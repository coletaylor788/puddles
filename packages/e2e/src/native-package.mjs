import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative } from "node:path";
import { atomicJson, digest, fileDigest, treeDigest } from "./native-state.mjs";
import { runCommand } from "./process-runner.mjs";

// Materialize the production dependency graph from the installed frozen graph.
// Resolve per package, not from the root: transitive versions and patched modules differ.
export function materializeRuntime(source, destination) {
  if (existsSync(destination)) throw new Error("Runtime destination already exists");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const installed = new Map([[realpathSync(source), destination]]);
  function packageCopy(from) {
    const real = realpathSync(from);
    if (installed.has(real)) return installed.get(real);
    const to = join(destination, "node_modules", ".runtime-deps", digest(real).slice(0, 24));
    installed.set(real, to);
    mkdirSync(dirname(to), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(real, "package.json"), "utf8"));
    cpSync(real, to, {
      recursive: true, dereference: true,
      filter: (path) => !["node_modules", ".git"].includes(relative(real, path).split("/")[0]),
    });
    const deps = { ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const name of Object.keys(deps)) {
      let current = real;
      let dependency;
      while (true) {
        const candidate = join(current, "node_modules", name);
        if (existsSync(candidate)) { dependency = realpathSync(candidate); break; }
        if (dirname(current) === current) break;
        current = dirname(current);
      }
      if (!dependency) {
        if (Object.hasOwn(manifest.optionalDependencies ?? {}, name) || manifest.peerDependenciesMeta?.[name]?.optional) continue;
        throw new Error(`Missing production dependency: ${name}`);
      }
      const target = join(to, "node_modules", name);
      mkdirSync(dirname(target), { recursive: true });
      const copied = packageCopy(dependency);
      symlinkSync(relative(dirname(target), copied), target);
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        if (manifest[field]?.[name]) manifest[field][name] = JSON.parse(readFileSync(join(dependency, "package.json"), "utf8")).version;
      }
    }
    delete manifest.devDependencies;
    // This tree is extracted directly; registry resolution is never part of installation.
    atomicJson(join(to, "package.json"), manifest);
    return to;
  }
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  // Let npm apply upstream's files list and exclusions, without lifecycle hooks.
  const selection = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: source, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, npm_config_update_notifier: "false" },
  });
  if (selection.error || selection.status !== 0) throw new Error("Bounded upstream package file selection failed");
  const [pack] = JSON.parse(selection.stdout);
  if (!pack?.files?.length) throw new Error("Upstream selected an empty package");
  for (const { path: name } of pack.files) {
    if (isAbsolute(name) || name.split("/").includes("..")) throw new Error("Invalid upstream package path");
    mkdirSync(dirname(join(destination, name)), { recursive: true });
    cpSync(join(source, name), join(destination, name), { dereference: true });
  }
  // Copy exactly the production graph by resolving from the root package.
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    const from = join(source, "node_modules", name);
    if (!existsSync(from)) {
      if (Object.hasOwn(manifest.optionalDependencies ?? {}, name)) continue;
      throw new Error(`Missing production dependency: ${name}`);
    }
    const to = join(destination, "node_modules", name);
    mkdirSync(dirname(to), { recursive: true });
    const copied = packageCopy(from);
    symlinkSync(relative(dirname(to), copied), to);
    for (const field of ["dependencies", "optionalDependencies"]) {
      if (manifest[field]?.[name]) manifest[field][name] = JSON.parse(readFileSync(join(from, "package.json"), "utf8")).version;
    }
  }
  delete manifest.devDependencies;
  atomicJson(join(destination, "package.json"), manifest);
  treeDigest(destination, { portable: true });
}

export async function packRuntime(source, directory, run = runCommand) {
  const runtime = join(directory, "runtime");
  if (existsSync(runtime)) rmSync(runtime, { recursive: true });
  materializeRuntime(source, runtime);
  const identity = { schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version, runtimeSha256: treeDigest(runtime, { portable: true }) };
  atomicJson(join(directory, "runtime-identity.json"), identity);
  const artifact = join(directory, "openclaw-runtime.tar.gz");
  await run("tar", ["-czf", artifact, "-C", directory, "runtime", "runtime-identity.json"]);
  return { path: artifact, sha256: fileDigest(artifact), ...identity };
}

export async function installRuntime(artifact, prefix, run = runCommand) {
  if (fileDigest(artifact.path) !== artifact.sha256) throw new Error("Artifact digest changed");
  if (existsSync(prefix)) throw new Error("Install prefix must be new");
  mkdirSync(prefix, { recursive: true, mode: 0o700 });
  const entries = await run("tar", ["-tzf", artifact.path], { capture: true });
  if (entries.split("\n").filter(Boolean).some((entry) => entry.startsWith("/") || entry.split("/").includes("..") || !["runtime", "runtime-identity.json"].includes(entry.split("/")[0]))) {
    throw new Error("Invalid runtime archive path");
  }
  await run("tar", ["-xzf", artifact.path, "-C", prefix]);
  const identity = JSON.parse(readFileSync(join(prefix, "runtime-identity.json"), "utf8"));
  if (identity.platform !== process.platform || identity.arch !== process.arch || identity.node !== process.version) throw new Error("Runtime toolchain or target differs from rehearsal");
  const runtime = join(prefix, "runtime");
  if (treeDigest(runtime, { portable: true }) !== identity.runtimeSha256) throw new Error("Installed runtime differs from artifact identity");
  return runtime;
}
