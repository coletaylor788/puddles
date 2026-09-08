import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireLock, atomicJson, fileDigest, inside, jsonDigest, treeDigest, verifyCandidateProofs } from "./native-state.mjs";
import { installRuntime } from "./native-package.mjs";
import { runCommand } from "./process-runner.mjs";

const patchDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/openclaw-setup/patches");

function additionalInstallPath(target, path) {
  if (typeof path !== "string" || !path || isAbsolute(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Additional install path must be a child of target state");
  }
  let current = target.stateDir;
  for (const part of path.split("/")) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
      throw new Error("Additional install path must use real state directories");
    }
  }
  return current;
}

export function validateTarget(target) {
  if (target.schemaVersion !== 1 || target.host !== hostname()) throw new Error("Explicit deployment target identity does not match this host");
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535 ||
      !/^[a-zA-Z0-9._-]+$/.test(target.label)) throw new Error("Invalid gateway target");
  for (const name of ["installDir", "stateDir", "plistPath", "backupRoot"]) {
    if (!isAbsolute(target[name] ?? "")) throw new Error("Deployment paths must be explicit absolute paths");
  }
  for (const name of ["installDir", "stateDir"]) {
    if (!lstatSync(target[name]).isDirectory() || lstatSync(target[name]).isSymbolicLink()) throw new Error("Deployment root must be a real directory");
  }
  if (!lstatSync(target.plistPath).isFile()) throw new Error("Gateway service definition is missing");
  mkdirSync(target.backupRoot, { recursive: true, mode: 0o700 });
  const roots = [target.installDir, target.stateDir, target.backupRoot].map((path) => realpathSync(path));
  for (let index = 0; index < roots.length; index++) {
    if (roots.some((root, other) => other !== index && (inside(root, roots[index]) || inside(roots[index], root)))) throw new Error("Deployment roots must be disjoint");
  }
  if (!Array.isArray(target.additionalInstalls ?? [])) throw new Error("Invalid additional install list");
  const ids = new Set();
  const destinations = [];
  for (const install of target.additionalInstalls ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(install.id) || ids.has(install.id)) throw new Error("Invalid additional install identity");
    ids.add(install.id);
    const destination = additionalInstallPath(target, install.path);
    if (destinations.some((path) => inside(path, destination) || inside(destination, path))) throw new Error("Additional installs must be disjoint");
    destinations.push(destination);
  }
}

export function systemOperations(target, recoveryDir, execute = runCommand) {
  const env = {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    HOME: process.env.HOME, OPENCLAW_STATE_DIR: target.stateDir,
    OPENCLAW_CONFIG_PATH: join(target.stateDir, "openclaw.json"),
    OPENCLAW_SERVICE_REPAIR_POLICY: "external", NO_COLOR: "1",
  };
  let counter = 0;
  const run = (command, args, options = {}) => execute(command, args, {
    env, timeoutMs: 60_000, quiet: true,
    logPath: join(recoveryDir, `command-${counter++}.log`), ...options,
  });
  const service = `gui/${process.getuid()}/${target.label}`;
  const cli = (args, runtime = target.installDir) => run(process.execPath, [join(runtime, "openclaw.mjs"), ...args]);
  const currentBrowser = async () => target.browser
    ? (await run("docker", ["image", "inspect", "--format", "{{.Id}}", target.browser.tag], { capture: true })).trim()
    : null;
  const loaded = async () => {
    try { await run("launchctl", ["print", service]); return true; }
    catch (error) {
      if (!error.message.includes("status 113")) throw error;
      return false;
    }
  };
  return {
    async preflight() {
      await run(process.execPath, [join(target.installDir, "openclaw.mjs"), "--version"]);
      await run("python3", ["--version"]);
      treeDigest(target.installDir, { portable: true });
      if (target.browser) {
        if (fileDigest(target.browser.path) !== target.browser.sha256 || !/^sha256:[a-f0-9]{64}$/.test(target.browser.imageId)) throw new Error("Browser artifact identity is invalid");
        const normalizeTag = (tag) => {
          const name = tag.replace(/^(?:docker\.io\/)?library\//, "").replace(/^docker\.io\//, "");
          return name.split("/").at(-1).includes(":") ? name : `${name}:latest`;
        };
        const manifest = JSON.parse(await run("tar", ["-xOf", target.browser.path, "manifest.json"], { capture: true, maxOutputBytes: 1024 * 1024 }));
        if (!Array.isArray(manifest) || manifest.some((image) => !Array.isArray(image.RepoTags) ||
            image.RepoTags.some((tag) => typeof tag !== "string" || normalizeTag(tag) === normalizeTag(target.browser.tag)))) {
          throw new Error("Browser archive must use isolated candidate tags, not the production tag");
        }
        const previous = await currentBrowser();
        if (!/^sha256:[a-f0-9]{64}$/.test(previous)) throw new Error("Previous browser image identity is invalid");
        // Loading prebuilt layers and checking the daemon happen before shutdown.
        await run("docker", ["load", "-i", target.browser.path], { timeoutMs: 5 * 60_000 });
        const image = (await run("docker", ["image", "inspect", "--format", "{{.Id}}", target.browser.imageId], { capture: true })).trim();
        if (image !== target.browser.imageId) throw new Error("Browser image differs from selected artifact");
        return previous;
      }
      return null;
    },
    async install(artifact, prefix) { return installRuntime(artifact, prefix, run); },
    async stop() {
      try { await run("launchctl", ["bootout", service]); }
      catch (error) { if (await loaded()) throw error; }
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!(await loaded())) return;
        await delay(1000);
      }
      throw new Error("Gateway shutdown did not complete");
    },
    async start() { await run("launchctl", ["bootstrap", `gui/${process.getuid()}`, target.plistPath]); },
    async clone(from, to) { await run("python3", [join(patchDir, "clone-runtime-tree.py"), from, to], { timeoutMs: 5 * 60_000 }); },
    async swap(from, to) { await run("python3", [join(patchDir, "swap-runtime-trees.py"), from, to]); },
    async doctor() {
      await cli(["doctor", "--fix", "--yes"]);
      if (await loaded()) throw new Error("Doctor activated the externally managed gateway");
    },
    async browser(imageId, runtime) {
      if (!target.browser) return;
      await run("docker", ["tag", imageId, target.browser.tag]);
      await cli(["sandbox", "recreate", "--agent", "browser-agent", "--force"], runtime);
      await cli(["sandbox", "recreate", "--browser", "--agent", "browser-agent", "--force"], runtime);
    },
    currentBrowser,
    async health() {
      for (let attempt = 0; attempt < 30; attempt++) {
        try { await cli(["gateway", "health", "--port", String(target.port)]); return; }
        catch (error) { if (attempt === 29) throw error; }
        await delay(1000);
      }
    },
  };
}

