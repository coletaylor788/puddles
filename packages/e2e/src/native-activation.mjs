import { accessSync, closeSync, constants, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireLock, atomicJson, fileDigest, inside, jsonDigest, treeDigest, verifyCandidateProofs } from "./native-state.mjs";
import { installRuntime } from "./native-package.mjs";
import { runCommand } from "./process-runner.mjs";
import { readMigrationManifest } from "./native-state-migration.mjs";

const patchDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/openclaw-setup/patches");

function validateNodeMigration(target) {
  const migration = target.nodeMigration;
  if (migration === undefined) return;
  if (!migration || !Number.isInteger(migration.argumentIndex) || migration.argumentIndex < 0) throw new Error("Invalid Node interpreter argument index");
  for (const identity of [migration.expected, migration.desired]) {
    if (!identity || !isAbsolute(identity.path ?? "") || !/^[a-f0-9]{64}$/.test(identity.sha256) ||
        !/^v\d+\.\d+\.\d+$/.test(identity.version) || identity.platform !== process.platform ||
        identity.arch !== process.arch) throw new Error("Invalid Node interpreter identity");
    if (identity.realPath !== undefined && (identity !== migration.expected || !isAbsolute(identity.realPath))) {
      throw new Error("Only the expected Node interpreter may select an explicit canonical realPath");
    }
    if ([target.installDir, target.stateDir, target.backupRoot].some((root) =>
      [identity.path, identity.realPath ?? identity.path].some((path) => inside(existsSync(root) ? realpathSync(root) : resolve(root), resolve(path))))) {
      throw new Error("Node interpreter must remain outside replaced runtime and recovery roots");
    }
  }
  if (migration.expected.path === migration.desired.path || (migration.expected.realPath ?? migration.expected.path) === migration.desired.path) {
    throw new Error("Node migration requires distinct retained executables");
  }
  const [major, minor] = migration.desired.version.slice(1).split(".").map(Number);
  if (!(major === 24 && minor >= 16 || major === 26 && minor >= 1 || major > 26)) throw new Error("Unsupported desired Node runtime");
}

function verifyNodeFile(identity) {
  const canonical = identity.realPath ?? identity.path;
  if (!lstatSync(identity.path, { throwIfNoEntry: false })?.isFile() ||
      !lstatSync(canonical, { throwIfNoEntry: false })?.isFile() || realpathSync(canonical) !== canonical) {
    throw new Error("Node interpreter must be an available canonical executable");
  }
  if (realpathSync(identity.path) !== canonical) throw new Error("Node interpreter path resolution differs from expected canonical binary");
  accessSync(canonical, constants.X_OK);
  if (fileDigest(canonical) !== identity.sha256) throw new Error("Node interpreter executable digest changed");
}

async function verifyNodeIdentities(migration, receipt, operations) {
  for (const identity of [migration.expected, migration.desired]) {
    verifyNodeFile(identity);
    const actual = await operations.inspectNode(identity.realPath ?? identity.path);
    if (["version", "platform", "arch"].some((key) => actual[key] !== identity[key])) throw new Error("Node interpreter version, platform or arch differs");
    verifyNodeFile(identity);
  }
  const desired = migration.desired;
  if (receipt.tools?.node !== desired.version || receipt.tools?.nodeBinary !== desired.sha256 ||
      receipt.tools?.platform !== desired.platform || receipt.tools?.arch !== desired.arch ||
      receipt.artifact.node !== desired.version || receipt.artifact.platform !== desired.platform ||
      receipt.artifact.arch !== desired.arch || process.version !== desired.version ||
      fileDigest(process.execPath) !== desired.sha256) throw new Error("Node interpreter differs from candidate toolchain");
}

