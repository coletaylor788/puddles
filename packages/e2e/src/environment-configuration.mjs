import { canonicalValueDigest } from "./native-state-migration.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const categories = new Set(["path", "port", "service", "credential-reference", "fixture", "account"]);
const equal = (a, b) => canonicalValueDigest(a) === canonicalValueDigest(b);

function environmentLeaf(path, category) {
  const leaf = path.at(-1);
  const joined = path.join("/");
  if (category === "port") return /^(?:port|[a-zA-Z]+Port)$/.test(leaf);
  if (category === "credential-reference") return /^secrets\/providers\/[^/]+\/path$/.test(joined);
  if (category === "account") return /^(?:channels\/[^/]+\/(?:allowFrom|groupAllowFrom)\/\d+|commands\/ownerAllowFrom\/\d+|bindings\/\d+\/match\/(?:accountId|peer\/id))$/.test(joined);
  if (category === "service") return /(?:\/allowedOrigins\/\d+|\/publicUrl|\/image|^models\/providers\/[^/]+\/(?:baseUrl|localService\/(?:healthUrl|args\/\d+)))$/.test(joined);
  if (category === "fixture") return /(?:\/cliPath|\/binDir|\/llmProvider|\/baseUrl|\/gmailMcpCommand|\/applePimMcpCommand|\/applePimMcpArgs\/\d+|^memory\/qmd\/command)$/.test(joined);
  if (category === "path") return /(?:\/(?:workspace|agentDir|gmailMcpCwd)|^plugins\/load\/paths\/\d+|\/sandbox\/browser\/binds\/\d+|^plugins\/entries\/canvas\/config\/host\/root|\/memory\/search\/(?:extraPaths\/\d+|local\/modelPath)|^memory\/search\/local\/modelPath|^models\/providers\/[^/]+\/localService\/(?:command|cwd|args\/\d+))$/.test(joined);
  return false;
}

function parts(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || /~(?![01])/.test(pointer)) {
    throw new Error("Invalid configuration binding path");
  }
  const result = pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (result.some((part) => !part || forbidden.has(part))) throw new Error("Invalid configuration binding path");
  return result;
}

function location(config, pointer) {
  const path = parts(pointer);
  let parent = config;
  for (const key of path.slice(0, -1)) {
    if ((!object(parent) && !Array.isArray(parent)) || !Object.hasOwn(parent, key)) {
      throw new Error(`Missing configuration binding: ${pointer}`);
    }
    parent = parent[key];
  }
  const key = path.at(-1);
  if ((!object(parent) && !Array.isArray(parent)) || !Object.hasOwn(parent, key)) {
    throw new Error(`Missing configuration binding: ${pointer}`);
  }
  return { parent, key };
}

// Bind values at exact authored leaves. A whole agent, model or plugin subtree
// can never be treated as an environment override.
export function validateConfigurationBindings(base, bindings) {
  canonicalValueDigest(base);
  if (!object(base) || !Array.isArray(bindings)) throw new Error("Invalid shared configuration");
  const seen = new Set();
  for (const binding of bindings) {
    if (!object(binding) || Object.keys(binding).some((key) => !["path", "category", "reason"].includes(key)) ||
        !categories.has(binding.category) || typeof binding.reason !== "string" || !binding.reason.trim()) {
      throw new Error("Invalid configuration binding declaration");
    }
    const path = parts(binding.path);
    if (!environmentLeaf(path, binding.category)) throw new Error(`Unsupported environment binding: ${binding.path}`);
    const key = JSON.stringify(path);
    if (seen.has(key)) throw new Error("Duplicate configuration binding");
    seen.add(key);
    const { parent, key: leaf } = location(base, binding.path);
    const value = parent[leaf];
    if (binding.category === "service" && path.at(-2) === "args" &&
        (parent[Number(leaf) - 1] !== "--port" || !/^\d+$/.test(value))) {
      throw new Error(`Only a service port argument can vary: ${binding.path}`);
    }
    if (binding.category === "path" && path.at(-2) === "args" &&
        parent[Number(leaf) - 1] !== "--models-preset") {
      throw new Error(`Only a declared service path argument can vary: ${binding.path}`);
    }
    if (value !== null && typeof value === "object") throw new Error(`Configuration binding must select a leaf: ${binding.path}`);
    if (typeof value === "boolean" || ["enabled", "model", "primary", "thinkingDefault"].includes(leaf) ||
        path.some((part) => ["allow", "deny", "alsoAllow", "fallbacks"].includes(part))) {
      throw new Error(`Behavior cannot be an environment binding: ${binding.path}`);
    }
  }
  return bindings;
}