function verifySnapshots(recoveryDir, journal) {
  if (journal.snapshotReady) {
    if (treeDigest(join(recoveryDir, "state")) !== journal.snapshots.state ||
        treeDigest(join(recoveryDir, "package")) !== journal.snapshots.package ||
        fileDigest(join(recoveryDir, "service.plist")) !== journal.snapshots.service) throw new Error("Recovery snapshot content changed");
  }
  if (journal.browserChanged &&
      treeDigest(join(recoveryDir, "candidate"), { portable: true }) !== journal.candidateSha256) throw new Error("Recovery candidate content changed");
}

async function restore(target, recoveryDir, journal, operations) {
  verifySnapshots(recoveryDir, journal);
  await operations.stop();
  if (journal.explicitRollback && !journal.failedSnapshots) {
    for (const [name, source] of [["failed-state", target.stateDir], ["failed-package", target.installDir]]) {
      const destination = join(recoveryDir, name);
      if (existsSync(destination)) rmSync(destination, { recursive: true });
      await operations.clone(source, destination);
    }
    cpSync(target.plistPath, join(recoveryDir, "failed-service.plist"));
    journal.failedSnapshots = {
      state: treeDigest(join(recoveryDir, "failed-state")),
      package: treeDigest(join(recoveryDir, "failed-package")),
      service: fileDigest(join(recoveryDir, "failed-service.plist")),
    };
    atomicJson(join(recoveryDir, "recovery.json"), journal);
  }
  if (journal.snapshotReady) {
    // Keep failed state for diagnosis. Restore from independent snapshots, so a
    // killed process cannot make us guess whether a prior swap actually happened.
    for (const [name, destination] of [["state", target.stateDir]]) {
      const replacement = join(recoveryDir, `restore-${name}`);
      if (existsSync(replacement)) rmSync(replacement, { recursive: true });
      await operations.clone(join(recoveryDir, name), replacement);
      await operations.swap(destination, replacement);
    }
    cpSync(join(recoveryDir, "service.plist"), target.plistPath);
    if (treeDigest(target.stateDir) !== journal.snapshots.state ||
        fileDigest(target.plistPath) !== journal.snapshots.service) throw new Error("Restored state or service differs from snapshot");
  }
  // Recovery can run after the old package was already restored. Never resolve
  // sandbox discovery through the mutable production install path.
  if (journal.browserChanged) {
    const candidate = join(recoveryDir, "candidate");
    if (treeDigest(candidate, { portable: true }) !== journal.candidateSha256) throw new Error("Recovery candidate content changed");
    await operations.browser(journal.previousBrowser, candidate);
  }
  if (journal.snapshotReady) {
    const replacement = join(recoveryDir, "restore-package");
    if (existsSync(replacement)) rmSync(replacement, { recursive: true });
    await operations.clone(join(recoveryDir, "package"), replacement);
    await operations.swap(target.installDir, replacement);
    if (treeDigest(target.installDir) !== journal.snapshots.package) throw new Error("Restored runtime differs from snapshot");
  }
  await operations.start();
  await operations.health();
}

