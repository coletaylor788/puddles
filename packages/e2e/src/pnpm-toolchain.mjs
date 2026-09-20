import { isAbsolute, relative, resolve } from "node:path";
import { runCommand } from "./process-runner.mjs";

export const PNPM_VERSION = "12.3.4";
export const PNPM_PACKAGE_MANAGER =
  "pnpm@12.3.4+sha512.961aa41fb077da3a04a441d9f8e15ebc0c96da8ef710b2eb67bf9ee7cb0610eabd48f1fd85f51cffe73846785fa0f87c56a3a872a1d893f8446741b5cce45457";
export const PNPM_STORE_ENV = "PNPM_CONFIG_STORE_DIR";

export function configuredPnpmStore(env = process.env) {
  const requested = env[PNPM_STORE_ENV];
  if (!requested || !isAbsolute(requested)) {
    throw new Error(`${PNPM_STORE_ENV} must name one absolute host-local pnpm store root`);
  }
  return resolve(requested);
}

function validateResolvedStore(configured, value) {
  if (!isAbsolute(value)) throw new Error("pnpm store path must be absolute");
  const store = resolve(value);
  const path = relative(configured, store);
  if (path === ".." || path.startsWith("../")) {
    throw new Error("pnpm resolved a store outside PNPM_CONFIG_STORE_DIR");
  }
  return store;
}

export async function inspectPnpmContext(
  cwd,
  execute = runCommand,
  env = process.env,
) {
  const configuredStoreDir = configuredPnpmStore(env);
  const commandEnv = { ...env, [PNPM_STORE_ENV]: configuredStoreDir };
  const version = (await execute(
    "corepack",
    ["pnpm", "--version"],
    { cwd, env: commandEnv, capture: true, quiet: true },
  )).trim();
  if (version !== PNPM_VERSION) {
    throw new Error(`pnpm ${PNPM_VERSION} is required; ${version || "no version"} resolved`);
  }
  const storeDir = validateResolvedStore(
    configuredStoreDir,
    (await execute(
      "corepack",
      ["pnpm", "store", "path", "--silent"],
      { cwd, env: commandEnv, capture: true, quiet: true },
    )).trim(),
  );
  return { version, configuredStoreDir, storeDir };
}

export function requireSharedPnpmStore(repository, source) {
  if (repository.version !== PNPM_VERSION || source.version !== PNPM_VERSION ||
      repository.configuredStoreDir !== source.configuredStoreDir ||
      repository.storeDir !== source.storeDir) {
    throw new Error("Puddles and OpenClaw must use one pnpm version and resolved host store");
  }
  return repository;
}
