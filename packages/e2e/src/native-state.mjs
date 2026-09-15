import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, readlinkSync, readSync, realpathSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const fileDigest = (path) => {
  const hash = createHash("sha256");
  const file = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = readSync(file, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(file);
  }
  return hash.digest("hex");
};
export const jsonDigest = (value) => digest(JSON.stringify(value));

function artifactIdentity(artifact) {
  if (!artifact || artifact.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) || !/^[a-f0-9]{64}$/.test(artifact.runtimeSha256) ||
      !["platform", "arch", "node"].every((key) => typeof artifact[key] === "string" && artifact[key])) {
    throw new Error("Invalid rehearsed artifact identity");
  }
  return ["schemaVersion", "sha256", "runtimeSha256", "platform", "arch", "node"].map((key) => artifact[key]);
}

function provenanceIdentity(provenance) {
  if (provenance == null) return null;
  if (!provenance || provenance.schema !== "puddles.openclaw-provider-artifact/v1" ||
      !/^[a-f0-9]{64}$/.test(provenance.sha256) ||
      !/^[a-f0-9]{40}$/.test(provenance.publicHead) ||
      !["sourceSha256", "buildInputsSha256", "buildCommandSha256"].every(
        (key) => /^[a-f0-9]{64}$/.test(provenance[key]),
      )) {
    throw new Error("Invalid additional artifact provenance");
  }
  return [
    provenance.schema,
    provenance.sha256,
    provenance.publicHead,
    provenance.sourceSha256,
    provenance.buildInputsSha256,
    provenance.buildCommandSha256,
  ];
}

function additionalArtifactIdentity({ id, artifact, provenance }) {
  return [id, artifactIdentity(artifact), provenanceIdentity(provenance)];
}

function preparedFileIdentity(record) {
  if (!record || !/^[a-z][a-z0-9-]*$/.test(record.id) ||
      !["file", "directory"].includes(record.type) ||
      !/^[a-f0-9]{64}$/.test(record.sha256)) {
    throw new Error("Invalid prepared file identity");
  }
  return [record.id, record.type, record.sha256];
}

