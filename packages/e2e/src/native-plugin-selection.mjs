import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inside, jsonDigest, treeDigest } from "./native-state.mjs";

const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validatePluginRetirements(bindings) {
  if (!Array.isArray(bindings) || !bindings.length || bindings.length > 16) throw new Error("Invalid plugin retirements");
  const ids = new Set();
  for (const binding of bindings) {
    if (!binding || Object.keys(binding).sort().join(",") !== "id,packagePath,packageSha256,recordSha256" ||
        !/^[a-z][a-z0-9-]*$/.test(binding.id ?? "") || ids.has(binding.id) ||
        !hash(binding.recordSha256) || !hash(binding.packageSha256) ||
        typeof binding.packagePath !== "string" || /[\\\x00-\x1f]/.test(binding.packagePath) || isAbsolute(binding.packagePath) ||
        binding.packagePath.split("/").some(part => !part || [".", ".."].includes(part))) {
      throw new Error("Invalid plugin retirement binding");
    }
    ids.add(binding.id);
  }
  return bindings;
}

async function installedFunction(runtime, prefix, name) {
  const files = readdirSync(join(runtime, "dist")).filter(file => file.startsWith(prefix) && /\.m?js$/.test(file) &&
    readFileSync(join(runtime, "dist", file), "utf8").includes(`function ${name}(`));
  if (files.length !== 1) throw new Error(`Missing installed plugin lifecycle function: ${name}`);
  const exports = await import(pathToFileURL(join(runtime, "dist", files[0])).href);
  const matches = [...new Set(Object.values(exports))].filter(value => typeof value === "function" && value.name === name);
  if (matches.length !== 1) throw new Error(`Ambiguous installed plugin lifecycle function: ${name}`);
  return matches[0];
}

export async function loadPluginSelectionApi(runtime) {
  const definitions = {
    read: ["installed-plugin-index-record-reader-", "readPersistedInstalledPluginIndexInstallRecords"],
    inspect: ["installed-plugin-index-record-reader-", "inspectPersistedInstalledPluginIndexInstallRecordsSync"],
    clear: ["installed-plugin-index-record-reader-", "clearLoadInstalledPluginIndexInstallRecordsCache"],
    write: ["installed-plugin-index-records-", "writePersistedInstalledPluginIndexInstallRecordsWithLease"],
    withLease: ["plugin-lifecycle-lease-", "withPluginLifecycleLease"],
    retainedInfo: ["managed-npm-retention-", "resolveRetainedManagedNpmInstallPackageInfo"],
    markRetained: ["managed-npm-retention-", "markRetainedManagedNpmInstall"],
  };
  const api = {};
  for (const [key, args] of Object.entries(definitions)) api[key] = await installedFunction(runtime, ...args);
  return api;
}

function ownedPath(stateDir, path) {
  const result = resolve(stateDir, path);
  if (!inside(stateDir, result) || result === stateDir) throw new Error("Plugin retirement escapes snapshotted state");
  let current = stateDir;
  for (const segment of relative(stateDir, result).split("/")) {
    current = join(current, segment);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() || stat?.isFile() && stat.nlink !== 1 || stat && !stat.isFile() && !stat.isDirectory()) {
      throw new Error("Plugin retirement crosses links or special files");
    }
  }
  return result;
}

function recordsFor(api, stateDir, config, env) {
  api.clear();
  const options = { stateDir, env, artifactPreservingReadOnly: true };
  if (api.inspect(options).status === "invalid") throw new Error("Invalid persisted plugin index");
  const persisted = api.read(options) ?? {};
  const legacy = config.plugins?.installs ?? {};
  for (const id of Object.keys(legacy)) {
    if (persisted[id] && jsonDigest(persisted[id]) !== jsonDigest(legacy[id])) throw new Error("Plugin install representations disagree");
  }
  return { ...legacy, ...persisted };
}

