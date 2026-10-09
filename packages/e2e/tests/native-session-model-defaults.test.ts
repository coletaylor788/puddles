import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native lifecycle JavaScript module.
import { executeSessionModelDefaults, validateSessionModelDefaults } from '../src/native-session-model-defaults.mjs';
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
    resolveStorePath:vi.fn(()=>'/synthetic/state/agents/collector/sessions/sessions.json'),
    resolveSessionStoreBackupPaths:vi.fn(()=>['/synthetic/state/agents/collector/agent/openclaw-agent.sqlite']),
    listSessionEntries:vi.fn(()=>Object.entries(rows).map(([sessionKey,entry])=>({sessionKey,entry:structuredClone(entry)}))),
    getSessionEntry:vi.fn(({sessionKey}:any)=>structuredClone(rows[sessionKey])),
    applyModelOverrideToSessionEntry:vi.fn(({entry}:any)=>{entry.modelOverrideSource='default';delete entry.providerOverride;delete entry.modelOverride;delete entry.modelOverrideFallbackOriginProvider;delete entry.modelOverrideFallbackOriginModel;delete entry.model;delete entry.modelProvider;entry.updatedAt=999;}),
    patchSessionEntry:vi.fn(async(params:any)=>{
      const patch=await params.update(structuredClone(rows[params.sessionKey]),{existingEntry:structuredClone(rows[params.sessionKey])});
      params.assertCommitAllowed();
      for(const [key,value] of Object.entries(patch)) if(value===undefined) delete rows[params.sessionKey][key];else rows[params.sessionKey][key]=value;
      return structuredClone(rows[params.sessionKey]);
    }),
  }};
  return {rows,options,run:()=>executeSessionModelDefaults(options)};
}
describe('stopped session default selection migration',()=>{
  it('changes only the auto self-origin selection and preserves identity, auth, history, and activity',async()=>{
    const before=original();const f=fixture();
    expect(await f.run()).toEqual({changed:1});
    const after=f.rows['agent:collector:auto'];
    expect(after).toMatchObject({sessionId:before.sessionId,updatedAt:before.updatedAt,lifecycleRevision:before.lifecycleRevision,
      authProfileOverride:before.authProfileOverride,authProfileOverrideSource:before.authProfileOverrideSource,cliSessionIds:before.cliSessionIds,unknown:before.unknown,
      modelOverrideSource:'default'});
    expect(after).not.toHaveProperty('modelOverride');expect(after).not.toHaveProperty('modelOverrideFallbackOriginModel');
    expect(f.options.sdk.applyModelOverrideToSessionEntry).toHaveBeenCalledWith(expect.objectContaining({explicitDefaultSelection:true,preserveAuthProfileOverride:true,selection:{provider:'synthetic',model:'new',isDefault:true}}));
    expect(f.options.sdk.patchSessionEntry).toHaveBeenCalledWith(expect.objectContaining({preserveActivity:true,skipMaintenance:true,requireWriteSuccess:true}));
    expect(await f.run()).toEqual({changed:0});
  });
  it('leaves user pins, other origins, and unrelated models unchanged',async()=>{
    const entries={
      'agent:collector:user':{...original(),modelOverrideSource:'user'},
      'agent:collector:other-origin':{...original(),modelOverrideFallbackOriginModel:'different'},
      'agent:collector:other-model':{...original(),modelOverride:'different'},
      'agent:collector:default':{...original(),modelOverrideSource:'default'},
    };
    const f=fixture(entries);expect(await f.run()).toEqual({changed:0});expect(f.rows).toEqual(entries);expect(f.options.sdk.patchSessionEntry).not.toHaveBeenCalled();
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
