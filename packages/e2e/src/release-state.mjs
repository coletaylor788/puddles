import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

function addHashRecord(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(Buffer.from(`${bytes.length}\0`));
  hash.update(bytes);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(path, args, encoding = "utf8") {
  const result = spawnSync("git", ["-C", path, ...args], {
    encoding,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr).trim()}`,
    );
  }
  return result.stdout;
}

export function candidateTreeSha256(path) {
  const diff = git(path, ["diff", "--binary", "HEAD"], null);
  const untracked = git(
    path,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    null,
  )
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const hash = createHash("sha256");
  addHashRecord(hash, "tracked-diff");
  addHashRecord(hash, diff);
  for (const file of untracked) {
    addHashRecord(hash, "untracked");
    addHashRecord(hash, file);
    addHashRecord(hash, readFileSync(join(path, file)));
  }
  return hash.digest("hex");
}

export function atomicWriteJson(path, value) {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function argvSha256(argv) {
  const hash = createHash("sha256");
  for (const value of argv) {
    addHashRecord(hash, value);
  }
  return hash.digest("hex");
}

export function assertSha256(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

export function assertGitSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${label} must be a 40-character lowercase Git SHA`);
  }
}

export function stageCanResume(state, expected) {
  if (
    state?.schemaVersion !== 1 ||
    state.status !== "passed" ||
    state.argvSha256 !== argvSha256(expected.argv) ||
    JSON.stringify(state.inputs) !== JSON.stringify(expected.inputs)
  ) {
    return false;
  }
  try {
    return Object.entries(state.outputs ?? {}).every(
      ([path, digest]) => sha256File(path) === digest,
    );
  } catch {
    return false;
  }
}

export function createRunId() {
  return `${new Date().toISOString().replaceAll(/[-:.]/g, "")}-${randomUUID()}`;
}