export function renderEnvironmentConfiguration(base, bindings, overrides) {
  validateConfigurationBindings(base, bindings);
  if (!object(overrides) || !equal(Object.keys(overrides).sort(), bindings.map(({ path }) => path).sort())) {
    throw new Error("Environment must supply exactly the declared configuration bindings");
  }
  const config = structuredClone(base);
  for (const binding of bindings) {
    const { parent, key } = location(config, binding.path);
    const value = overrides[binding.path];
    if (value === null || typeof value !== typeof parent[key] || typeof value === "object" ||
        typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`Configuration binding type changed: ${binding.path}`);
    }
    if (binding.category === "port" && (!Number.isInteger(value) || value < 1 || value > 65535)) {
      throw new Error(`Invalid environment port: ${binding.path}`);
    }
    parent[key] = value;
  }
  return config;
}

function differences(expected, actual, path = "") {
  if (equal(expected, actual)) return [];
  if ((object(expected) && object(actual)) || (Array.isArray(expected) && Array.isArray(actual))) {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().flatMap((key) => {
      const next = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      return !Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)
        ? [next] : differences(expected[key], actual[key], next);
    });
  }
  return [path || "/"];
}

export function assertEnvironmentConfiguration(actual, base, bindings, overrides) {
  const expected = renderEnvironmentConfiguration(base, bindings, overrides);
  const changed = differences(expected, actual);
  if (changed.length) throw new Error(`Configuration parity failed at ${changed.join(", ")}`);
  return {
    schema: "puddles.environment-configuration/v1",
    baseSha256: canonicalValueDigest(base),
    bindingsSha256: canonicalValueDigest(bindings),
    overridesSha256: canonicalValueDigest(overrides),
    configSha256: canonicalValueDigest(expected),
  };
}

// Only these fields are written by OpenClaw bookkeeping. Missing behavioral
// settings, defaults and legacy fields remain significant.
const metadata = [
  ["meta", "lastTouchedVersion"], ["meta", "lastTouchedAt"],
  ["wizard", "lastRunAt"], ["wizard", "lastRunVersion"],
  ["wizard", "lastRunCommit"], ["wizard", "lastRunCommand"], ["wizard", "lastRunMode"],
];
export function configurationBehavior(config) {
  const copy = structuredClone(config);
  for (const [section, key] of metadata) {
    if (object(copy[section])) {
      delete copy[section][key];
      if (!Object.keys(copy[section]).length) delete copy[section];
    }
  }
  return copy;
}

export const configurationDigest = (config) => canonicalValueDigest(configurationBehavior(config));

export function authoredConfiguration(snapshot) {
  if (!object(snapshot.parsed) || snapshot.includedPaths?.length || snapshot.includeProvenance?.length) {
    throw new Error("Configuration parity requires one authored configuration file");
  }
  const inspect = (value) => {
    if (object(value) && Object.hasOwn(value, "$include")) throw new Error("Configuration parity does not support includes");
    if (value && typeof value === "object") Object.values(value).forEach(inspect);
  };
  inspect(snapshot.parsed);
  return snapshot.parsed;
}

export function assertConfigurationDigest(config, expected, stage) {
  if (configurationDigest(config) !== expected) throw new Error(`Configuration parity failed for ${stage}`);
}
