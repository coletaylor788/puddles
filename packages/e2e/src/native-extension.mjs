import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";
import { fixtureEnv } from "./native-fixture.mjs";
import { runCommand } from "./process-runner.mjs";

export async function loadExtension(path) {
  if (!path) return { schemaVersion: 1, commands: [], scenarios: [], healthChecks: [], artifacts: [], hash: "none", phaseHashes: {} };
  if (!isAbsolute(path) || !existsSync(path)) throw new Error("Local extension requires an existing absolute module path");
  const extension = (await import(pathToFileURL(realpathSync(path)).href)).default;
  if (extension?.schemaVersion !== 1) throw new Error("Unsupported local extension version");
  for (const key of ["commands", "scenarios", "healthChecks", "inputs", "artifacts"]) {
    if (!Array.isArray(extension[key] ?? [])) throw new Error("Invalid local extension list");
  }
  const files = [path, ...(extension.inputs ?? [])];
  for (const file of files) {
    if (!isAbsolute(file) || !existsSync(file)) throw new Error("Local extension input missing");
  }
  const commands = extension.commands ?? [];
  const healthChecks = extension.healthChecks ?? [];
  const names = new Set();
  for (const command of [...commands, ...healthChecks]) {
    if (!/^[a-z0-9-]+$/.test(command.id) || names.has(command.id) ||
        typeof command.command !== "string" || !Array.isArray(command.args) ||
        command.args.some((arg) => typeof arg !== "string") ||
        !Number.isSafeInteger(command.timeoutMs) || command.timeoutMs <= 0 || command.timeoutMs > 30 * 60_000) {
      throw new Error("Invalid bounded local command");
    }
    names.add(command.id);
    if (!Array.isArray(command.outputs ?? []) || (command.outputs ?? []).some((path) => typeof path !== "string" || isAbsolute(path) || path.split("/").includes(".."))) {
      throw new Error("Local command outputs must be paths relative to the isolated root");
    }
  }
  if (commands.some((command) => !["prepare", "gate", "package", "installed"].includes(command.phase))) throw new Error("Unknown local command phase");
  const artifacts = extension.artifacts ?? [];
  const artifactIds = new Set();
  for (const artifact of artifacts) {
    if (!/^[a-z][a-z0-9-]*$/.test(artifact.id) || artifactIds.has(artifact.id) ||
        typeof artifact.manifest !== "string" || !artifact.manifest ||
        isAbsolute(artifact.manifest) || artifact.manifest.split("/").includes("..")) {
      throw new Error("Invalid named local artifact");
    }
    artifactIds.add(artifact.id);
  }
  const inputs = (extension.inputs ?? []).map(fileDigest);
  const phaseHashes = Object.fromEntries(["prepare", "gate", "package", "installed"].map((phase) => [
    phase, jsonDigest({ commands: commands.filter((command) => command.phase === phase), inputs }),
  ]));
  return { ...extension, commands, healthChecks, artifacts, scenarios: extension.scenarios ?? [], phaseHashes, hash: jsonDigest(files.map(fileDigest)) };
}

export function additionalArtifacts(extension, context, outputs) {
  const verified = new Set();
  const verifyOutput = (path) => {
    if (typeof path !== "string" || !isAbsolute(path) || !existsSync(path) ||
        !inside(realpathSync(context.root), realpathSync(path))) {
      throw new Error("Additional artifact must remain inside isolated state");
    }
    for (const [output, expected] of Object.entries(outputs)) {
      if (typeof expected !== "string" || !existsSync(output)) continue;
      const directory = lstatSync(output).isDirectory();
      if (output !== path && !(directory && inside(realpathSync(output), realpathSync(path)))) continue;
      if (!verified.has(output)) {
        if ((directory ? treeDigest(output) : fileDigest(output)) !== expected) throw new Error("Additional artifact package output changed");
        verified.add(output);
      }
      return;
    }
    throw new Error("Additional artifact requires a declared package output");
  };
  return extension.artifacts.map(({ id, manifest }) => {
    const path = resolve(context.root, manifest);
    verifyOutput(path);
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(value.sha256) ||
        !/^[a-f0-9]{64}$/.test(value.runtimeSha256) ||
        !["platform", "arch", "node", "path"].every((key) => typeof value[key] === "string")) {
      throw new Error("Invalid additional runtime artifact manifest");
    }
    verifyOutput(value.path);
    if (fileDigest(value.path) !== value.sha256) throw new Error("Additional archive differs from its manifest");
    const artifact = Object.fromEntries(["path", "sha256", "runtimeSha256", "schemaVersion", "platform", "arch", "node"].map((key) => [key, value[key]]));
    return { id, artifact };
  });
}

export async function extensionPhase(extension, phase, context) {
  const contextPath = join(context.root, "context.json");
  atomicJson(contextPath, context);
  const selected = phase === "health" ? extension.healthChecks : extension.commands.filter((command) => command.phase === phase);
  const results = [];
  const outputs = {};
  for (const [index, command] of selected.entries()) {
    const logPath = join(context.root, `local-${phase}-${index}.log`);
    const env = { ...fixtureEnv(context), ...command.env, E2E_CONTEXT_PATH: contextPath };
    // Local hooks may select credentials, but cannot redirect the isolated runtime roots.
    for (const key of ["HOME", "USERPROFILE", "OPENCLAW_HOME", "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "E2E_MOCK_STATE", "TMPDIR"]) {
      env[key] = fixtureEnv(context)[key];
    }
    const stdout = await runCommand(command.command, command.args, {
      cwd: ["prepare", "gate", "package"].includes(phase) ? context.sourceDir : context.workspace,
      env, timeoutMs: command.timeoutMs, quiet: true,
      capture: phase === "health", logPath: phase === "health" ? undefined : logPath,
    });
    if (phase === "health") {
      let value;
      try { value = JSON.parse(stdout); }
      catch { throw new Error("Host health check returned invalid protocol"); }
      const result = { available: value.available === true, authenticated: value.authenticated === true, protocol: value.protocol === true };
      results.push(result);
      if (command.required !== false && Object.values(result).some((ok) => !ok)) throw new Error("Required host health check unavailable");
    }
    for (const path of command.outputs ?? []) {
      const output = resolve(context.root, path);
      if (!existsSync(output) || !inside(realpathSync(context.root), realpathSync(output))) throw new Error("Declared local command output is missing or outside isolated root");
      outputs[output] = lstatSync(output).isDirectory() ? treeDigest(output) : fileDigest(output);
    }
  }
  return phase === "health" ? results : outputs;
}
