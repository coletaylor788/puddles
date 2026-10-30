import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
const [runtimeArg,scratch,mode]=process.argv.slice(2);
const runtime=resolve(runtimeArg);
if(mode!=='--child') {
 const root=mkdtempSync(join(resolve(scratch),'tool-results-'));
 try {
  writeFileSync(join(root,'openclaw.json'),'{}');
  const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),runtime,root,'--child'],{
   cwd:root,encoding:'utf8',timeout:60000,
   env:{PATH:process.env.PATH,HOME:root,TMPDIR:root,OPENCLAW_STATE_DIR:root,OPENCLAW_CONFIG_PATH:join(root,'openclaw.json')},
  });
  assert.equal(result.status,0,result.error?.message??result.stderr);
  process.stdout.write(result.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}else{
 const deny=()=>{throw new Error('External network forbidden in tool result fixtures');};
 globalThis.fetch=http.request=http.get=https.request=https.get=deny;
 const root=resolve(scratch),dist=join(runtime,'dist'),tools=[],cleanup=[];
 const modules=readdirSync(dist).filter(name=>name.endsWith('.mjs'));
 async function native(name){
  for(const file of modules){
   const text=readFileSync(join(dist,file),'utf8');
   const alias=text.match(new RegExp(`export \\{[^}]*\\b${name} as ([\\w$]+)`))?.[1];
   if(alias)return (await import(pathToFileURL(join(dist,file))))[alias];
  }
  throw new Error('Missing native export: '+name);
 }
 const run=await native('runCodeModeScriptHeadless'),ref=(await native('createToolSearchCatalogRef'))();
 const register=await native('registerHeadlessToolSearchCatalog'),clear=await native('clearToolSearchCatalog');
 const provider=join(root,'provider.mjs'),mcp=join(root,'mcp.mjs');
 writeFileSync(provider,'export default class { async classify(){return JSON.stringify({detected:false,evidence:""});} }');
 writeFileSync(mcp,`import {createInterface} from 'node:readline';
 for await(const line of createInterface({input:process.stdin})){
  const q=JSON.parse(line);if(q.id===undefined)continue;let result;
  if(q.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  else if(q.method==='tools/call'&&['list_emails','calendar'].includes(q.params.name))result={content:[{type:'text',text:JSON.stringify({fixture:q.params.name})}],structuredContent:{private:'RAW_STRUCTURED'}};
  else throw new Error('Unrecorded MCP operation');
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
 }`);
 const ctx={agentId:'main',sessionKey:'agent:main:fixture',workspaceDir:root};
 function api(config,pluginConfig){return {config,pluginConfig,
  logger:{info(){},warn(){},error(message){throw new Error(message);},debug(){}},
  registerTool(factory){const value=typeof factory==='function'?factory({...ctx,config}):factory;if(value)tools.push(...(Array.isArray(value)?value:[value]));},
  registerService(service){cleanup.push(service.stop);},on(name,fn){if(name==='session_end')cleanup.push(fn);},
 };}
 try{
  const gmail=(await import(pathToFileURL(join(runtime,'plugins/secure-gmail/plugin.js')))).default;
  gmail.register(api({}, {gmailMcpCommand:process.execPath,gmailMcpArgs:[mcp],llmProvider:provider,auditLogPath:join(root,'gmail-audit.jsonl')}));
  const calendar=(await import(pathToFileURL(join(runtime,'plugins/secure-apple-calendar/plugin.js')))).default;
  calendar.register(api({}, {applePimMcpCommand:process.execPath,applePimMcpArgs:[mcp],llmProvider:provider,auditLogPath:join(root,'calendar-audit.jsonl')}));
  const money=await import(pathToFileURL(join(runtime,'plugins/rocket-money/plugin.js')));
  const cfg={plugins:{entries:{'rocket-money':{enabled:true,config:{command:'/fixture/python',stateDir:root,llmProvider:provider}}}}};
  money.createPlugin(async()=>({callTool:async()=>({content:[{type:'text',text:'{"fixture":"money"}'}],structuredContent:{private:'RAW_STRUCTURED'}}),close:async()=>{}}),money.createBridgeRuntime()).register(api(cfg));
  const shell=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const cli=join(root,'pim.mjs');writeFileSync(cli,'console.log(JSON.stringify({success:true,lists:[{id:"fixture-list",title:"Fixture reminders"}]}));');
  for(const name of ['calendar-cli','reminder-cli','contacts-cli','mail-cli'])writeFileSync(join(root,name),`#!/bin/sh\nexec ${shell(process.execPath)} ${shell(cli)} "$@"\n`,{mode:0o700});
  const pim=(await import(pathToFileURL(join(runtime,'plugins/apple-pim-cli/dist/index.js')))).default;
  pim.register(api({}, {binDir:root}));
  const names=['list_emails','calendar_read','rocket_money_status','apple_pim_reminder'];
  register({catalogRef:ref,tools:tools.filter(tool=>names.includes(tool.name))});
  assert.equal(ref.current.entries.length,4);
  const config={tools:{codeMode:{enabled:true,executor:'quickjs'}},plugins:{entries:{'code-mode-quickjs':{enabled:true}}}};
  const result=await run({ctx:{...ctx,config,runtimeConfig:config,catalogRef:ref,sessionId:'fixture',runId:'fixture'},
   code:'return {gmail:await list_emails({max_results:1}),calendar:await calendar_read({action:"list"}),money:await rocket_money_status({}),reminders:await apple_pim_reminder({action:"lists"})};',wallClockMs:45000});
  assert.equal(result.status,'completed',result.error);
  for(const [name,value] of [['gmail','list_emails'],['calendar','calendar'],['money','money']])assert.deepEqual(JSON.parse(result.value[name].content[0].text),{fixture:value});
  assert.ok(result.value.reminders.content[0].text.includes('fixture-list'));
  assert.ok(result.value.reminders.content[0].text.includes('UNTRUSTED_REMINDER_DATA_'));
  assert.ok(!JSON.stringify(result.value).includes('RAW_STRUCTURED'));
  console.log(JSON.stringify({status:'passed',executor:'quickjs',tools:4,externalWrites:0}));
 }finally{clear(ref);for(const close of cleanup)await close?.();}
}
