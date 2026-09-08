import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, readlinkSync, realpathSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const fileDigest = (path) => digest(readFileSync(path));
export const jsonDigest = (value) => digest(JSON.stringify(value));

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
export function treeDigest(root, { portable = false, exclude = [], excludeNames = [] } = {}) {
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
      records.push(["file", fileDigest(path)]);
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

export async function stage(runDir, name, inputs, action, outputs = () => ({}), validate = async () => true) {
  const path = join(runDir, "stages", `${name}.json`);
  const key = jsonDigest(inputs);
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
    }
  }
  const record = { schemaVersion: 1, name, inputs, key, status: "running", startedAt: new Date().toISOString() };
  atomicJson(path, record);
  try {
    const result = await action();
    atomicJson(path, { ...record, status: "passed", outputs: outputs(result), result, finishedAt: new Date().toISOString() });
    console.log(`${name}: passed`);
    return result;
  } catch (error) {
    // Command output can contain local extension data. Keep diagnostics in local logs.
    atomicJson(path, { ...record, status: "failed", finishedAt: new Date().toISOString() });
    throw error;
  }
}
