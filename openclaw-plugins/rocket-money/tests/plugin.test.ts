import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPlugin, createBridgeRuntime, TOOLS } from "../src/plugin.js";
const leakCheck = vi.hoisted(() => vi.fn(async (_name: string, text: string) => {
  if (text.includes("guard-failure")) throw new Error("private classifier error");
  return {action: text.includes("outbound-secret") ? "block" : "allow"};
}));
vi.mock("mcp-hooks", () => ({
  LeakGuard: class { check = leakCheck; },
  loadLLMProvider: vi.fn(async () => ({})),
  InjectionGuard: class { async check(_name: string, text: string) { return {action: text.includes("injection-canary") ? "block" : "allow"}; } },
  SecretRedactor: class { async check(_name: string, text: string) { return {action:"modify", content:text.replaceAll("secret-canary", "[REDACTED]")}; } },
}));

function setup() {
  const callTool = vi.fn(async () => ({ content:[{type:"text",text:'{"status":"ok"}'}], structuredContent:{private:"secret-canary"} }));
  const connect = vi.fn(async () => ({callTool,close:vi.fn(async()=>{})}));
  const cfg = {plugins:{entries:{"rocket-money":{enabled:true,config:{command:"/trusted/python",stateDir:"/trusted/state",llmProvider:"fixture",writesEnabled:true}}}}};
  let factory: any; let stop: any;
  createPlugin(connect as any, createBridgeRuntime()).register({config:cfg,registerTool:(f:any)=>{factory=f},registerService:(s:any)=>{stop=s.stop}} as any);
  const ctx = {agentId:"main",sessionKey:"session",workspaceDir:"/workspace",getRuntimeConfig:()=>cfg};
  return {callTool,connect,cfg,factory,ctx,stop};
}

describe("Rocket Money adapter", () => {
 it.each(["outbound-secret", "guard-failure"])("stops %s before opening or calling MCP", async (value) => {
   const {factory,ctx,callTool,connect}=setup();
   const read=factory(ctx).find((t:any)=>t.name==="rocket_money_read");
   const out=await read.execute("one",{query:"query Q($s:String){search(s:$s){id}}",variables:{s:value}});
   expect(out.content[0].text).toContain("EGRESS_BLOCKED");
   expect(callTool).not.toHaveBeenCalled();
   expect(connect).not.toHaveBeenCalled();
   expect(JSON.stringify(out)).not.toContain("private classifier error");
 });
 it("rechecks authority after outbound classification", async () => {
   const {factory,ctx,cfg,callTool}=setup();
   const write=factory(ctx).find((t:any)=>t.name==="rocket_money_set_date");
   leakCheck.mockImplementationOnce(async () => {
     cfg.plugins.entries["rocket-money"].config.writesEnabled=false;
     return {action:"allow"};
   });
   expect((await write.execute("one",{})).content[0].text).toContain("ACCESS_DENIED");
   expect(callTool).not.toHaveBeenCalled();
 });
 it("matches the Python server's tool manifest", () => {
   const source=JSON.parse(readFileSync(new URL("../../../servers/rocket-money-mcp/src/rocket_money_mcp/resources/tools.json",import.meta.url),"utf8"));
   expect(TOOLS).toEqual(source);
 });
 it("denies absent and lower-tier identity", () => {
   const {factory,ctx}=setup();
   for (const agentId of [undefined,"household","reader","browser","debug"]) expect(factory({...ctx,agentId})).toEqual([]);
   expect(factory({...ctx,sessionKey:undefined})).toEqual([]);
 });
 it("retains one bridge across tools and turns", async () => {
   const {factory,ctx,connect}=setup();
   await factory(ctx)[0].execute("one",{});
   await factory({...ctx,sessionKey:"next-turn"})[0].execute("two",{});
   expect(connect).toHaveBeenCalledTimes(1);
 });
 it("rechecks grants before calls", async () => {
   const {factory,ctx,cfg,callTool}=setup(); const tools=factory(ctx);
   cfg.plugins.entries["rocket-money"].enabled=false;
   expect((await tools[0].execute("one",{})).content[0].text).toContain("ACCESS_DENIED");
   expect(callTool).not.toHaveBeenCalled();
 });
 it("separately disables writes including existing tool instances", async () => {
   const {factory,ctx,cfg,callTool}=setup(); const write=factory(ctx).find((t:any)=>t.name==="rocket_money_set_date");
   cfg.plugins.entries["rocket-money"].config.writesEnabled=false;
   expect(factory(ctx)).toHaveLength(3);
   expect((await write.execute("one",{})).content[0].text).toContain("ACCESS_DENIED");
   expect(callTool).not.toHaveBeenCalled();
 });
 it("filters all returned content and never relays raw structured payloads", async () => {
   const {factory,ctx,callTool}=setup();
   callTool.mockResolvedValue({content:[{type:"text",text:"secret-canary"}],structuredContent:{private:"secret-canary"}});
   const out=await factory(ctx)[0].execute("one",{});
   expect(JSON.stringify(out)).not.toContain("secret-canary");
   expect(out.content[0].text).toBe("[REDACTED]");
 });
 it("does not release an old account result after configuration switches", async () => {
   const {factory,ctx,cfg,callTool}=setup();
   callTool.mockImplementation(async () => {
     cfg.plugins.entries["rocket-money"].config.stateDir="/trusted/different-account";
     return {content:[{type:"text",text:"old-account-data"}],structuredContent:{private:""}};
   });
   const out=await factory(ctx)[0].execute("one",{});
   expect(JSON.stringify(out)).not.toContain("old-account-data");
   expect(out.content[0].text).toContain("ACCESS_DENIED");
 });
 it("blocks injected provider text", async () => {
   const {factory,ctx,callTool}=setup();
   callTool.mockResolvedValue({content:[{type:"text",text:"injection-canary"}],structuredContent:{private:"secret-canary"}});
   expect((await factory(ctx)[0].execute("one",{})).content[0].text).toContain("CONTENT_BLOCKED");
 });
 it("does not replay on connection failure and returns request ID", async () => {
   const {factory,ctx,callTool}=setup(); callTool.mockRejectedValue(new Error("secret-canary"));
   const out=await factory(ctx).find((t:any)=>t.name==="rocket_money_set_category").execute("one",{requestId:"original-id"});
   expect(out.content[0].text).toContain("original-id");
   expect(out.content[0].text).toContain("OUTCOME_UNKNOWN");
   expect(JSON.stringify(out)).not.toContain("secret-canary");
   expect(callTool).toHaveBeenCalledTimes(1);
 });
});


