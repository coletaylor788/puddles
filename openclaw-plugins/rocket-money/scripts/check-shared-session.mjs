import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// This packaged smoke check uses real SDK instance scopes and the bundled MCP
// subprocess. Its only operation is status against fresh synthetic state.
const [entryArg, python] = process.argv.slice(2);
assert.ok(entryArg && python, 'Usage: node check-shared-session.mjs <packaged-plugin.js> <python3.11>');
const entry = resolve(entryArg);
const root = await mkdtemp(join(await realpath(tmpdir()), 'rocket-shared-session-'));
const stops = [];
try {
 const classifier = join(root, 'classifier.mjs');
 await writeFile(classifier, 'export default class Fixture {async classify(_text,_prompt,options){return JSON.stringify(options?.label === "secret-redact" ? {findings:[]} : {detected:false,evidence:"synthetic fixture"});}}\n');
 const cfg = {plugins:{entries:{'rocket-money':{enabled:true,config:{command:python,stateDir:join(root,'state'),llmProvider:classifier,writesEnabled:false}}}}};
 const dist = dirname(dirname(createRequire(entry).resolve('openclaw/plugin-sdk/core')));
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
   let factory;
   module.createPlugin(async config=>{connections++;return module.connect(config);}).register({config:cfg,registerTool:f=>{factory=f;},registerService:s=>{stops.push(()=>owner.runCleanup(()=>s.stop()));}});
   const tool = factory({agentId:'main',sessionKey:'agent:main:main',workspaceDir:root,getRuntimeConfig:()=>cfg}).find(t=>t.name==='rocket_money_status');
   return ()=>owner.run(()=>tool.execute('synthetic-'+index,{}));
  });
  invocations.push(invoke);
 }
 for (const invoke of [...invocations,...invocations]) {
  const result = await invoke();
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.status,'ok',JSON.stringify(body));
  assert.equal(body.authentication,'unknown');
 }
 assert.equal(connections,1,'Registries must share one real MCP subprocess');
 console.log(JSON.stringify({status:'passed',nativeInstances:2,toolCalls:4,mcpConnections:connections,liveAccountAccess:false}));
} finally {
 for (const stop of stops) await stop();
 await rm(root,{recursive:true,force:true});
}
