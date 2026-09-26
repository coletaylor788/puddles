import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";
import { fixtureEnv } from "./native-fixture.mjs";
import { runCommand } from "./process-runner.mjs";

export async function loadExtension(path) {
  if (!path) return { schemaVersion: 1, commands: [], scenarios: [], healthChecks: [], artifacts: [], preparedFiles: [], hash: "none", phaseHashes: {} };
  if (!isAbsolute(path) || !existsSync(path)) throw new Error("Local extension requires an existing absolute module path");
  const extension = (await import(pathToFileURL(realpathSync(path)).href)).default;
  if (extension?.schemaVersion !== 1) throw new Error("Unsupported local extension version");
  for (const key of ["commands", "scenarios", "healthChecks", "inputs", "artifacts", "preparedFiles"]) {
    if (!Array.isArray(extension[key] ?? [])) throw new Error("Invalid local extension list");
  }
  const files = [path, ...(extension.inputs ?? [])];
  for (const file of files) {
    if (!isAbsolute(file) || !existsSync(file)) throw new Error("Local extension input missing");
  }
  const commands = extension.commands ?? [];
  const healthChecks = extension.healthChecks ?? [];
  const declaredInputs = extension.inputs ?? [];
  const declaredInputSet = new Set(declaredInputs);
  const names = new Set();
  for (const command of [...commands, ...healthChecks]) {
    if (!/^[a-z0-9-]+$/.test(command.id) || names.has(command.id) ||
        typeof command.command !== "string" || !Array.isArray(command.args) ||
        command.args.some((arg) => typeof arg !== "string") ||
        command.inputs !== undefined &&
          (!Array.isArray(command.inputs) ||
            command.inputs.some((input) => typeof input !== "string" ||
              !declaredInputSet.has(input))) ||
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
  const prepared = extension.preparedFiles ?? [];
  for (const [kind, records] of [["artifact", artifacts], ["prepared file", prepared]]) {
    const ids = new Set();
    for (const record of records) {
      if (!/^[a-z][a-z0-9-]*$/.test(record.id) || ids.has(record.id) ||
          typeof record.manifest !== "string" || !record.manifest ||
          isAbsolute(record.manifest) || record.manifest.split("/").includes("..")) {
        throw new Error(`Invalid named local ${kind}`);
      }
      ids.add(record.id);
    }
  }
  const inputDigests = new Map(declaredInputs.map((input) => [input, fileDigest(input)]));
  const phaseHashes = Object.fromEntries(["prepare", "gate", "package", "installed"].map((phase) => {
    const selectedCommands = commands.filter((command) => command.phase === phase);
    const selectedInputs = new Set(selectedCommands.flatMap(
      (command) => command.inputs ?? declaredInputs,
    ));
    return [phase, jsonDigest({
      commands: selectedCommands,
      inputs: declaredInputs
        .filter((input) => selectedInputs.has(input))
        .map((input) => inputDigests.get(input)),
    })];
  }));
  return {
    ...extension, commands, healthChecks, artifacts, preparedFiles: prepared,
    scenarios: extension.scenarios ?? [], phaseHashes, hash: jsonDigest(files.map(fileDigest)),
  };
}

function packageOutputVerifier(context, outputs) {
  const verified = new Set();
  return (path) => {
    if (typeof path !== "string" || !isAbsolute(path) || !existsSync(path) ||
        !inside(realpathSync(context.root), realpathSync(path))) {
      throw new Error("Local package output must remain inside isolated state");
    }
    for (const [output, expected] of Object.entries(outputs)) {
      if (typeof expected !== "string" || !existsSync(output)) continue;
      const directory = lstatSync(output).isDirectory();
      if (output !== path && !(directory && inside(realpathSync(output), realpathSync(path)))) continue;
      if (!verified.has(output)) {
        if ((directory ? treeDigest(output) : fileDigest(output)) !== expected) throw new Error("Local package output changed");
        verified.add(output);
      }
      return;
    }
    throw new Error("Local package selection requires a declared package output");
  };
}

export function additionalArtifacts(extension, context, outputs) {
  const verifyOutput = packageOutputVerifier(context, outputs);
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

export function preparedFiles(extension, context, outputs) {
  const verifyOutput = packageOutputVerifier(context, outputs);
  return extension.preparedFiles.map(({ id, manifest }) => {
    const manifestPath = resolve(context.root, manifest);
    verifyOutput(manifestPath);
    const value = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (value.schemaVersion !== 1 || !["file", "directory"].includes(value.type) ||
        typeof value.path !== "string" || !isAbsolute(value.path) ||
        !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw new Error("Invalid prepared file manifest");
    }
    verifyOutput(value.path);
    const stat = lstatSync(value.path);
    if (stat.isSymbolicLink() ||
        value.type === "file" && !stat.isFile() ||
        value.type === "directory" && !stat.isDirectory()) {
      throw new Error("Prepared file type differs from its manifest");
    }
    const sha256 = value.type === "file"
      ? fileDigest(value.path)
      : treeDigest(value.path, { portable: true });
    if (sha256 !== value.sha256) throw new Error("Prepared file differs from its manifest");
    return { id, type: value.type, path: value.path, sha256 };
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
