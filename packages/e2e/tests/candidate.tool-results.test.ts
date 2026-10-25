import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { wrapMcpTool as gmail } from "../../../openclaw-plugins/secure-gmail/src/wrap-tool.js";
import { wrapMcpTool as calendar } from "../../../openclaw-plugins/secure-apple-calendar/src/wrap-tool.js";
import { createPlugin, createBridgeRuntime } from "../../../openclaw-plugins/rocket-money/src/plugin.js";

const root = mkdtempSync(join(tmpdir(), "tool-results-fixture-"));
vi.stubEnv("OPENCLAW_STATE_DIR", root);
vi.stubEnv("OPENCLAW_CONFIG_PATH", join(root, "openclaw.json"));
writeFileSync(join(root, "openclaw.json"), "{}");
afterAll(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

// Apple PIM is macOS-only. The complete application gate runs this on the target platform.
it.skipIf(process.platform !== "darwin")("returns guarded plugin data through the native QuickJS bridge", async () => {
  const runtime = process.env.OPENCLAW_CANDIDATE;
  expect(runtime, "prepared OpenClaw runtime is required").toBeTruthy();
  const dist = join(runtime!, "dist");
  const modules = readdirSync(dist).filter(name => name.endsWith(".mjs"));
  async function native(name: string): Promise<any> {
    for (const file of modules) {
      const source = readFileSync(join(dist, file), "utf8");
      const alias = source.match(new RegExp(`export \\{[^}]*\\b${name} as ([\\w$]+)`))?.[1];
      if (alias) return (await import(pathToFileURL(join(dist, file)).href))[alias];
    }
    throw new Error("Missing native export: " + name);
  }
  const run = await native("runCodeModeScriptHeadless");
  const catalogRef = (await native("createToolSearchCatalogRef"))();
  const register = await native("registerHeadlessToolSearchCatalog");
  const clear = await native("clearToolSearchCatalog");
  const raw = { content: [{ type: "text" as const, text: "RAW_SECRET" }], isError: true,
    structuredContent: { private: "RAW_STRUCTURED" }, _meta: { private: "RAW_META" } };
  const caller = { callTool: vi.fn(async (name: string) => name.startsWith("rocket_money_") ? { ...raw, content: [{type:"text" as const,text:"fixture account"}] } : raw) };
  const redact = { name: "redactor", check: async () => ({ action: "modify" as const, content: "[REDACTED]" }) };
  const descriptor = (name: string) => ({ name, inputSchema: { type: "object" as const, properties: {} } });
  const tools: any[] = [gmail(descriptor("get_email"), caller, { ingress: [redact] }),
    calendar(descriptor("calendar_read"), caller, { selectHooks: () => ({ ingress: [redact] }) })];
  let stop: (() => Promise<void>) | undefined;
  const provider = join(root, "provider.mjs");
  writeFileSync(provider, `export default class { async classify() { return JSON.stringify({detected:false,evidence:""}); } }`);
  const cfg = { plugins: { entries: { "rocket-money": { enabled: true, config: {
    command: "/fixture/python", stateDir: root, llmProvider: provider } } } } };
  createPlugin(async () => ({ ...caller, close: async () => {} }), createBridgeRuntime()).register({
    config: cfg, registerService(service: any) { stop = service.stop; },
    registerTool(factory: any) { tools.push(...factory({ agentId: "main", sessionKey: "fixture", workspaceDir: root, config: cfg })); },
  } as any);
  // Only the fake CLI below can run. No native Apple binary or account is used.
  const shell = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const fixture = join(root, "pim.mjs");
  writeFileSync(fixture, `if(process.argv[2]==="items"){process.stderr.write("fixture CLI failure");process.exit(1);}console.log(JSON.stringify({success:true,lists:[{id:"fixture-list",title:"Fixture reminders"}]}));`);
  for (const name of ["calendar-cli", "reminder-cli", "contacts-cli", "mail-cli"]) {
    writeFileSync(join(root, name), `#!/bin/sh\nexec ${shell(process.execPath)} ${shell(fixture)} "$@"\n`, { mode: 0o700 });
  }
  const pim = (await import(pathToFileURL(resolve(import.meta.dirname, "../../../node_modules/apple-pim-cli/dist/index.js")).href)).default;
  pim.register({ pluginConfig: { binDir: root }, registerTool(factory: any) { tools.push(factory({ workspaceDir: root })); } });
  register({ catalogRef, tools });
  const config = { tools: { codeMode: { enabled: true, executor: "quickjs" } }, plugins: { entries: { "code-mode-quickjs": { enabled: true } } } };
  try {
    const result = await run({ ctx: { config, runtimeConfig: config, catalogRef, sessionId: "tool-result-fixture", sessionKey: "agent:main:fixture", runId: "tool-result-fixture", workspaceDir: root },
      code: `return { gmail: await get_email({}), calendar: await calendar_read({}), money: await rocket_money_status({}), reminders: await apple_pim_reminder({action:"lists"}), failure: await apple_pim_reminder({action:"items"}) };`, wallClockMs: 30000 });
    expect(result.status, result.error).toBe("completed");
    for (const name of ["gmail", "calendar", "money"]) {
      expect(result.value[name].content).toEqual([{ type: "text", text: name === "money" ? "fixture account" : "[REDACTED]" }]);
      expect(result.value[name].isError).toBe(true);
    }
    expect(result.value.reminders).toMatchObject({ domain: "reminder", action: "lists" });
    expect(result.value.reminders.content[0].text).toContain("fixture-list");
    expect(result.value.reminders.content[0].text).toContain("UNTRUSTED_REMINDER_DATA_");
    expect(result.value.failure.content[0].text).toContain("fixture CLI failure");
    const invalid = await tools.find(tool => tool.name === "apple_pim_reminder").execute("invalid", {});
    expect(invalid.details.content).toEqual(invalid.content);
    expect(invalid.details.content[0].text).toContain("Missing required");
    expect(JSON.stringify(result.value)).not.toMatch(/RAW_SECRET|RAW_STRUCTURED|RAW_META/);
    expect(caller.callTool).toHaveBeenCalledTimes(3);
  } finally { clear(catalogRef); await stop?.(); }
}, 45000);
