import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";

const seedSchema = "puddles.openclaw-rehearsal-seed/v1";
const receiptName = ".puddles-rehearsal-seed.json";

function child(root, path, name) {
  if (!isAbsolute(path ?? "") || path === root || !inside(root, path)) {
    throw new Error(`Rehearsal ${name} must be a child of the new isolation root`);
  }
  const part = relative(root, path);
  if (!part || part === ".." || part.startsWith(`..${sep}`)) {
    throw new Error(`Rehearsal ${name} escapes the new isolation root`);
  }
  return part;
}

function source(seed, name, directory) {
  const path = seed[name];
  if (!isAbsolute(path ?? "") || !existsSync(path)) {
    throw new Error(`Rehearsal seed ${name} must be an existing absolute path`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Rehearsal seed ${name} has the wrong type`);
  }
  return realpathSync(path);
}

function verifyContainedLinks(root, path = root) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const childPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      if (!inside(root, realpathSync(childPath))) {
        throw new Error("Rehearsal seed contains a link outside its owned root");
      }
    } else if (entry.isDirectory()) {
      verifyContainedLinks(root, childPath);
    }
  }
}

export function createRehearsalTarget(target, seedPath) {
  if (!seedPath) return null;
  if (target.purpose !== "rehearsal" ||
      target.isolation?.schema !== "puddles.openclaw-rehearsal-target/v1") {
    throw new Error("Only an explicit rehearsal target may be created");
  }
  const declaredRoot = resolve(target.isolation.root ?? "");
  if (!isAbsolute(target.isolation.root ?? "") || existsSync(declaredRoot)) {
    throw new Error("Rehearsal target creation requires a new absolute isolation root");
  }
  const parent = realpathSync(dirname(declaredRoot));
  const root = join(parent, declaredRoot.split(sep).at(-1));
  const seed = JSON.parse(readFileSync(resolve(seedPath), "utf8"));
  if (seed.schema !== seedSchema ||
      Object.keys(seed).some((key) =>
        !["schema", "installDir", "stateDir", "plistPath", "stateMigrationPath"].includes(key)) ||
      Boolean(seed.stateMigrationPath) !== Boolean(target.stateMigration)) {
    throw new Error("Invalid rehearsal target seed");
  }
  const sources = {
    installDir: source(seed, "installDir", true),
    stateDir: source(seed, "stateDir", true),
    plistPath: source(seed, "plistPath", false),
    ...(target.stateMigration ? { stateMigrationPath: source(seed, "stateMigrationPath", false) } : {}),
  };
  const seedDigests = {
    installSha256: treeDigest(sources.installDir),
    stateSha256: treeDigest(sources.stateDir),
    plistSha256: fileDigest(sources.plistPath),
    ...(target.stateMigration ? { stateMigrationSha256: fileDigest(sources.stateMigrationPath) } : {}),
  };
  verifyContainedLinks(sources.installDir);
  verifyContainedLinks(sources.stateDir);
  if (target.stateMigration && seedDigests.stateMigrationSha256 !== target.stateMigration.sha256) {
    throw new Error("Rehearsal seed migration differs from the target");
  }
  const destinations = {
    installDir: child(declaredRoot, resolve(target.installDir), "install directory"),
    stateDir: child(declaredRoot, resolve(target.stateDir), "state directory"),
    plistPath: child(declaredRoot, resolve(target.plistPath), "service definition"),
    backupRoot: child(declaredRoot, resolve(target.backupRoot), "backup directory"),
    ...(target.stateMigration ? {
      stateMigrationPath: child(
        declaredRoot,
        resolve(target.stateMigration.manifestPath),
        "state migration manifest",
      ),
    } : {}),
  };
  const absoluteDestinations = Object.values(destinations).map((part) => join(root, part));
  if (absoluteDestinations.some((path, index) =>
    absoluteDestinations.some((other, otherIndex) =>
      index !== otherIndex && (inside(path, other) || inside(other, path))))) {
    throw new Error("Rehearsal target roots must be disjoint");
  }
  const staging = join(parent, `.${root.split(sep).at(-1)}.create-${process.pid}-${randomUUID()}`);
  try {
    mkdirSync(staging, { mode: 0o700 });
    for (const name of ["installDir", "stateDir"]) {
      const destination = join(staging, destinations[name]);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      cpSync(sources[name], destination, { recursive: true, verbatimSymlinks: true });
    }
    const service = join(staging, destinations.plistPath);
    mkdirSync(dirname(service), { recursive: true, mode: 0o700 });
    cpSync(sources.plistPath, service);
    if (target.stateMigration) {
      const migration = join(staging, destinations.stateMigrationPath);
      mkdirSync(dirname(migration), { recursive: true, mode: 0o700 });
      cpSync(sources.stateMigrationPath, migration);
    }
    mkdirSync(join(staging, destinations.backupRoot), { recursive: true, mode: 0o700 });
    if (treeDigest(join(staging, destinations.installDir)) !== seedDigests.installSha256 ||
        treeDigest(join(staging, destinations.stateDir)) !== seedDigests.stateSha256 ||
        fileDigest(service) !== seedDigests.plistSha256 ||
        target.stateMigration &&
          fileDigest(join(staging, destinations.stateMigrationPath)) !== seedDigests.stateMigrationSha256) {
      throw new Error("Rehearsal seed changed while creating the target");
    }
    atomicJson(join(staging, receiptName), {
      schema: seedSchema,
      schemaVersion: 1,
      targetSha256: jsonDigest(target),
      seed: seedDigests,
    });
    if (existsSync(root)) throw new Error("Rehearsal target root appeared during creation");
    renameSync(staging, root);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return join(root, receiptName);
}

export function rehearsalTargetSeed(target) {
  const path = join(realpathSync(target.isolation.root), receiptName);
  if (!existsSync(path)) return null;
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  if (receipt.schema !== seedSchema || receipt.schemaVersion !== 1 ||
      receipt.targetSha256 !== jsonDigest(target) ||
      !/^[a-f0-9]{64}$/.test(receipt.seed?.installSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(receipt.seed?.stateSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(receipt.seed?.plistSha256 ?? "") ||
      target.stateMigration &&
        receipt.seed?.stateMigrationSha256 !== target.stateMigration.sha256) {
    throw new Error("Rehearsal target seed receipt is invalid");
  }
  return { path, sha256: fileDigest(path) };
}
