import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// This packaged smoke check uses real SDK instance scopes and the bundled MCP
// subprocess. Its only operation is status against fresh synthetic state.
const [entryArg, python, runtimeArg] = process.argv.slice(2);
assert.ok(entryArg && python, 'Usage: node check-shared-session.mjs <packaged-plugin.js> <python3.11> [runtime-root]');
const entry = resolve(entryArg);
const root = await mkdtemp(join(await realpath(tmpdir()), 'rocket-shared-session-'));
const stops = [];
try {
 const classifier = join(root, 'classifier.mjs');
 await writeFile(classifier, 'export default class Fixture {async classify(_text,_prompt,options){return JSON.stringify(options?.label === "secret-redact" ? {findings:[]} : {detected:false,evidence:"synthetic fixture"});}}\n');
 const cfg = {plugins:{entries:{'rocket-money':{enabled:true,config:{command:python,stateDir:join(root,'state'),llmProvider:classifier,writesEnabled:false}}}}};
 // Standalone DEV/TEST runtimes are not nested beneath node_modules. Resolve
 // the host's own SDK export from its package root when explicitly supplied.
 const hostRequire = createRequire(runtimeArg ? join(resolve(runtimeArg), 'package.json') : entry);
 const dist = dirname(dirname(hostRequire.resolve('openclaw/plugin-sdk/core')));
 const chunk = (await readdir(dist)).find(name=>/^plugin-setup-module-.*\.mjs$/.test(name));
 assert.ok(chunk, 'Pinned native plugin loader required');
 const native = await import(pathToFileURL(join(dist,chunk)).href);
 const Instance = Object.values(native).find(value=>value?.name === 'PluginInstance');
 assert.ok(Instance, 'Native instance scope required');
 let connections = 0;
 const invocations = [];
 for (let index=0;index<2;index++) {
  const owner = new Instance('rocket-money');
  const invoke = await owner.run(async()=>{
   const module = await import(pathToFileURL(entry).href+'?registry='+index);
   let factory, start;
   module.createPlugin(async config=>{connections++;return module.connect(config);}).register({config:cfg,registerTool:f=>{factory=f;},registerService:s=>{start=s.start;stops.push(()=>owner.runCleanup(()=>s.stop()));}});
   await start();
   const tool = factory({agentId:'main',sessionKey:'agent:main:main',workspaceDir:root,getRuntimeConfig:()=>cfg}).find(t=>t.name==='rocket_money_status');
   return ()=>owner.run(()=>tool.execute('synthetic-'+index,{}));
  });
  invocations.push(invoke);
 }
 // Startup alone must run the scheduler, without any tool or live credentials.
 const receiptPath=join(root,'state/keepalive.json');
 const deadline=Date.now()+5000;
 let receipt;
 while (Date.now()<deadline) {
  try { receipt=JSON.parse(await readFile(receiptPath,'utf8')); break; }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.equal(receipt?.outcome,'needs_user_login');
 assert.equal(receipt?.intervalSeconds,1800);
 await assert.rejects(access(join(root,'state/auth/chrome')),{code:'ENOENT'});
 for (const invoke of [...invocations,...invocations]) {
  const result = await invoke();
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.status,'ok',JSON.stringify(body));
  assert.equal(body.authentication,'unknown');
 }
 assert.equal(connections,1,'Registries must share one real MCP subprocess');
 console.log(JSON.stringify({status:'passed',nativeInstances:2,toolCalls:4,mcpConnections:connections,keepaliveStarted:true,liveAccountAccess:false}));
} finally {
 for (const stop of stops) await stop();
 await rm(root,{recursive:true,force:true});
}
