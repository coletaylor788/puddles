import { isAbsolute } from "node:path";
import { jsonDigest } from "./native-state.mjs";

const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function keys(value, names) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...names].sort().join(",");
}

// This identity describes the environment being changed, not the location of
// a transported receipt, manifest, or integration checkout.
export function migrationTargetIdentity(target) {
  if (!["rehearsal", "production"].includes(target.purpose) ||
      target.privateRole === "development" || !target.host || !target.label ||
      !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 ||
      ["installDir", "stateDir", "plistPath", "backupRoot"].some((key) => !isAbsolute(target[key] ?? ""))) {
    throw new Error("Invalid migration target role or identity");
  }
  return {
    role: target.purpose, host: target.host, label: target.label, port: target.port,
    installDir: target.installDir, stateDir: target.stateDir,
    plistPath: target.plistPath, backupRoot: target.backupRoot,
    additionalInstalls: [...(target.additionalInstalls ?? [])].map(({ id, path }) => ({ id, path }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    preparedFiles: [...(target.preparedFiles ?? [])].map(({ id, path }) => ({ id, path }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function validateMigrationBindings(value) {
  if (!keys(value, ["schema", "generator", "policy", "bindings"]) ||
      value.schema !== "puddles.target-state-migrations/v1" ||
      !keys(value.generator, ["repositoryId", "inputsSha256"]) ||
      !/^[a-z][a-z0-9-]*$/.test(value.generator.repositoryId ?? "") ||
      !hash(value.generator.inputsSha256) ||
      !keys(value.policy, ["id", "sha256"]) ||
      !/^[a-z][a-z0-9/-]*$/.test(value.policy.id ?? "") || !hash(value.policy.sha256) ||
      !Array.isArray(value.bindings) || value.bindings.length !== 2 ||
      value.bindings.some((binding) =>
        !keys(binding, ["role", "targetSha256", "inputsSha256", "manifestSha256"]) ||
        !["rehearsal", "production"].includes(binding.role) ||
        !["targetSha256", "inputsSha256", "manifestSha256"].every((key) => hash(binding[key]))) ||
      new Set(value.bindings.map(({ role }) => role)).size !== 2 ||
      new Set(value.bindings.map(({ targetSha256 }) => targetSha256)).size !== 2) {
    throw new Error("Invalid target-bound state migrations");
  }
  return value;
}

export function selectTargetMigration(receipt, target) {
  if (!receipt.stateMigrations) {
    if ((receipt.stateMigration?.sha256 ?? null) !== (target.stateMigration?.sha256 ?? null)) {
      throw new Error("State migration differs from the rehearsed candidate");
    }
    return null;
  }
  const bindings = validateMigrationBindings(receipt.stateMigrations);
  const targetSha256 = jsonDigest(migrationTargetIdentity(target));
  const binding = bindings.bindings.find(({ role }) => role === target.purpose);
  if (binding.targetSha256 !== targetSha256 ||
      binding.manifestSha256 !== target.stateMigration?.sha256) {
    throw new Error("State migration differs from its sealed target binding");
  }
  return binding;
}