export async function activateNative(receipt, target, operationsFactory = systemOperations, recoverDir, action = "recover") {
  if (!["recover", "rollback"].includes(action) || action === "rollback" && !recoverDir) throw new Error("Explicit rollback requires its recovery directory");
  validateTarget(target);
  if (receipt.status !== "passed" || receipt.accumulated !== true || !receipt.scenarios) throw new Error("A complete accumulated rehearsal is required before activation");
  const extras = receipt.additionalArtifacts ?? [];
  if (!Array.isArray(extras) || extras.some((extra) => !/^[a-z][a-z0-9-]*$/.test(extra.id) || !extra.artifact?.runtimeSha256) ||
      new Set(extras.map((extra) => extra.id)).size !== extras.length ||
      extras.length !== (target.additionalInstalls ?? []).length ||
      extras.some((extra) => !target.additionalInstalls.some((install) => install.id === extra.id))) {
    throw new Error("Target must map every rehearsed additional artifact exactly once");
  }
  const extraIdentity = extras.map(({ id, artifact }) => ({ id, sha256: artifact.sha256, runtimeSha256: artifact.runtimeSha256 }));
  if (!recoverDir) {
    for (const artifact of [receipt.artifact, ...extras.map((extra) => extra.artifact)]) {
      if (fileDigest(artifact.path) !== artifact.sha256) throw new Error("Rehearsed artifact changed");
    }
  }
  const recoveryDir = recoverDir ? realpathSync(recoverDir) : join(realpathSync(target.backupRoot), `activation-${Date.now()}-${process.pid}`);
  if (dirname(recoveryDir) !== realpathSync(target.backupRoot)) throw new Error("Recovery directory is outside target backups");
  const unlock = acquireLock(target.backupRoot);
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  const operations = operationsFactory(target, recoveryDir);
  const journalPath = join(recoveryDir, "recovery.json");
  const latestPath = join(realpathSync(target.backupRoot), "latest-activation.json");
  let journal = {
    schemaVersion: 1, target: jsonDigest(target), artifact: receipt.artifact.sha256,
    transaction: basename(recoveryDir),
    additionalArtifacts: extraIdentity,
    status: "preflight", snapshotReady: false, browserChanged: false, quiesced: false,
  };
  let signal;
  let recoveryIdentityVerified = !recoverDir;
  const onSignal = (value) => { signal = value; };
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, () => onSignal(name)]);
  for (const [name, handler] of handlers) process.on(name, handler);
  const save = (status) => { journal.status = status; atomicJson(journalPath, journal); };
  const checkpoint = () => { if (signal) throw new Error("Activation interrupted"); };
  const verifyLatest = () => {
    if (journal.transaction !== basename(recoveryDir) || !existsSync(latestPath)) throw new Error("Activation ownership evidence is missing");
    const latest = JSON.parse(readFileSync(latestPath, "utf8"));
    if (latest.transaction !== journal.transaction || latest.target !== journal.target) throw new Error("Activation was superseded; refusing rollback");
  };
  const verifyAdditional = () => {
    for (const install of target.additionalInstalls ?? []) {
      const expected = extras.find((extra) => extra.id === install.id).artifact.runtimeSha256;
      if (treeDigest(additionalInstallPath(target, install.path), { portable: true }) !== expected) throw new Error("Additional deployed runtime differs from rehearsal");
    }
  };
  try {
    if (recoverDir) {
      journal = JSON.parse(readFileSync(journalPath, "utf8"));
      if (journal.target !== jsonDigest(target) || journal.artifact !== receipt.artifact.sha256 ||
          jsonDigest(journal.additionalArtifacts ?? []) !== jsonDigest(extraIdentity)) throw new Error("Recovery identity differs from original target or artifact");
      if (action === "rollback") {
        verifyLatest();
        if (journal.status === "rolled-back") return { status: journal.status, recoveryDir };
        if (journal.status === "healthy") {
          if (!journal.snapshotReady ||
              treeDigest(target.installDir, { portable: true }) !== journal.deployedRuntimeSha256 ||
              fileDigest(target.plistPath) !== journal.deployedServiceSha256) throw new Error("Deployed runtime or service differs from recorded activation");
          verifyAdditional();
          if (target.browser && await operations.currentBrowser() !== target.browser.imageId) throw new Error("Deployed browser differs from recorded activation");
          verifySnapshots(recoveryDir, journal);
          recoveryIdentityVerified = true;
          journal.explicitRollback = true;
          journal.quiesced = true;
          save("rolling-back");
        } else if (!journal.explicitRollback || !journal.quiesced) {
          throw new Error("Explicit rollback requires a healthy activation or its interrupted rollback");
        }
      } else {
        if (["healthy", "rolled-back"].includes(journal.status)) return { status: journal.status, recoveryDir };
        if (!journal.quiesced) return { status: journal.status, recoveryDir };
        if (journal.transaction) verifyLatest();
      }
      recoveryIdentityVerified = true;
      await restore(target, recoveryDir, journal, operations);
      journal.quiesced = false;
      save("rolled-back");
      return { status: "rolled-back", recoveryDir };
    }
    save("preflight");
    journal.previousBrowser = await operations.preflight();
    const prefix = join(dirname(target.installDir), `.puddles-install-${Date.now()}-${process.pid}`);
    journal.prefix = prefix;
    const installed = await operations.install(receipt.artifact, prefix);
    journal.deployedRuntimeSha256 = treeDigest(installed, { portable: true });
    const stagedExtras = {};
    for (const { id, artifact } of extras) {
      const staged = await operations.install(artifact, join(recoveryDir, "additional-staging", id));
      if (treeDigest(staged, { portable: true }) !== artifact.runtimeSha256) throw new Error("Additional staged runtime differs from rehearsal");
      stagedExtras[id] = staged;
      checkpoint();
    }
    if (target.browser) {
      await operations.clone(installed, join(recoveryDir, "candidate"));
      journal.candidateSha256 = treeDigest(join(recoveryDir, "candidate"), { portable: true });
    }
    checkpoint();
    // Snapshots use clonefile through the existing helper, with no fallback copy.
    await operations.clone(target.installDir, join(recoveryDir, "package"));
    cpSync(target.plistPath, join(recoveryDir, "service.plist"));
    atomicJson(latestPath, { transaction: journal.transaction, target: journal.target });
    journal.quiesced = true;
    save("stopping");
    await operations.stop();
    checkpoint();
    await operations.clone(target.stateDir, join(recoveryDir, "state"));
    journal.snapshots = {
      state: treeDigest(join(recoveryDir, "state")),
      package: treeDigest(join(recoveryDir, "package")),
      service: fileDigest(join(recoveryDir, "service.plist")),
    };
    journal.snapshotReady = true;
    save("replacing");
    await operations.swap(target.installDir, installed);
    checkpoint();
    for (const install of target.additionalInstalls ?? []) {
      const destination = additionalInstallPath(target, install.path);
      if (existsSync(destination)) rmSync(destination, { recursive: true });
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      await operations.clone(stagedExtras[install.id], destination);
      checkpoint();
    }
    verifyAdditional();
    await operations.doctor();
    verifyAdditional();
    checkpoint();
    if (target.browser) {
      journal.browserChanged = true;
      save("browser");
      await operations.browser(target.browser.imageId);
    }
    checkpoint();
    save("starting");
    await operations.start();
    await operations.health();
    verifyAdditional();
    if (treeDigest(target.installDir, { portable: true }) !== journal.deployedRuntimeSha256) throw new Error("Deployed runtime changed during activation");
    journal.deployedServiceSha256 = fileDigest(target.plistPath);
    checkpoint();
    journal.quiesced = false;
    save("healthy");
    return { status: "healthy", recoveryDir };
  } catch (error) {
    if (!recoveryIdentityVerified) throw error;
    atomicJson(join(recoveryDir, "failure.json"), { message: error.message, stack: error.stack });
    if (journal.explicitRollback) {
      save("recovery-required");
      throw new Error(`Rollback failed; recovery state: ${recoveryDir}`, { cause: error });
    }
    if (journal.quiesced) {
      save("rolling-back");
      try {
        await restore(target, recoveryDir, journal, operations);
        journal.quiesced = false;
        save("rolled-back");
      } catch (rollbackError) {
        atomicJson(join(recoveryDir, "rollback-failure.json"), { message: rollbackError.message, stack: rollbackError.stack });
        save("recovery-required");
        throw new AggregateError([error, rollbackError], `Activation and rollback failed. Recover from ${recoveryDir}`);
      }
    } else {
      save("failed-before-shutdown");
    }
    throw new Error(`Activation failed; recovery state: ${recoveryDir}`, { cause: error });
  } finally {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    unlock();
  }
}

export async function verifyIntegratedCandidate(receiptPath, target) {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (!receipt.repository?.tree || !target.integration?.repository || !target.integration?.ref) throw new Error("Exact source integration evidence is required");
  const tree = (await runCommand("git", ["-C", target.integration.repository, "rev-parse", `${target.integration.ref}^{tree}`], { capture: true, quiet: true })).trim();
  if (tree !== receipt.repository.tree) throw new Error("Integrated source is not the rehearsed candidate");
  verifyCandidateProofs(receiptPath, receipt);
  return receipt;
}