export function verifyCandidateProofs(receiptPath, receipt) {
  const extras = receipt.additionalArtifacts ?? [];
  if (!Array.isArray(extras) || extras.some((extra) => !/^[a-z][a-z0-9-]*$/.test(extra.id)) ||
      new Set(extras.map((extra) => extra.id)).size !== extras.length) throw new Error("Invalid additional artifact identities");
  const provider = extras.find((extra) => extra.id === "llama-cpp-provider");
  const prepared = receipt.preparedFiles ?? [];
  if (!Array.isArray(prepared) ||
      new Set(prepared.map((record) => preparedFileIdentity(record)[0])).size !== prepared.length) {
    throw new Error("Invalid prepared file identities");
  }
  const required = [
    "build",
    ...(provider ? ["provider-package"] : []),
    ...(prepared.length ? ["prepared-files"] : []),
    "regressions",
    "runtime",
    "install",
    ...extras.map((_extra, index) => `install-additional-${index}`),
  ];
  const proofs = {};
  for (const name of required) {
    const path = join(dirname(receiptPath), "stages", `${name}.json`);
    if (!existsSync(path)) throw new Error("Candidate proof is missing");
    const proof = JSON.parse(readFileSync(path, "utf8"));
    if (!proof.inputs || proof.status !== "passed" || proof.key !== receipt.proofs?.[name] ||
        proof.key !== jsonDigest(proof.inputs)) throw new Error("Candidate proof chain does not match");
    proofs[name] = proof;
  }
  const rootIdentity = jsonDigest(artifactIdentity(receipt.artifact));
  if (["regressions", "runtime"].some((name) => jsonDigest(proofs[name].inputs.stateMigration ?? null) !== jsonDigest(receipt.stateMigration ?? null))) {
    throw new Error("State migration differs from candidate proofs");
  }
  if (["runtime", "install"].some((name) => jsonDigest(artifactIdentity(proofs[name].inputs.artifact)) !== rootIdentity)) {
    throw new Error("Root artifact differs from rehearsal proofs");
  }
  const bundleIdentity = (artifacts) => jsonDigest(artifacts.map(additionalArtifactIdentity));
  if (bundleIdentity(extras) !== bundleIdentity(proofs.runtime.inputs.additionalArtifacts ?? [])) throw new Error("Additional artifacts differ from runtime proof");
  const preparedIdentity = (records) => jsonDigest(records.map(preparedFileIdentity));
  if (preparedIdentity(prepared) !== preparedIdentity(proofs.runtime.inputs.preparedFiles ?? [])) {
    throw new Error("Prepared files differ from runtime proof");
  }
  if (prepared.length &&
      preparedIdentity(prepared) !== preparedIdentity(proofs["prepared-files"].result ?? [])) {
    throw new Error("Prepared files differ from package proof");
  }
  for (const [index, extra] of extras.entries()) {
    const inputs = proofs[`install-additional-${index}`].inputs;
    if (jsonDigest(additionalArtifactIdentity(extra)) !==
        jsonDigest(additionalArtifactIdentity({
          id: inputs.id,
          artifact: inputs.artifact,
          provenance: inputs.provenance,
        }))) {
      throw new Error("Additional artifact differs from installation proof");
    }
  }
  if (provider) {
    const provenance = provider.provenance;
    if (!provenance?.path || !existsSync(provenance.path) ||
        fileDigest(provenance.path) !== provenance.sha256) {
      throw new Error("Provider provenance receipt differs from candidate");
    }
    const value = JSON.parse(readFileSync(provenance.path, "utf8"));
    const providerInputs = proofs["provider-package"].inputs;
    if (value.schema !== provenance.schema || value.schemaVersion !== 1 ||
        value.id !== provider.id || value.publicHead !== receipt.repository?.head ||
        value.publicHead !== provenance.publicHead ||
        value.source?.sha256 !== provenance.sourceSha256 ||
        value.source.sha256 !== providerInputs.source ||
        value.build?.inputsSha256 !== proofs.build.key ||
        value.build.inputsSha256 !== provenance.buildInputsSha256 ||
        value.build.commandSha256 !== provenance.buildCommandSha256 ||
        value.build.commandSha256 !== providerInputs.provenance?.buildCommandSha256 ||
        value.build.outputSha256 !== providerInputs.build ||
        value.artifact?.sha256 !== provider.artifact.sha256 ||
        value.artifact.runtimeSha256 !== provider.artifact.runtimeSha256 ||
        jsonDigest(value.toolchain) !== jsonDigest(proofs.build.inputs.tools) ||
        jsonDigest(value.toolchain) !== jsonDigest(providerInputs.provenance?.tools) ||
        jsonDigest(additionalArtifactIdentity(proofs["provider-package"].result)) !==
          jsonDigest(additionalArtifactIdentity(provider))) {
      throw new Error("Provider provenance does not match candidate proofs");
    }
  }
}

export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export function inside(root, path) {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
}

// Hash links as links, but reject runtime bundles that depend on their build tree.
export function treeDigest(root, { portable = false, exclude = [], excludeNames = [], normalizePnpmWorkspaceState = false } = {}) {
  const canonical = realpathSync(root);
  const records = [];
  function walk(path, name) {
    if (exclude.some((item) => name === item || name.startsWith(`${item}/`)) ||
        name.split("/").some((part) => excludeNames.includes(part))) return;
    const stat = lstatSync(path);
    records.push([name, stat.mode & 0o777]);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (portable && (isAbsolute(target) || !inside(canonical, realpathSync(path)))) {
        throw new Error(`Runtime link escapes package: ${name}`);
      }
      records.push(["link", target]);
    } else if (stat.isFile()) {
      if (normalizePnpmWorkspaceState && name === ".pnpm-workspace-state-v1.json") {
        const state = JSON.parse(readFileSync(path, "utf8"));
        if (!state || typeof state !== "object" || Array.isArray(state) ||
            !Number.isFinite(state.lastValidatedTimestamp)) throw new Error("Invalid pnpm workspace-state metadata");
        // pnpm refreshes only this freshness timestamp after unchanged validation.
        const { lastValidatedTimestamp, ...content } = state;
        records.push(["file", jsonDigest(content)]);
      } else {
        records.push(["file", fileDigest(path)]);
      }
    } else if (stat.isDirectory()) {
      for (const child of readdirSync(path).sort()) walk(join(path, child), name ? `${name}/${child}` : child);
    } else {
      throw new Error(`Unsupported artifact entry: ${name}`);
    }
  }
  walk(root, "");
  return jsonDigest(records);
}

