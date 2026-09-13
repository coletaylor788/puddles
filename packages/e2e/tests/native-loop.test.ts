import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The native lifecycle modules are also executable without the TypeScript toolchain.
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { acquireLock, atomicJson, fileDigest, stage, treeDigest } from "../src/native-state.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { installRuntime, packProviderRuntime, packRuntime } from "../src/native-package.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { fixtureEnv, isolatedContext, runScenario } from "../src/native-fixture.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { additionalArtifacts, loadExtension, extensionPhase } from "../src/native-extension.mjs";
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

  it("reuses a dependency proof after real offline pnpm refreshes only its validation timestamp", async () => {
    const directory = root();
    json(join(directory, "package.json"), {
      name: "synthetic-pnpm-proof", version: "1.0.0", private: true,
      packageManager: "pnpm@12.3.4", dependencies: { "synthetic-dependency": "file:./dependency" },
    });
    json(join(directory, "dependency/package.json"), { name: "synthetic-dependency", version: "1.0.0", main: "index.js" });
    writeFileSync(join(directory, "dependency/index.js"), "module.exports = 'original';");
    writeFileSync(join(directory, "pnpm-workspace.yaml"), "packages:\n  - '.'\n");
    writeFileSync(join(directory, "empty.npmrc"), "");
    const options = { normalizePnpmWorkspaceState: true };
    const command = (args: string[]) => execFileSync("corepack", ["pnpm", ...args], {
      cwd: directory, encoding: "utf8", timeout: 20_000,
      env: { ...process.env, CI: "true", COREPACK_ENABLE_NETWORK: "0",
        NPM_CONFIG_USERCONFIG: join(directory, "empty.npmrc") },
    });
    expect(command(["--version"]).trim()).toBe("12.3.4");
    const install = (frozen: boolean) => command([
      "install", "--offline", "--ignore-scripts", "--ignore-pnpmfile",
      frozen ? "--frozen-lockfile" : "--no-frozen-lockfile", "--store-dir", join(directory, "store"),
    ]);
    install(false);
    const modules = join(directory, "node_modules");
    const metadata = join(modules, ".pnpm-workspace-state-v1.json");
    const proofRoot = join(directory, "proof");
    let installs = 0;
    const proof = () => stage(proofRoot, "dependencies", { fingerprint: options }, async () => {
      installs++;
      install(true);
      return { installed: true };
    }, () => ({ [modules]: { sha256: treeDigest(modules, options), options } }));
    await proof();
    const before = JSON.parse(readFileSync(metadata, "utf8"));
    const rawBefore = treeDigest(modules);
    const normalizedBefore = treeDigest(modules, options);
    const record = readFileSync(join(proofRoot, "stages/dependencies.json"), "utf8");
    install(true);
    const after = JSON.parse(readFileSync(metadata, "utf8"));
    expect(after.lastValidatedTimestamp).toBeGreaterThan(before.lastValidatedTimestamp);
    expect({ ...after, lastValidatedTimestamp: 0 }).toEqual({ ...before, lastValidatedTimestamp: 0 });
    expect(treeDigest(modules)).not.toBe(rawBefore);
    expect(treeDigest(modules, options)).toBe(normalizedBefore);
    await proof();
    expect(installs).toBe(1);
    expect(readFileSync(join(proofRoot, "stages/dependencies.json"), "utf8")).toBe(record);
    writeFileSync(metadata, JSON.stringify({ ...after, settings: { ...after.settings, nodeLinker: "hoisted" } }));
    expect(treeDigest(modules, options)).not.toBe(normalizedBefore);
    writeFileSync(metadata, JSON.stringify(after));
    writeFileSync(join(modules, "synthetic-dependency/index.js"), "module.exports = 'changed real dependency';");
    expect(treeDigest(modules, options)).not.toBe(normalizedBefore);
  }, 60_000);

  it("normalizes only the root pnpm timestamp and rejects malformed metadata", () => {
    const directory = root();
    const options = { normalizePnpmWorkspaceState: true };
    const metadata = join(directory, ".pnpm-workspace-state-v1.json");
    json(metadata, { lastValidatedTimestamp: 1, settings: {}, projects: {} });
    const first = treeDigest(directory, options);
    for (const content of [{ settings: { nodeLinker: "hoisted" } }, { projects: { synthetic: { version: "2.0.0" } } }, { unknown: true }]) {
      json(metadata, { lastValidatedTimestamp: 1, settings: {}, projects: {}, ...content });
      expect(treeDigest(directory, options)).not.toBe(first);
    }
    json(metadata, { lastValidatedTimestamp: 2, settings: {}, projects: {} });
    expect(treeDigest(directory, options)).toBe(first);
    const nested = join(directory, "dependency/.pnpm-workspace-state-v1.json");
    json(nested, { lastValidatedTimestamp: 1 });
    const withNested = treeDigest(directory, options);
    json(nested, { lastValidatedTimestamp: 2 });
    expect(treeDigest(directory, options)).not.toBe(withNested);
    json(metadata, { lastValidatedTimestamp: "invalid", settings: {} });
    expect(() => treeDigest(directory, options)).toThrow("Invalid pnpm");
    writeFileSync(metadata, "{");
    expect(() => treeDigest(directory, options)).toThrow();
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
  it("seals the patched llama.cpp provider with source and build provenance", async () => {
    const directory = root();
    const source = join(directory, "source");
    const providerSource = join(source, "extensions/llama-cpp");
    const providerBuild = join(source, "dist/extensions/llama-cpp");
    const manifest = {
      name: "@openclaw/llama-cpp-provider",
      version: "2026.9.3",
      type: "module",
      openclaw: { extensions: ["./index.js"] },
    };
    json(join(providerSource, "package.json"), { ...manifest, openclaw: { extensions: ["./index.ts"] } });
    writeFileSync(join(providerSource, "index.ts"), "export const keepEmbeddingResident = true;");
    json(join(providerBuild, "package.json"), manifest);
    writeFileSync(join(providerBuild, "index.js"), "export const keepEmbeddingResident = true;");
    mkdirSync(join(providerBuild, "node_modules/@openclaw"), { recursive: true });
    symlinkSync(providerSource, join(providerBuild, "node_modules/@openclaw/plugin-sdk"));
    const provenance = {
      publicHead: "1".repeat(40),
      buildInputsSha256: "2".repeat(64),
      buildCommandSha256: "3".repeat(64),
      tools: { node: process.version, platform: process.platform, arch: process.arch },
    };
    const result = await packProviderRuntime(source, join(directory, "artifact"), provenance);
    const receipt = JSON.parse(readFileSync(result.provenance.path, "utf8"));
    expect(receipt).toMatchObject({
      schema: "puddles.openclaw-provider-artifact/v1",
      publicHead: provenance.publicHead,
      source: { sha256: result.provenance.sourceSha256 },
      build: {
        inputsSha256: provenance.buildInputsSha256,
        commandSha256: provenance.buildCommandSha256,
      },
      artifact: { sha256: result.artifact.sha256, runtimeSha256: result.artifact.runtimeSha256 },
    });
    const installed = await installRuntime(result.artifact, join(directory, "installed"));
    expect(readFileSync(join(installed, "index.js"), "utf8")).toContain("keepEmbeddingResident");
    expect(fileDigest(result.provenance.path)).toBe(result.provenance.sha256);
  });

  it.each(["bundleDependencies", "bundledDependencies"])("materializes %s without overlapping npm's bundled files", async (field) => {
    const directory = root();
    const source = join(directory, "source");
    json(join(source, "package.json"), {
      name: "synthetic-bundled-runtime", version: "1.0.0", files: ["index.cjs"],
      dependencies: { "@synthetic/bundled": "1.0.0" }, [field]: ["@synthetic/bundled"],
    });
    writeFileSync(join(source, "index.cjs"), "console.log(require('@synthetic/bundled'));");
    const bundled = join(source, "node_modules/@synthetic/bundled");
    json(join(bundled, "package.json"), {
      name: "@synthetic/bundled", version: "1.0.0", main: "index.cjs",
      dependencies: { transitive: "2.0.0" }, peerDependencies: { "required-peer": "3.0.0" },
    });
    writeFileSync(join(bundled, "index.cjs"), "module.exports = require('transitive') + require('required-peer') + require('./payload/node_modules/embedded');");
    const embedded = join(bundled, "payload/node_modules/embedded");
    json(join(embedded, "package.json"), { name: "embedded", version: "1.0.0", main: "index.cjs" });
    writeFileSync(join(embedded, "index.cjs"), "module.exports = '-embedded';");
    for (const [name, version, value] of [["transitive", "2.0.0", "patched-"], ["required-peer", "3.0.0", "peer"]]) {
      const dependency = join(source, "node_modules", name);
      json(join(dependency, "package.json"), { name, version, main: "index.cjs" });
      writeFileSync(join(dependency, "index.cjs"), `module.exports = ${JSON.stringify(value)};`);
    }
    const selection = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: source, encoding: "utf8", timeout: 10_000,
    }));
    expect(selection[0].files.some(({ path }: { path: string }) => path.startsWith("node_modules/"))).toBe(true);
    const artifact = await packRuntime(source, join(directory, "artifacts"));
    const installed = await installRuntime(artifact, join(directory, "prefix"));
    rmSync(join(source, "node_modules/required-peer"), { recursive: true });
    await expect(packRuntime(source, join(directory, "missing-peer"))).rejects.toThrow("Missing production dependency: required-peer");
    rmSync(source, { recursive: true });
    expect(execFileSync(process.execPath, [join(installed, "index.cjs")], {
      encoding: "utf8", timeout: 10_000, env: fixtureEnv(isolatedContext(join(directory, "context"))),
    }).trim()).toBe("patched-peer-embedded");
    expect(treeDigest(installed, { portable: true })).toBe(artifact.runtimeSha256);
  }, 15_000);

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
    for (const name of [".experimental-vitest-cache", ".unrun"]) {
      mkdirSync(join(source, "node_modules", name));
      writeFileSync(join(source, "node_modules", name, "generated"), "generated test cache");
    }
    const cached = await packRuntime(source, join(directory, "cached-artifacts"), run);
    expect(cached.runtimeSha256).toBe(artifact.runtimeSha256);
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
    await expect(installRuntime({ ...artifact, runtimeSha256: "0".repeat(64) }, join(directory, "mismatched-prefix"), run)).rejects.toThrow("Archive identity");
    writeFileSync(artifact.path, "damaged");
    await expect(installRuntime(artifact, join(directory, "damaged-prefix"), run)).rejects.toThrow("digest");
    expect(existsSync(join(directory, "damaged-prefix"))).toBe(false);
  }, 15_000);
});

