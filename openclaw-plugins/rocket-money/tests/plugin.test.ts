import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createPlugin, TOOLS } from "../src/plugin.js";
vi.mock("mcp-hooks", () => ({
  loadLLMProvider: vi.fn(async () => ({})),
  InjectionGuard: class { async check(_name: string, text: string) { return {action: text.includes("injection-canary") ? "block" : "allow"}; } },
  SecretRedactor: class { async check(_name: string, text: string) { return {action:"modify", content:text.replaceAll("secret-canary", "[REDACTED]")}; } },
}));

function setup() {
  const callTool = vi.fn(async () => ({ content:[{type:"text",text:'{"status":"ok"}'}], structuredContent:{private:"secret-canary"} }));
  const connect = vi.fn(async () => ({callTool,close:vi.fn(async()=>{})}));
  const cfg = {plugins:{entries:{"rocket-money":{enabled:true,config:{command:"/trusted/python",stateDir:"/trusted/state",llmProvider:"fixture",writesEnabled:true}}}}};
  let factory: any; let stop: any;
  createPlugin(connect as any).register({config:cfg,registerTool:(f:any)=>{factory=f},registerService:(s:any)=>{stop=s.stop}} as any);
  const ctx = {agentId:"main",sessionKey:"session",workspaceDir:"/workspace",getRuntimeConfig:()=>cfg};
  return {callTool,connect,cfg,factory,ctx,stop};
}

describe("Rocket Money adapter", () => {
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
