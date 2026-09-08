import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The native lifecycle modules are also executable without the TypeScript toolchain.
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { acquireLock, atomicJson, fileDigest, stage, treeDigest } from "../src/native-state.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { installRuntime, packRuntime } from "../src/native-package.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { fixtureEnv, isolatedContext, runScenario } from "../src/native-fixture.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { loadExtension, extensionPhase } from "../src/native-extension.mjs";
import { runCommand } from "../src/process-runner.mjs";

const roots: string[] = [];
function root() { const path = mkdtempSync(join(tmpdir(), "native-loop-test-")); roots.push(path); return path; }
function json(path: string, value: unknown) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("native exact-input evidence", () => {
  it("reuses successful stages but reruns for changed input, output, or failure", async () => {
    const directory = root();
    const output = join(directory, "artifact");
    let calls = 0;
    const action = async () => { calls++; writeFileSync(output, String(calls)); return calls; };
    const outputs = () => ({ [output]: fileDigest(output) });
    await stage(directory, "proof", { code: "one" }, action, outputs);
    await stage(directory, "proof", { code: "one" }, action, outputs);
    expect(calls).toBe(1);
    writeFileSync(output, "changed");
    await stage(directory, "proof", { code: "one" }, action, outputs);
    await stage(directory, "proof", { code: "two" }, action, outputs);
    expect(calls).toBe(3);
    await expect(stage(directory, "failed", {}, async () => { throw new Error("failure"); })).rejects.toThrow("failure");
    await stage(directory, "failed", {}, action, outputs);
    expect(calls).toBe(4);
  });

  it("locks concurrent runs and retains a durable owner for interrupted recovery", () => {
    const directory = root();
    const unlock = acquireLock(directory);
    expect(() => acquireLock(directory)).toThrow("locked");
    expect(JSON.parse(readFileSync(join(directory, "lock", "owner.json"), "utf8")).pid).toBe(process.pid);
    unlock();
    acquireLock(directory)();
  });

  it("rejects absolute and escaping runtime links", () => {
    const directory = root();
    symlinkSync("/tmp", join(directory, "bad"));
    expect(() => treeDigest(directory, { portable: true })).toThrow("escapes");
  });
});

describe("offline installed runtime", () => {
  it("ships actual patched dependency bytes, cycles and versions without registry resolution", async () => {
    const directory = root();
    const source = join(directory, "source");
    const artifacts = join(directory, "artifacts");
    mkdirSync(artifacts);
    mkdirSync(join(source, "dist"), { recursive: true });
    json(join(source, "package.json"), { name: "openclaw", version: "1.0.0",
      files: ["dist/", "!dist/*.map", "openclaw.mjs", "skills/", "src/agents/templates/", "docs/"],
      dependencies: { "@openclaw/ai": "workspace:*" } });
    for (const name of ["skills/example/SKILL.md", "src/agents/templates/BOOTSTRAP.md", "docs/reference.md", "dist/excluded.map", "excluded-source.txt"]) {
      mkdirSync(join(source, name, ".."), { recursive: true });
      writeFileSync(join(source, name), "synthetic package asset");
    }
    writeFileSync(join(source, "dist", "entry.js"), "export {}");
    writeFileSync(join(source, "openclaw.mjs"), "import value from '@openclaw/ai'; console.log(value);");
    const dependency = join(source, "node_modules", "@openclaw", "ai");
    json(join(dependency, "package.json"), { name: "@openclaw/ai", version: "1.0.0", main: "index.js", dependencies: { openclaw: "file:/build-only/root" } });
    writeFileSync(join(dependency, "index.js"), "module.exports = 'patched fixture bytes';");
    symlinkSync(source, join(source, "node_modules", "openclaw"));
    const commands: string[] = [];
    const run = async (command: string, args: string[], options = {}) => {
      commands.push(command);
      return runCommand(command, args, { ...options, quiet: true });
    };
    const artifact = await packRuntime(source, artifacts, run);
    const installed = await installRuntime(artifact, join(directory, "prefix"), run);
    expect(execFileSync(process.execPath, [join(installed, "openclaw.mjs")], { encoding: "utf8", env: fixtureEnv(isolatedContext(join(directory, "context"))) }).trim()).toBe("patched fixture bytes");
    expect(commands.every((command) => command === "tar")).toBe(true);
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
    expect(manifest.dependencies["@openclaw/ai"]).toBe("1.0.0");
    for (const name of ["skills/example/SKILL.md", "src/agents/templates/BOOTSTRAP.md", "docs/reference.md"]) {
      expect(readFileSync(join(installed, name), "utf8")).toBe("synthetic package asset");
    }
    expect(existsSync(join(installed, "excluded-source.txt"))).toBe(false);
    expect(existsSync(join(installed, "dist/excluded.map"))).toBe(false);
    writeFileSync(artifact.path, "damaged");
    await expect(installRuntime(artifact, join(directory, "damaged-prefix"), run)).rejects.toThrow("digest");
    expect(existsSync(join(directory, "damaged-prefix"))).toBe(false);
  });
});

