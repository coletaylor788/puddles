import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireLock, atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";
import { installRuntime } from "./native-package.mjs";
import { runCommand } from "./process-runner.mjs";

const patchDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/openclaw-setup/patches");

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
        const previous = (await run("docker", ["image", "inspect", "--format", "{{.Id}}", target.browser.tag], { capture: true })).trim();
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
    async health() {
      for (let attempt = 0; attempt < 30; attempt++) {
        try { await cli(["gateway", "health", "--port", String(target.port)]); return; }
        catch (error) { if (attempt === 29) throw error; }
        await delay(1000);
      }
    },
  };
}

async function restore(target, recoveryDir, journal, operations) {
  await operations.stop();
  if (journal.snapshotReady) {
    if (treeDigest(join(recoveryDir, "state")) !== journal.snapshots.state ||
        treeDigest(join(recoveryDir, "package")) !== journal.snapshots.package ||
        fileDigest(join(recoveryDir, "service.plist")) !== journal.snapshots.service) throw new Error("Recovery snapshot content changed");
    // Keep failed state for diagnosis. Restore from independent snapshots, so a
    // killed process cannot make us guess whether a prior swap actually happened.
    for (const [name, destination] of [["state", target.stateDir]]) {
      const replacement = join(recoveryDir, `restore-${name}`);
      if (existsSync(replacement)) rmSync(replacement, { recursive: true });
      await operations.clone(join(recoveryDir, name), replacement);
      await operations.swap(destination, replacement);
    }
    cpSync(join(recoveryDir, "service.plist"), target.plistPath);
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
  }
  await operations.start();
  await operations.health();
}

export async function activateNative(receipt, target, operationsFactory = systemOperations, recoverDir) {
  validateTarget(target);
  if (receipt.status !== "passed" || receipt.accumulated !== true || !receipt.scenarios) throw new Error("A complete accumulated rehearsal is required before activation");
  if (!recoverDir && fileDigest(receipt.artifact.path) !== receipt.artifact.sha256) throw new Error("Rehearsed artifact changed");
  const unlock = acquireLock(target.backupRoot);
  const recoveryDir = recoverDir ? realpathSync(recoverDir) : join(realpathSync(target.backupRoot), `activation-${Date.now()}-${process.pid}`);
  if (dirname(recoveryDir) !== realpathSync(target.backupRoot)) { unlock(); throw new Error("Recovery directory is outside target backups"); }
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  const operations = operationsFactory(target, recoveryDir);
  const journalPath = join(recoveryDir, "recovery.json");
  let journal = {
    schemaVersion: 1, target: jsonDigest(target), artifact: receipt.artifact.sha256,
    status: "preflight", snapshotReady: false, browserChanged: false, quiesced: false,
  };
  let signal;
  let recoveryIdentityVerified = !recoverDir;
  const onSignal = (value) => { signal = value; };
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, () => onSignal(name)]);
  for (const [name, handler] of handlers) process.on(name, handler);
  const save = (status) => { journal.status = status; atomicJson(journalPath, journal); };
  const checkpoint = () => { if (signal) throw new Error("Activation interrupted"); };
  try {
    if (recoverDir) {
      journal = JSON.parse(readFileSync(journalPath, "utf8"));
      if (journal.target !== jsonDigest(target) || journal.artifact !== receipt.artifact.sha256) throw new Error("Recovery identity differs from original target or artifact");
      recoveryIdentityVerified = true;
      if (["healthy", "rolled-back"].includes(journal.status)) return { status: journal.status, recoveryDir };
      if (!journal.quiesced) return { status: journal.status, recoveryDir };
      await restore(target, recoveryDir, journal, operations);
      save("rolled-back");
      return { status: "rolled-back", recoveryDir };
    }
    save("preflight");
    journal.previousBrowser = await operations.preflight();
    const prefix = join(dirname(target.installDir), `.puddles-install-${Date.now()}-${process.pid}`);
    journal.prefix = prefix;
    const installed = await operations.install(receipt.artifact, prefix);
    if (target.browser) {
      await operations.clone(installed, join(recoveryDir, "candidate"));
      journal.candidateSha256 = treeDigest(join(recoveryDir, "candidate"), { portable: true });
    }
    checkpoint();
    // Snapshots use clonefile through the existing helper, with no fallback copy.
    await operations.clone(target.installDir, join(recoveryDir, "package"));
    cpSync(target.plistPath, join(recoveryDir, "service.plist"));
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
    await operations.doctor();
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
    checkpoint();
    journal.quiesced = false;
    save("healthy");
    return { status: "healthy", recoveryDir };
  } catch (error) {
    if (!recoveryIdentityVerified) throw error;
    atomicJson(join(recoveryDir, "failure.json"), { message: error.message, stack: error.stack });
    if (journal.quiesced) {
      save("rolling-back");
      try {
        await restore(target, recoveryDir, journal, operations);
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
  for (const [name, key] of Object.entries(receipt.proofs ?? {})) {
    const proof = JSON.parse(readFileSync(join(dirname(receiptPath), "stages", `${name}.json`), "utf8"));
    if (proof.status !== "passed" || proof.key !== key) throw new Error("Candidate proof no longer matches");
  }
  if (!["regressions", "runtime", "install"].every((name) => receipt.proofs?.[name])) throw new Error("Candidate proof chain is incomplete");
  return receipt;
}
