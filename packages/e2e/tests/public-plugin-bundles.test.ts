import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { installRuntime, packRuntime } from "../src/native-package.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { fixtureEnv, isolatedContext } from "../src/native-fixture.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("self-contained public plugin bundles", () => {
  it.each([
    ["secure-gmail", ["list_emails", "get_email", "get_attachments", "archive_email", "add_label"]],
    ["secure-apple-calendar", ["calendar_read", "calendar_write"]],
  ] as const)("imports and registers %s as native ESM outside the source tree", async (id, expected) => {
    const root = mkdtempSync(join(tmpdir(), "public-plugin-bundle-"));
    roots.push(root);
    const context = isolatedContext(join(root, "context"));
    const source = resolve(import.meta.dirname, "../../../openclaw-plugins", id, "dist");
    const snapshot = join(root, "source");
    cpSync(source, snapshot, { recursive: true });
    const artifact = await packRuntime(snapshot, join(root, "artifact"));
    const installed = await installRuntime(artifact, join(root, "installed"));
    const script = join(context.workspace, "register.mjs");
    writeFileSync(script, `
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
const deny = () => { throw new Error("External activity is forbidden during registration"); };
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = deny;
http.request = http.get = https.request = https.get = globalThis.fetch = deny;
syncBuiltinESMExports();
const { default: plugin } = await import(pathToFileURL(process.argv[2]).href);
const tools = [];
const hooks = [];
const result = plugin.register({
  pluginConfig: {
    gmailMcpCommand: "/missing/fixture-command",
    applePimMcpCommand: "/missing/fixture-command",
    applePimMcpArgs: ["fixture-only"],
    llmProvider: "/missing/fixture-provider.mjs",
  },
  logger: { info() {}, debug() {}, warn: deny, error: deny },
  registerTool(factory) {
    tools.push(factory({ agentId: "fixture", workspaceDir: process.cwd() }));
  },
  on(name, handler) { hooks.push({ name, handler }); },
});
assert.equal(result, undefined, "registration must stay synchronous");
assert.deepEqual(tools.map(tool => tool.name).sort(), JSON.parse(process.argv[3]).sort());
assert.ok(tools.every(tool => typeof tool.execute === "function"));
assert.deepEqual(hooks.map(hook => hook.name), ["session_end"]);
for (const hook of hooks) await hook.handler();
console.log("PUBLIC_PLUGIN_BUNDLE_OK");
`);
    const child = spawnSync(process.execPath, [script, join(installed, "plugin.js"), JSON.stringify(expected)], {
      cwd: context.workspace, env: fixtureEnv(context), encoding: "utf8", timeout: 15_000,
    });
    expect(child.status, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`).toBe(0);
    expect(child.stdout).toContain("PUBLIC_PLUGIN_BUNDLE_OK");
  }, 20_000);
});