function durableServiceCopy(from, to) {
  const staged = `${to}.${randomUUID()}.staged`;
  try {
    cpSync(from, staged, { errorOnExist: true, force: false });
    const file = openSync(staged, "r");
    try { fsyncSync(file); } finally { closeSync(file); }
    renameSync(staged, to);
    const directory = openSync(dirname(to), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    rmSync(staged, { force: true });
  }
}

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
  validateNodeMigration(target);
  if (target.stateMigration) {
    const migration = target.stateMigration;
    if (Object.keys(migration).some((key) => !["manifestPath", "sha256"].includes(key)) ||
        !isAbsolute(migration.manifestPath ?? "") || !/^[a-f0-9]{64}$/.test(migration.sha256 ?? "") ||
        [target.installDir, target.stateDir].some((root) => inside(resolve(root), resolve(migration.manifestPath)))) {
      throw new Error("Invalid stopped-state migration identity");
    }
  }
  if (target.nodeMigration && lstatSync(target.plistPath).isSymbolicLink()) throw new Error("Gateway service definition must be a real file");
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
  const cli = (args, runtime = target.installDir, interpreter = target.nodeMigration?.desired.path ?? process.execPath) =>
    run(interpreter, [join(runtime, "openclaw.mjs"), ...args], {
      env: { ...env, PATH: `${dirname(interpreter)}:${process.env.PATH ?? "/usr/bin:/bin"}` },
    });
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
    async inspectNode(path) {
      return JSON.parse(await run(path, ["-p", "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})"], { capture: true }));
    },
    async prepareService(migration, destination) {
      await run("python3", ["-c", `
import os, plistlib, shutil, sys
source, destination, index, expected, desired = sys.argv[1:]
index = int(index)
with open(source, "rb") as file:
    raw = file.read()
service = plistlib.loads(raw)
args = service.get("ProgramArguments")
if (not isinstance(args, list) or not all(isinstance(arg, str) for arg in args)
    or index >= len(args) or args[index] != expected or args.count(expected) != 1):
    raise ValueError("Missing, ambiguous or mismatched interpreter argument")
if "Program" in service and (index == 0 or service["Program"] != args[0]):
    raise ValueError("Unsupported service Program override")
args[index] = desired
with open(destination, "xb") as file:
    plistlib.dump(service, file, fmt=plistlib.FMT_BINARY if raw.startswith(b"bplist00") else plistlib.FMT_XML, sort_keys=False)
    file.flush()
    os.fsync(file.fileno())
shutil.copymode(source, destination)
`, target.plistPath, destination, String(migration.argumentIndex), migration.expected.path, migration.desired.path]);
    },
    async preflight() {
      await cli(["--version"], target.installDir, target.nodeMigration?.expected.realPath ?? target.nodeMigration?.expected.path ?? process.execPath);
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
    async stateMigration(phase, runtime, manifestPath, sha256) {
      await run(target.nodeMigration?.desired.path ?? process.execPath, [
        resolve(patchDir, "../../../packages/e2e/bin/openclaw-state-migrate.mjs"),
        phase, runtime, realpathSync(target.stateDir), manifestPath, sha256,
      ], {
        env: {
          ...env, OPENCLAW_STATE_DIR: realpathSync(target.stateDir),
          OPENCLAW_CONFIG_PATH: join(realpathSync(target.stateDir), "openclaw.json"),
          XDG_CACHE_HOME: join(recoveryDir, "read-cache"),
        },
      });
    },
    async browser(imageId, runtime, interpreter) {
      if (!target.browser) return;
      await run("docker", ["tag", imageId, target.browser.tag]);
      await cli(["sandbox", "recreate", "--agent", "browser-agent", "--force"], runtime, interpreter);
      await cli(["sandbox", "recreate", "--browser", "--agent", "browser-agent", "--force"], runtime, interpreter);
    },
    currentBrowser,
    async health(interpreter) {
      for (let attempt = 0; attempt < 30; attempt++) {
        try { await cli(["gateway", "health", "--port", String(target.port)], target.installDir, interpreter); return; }
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
  if (journal.nodeMigration) {
    verifyNodeFile(journal.nodeMigration.expected);
    verifyNodeFile(journal.nodeMigration.desired);
  }
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
    if (journal.nodeMigration) durableServiceCopy(join(recoveryDir, "service.plist"), target.plistPath);
    else cpSync(join(recoveryDir, "service.plist"), target.plistPath);
    if (treeDigest(target.stateDir) !== journal.snapshots.state ||
        fileDigest(target.plistPath) !== journal.snapshots.service) throw new Error("Restored state or service differs from snapshot");
  }
  // Recovery can run after the old package was already restored. Never resolve
  // sandbox discovery through the mutable production install path.
  if (journal.browserChanged) {
    const candidate = join(recoveryDir, "candidate");
    if (treeDigest(candidate, { portable: true }) !== journal.candidateSha256) throw new Error("Recovery candidate content changed");
    await operations.browser(journal.previousBrowser, candidate, journal.nodeMigration?.desired.path);
  }
  if (journal.snapshotReady) {
    const replacement = join(recoveryDir, "restore-package");
    if (existsSync(replacement)) rmSync(replacement, { recursive: true });
    await operations.clone(join(recoveryDir, "package"), replacement);
    await operations.swap(target.installDir, replacement);
    if (treeDigest(target.installDir) !== journal.snapshots.package) throw new Error("Restored runtime differs from snapshot");
  }
  if (journal.nodeMigration) {
    verifyNodeFile(journal.nodeMigration.expected);
    verifyNodeFile(journal.nodeMigration.desired);
  }
  await operations.start();
  await operations.health(journal.nodeMigration?.expected.realPath ?? journal.nodeMigration?.expected.path);
}

export async function activateNative(receipt, target, operationsFactory = systemOperations, recoverDir, action = "recover") {
  if (!["recover", "rollback"].includes(action) || action === "rollback" && !recoverDir) throw new Error("Explicit rollback requires its recovery directory");
  validateTarget(target);
  if (receipt.status !== "passed" || receipt.accumulated !== true || !receipt.scenarios) throw new Error("A complete accumulated rehearsal is required before activation");
  if ((receipt.stateMigration?.sha256 ?? null) !== (target.stateMigration?.sha256 ?? null)) {
    throw new Error("State migration differs from the rehearsed candidate");
  }
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
      if ((journal.quiesced || journal.snapshotReady) && (target.nodeMigration || journal.nodeMigration)) {
        const migration = journal.nodeMigration;
        if (!migration || jsonDigest({ argumentIndex: migration.argumentIndex, expected: migration.expected, desired: migration.desired }) !==
            jsonDigest({ argumentIndex: target.nodeMigration?.argumentIndex, expected: target.nodeMigration?.expected, desired: target.nodeMigration?.desired }) ||
            migration.originalServiceSha256 !== fileDigest(join(recoveryDir, "service.plist"))) throw new Error("Recovery Node migration identity differs");
        await verifyNodeIdentities(migration, receipt, operations);
      }
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
    if (target.nodeMigration) {
      await verifyNodeIdentities(target.nodeMigration, receipt, operations);
      const originalServiceSha256 = fileDigest(target.plistPath);
      await operations.prepareService(target.nodeMigration, join(recoveryDir, "candidate-service.plist"));
      if (fileDigest(target.plistPath) !== originalServiceSha256) throw new Error("Gateway service changed during migration preflight");
      journal.nodeMigration = {
        ...target.nodeMigration, originalServiceSha256,
        migratedServiceSha256: fileDigest(join(recoveryDir, "candidate-service.plist")),
      };
      save("preflight");
    }
    journal.previousBrowser = await operations.preflight();
    const prefix = join(dirname(target.installDir), `.puddles-install-${Date.now()}-${process.pid}`);
    journal.prefix = prefix;
    const installed = await operations.install(receipt.artifact, prefix);
    journal.deployedRuntimeSha256 = treeDigest(installed, { portable: true });
    if (target.stateMigration) {
      readMigrationManifest(target.stateMigration.manifestPath, target.stateMigration.sha256);
      const manifestPath = join(recoveryDir, "state-migration.json");
      durableServiceCopy(target.stateMigration.manifestPath, manifestPath);
      readMigrationManifest(manifestPath, target.stateMigration.sha256);
      journal.stateMigration = { sha256: target.stateMigration.sha256, phase: "preflight" };
      save("preflight");
      await operations.stateMigration("preflight", installed, manifestPath, target.stateMigration.sha256);
      checkpoint();
    }
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
    if (journal.nodeMigration) {
      verifyNodeFile(journal.nodeMigration.expected);
      verifyNodeFile(journal.nodeMigration.desired);
      if (fileDigest(target.plistPath) !== journal.nodeMigration.originalServiceSha256 ||
          fileDigest(join(recoveryDir, "candidate-service.plist")) !== journal.nodeMigration.migratedServiceSha256) throw new Error("Gateway service changed before shutdown");
      durableServiceCopy(target.plistPath, join(recoveryDir, "service.plist"));
      if (fileDigest(join(recoveryDir, "service.plist")) !== journal.nodeMigration.originalServiceSha256) throw new Error("Gateway service changed while snapshotting");
    } else cpSync(target.plistPath, join(recoveryDir, "service.plist"));
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
    if (journal.stateMigration) {
      journal.stateMigration.phase = "schema";
      save("migrating-schema");
      await operations.stateMigration("schema", target.installDir, join(recoveryDir, "state-migration.json"), journal.stateMigration.sha256);
      checkpoint();
      journal.stateMigration.phase = "config";
      save("migrating-config");
      await operations.stateMigration("config", target.installDir, join(recoveryDir, "state-migration.json"), journal.stateMigration.sha256);
      checkpoint();
    }
    await operations.doctor();
    if (journal.stateMigration) {
      journal.stateMigration.phase = "cron";
      save("migrating-cron");
      await operations.stateMigration("cron", target.installDir, join(recoveryDir, "state-migration.json"), journal.stateMigration.sha256);
      journal.stateMigration.phase = "complete";
      save("migrated");
    }
    verifyAdditional();
    checkpoint();
    if (journal.nodeMigration) {
      verifyNodeFile(journal.nodeMigration.expected);
      verifyNodeFile(journal.nodeMigration.desired);
      if (fileDigest(target.plistPath) !== journal.nodeMigration.originalServiceSha256 ||
          fileDigest(join(recoveryDir, "candidate-service.plist")) !== journal.nodeMigration.migratedServiceSha256) throw new Error("Gateway service changed before interpreter replacement");
      durableServiceCopy(join(recoveryDir, "candidate-service.plist"), target.plistPath);
    }
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
    if (journal.nodeMigration && journal.deployedServiceSha256 !== journal.nodeMigration.migratedServiceSha256) throw new Error("Deployed interpreter service changed");
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
  if (target.nodeMigration) {
    const proof = JSON.parse(readFileSync(join(dirname(receiptPath), "stages", "runtime.json"), "utf8"));
    if (["node", "nodeBinary", "platform", "arch"].some((key) => proof.inputs.tools?.[key] !== receipt.tools?.[key])) {
      throw new Error("Candidate Node toolchain differs from rehearsal proof");
    }
  }
  return receipt;
}