describe("recording fixture prerequisites", () => {
  it("does not inherit host profiles, credentials or user state", () => {
    const context = isolatedContext(root());
    const env = fixtureEnv(context);
    expect(env.HOME).toBe(context.home);
    expect(env.OPENCLAW_CONFIG_PATH).toBe(context.configPath);
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env.NODE_ENV).toBe("production");
  });

  it("fails before launch if a scripted mutation has no recorder", async () => {
    await expect(runScenario(root(), { id: "missing-adapter", steps: [{ incoming: [], responses: [{ toolCalls: [{ name: "real_write", args: {} }] }], expect: { sends: [] } }] })).rejects.toThrow("Missing required recording adapter");
  });

  it("never counts a missing real installed candidate as green", async () => {
    await expect(runScenario(root(), { id: "missing-runtime", steps: [{ incoming: [{ text: "test" }], responses: [{ text: "test" }], expect: { sends: ["test"] } }] })).rejects.toThrow("real installed");
  });

  it("requires explicit valid local extensions and failed host availability is not green", async () => {
    expect((await loadExtension()).healthChecks).toEqual([]);
    const directory = root();
    const module = join(directory, "extension.mjs");
    writeFileSync(module, `export default {schemaVersion:1,inputs:[],commands:[],scenarios:[],healthChecks:[{id:"health",command:${JSON.stringify(process.execPath)},args:["-e","console.log(JSON.stringify({available:false,authenticated:false,protocol:true}))"],timeoutMs:1000,required:true}]};`);
    const extension = await loadExtension(module);
    await expect(extensionPhase(extension, "health", isolatedContext(join(directory, "context")))).rejects.toThrow("unavailable");
    expect(readFileSync(module, "utf8")).not.toContain("credential");
  });

  it("tracks declared extension package outputs so a removed artifact reruns its producer", async () => {
    const directory = root();
    const context = isolatedContext(join(directory, "context"));
    context.sourceDir = context.workspace;
    const module = join(directory, "extension.mjs");
    const script = "require('node:fs').writeFileSync(require('node:path').join(JSON.parse(require('node:fs').readFileSync(process.env.E2E_CONTEXT_PATH)).workspace,'artifact'),'sealed')";
    writeFileSync(module, `export default {schemaVersion:1,commands:[{id:"package",phase:"package",command:${JSON.stringify(process.execPath)},args:["-e",${JSON.stringify(script)}],timeoutMs:1000,outputs:["workspace/artifact"]}]};`);
    const extension = await loadExtension(module);
    let calls = 0;
    const action = async () => { calls++; return extensionPhase(extension, "package", context); };
    const outputs = (value: Record<string, string>) => value;
    await stage(directory, "package", { inputs: extension.hash }, action, outputs);
    await stage(directory, "package", { inputs: extension.hash }, action, outputs);
    expect(calls).toBe(1);
    rmSync(join(context.workspace, "artifact"));
    await stage(directory, "package", { inputs: extension.hash }, action, outputs);
    expect(calls).toBe(2);
  });

  it("separates preparation inputs from package, installed and health command edits", async () => {
    const directory = root();
    const load = async (name: string, phase: string) => {
      const module = join(directory, `${name}.mjs`);
      writeFileSync(module, `export default {schemaVersion:1,commands:[{id:"${name}",phase:"${phase}",command:"node",args:["--version"],timeoutMs:1000}]};`);
      return loadExtension(module);
    };
    const first = await load("one", "package");
    const second = await load("two", "package");
    const installed = await load("three", "installed");
    expect(first.hash).not.toBe(second.hash);
    expect(first.phaseHashes.package).not.toBe(second.phaseHashes.package);
    expect(first.phaseHashes.prepare).toBe(second.phaseHashes.prepare);
    expect(first.phaseHashes.prepare).toBe(installed.phaseHashes.prepare);
  });
});

describe("bounded commands", () => {
  it("terminates commands that exceed the deadline and hides local command details", async () => {
    await expect(runCommand(process.execPath, ["-e", "setInterval(()=>{},100)"], { timeoutMs: 30, killGraceMs: 20, quiet: true })).rejects.toThrow("exceeded");
  });

  it("fails instead of hashing a silently truncated command result", async () => {
    await expect(runCommand(process.execPath, ["-e", "console.log('x'.repeat(4096))"], { maxOutputBytes: 32, capture: true, quiet: true })).rejects.toThrow("capture bound");
  });
});
