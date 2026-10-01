import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import plugin from "../src/plugin.js";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, {recursive: true, force: true}); });
function fixture(script?: string) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "puddles-cli-plugin-")); directories.push(directory);
  const state = join(directory, "state"); mkdirSync(state, {mode: 0o700});
  const policyPath = join(directory, "policy.json");
  const policy = {version: 1, stateDir: state, curlPath: "/usr/bin/curl", agents: {
    main: {tools: ["rocket_money_read", "rocket_money_write", "weather_curl"], rocketMoneyAccount: "personal"},
    household: {tools: ["weather_curl"]},
  }};
  writeFileSync(policyPath, JSON.stringify(policy), {mode: 0o600});
  const cliPath = join(directory, "cli");
  writeFileSync(cliPath, `#!${process.execPath}\n${script ?? 'let s="";process.stdin.on("data", x=>s+=x);process.stdin.on("end",()=>{console.log(JSON.stringify({input:JSON.parse(s),args:process.argv.slice(2),secret:process.env.TEST_SECRET??null}));});'}`, {mode:0o700});
  const cfg = {cliPath, configPath: policyPath, invocationStateDir: state};
  let factory: any;
  plugin.register({pluginConfig: cfg, config: {}, registerTool: (f:any) => factory=f} as any);
  return {factory, policyPath, policy, cfg};
}

describe("named CLI tools", () => {
  it("grants main all tools, household weather only, and denies missing/other identities", () => {
    const {factory} = fixture();
    expect(factory({agentId:"main"}).map((t:any)=>t.name)).toEqual(["rocket_money_read","rocket_money_write","weather_curl"]);
    expect(factory({agentId:"household"}).map((t:any)=>t.name)).toEqual(["weather_curl"]);
    expect(factory({agentId:"reader"})).toEqual([]);
    expect(factory({})).toEqual([]);
  });
  it("passes source inputs unchanged with trusted identity and a clean environment", async () => {
    process.env.TEST_SECRET="do-not-inherit";
    const {factory}=fixture(); const tool=factory({agentId:"main"})[0];
    const input={mode:"graphql",request:{query:"{viewer{id}}",variables:{}}};
    const result=JSON.parse((await tool.execute("call1",input)).content[0].text);
    expect(result.input).toEqual(input); expect(result.secret).toBe(null);
    expect(result.args).toContain("main"); expect(result.args).toContain("rocket_money_read");
    delete process.env.TEST_SECRET;
  });
  it("does not permit model-controlled identity, binary, mode, or host setup", async () => {
    const tool=fixture().factory({agentId:"main"})[0];
    for (const input of [{mode:"help",agent:"household"},{mode:"help",cliPath:"/bin/sh"},{mode:"setup"},{mode:"curl",argv:[]}]) {
      await expect(tool.execute("call1",input)).rejects.toThrow();
    }
  });
  it("checks revocation for tools created before a grant was removed", async () => {
    const {factory,policyPath,policy}=fixture(); const tool=factory({agentId:"main"})[0];
    policy.agents.main.tools=[]; writeFileSync(policyPath,JSON.stringify(policy));
    await expect(tool.execute("call1",{mode:"help"})).rejects.toThrow("POLICY_DENIED");
  });
  it("persists a write request ID and rejects changed content with the same call ID", async () => {
    const tool=fixture().factory({agentId:"main"})[1];
    const input={mode:"graphql",request:{query:"mutation {x}"},expected:{date:"2026-01-01"}};
    const first=await tool.execute("call-write",input);const second=await tool.execute("call-write",input);
    expect(first.details.requestId).toBe(second.details.requestId);
    await expect(tool.execute("call-write",{...input,expected:{date:"2026-02-01"}})).rejects.toThrow("REQUEST_ID_CONFLICT");
  });
  it("sanitizes arbitrary subprocess errors and preserves write uncertainty", async () => {
    const tool=fixture('process.stderr.write("secret_cookie=value");process.exit(1);').factory({agentId:"main"})[1];
    await expect(tool.execute("failure",{mode:"graphql",request:{query:"mutation {x}"}})).rejects.toThrow(/CLI_FAILED requestId=/);
  });
  it("rejects unsafe config permissions", () => {
    const {factory,policyPath}=fixture();chmodSync(policyPath,0o666);
    expect(factory({agentId:"main"})).toEqual([]);
  });
  it("handles a cancelled invocation without executing", async () => {
    const controller=new AbortController();controller.abort();
    const tool=fixture().factory({agentId:"main"})[0];
    await expect(tool.execute("cancelled",{mode:"help"},controller.signal)).rejects.toThrow("CANCELLED");
  });
});


it("executes the real Python CLI through the plugin boundary without credentials", async () => {
  const local = fileURLToPath(new URL("../../../packages/cli-gateway/.venv/bin/python", import.meta.url));
  const python = process.env.CLI_GATEWAY_PYTHON ?? (existsSync(local) ? local : execFileSync("python3", ["-c", "import sys; print(sys.executable)"], {encoding:"utf8"}).trim());
  const script = `const {spawnSync}=require("node:child_process");let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const r=spawnSync(${JSON.stringify(python)},["-m","puddles_cli.cli",...process.argv.slice(2)],{input:s,encoding:"utf8"});process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);});`;
  const tool = fixture(script).factory({agentId:"main"})[0];
  const result = await tool.execute("real-help", {mode:"help"});
  expect(JSON.parse(result.content[0].text).tool).toBe("rocket_money_read");
  await expect(tool.execute("real-deny",{mode:"graphql",request:{query:"mutation { deleteAccount }"}})).rejects.toThrow("POLICY_DENIED");
});