export function externalDirectory(requested, protectedRoots) {
  const absolute = resolve(requested);
  let parent = absolute;
  while (!existsSync(parent)) parent = dirname(parent);
  const canonical = resolve(realpathSync(parent), relative(parent, absolute));
  if (protectedRoots.some((root) => inside(realpathSync(root), canonical)) ||
      canonical === dirname(canonical)) {
    throw new Error("Run directory must be outside source and repository trees");
  }
  mkdirSync(canonical, { recursive: true, mode: 0o700 });
  return canonical;
}

export function acquireLock(directory) {
  const lock = join(directory, "lock");
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("Run is locked. Confirm the recorded process has stopped before explicit recovery.");
  }
  atomicJson(join(lock, "owner.json"), { pid: process.pid, startedAt: new Date().toISOString() });
  return () => rmSync(lock, { recursive: true });
}

export function nativeRunStatus(runDir) {
  const stagesDir = join(runDir, "stages");
  const stages = existsSync(stagesDir)
    ? readdirSync(stagesDir).filter((name) => name.endsWith(".json")).sort().map((name) => {
      const record = JSON.parse(readFileSync(join(stagesDir, name), "utf8"));
      return {
        name: record.name,
        status: record.status,
        key: record.key,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt ?? null,
        durationMs: record.durationMs ?? null,
        invalidation: record.invalidation ?? null,
        failure: record.failure ?? null,
      };
    })
    : [];
  const runPath = join(runDir, "run-status.json");
  const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, "utf8")) : null;
  return { schemaVersion: 1, run, stages };
}

export function updateNativeRunStatus(runDir, value) {
  const path = join(runDir, "run-status.json");
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const next = { schemaVersion: 1, ...previous, ...value, updatedAt: new Date().toISOString() };
  atomicJson(path, next);
  return next;
}

export async function stage(runDir, name, inputs, action, outputs = () => ({}), validate = async () => true) {
  const path = join(runDir, "stages", `${name}.json`);
  const key = jsonDigest(inputs);
  let invalidation = "new";
  if (existsSync(path)) {
    const previous = JSON.parse(readFileSync(path, "utf8"));
    if (previous.status === "passed" && previous.key === key) {
      let valid = true;
      for (const [output, expected] of Object.entries(previous.outputs)) {
        const options = typeof expected === "string" ? {} : expected.options;
        const sha256 = typeof expected === "string" ? expected : expected.sha256;
        if (!existsSync(output) || (lstatSync(output).isDirectory()
          ? treeDigest(output, options) : fileDigest(output)) !== sha256) valid = false;
      }
      if (valid && await validate(previous.result)) {
        console.log(`${name}: reused`);
        return previous.result;
      }
      invalidation = valid ? "result-invalid" : "output-changed";
    } else if (previous.status === "failed" && previous.key === key) {
      if (process.env.E2E_RESUME_FAILED !== "1") {
        throw new Error(`${name} failed with unchanged inputs. Run the explicit resume command after addressing the failure.`);
      }
      invalidation = "explicit-resume";
    } else if (previous.status === "running" && previous.key === key) {
      invalidation = "interrupted";
    } else {
      invalidation = "inputs-changed";
    }
  }
  const started = Date.now();
  const record = {
    schemaVersion: 1, name, inputs, key, status: "running",
    invalidation, startedAt: new Date(started).toISOString(),
  };
  atomicJson(path, record);
  try {
    const result = await action();
    const finished = Date.now();
    atomicJson(path, {
      ...record, status: "passed", outputs: outputs(result), result,
      finishedAt: new Date(finished).toISOString(), durationMs: finished - started,
    });
    console.log(`${name}: passed`);
    return result;
  } catch (error) {
    // Command output can contain local extension data. Keep diagnostics in local logs.
    const finished = Date.now();
    atomicJson(path, {
      ...record, status: "failed", finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      failure: { code: error.code ?? null, message: String(error.message ?? error).slice(0, 1000) },
    });
    throw error;
  }
}
