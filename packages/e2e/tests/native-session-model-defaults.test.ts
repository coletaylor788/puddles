import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error Native lifecycle JavaScript module.
import { executeSessionModelDefaults, validateSessionModelDefaults, sessionModelDefaultEntryDigest, sessionModelDefaultActivityDigest } from '../src/native-session-model-defaults.mjs';
// @ts-expect-error Native lifecycle JavaScript module.
import { validateMigrationManifest } from '../src/native-state-migration.mjs';

const operation = {agentId:'collector',expected:{provider:'synthetic',model:'old'},desired:{provider:'synthetic',model:'new'}};
const original = () => ({sessionId:'same-session',updatedAt:12,lifecycleRevision:'same-generation',status:'done',
  modelOverrideSource:'auto',providerOverride:'synthetic',modelOverride:'old',modelOverrideFallbackOriginProvider:'synthetic',modelOverrideFallbackOriginModel:'old',
  model:'old',modelProvider:'synthetic',authProfileOverride:'retain-auth',authProfileOverrideSource:'user',cliSessionIds:{copilot:'history-id'},
  unknown:{preserve:true}});
function fixture(entries: Record<string,any> = {'agent:collector:auto':original()}) {
  const rows=structuredClone(entries);
  const config={agents:{entries:{collector:{model:{primary:'synthetic/new'}}}}};
  const options={operations:[operation],config,stateDir:'/synthetic/state',assertCurrent:vi.fn(),assertStatePath:vi.fn(),sdk:{
    resolveOpenClawAgentSqlitePath:vi.fn(()=>'/synthetic/state/agents/collector/agent/openclaw-agent.sqlite'),
    withOpenClawAgentDatabaseReadOnly:vi.fn(()=>({found:true,value:'a'.repeat(64)})),
    resolveStorePath:vi.fn(()=>'/synthetic/state/agents/collector/sessions/sessions.json'),
    resolveSessionStoreBackupPaths:vi.fn(()=>['/synthetic/state/agents/collector/agent/openclaw-agent.sqlite']),
    listSessionEntries:vi.fn(()=>Object.entries(rows).map(([sessionKey,entry])=>({sessionKey,entry:structuredClone(entry)}))),
    getSessionEntry:vi.fn(({sessionKey}:any)=>structuredClone(rows[sessionKey])),
    applyModelOverrideToSessionEntry:vi.fn(({entry}:any)=>{entry.modelOverrideSource='default';delete entry.providerOverride;delete entry.modelOverride;delete entry.modelOverrideFallbackOriginProvider;delete entry.modelOverrideFallbackOriginModel;delete entry.model;delete entry.modelProvider;entry.updatedAt=999;}),
    patchSessionEntry:vi.fn(async(params:any)=>{
      const patch=await params.update(structuredClone(rows[params.sessionKey]),{existingEntry:structuredClone(rows[params.sessionKey])});
      params.assertCommitAllowed();
      if(params.replaceEntry) rows[params.sessionKey]={};
      for(const [key,value] of Object.entries(patch)) if(value===undefined) delete rows[params.sessionKey][key];else rows[params.sessionKey][key]=value;
      return structuredClone(rows[params.sessionKey]);
    }),
  }};
  return {rows,options,run:()=>executeSessionModelDefaults(options)};
}
describe('stopped session default selection migration',()=>{
  it('changes only the auto self-origin selection and preserves identity, auth, history, and activity',async()=>{
    const before=original();const f=fixture();
    expect(await f.run()).toEqual({changed:1,recovered:0});
    const after=f.rows['agent:collector:auto'];
    expect(after).toMatchObject({sessionId:before.sessionId,updatedAt:before.updatedAt,lifecycleRevision:before.lifecycleRevision,
      authProfileOverride:before.authProfileOverride,authProfileOverrideSource:before.authProfileOverrideSource,cliSessionIds:before.cliSessionIds,unknown:before.unknown,
      modelOverrideSource:'default'});
    expect(after).not.toHaveProperty('modelOverride');expect(after).not.toHaveProperty('modelOverrideFallbackOriginModel');
    expect(f.options.sdk.applyModelOverrideToSessionEntry).toHaveBeenCalledWith(expect.objectContaining({explicitDefaultSelection:true,preserveAuthProfileOverride:true,selection:{provider:'synthetic',model:'new',isDefault:true}}));
    expect(f.options.sdk.patchSessionEntry).toHaveBeenCalledWith(expect.objectContaining({preserveActivity:true,preserveConversation:true,preservePrivateMetadata:true,preserveWindowActivity:true,skipMaintenance:true,requireWriteSuccess:true}));
    expect(await f.run()).toEqual({changed:0,recovered:0});
  });
  it('leaves user pins, other origins, and unrelated models unchanged',async()=>{
    const entries={
      'agent:collector:user':{...original(),modelOverrideSource:'user'},
      'agent:collector:other-origin':{...original(),modelOverrideFallbackOriginModel:'different'},
      'agent:collector:other-model':{...original(),modelOverride:'different'},
      'agent:collector:default':{...original(),modelOverrideSource:'default'},
    };
    const f=fixture(entries);expect(await f.run()).toEqual({changed:0,recovered:0});expect(f.rows).toEqual(entries);expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('moves multiple reviewed automatic defaults while preserving user pins and cross-origin fallbacks',async()=>{
    const intermediate={...original(),modelOverride:'intermediate',modelOverrideFallbackOriginModel:'intermediate',model:'intermediate'};
    const entries={'agent:collector:old':original(),'agent:collector:intermediate':intermediate,
      'agent:collector:user':{...intermediate,modelOverrideSource:'user'},
      'agent:collector:fallback':{...intermediate,modelOverrideFallbackOriginModel:'old'}};
    const f=fixture(entries);
    f.options.operations=[{...operation,additionalExpected:[{provider:'synthetic',model:'intermediate'}]} as any];
    expect(await f.run()).toEqual({changed:2,recovered:0});
    for(const key of ['old','intermediate']) expect(f.rows[`agent:collector:${key}`]).toMatchObject({modelOverrideSource:'default',updatedAt:12,unknown:{preserve:true}});
    for(const key of ['user','fallback']) expect(f.rows[`agent:collector:${key}`]).toEqual(entries[`agent:collector:${key}` as keyof typeof entries]);
    expect(await f.run()).toEqual({changed:0,recovered:0});
    const blocked=fixture({'agent:collector:old':original(),'agent:collector:intermediate':{...intermediate,status:'running'}});
    blocked.options.operations=f.options.operations;
    await expect(blocked.run()).rejects.toThrow(/locked or not idle/);
    expect(blocked.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('rejects unbounded, duplicate, unchanged, or cross-provider additional selections',()=>{
    const next={provider:'synthetic',model:'intermediate'};
    expect(validateSessionModelDefaults([{...operation,additionalExpected:[next]}])).toBeTruthy();
    for(const additionalExpected of [undefined,[],{},Array(8).fill(next),[next,next],[operation.expected],[operation.desired],
      [{...next,provider:'other'}],[{...next,extra:true}],[{...next,model:'bad\nmodel'}]]) {
      expect(()=>validateSessionModelDefaults([{...operation,additionalExpected}])).toThrow();
    }
  });
  it.each([{modelSelectionLocked:true},{status:'running'},{status:undefined},{liveModelSwitchPending:true},{pendingTranscriptRepair:[{}]},{cronRunContinuation:{phase:'ready'}}])('rejects every selected non-idle or locked row before any mutation: %j',async state=>{
    const f=fixture({'agent:collector:first':original(),'agent:collector:blocked':{...original(),...state}});
    await expect(f.run()).rejects.toThrow(/locked or not idle/);expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('rejects changed agent configuration and unsafe state paths before mutation',async()=>{
    const f=fixture();f.options.config.agents.entries.collector.model.primary='synthetic/unreviewed';
    await expect(f.run()).rejects.toThrow(/configured agent primary/);
    f.options.config.agents.entries.collector.model.primary='synthetic/new';f.options.assertStatePath.mockImplementation(()=>{throw new Error('escaped state');});
    await expect(f.run()).rejects.toThrow('escaped state');expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('rejects preflight row drift before changing any selected row',async()=>{
    const f=fixture({'agent:collector:first':original(),'agent:collector:changed':original()});
    f.options.sdk.getSessionEntry.mockImplementation(({sessionKey}:any)=>({...f.rows[sessionKey],...(sessionKey.endsWith('changed')?{updatedAt:99}:{})}));
    await expect(f.run()).rejects.toThrow(/predecessor changed/);expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('revalidates the native callback and final commit ownership',async()=>{
    const f=fixture();f.options.sdk.patchSessionEntry.mockImplementation(async(params:any)=>{
      return params.update({...f.rows[params.sessionKey],lifecycleRevision:'successor'},{existingEntry:f.rows[params.sessionKey]});
    });
    await expect(f.run()).rejects.toThrow(/predecessor changed/);
    const g=fixture();let calls=0;g.options.assertCurrent.mockImplementation(()=>{if(++calls===4)throw new Error('ownership changed');});
    await expect(g.run()).rejects.toThrow('ownership changed');expect(g.rows['agent:collector:auto']).toEqual(original());
  });
  it('refuses a native helper that unexpectedly changes auth or unrelated metadata',async()=>{
    const f=fixture();f.options.sdk.applyModelOverrideToSessionEntry.mockImplementation(({entry}:any)=>{delete entry.authProfileOverride;});
    await expect(f.run()).rejects.toThrow(/unrelated session metadata/);expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('validates the strict bounded manifest and admits a session-only migration',()=>{
    expect(validateMigrationManifest({schemaVersion:1,configOperations:[],sessionModelDefaults:[operation]})).toBeTruthy();
    for(const invalid of [[],Array(17).fill(operation),[operation,operation],[{...operation,agentId:['collector']}],
      [{...operation,agentId:'../collector'}],[{...operation,extra:true}],[{...operation,desired:operation.expected}],
      [{...operation,desired:{provider:'different',model:'new'}}],
      [{...operation,expected:{provider:'synthetic',model:'bad\nmodel'}}]]) expect(()=>validateSessionModelDefaults(invalid)).toThrow();
  });
});

function repaired() {
  const entry:any=original();
  for(const key of ['modelOverrideSource','providerOverride','modelOverride','modelOverrideFallbackOriginProvider','modelOverrideFallbackOriginModel']) delete entry[key];
  entry.updatedAt=90;
  return entry;
}
function recoveryFor(sessionKey:string,entry:any) {
  return {sessionKey,expectedEntrySha256:sessionModelDefaultEntryDigest(entry),expectedActivitySha256:'a'.repeat(64),originalUpdatedAt:12,originalWindowActivity:{updatedAt:18,transcriptObservedAt:9}};
}
function recoveryFixture(entries:Record<string,any>={'agent:collector:repaired':repaired()}) {
  const f=fixture(entries);
  (f.options.operations[0] as any)={...operation,recoveries:Object.entries(entries).filter(([key])=>key.includes('repaired')).map(([key,entry])=>recoveryFor(key,entry))};
  return f;
}
describe('sealed session model recovery',()=>{
  it('uses a complete current-derived replacement to restore activity and counts recovery separately',async()=>{
    const before=repaired();
    const f=recoveryFixture({'agent:collector:repaired':before,'agent:collector:auto':original(),
      'agent:collector:user':{...original(),modelOverrideSource:'user'}});
    expect(await f.run()).toEqual({changed:1,recovered:1});
    const expected={...before,updatedAt:12,modelOverrideSource:'default'};delete expected.model;delete expected.modelProvider;
    expect(f.rows['agent:collector:repaired']).toEqual(expected);
    expect(f.rows['agent:collector:user']).toEqual({...original(),modelOverrideSource:'user'});
    expect(f.options.sdk.patchSessionEntry).toHaveBeenCalledWith(expect.objectContaining({sessionKey:'agent:collector:repaired',replaceEntry:true,preserveActivity:true,preserveConversation:true,preservePrivateMetadata:true,restoreWindowActivity:{updatedAt:18,transcriptObservedAt:9}}));
    await expect(f.run()).rejects.toThrow(/recovery predecessor differs/);
  });
  it('hashes the persisted JSON projection independent of insertion order',()=>{
    expect(sessionModelDefaultEntryDigest({nested:{b:2,a:1},absent:undefined,a:3})).toBe(sessionModelDefaultEntryDigest({a:3,nested:{a:1,b:2}}));
    expect(sessionModelDefaultEntryDigest({a:3})).not.toBe(sessionModelDefaultEntryDigest({a:4}));
  });
  it.each([{updatedAt:91},{status:'running'},{modelSelectionLocked:true},{unknown:{progressed:true}},
    {modelOverrideSource:'user'},{providerOverride:'synthetic'},{modelOverrideRouteResolution:{route:'other'}},
    {pendingFinalDelivery:{status:'pending'}},{sessionId:'successor'}])('refuses sealed recovery drift before any ordinary write: %j',async delta=>{
    const f=recoveryFixture({'agent:collector:auto':original(),'agent:collector:repaired':repaired()});
    Object.assign(f.rows['agent:collector:repaired'],delta);
    await expect(f.run()).rejects.toThrow();expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it.each([{status:'running'},{modelSelectionLocked:true},{modelOverrideSource:'auto'},{updatedAt:1}])('refuses ineligible entries even when their digest matches: %j',async delta=>{
    const f=recoveryFixture({'agent:collector:auto':original(),'agent:collector:repaired':{...repaired(),...delta}});
    await expect(f.run()).rejects.toThrow();expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('refuses missing sealed entries before any ordinary write',async()=>{
    const f=recoveryFixture({'agent:collector:auto':original(),'agent:collector:repaired':repaired()});
    delete f.rows['agent:collector:repaired'];
    await expect(f.run()).rejects.toThrow(/predecessor missing/);expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
  });
  it('rechecks the complete recovery predecessor inside the native write callback',async()=>{
    const f=recoveryFixture();f.options.sdk.patchSessionEntry.mockImplementation(async(params:any)=>
      params.update({...f.rows[params.sessionKey],updatedAt:91},{existingEntry:f.rows[params.sessionKey]}));
    await expect(f.run()).rejects.toThrow(/predecessor changed/);expect(f.rows['agent:collector:repaired']).toEqual(repaired());
  });
  it('validates bounded strict recovery inputs',()=>{
    const recovery=recoveryFor('agent:collector:repaired',repaired());
    expect(validateSessionModelDefaults([{...operation,recoveries:[recovery]}])).toBeTruthy();
    expect(validateSessionModelDefaults([{...operation,recoveries:[{...recovery,originalWindowActivity:{updatedAt:18,transcriptObservedAt:null}}]}])).toBeTruthy();
    for(const recoveries of [[],Array(257).fill(recovery),[recovery,recovery],
      [{...recovery,extra:true}],[{...recovery,sessionKey:'agent:other:key'}],
      [{...recovery,sessionKey:'agent:collector:bad\nkey'}],[{...recovery,expectedEntrySha256:'bad'}],
      [{...recovery,expectedActivitySha256:'bad'}],[{...recovery,originalUpdatedAt:-1}],[{...recovery,originalUpdatedAt:1.5}],
      ...[undefined,{}, {updatedAt:-1,transcriptObservedAt:0},{updatedAt:1,transcriptObservedAt:-1},
        {updatedAt:1,transcriptObservedAt:0.5},{updatedAt:1,transcriptObservedAt:null,extra:true}]
        .map(originalWindowActivity=>[{...recovery,originalWindowActivity}])]) {
      expect(()=>validateSessionModelDefaults([{...operation,recoveries}])).toThrow();
    }
  });
});

describe('selected recovery activity witness',()=>{
  it('blocks changed selected activity before ordinary writes and at native commit admission',async()=>{
    const f=recoveryFixture({'agent:collector:auto':original(),'agent:collector:repaired':repaired()});
    f.options.sdk.withOpenClawAgentDatabaseReadOnly.mockReturnValue({found:true,value:'b'.repeat(64)});
    await expect(f.run()).rejects.toThrow(/activity changed/);expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
    const g=recoveryFixture();
    g.options.sdk.patchSessionEntry.mockImplementation(async(params:any)=>{
      params.update(structuredClone(g.rows[params.sessionKey]),{existingEntry:g.rows[params.sessionKey]});
      g.options.sdk.withOpenClawAgentDatabaseReadOnly.mockReturnValue({found:true,value:'b'.repeat(64)});
      params.assertCommitAllowed();
    });
    await expect(g.run()).rejects.toThrow(/activity changed/);expect(g.rows['agent:collector:repaired']).toEqual(repaired());
  });
  it('binds exact own history, private node metadata, windows and inputs while excluding another session and shared conversation activity',()=>{
    const db=new DatabaseSync(':memory:');
    const tables=['transcript_events','session_transcript_active_events','transcript_rewrite_watermarks','session_transcript_archives',
      'session_transcript_cold_archives','session_pending_inputs','session_input_completions','session_conversations'];
    try {
      db.exec(`CREATE TABLE session_nodes(session_key TEXT,current_session_id TEXT,private_writer TEXT);
        CREATE TABLE session_windows(session_key TEXT,session_id TEXT,updated_at INTEGER);
        CREATE TABLE session_participants(session_key TEXT,actor_id TEXT);
        CREATE TABLE conversations(conversation_id TEXT,label TEXT,updated_at INTEGER);
        INSERT INTO session_nodes VALUES('selected','selected-id','fence'),('other','other-id','other');
        INSERT INTO session_windows VALUES('selected','selected-id',100),('other','other-id',200);`);
      for(const table of tables) db.exec(`CREATE TABLE ${table}(session_id TEXT,value BLOB,session_key TEXT); INSERT INTO ${table} VALUES('selected-id',x'0102','selected'),('other-id',x'0304','other')`);
      const before=sessionModelDefaultActivityDigest(db,'selected');
      for(const table of tables) db.exec(`UPDATE ${table} SET value=x'9999' WHERE session_id='other-id'`);
      db.exec("INSERT INTO conversations VALUES('shared','newer',999)");
      expect(sessionModelDefaultActivityDigest(db,'selected')).toBe(before);
      for(const table of tables) {
        db.exec(`UPDATE ${table} SET value=x'0103' WHERE session_id='selected-id'`);
        expect(sessionModelDefaultActivityDigest(db,'selected')).not.toBe(before);
        db.exec(`UPDATE ${table} SET value=x'0102' WHERE session_id='selected-id'`);
      }
      for(const table of ['session_pending_inputs','session_input_completions','session_transcript_archives']) {
        db.exec(`INSERT INTO ${table} VALUES('unbound-id',x'05','selected')`);
        expect(sessionModelDefaultActivityDigest(db,'selected')).not.toBe(before);
        db.exec(`DELETE FROM ${table} WHERE session_id='unbound-id'`);
      }
      db.exec("UPDATE session_nodes SET private_writer='new-fence' WHERE session_key='selected'");
      expect(sessionModelDefaultActivityDigest(db,'selected')).not.toBe(before);
      db.exec("UPDATE session_nodes SET private_writer='fence' WHERE session_key='selected'; UPDATE session_windows SET updated_at=101 WHERE session_key='selected'");
      expect(sessionModelDefaultActivityDigest(db,'selected')).not.toBe(before);
      expect(db.isTransaction).toBe(false);
    } finally { db.close(); }
  });
});