describe("shared gateway session", () => {
 function registration(plugin: ReturnType<typeof createPlugin>, cfg: any) {
  let factory: any; let stop: () => Promise<void> = async () => {};
  plugin.register({config:cfg,registerTool:(f:any)=>{factory=f},registerService:(s:any)=>{stop=s.stop}} as any);
  const ctx={agentId:"main",sessionKey:"agent:main:main",workspaceDir:"/workspace",getRuntimeConfig:()=>cfg};
  return {invoke:()=>factory(ctx)[0].execute("request",{}),stop};
 }
 const config=()=>({plugins:{entries:{"rocket-money":{enabled:true,config:{command:"/trusted/python",stateDir:"/trusted/shared-state",llmProvider:"fixture"}}}}});
 it("reuses one bridge across native plugin instances and separate module loads", async () => {
  const close=vi.fn(async()=>{});
  const callTool=vi.fn(async()=>({content:[{type:"text",text:'{"status":"ok"}'}]}));
  const connector=vi.fn(async()=>({callTool,close}));
  const cfg=config();
  // Use the pinned loader's real scopes; plain module imports miss its
  // instance-local runtime-store behavior. Chunk names vary with the build.
  const dist=dirname(dirname(createRequire(import.meta.url).resolve("openclaw/plugin-sdk/core")));
  const chunk=readdirSync(dist).find(name=>/^plugin-setup-module-.*\.mjs$/.test(name));
  expect(chunk).toBeDefined();
  const native=await import(pathToFileURL(join(dist,chunk!)).href);
  const Instance=Object.values(native).find((value:any)=>value?.name==="PluginInstance") as any;
  expect(Instance).toBeDefined();
  const httpOwner=new Instance("rocket-money");
  const agentOwner=new Instance("rocket-money");
  const http=httpOwner.run(()=>registration(createPlugin(connector as any),cfg));
  const agent=agentOwner.run(()=>registration(createPlugin(connector as any),cfg));
  vi.resetModules();
  const later=await agentOwner.run(async()=>{
   const reloaded=await import("../src/plugin.js");
   return registration(reloaded.createPlugin(connector as any),cfg);
  });
  try {
   await httpOwner.run(()=>http.invoke());
   await agentOwner.run(()=>agent.invoke());
   await agentOwner.run(()=>later.invoke());
   expect(connector).toHaveBeenCalledTimes(1);
   expect(callTool).toHaveBeenCalledTimes(3);
  } finally {await http.stop();await agent.stop();await later.stop();}
  expect(close).toHaveBeenCalledTimes(1);
 });
 it("waits for an active call before shutdown and lets the next call reconnect", async () => {
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  let started!:()=>void;
  const running=new Promise<void>(resolve=>{started=resolve;});
  const close=vi.fn(async()=>{});
  const callTool=vi.fn(async()=>{started();await blocked;return {content:[{type:"text",text:'{"status":"ok"}'}]};});
  const connector=vi.fn(async()=>({callTool,close}));
  const plugin=createPlugin(connector as any,createBridgeRuntime());
  const first=registration(plugin,config());const second=registration(plugin,config());
  const call=first.invoke();await running;
  const stop=second.stop();
  expect(close).not.toHaveBeenCalled();
  release();await call;await stop;
  expect(close).toHaveBeenCalledTimes(1);
  await second.invoke();
  expect(connector).toHaveBeenCalledTimes(2);
  await second.stop();
 });
 it("rechecks a queued caller's permission after another registration finishes", async () => {
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
  let started!:()=>void;const running=new Promise<void>(resolve=>{started=resolve;});
  const callTool=vi.fn(async()=>{started();await blocked;return {content:[{type:"text",text:'{"status":"ok"}'}]};});
  const connector=vi.fn(async()=>({callTool,close:vi.fn(async()=>{})}));
  const plugin=createPlugin(connector as any,createBridgeRuntime());
  const cfg=config();const first=registration(plugin,cfg);const second=registration(plugin,cfg);
  const call=first.invoke();await running;
  const queued=second.invoke();
  await Promise.resolve();await Promise.resolve();
  cfg.plugins.entries["rocket-money"].enabled=false;
  release();await call;
  expect((await queued).content[0].text).toContain("ACCESS_DENIED");
  expect(callTool).toHaveBeenCalledTimes(1);
  await first.stop();
 });
});