describe("recording fixture prerequisites", () => {
  it("rejects unsupported fixture chat types before starting a gateway", async () => {
    await expect(runScenario("/missing", {
      id: "invalid-chat",
      chatType: "unrestricted",
      steps: [{ incoming: [], responses: [], expect: { sends: [] } }],
    })).rejects.toThrow("Invalid fixture chat type");
  });
  it("seals named portable artifacts from verified declared package directories", async () => {
    const context = isolatedContext(root());
    const source = join(context.workspace, "source");
    json(join(source, "package.json"), { name: "synthetic-component", version: "1.0.0", files: ["index.js"] });
    writeFileSync(join(source, "index.js"), "module.exports = 'fixture';");
    const prepared = join(context.workspace, "prepared");
    const artifact = await packRuntime(source, prepared);
    json(join(prepared, "artifact.json"), artifact);
    const extension = { artifacts: [{ id: "auxiliary", manifest: "workspace/prepared/artifact.json" }] };
    const outputs = { [prepared]: treeDigest(prepared) };
    expect(additionalArtifacts(extension, context, outputs)).toEqual([{ id: "auxiliary", artifact }]);
    const installed = await installRuntime(artifact, join(context.root, "installed-auxiliary"));
    expect(readFileSync(join(installed, "index.js"), "utf8")).toBe("module.exports = 'fixture';");
    expect(() => additionalArtifacts(extension, context, {})).toThrow("declared package output");
    writeFileSync(artifact.path, "changed");
    expect(() => additionalArtifacts(extension, context, outputs)).toThrow("output changed");
  });

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

  it("rejects an omitted maintained channel before a fixture can install an external replacement", async () => {
    const directory = root();
    mkdirSync(join(directory, "dist"));
    mkdirSync(join(directory, "node_modules"));
    writeFileSync(join(directory, "openclaw.mjs"), "");
    writeFileSync(join(directory, "dist/entry.js"), "");
    await expect(runScenario(directory, {
      id: "missing-maintained-channel",
      steps: [{ incoming: [{ text: "fixture" }], responses: [{ text: "fixture" }], expect: { sends: ["fixture"] } }],
    })).rejects.toThrow("maintained iMessage plugin must be bundled");
    const env = fixtureEnv(isolatedContext(join(directory, "context")));
    expect(env.npm_config_offline).toBe("true");
    expect(env.COREPACK_ENABLE_NETWORK).toBe("0");
    expect(env.npm_config_cache).toBe(join(directory, "context/home/.npm"));
  });

  it.each([-1, 1001, NaN])("rejects an unbounded incoming fixture delay (%s)", async (delayMs) => {
    await expect(runScenario(root(), {
      id: "invalid-delay",
      steps: [{ incoming: [{ text: "fixture", delayMs }], responses: [], expect: { sends: [] } }],
    })).rejects.toThrow("Invalid fixture incoming delay");
  });

  it.each(["channel", "account"])("rejects stale packaged %s metadata before startup", async (missing) => {
    const directory = root();
    mkdirSync(join(directory, "dist/extensions/imessage"), { recursive: true });
    mkdirSync(join(directory, "node_modules"));
    writeFileSync(join(directory, "openclaw.mjs"), "");
    writeFileSync(join(directory, "dist/entry.js"), "");
    json(join(directory, "dist/extensions/imessage/package.json"), {
      openclaw: { build: { bundledDist: true } },
    });
    json(join(directory, "dist/extensions/imessage/openclaw.plugin.json"), {
      channelConfigs: { imessage: { schema: { properties: {
        ...(missing === "channel" ? {} : { coalesceSameSenderDms: { type: "boolean" } }),
        accounts: { additionalProperties: { properties: missing === "account"
          ? {} : { coalesceSameSenderDms: { type: "boolean" } } } },
      } } } },
    });
    await expect(runScenario(directory, {
      id: "stale-packaged-schema",
      steps: [{ incoming: [{ text: "fixture" }], responses: [{ text: "fixture" }], expect: { sends: ["fixture"] } }],
    })).rejects.toThrow(`packaged ${missing} schema is missing maintained iMessage coalescing`);
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