// Only digests and state-relative paths enter the sealed release inputs.
export async function capturePluginRetirements({ runtime, stateDir, config, ids, env = process.env }, api) {
  api ??= await loadPluginSelectionApi(runtime);
  const records = recordsFor(api, stateDir, config, env);
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length ||
      ids.some(id => !/^[a-z][a-z0-9-]*$/.test(id))) throw new Error("Invalid plugin selection IDs");
  const bindings = ids.flatMap(id => {
    const record = records[id];
    if (!record) {
      // Later releases have no global selection left to retire. Still require
      // the candidate to contain the replacement at the canonical bundle path.
      const bundled = join(runtime, "dist/extensions", id);
      if (realpathSync(bundled) !== bundled || JSON.parse(readFileSync(join(bundled, "openclaw.plugin.json"), "utf8")).id !== id) {
        throw new Error("Replacement bundled plugin is missing");
      }
      return [];
    }
    if (!record || record.source !== "npm" || record.artifactKind !== "npm-pack") throw new Error("Expected local archive selection is missing");
    const packageDir = ownedPath(stateDir, record.installPath);
    const marker = api.retainedInfo(packageDir)?.markerPath;
    if (marker && existsSync(ownedPath(stateDir, marker))) throw new Error("Selected plugin already has a retention marker");
    return [{ id, packagePath: relative(stateDir, packageDir), recordSha256: jsonDigest(record), packageSha256: treeDigest(packageDir, { portable: true }) }];
  });
  return bindings.length ? validatePluginRetirements(bindings) : [];
}

export async function retirePluginSelections({ runtime, stateDir, config, bindings, apply = false, env = process.env }, api) {
  validatePluginRetirements(bindings);
  api ??= await loadPluginSelectionApi(runtime);
  const options = { stateDir, env, config };
  const check = () => {
    const records = recordsFor(api, stateDir, config, env);
    for (const binding of bindings) {
      const record = records[binding.id];
      const packageDir = ownedPath(stateDir, binding.packagePath);
      if (!record || record.source !== "npm" || record.artifactKind !== "npm-pack" ||
          resolve(record.installPath) !== packageDir || jsonDigest(record) !== binding.recordSha256 ||
          treeDigest(packageDir, { portable: true }) !== binding.packageSha256) throw new Error("Plugin selection changed since capture");
      const bundled = join(runtime, "dist/extensions", binding.id);
      if (realpathSync(bundled) !== bundled || JSON.parse(readFileSync(join(bundled, "openclaw.plugin.json"), "utf8")).id !== binding.id) {
        throw new Error("Replacement bundled plugin is missing");
      }
      const marker = api.retainedInfo(packageDir)?.markerPath;
      if (marker && existsSync(ownedPath(stateDir, marker))) throw new Error("Plugin retention state changed since capture");
    }
    return records;
  };
  if (!apply) { check(); return; }
  // Called only after the outer activation has stopped the gateway and saved
  // runtime plus all state. Doctor has already imported legacy install records.
  if (bindings.some(({ id }) => config.plugins?.installs?.[id])) throw new Error("Legacy install records must be imported before retirement");
  await api.withLease({ env }, async lease => {
    const records = check();
    for (const binding of bindings) {
      const packageDir = ownedPath(stateDir, binding.packagePath);
      if (api.retainedInfo(packageDir)) {
        if (!await api.markRetained({ packageDir, pluginId: binding.id,
          reason: "removed-managed-npm-install-retained", assertCurrent: () => lease.assertOwned() })) {
          throw new Error("Could not retain the old plugin files");
        }
      }
      delete records[binding.id];
    }
    await api.write(records, { ...options, lease });
    api.clear();
    const after = api.read({ ...options, artifactPreservingReadOnly: true }) ?? {};
    if (jsonDigest(after) !== jsonDigest(records)) throw new Error("Plugin retirement changed unrelated install records");
  });
}
