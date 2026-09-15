import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error Native retention is executable JavaScript.
import { acquireArtifactPoolLock, applyArtifactCleanup, initializeArtifactPool, planArtifactCleanup, registerDiagnosticLogs, registerRetainedObject, retentionSpaceSummary, setRetentionReference } from "../src/native-retention.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
  const path = mkdtempSync(join(tmpdir(), "native-retention-test-"));
  roots.push(path);
  return path;
}
function pool() {
  const path = join(root(), "pool");
  initializeArtifactPool(path);
  return path;
}
function object(poolPath: string, id: string, kind: "successful-build" | "failed-reproduction" | "diagnostic-log" | "target-rehearsal" | "target-proof", createdAt: string, dependencies: string[] = [], bytes = id) {
  const source = join(root(), `${id}.bin`);
  writeFileSync(source, bytes);
  return registerRetainedObject(poolPath, {
    id, kind, createdAt, dependencies,
    assets: [{ source, path: "payload.bin" }],
  });
}

describe("owned artifact retention", () => {
  it("keeps two successful builds, one failed reproduction, all logs, and protected dependency closure", () => {
    const directory = pool();
    object(directory, "shared-proof", "successful-build", "2026-01-01T00:00:00.000Z");
    object(directory, "success-one", "successful-build", "2026-01-02T00:00:00.000Z");
    object(directory, "success-two", "successful-build", "2026-01-03T00:00:00.000Z");
    object(directory, "success-three", "successful-build", "2026-01-04T00:00:00.000Z");
    object(directory, "success-pinned", "successful-build", "2025-01-01T00:00:00.000Z", ["shared-proof"]);
    object(directory, "failure-one", "failed-reproduction", "2026-01-02T00:00:00.000Z");
    object(directory, "failure-two", "failed-reproduction", "2026-01-03T00:00:00.000Z");
    object(directory, "ordinary-log", "diagnostic-log", "2020-01-01T00:00:00.000Z", [], "log bytes");
    setRetentionReference(directory, { id: "pinned-release", kind: "pinned", objectIds: ["success-pinned"] });
    const plan = planArtifactCleanup(directory, new Date("2030-01-01T00:00:00.000Z"));
    expect(plan.remove.map((entry: { id: string }) => entry.id)).toEqual(expect.arrayContaining(["success-one", "failure-one"]));
    expect(plan.retained.map((entry: { id: string }) => entry.id)).toEqual(expect.arrayContaining([
      "success-two", "success-three", "success-pinned", "shared-proof", "failure-two", "ordinary-log",
    ]));
    expect(plan.retained.find((entry: { id: string }) => entry.id === "ordinary-log")?.protected).toBe(false);
    applyArtifactCleanup(directory);
    expect(existsSync(join(directory, "objects/ordinary-log"))).toBe(true);
  });

  it.each(["current", "active", "paused", "pinned", "failed-debug", "deployed", "latest-healthy-recovery"] as const)(
    "protects %s references even above ordinary retention counts",
    (kind) => {
      const directory = pool();
      object(directory, "old-success", "successful-build", "2020-01-01T00:00:00.000Z");
      object(directory, "new-success-one", "successful-build", "2026-01-01T00:00:00.000Z");
      object(directory, "new-success-two", "successful-build", "2026-01-02T00:00:00.000Z");
      setRetentionReference(directory, { id: `reference-${kind}`, kind, objectIds: ["old-success"] });
      expect(planArtifactCleanup(directory).remove).toEqual([]);
    },
  );

  it("blocks cleanup for missing, corrupt, linked, escaped, or root ownership", () => {
    const missing = pool();
    object(missing, "success-one", "successful-build", "2026-01-01T00:00:00.000Z", ["missing-object"]);
    expect(() => planArtifactCleanup(missing)).toThrow("dependency is missing");

    const corrupt = pool();
    object(corrupt, "success-one", "successful-build", "2026-01-01T00:00:00.000Z");
    writeFileSync(join(corrupt, "objects/success-one/payload.bin"), "changed");
    expect(() => planArtifactCleanup(corrupt)).toThrow("differs");

    const linked = pool();
    object(linked, "success-one", "successful-build", "2026-01-01T00:00:00.000Z");
    symlinkSync("/tmp", join(linked, "objects/success-one/linked"));
    expect(() => planArtifactCleanup(linked)).toThrow("symbolic link");

    const escaped = pool();
    expect(() => registerRetainedObject(escaped, {
      id: "success-one", kind: "successful-build", createdAt: new Date().toISOString(),
      dependencies: [], assets: [{ source: join(root(), "missing"), path: "../escape" }],
    })).toThrow();

    expect(() => registerRetainedObject(pool(), {
      id: "success-one", kind: "successful-build", createdAt: new Date().toISOString(),
      dependencies: [], assets: [{ source: "/", path: "root" }],
    })).toThrow();
  });

  it("serializes cleanup and pin updates with the shared pool lock", () => {
    const directory = pool();
    object(directory, "success-one", "successful-build", "2026-01-01T00:00:00.000Z");
    const unlock = acquireArtifactPoolLock(directory);
    expect(() => acquireArtifactPoolLock(directory)).toThrow("locked");
    unlock();
    const next = acquireArtifactPoolLock(directory);
    setRetentionReference(directory, { id: "pin", kind: "pinned", objectIds: ["success-one"] });
    next();
    expect(planArtifactCleanup(directory).retained[0].protected).toBe(true);
  });

  it("resumes a moved cleanup object without touching newly registered objects", () => {
    const directory = pool();
    object(directory, "success-one", "successful-build", "2026-01-01T00:00:00.000Z");
    object(directory, "success-two", "successful-build", "2026-01-02T00:00:00.000Z");
    object(directory, "success-three", "successful-build", "2026-01-03T00:00:00.000Z");
    const source = join(directory, "objects/success-one");
    const trash = join(directory, "trash/success-one");
    const metadataSha256 = execFileSync("shasum", ["-a", "256", join(source, "ownership.json")], { encoding: "utf8" }).split(" ")[0];
    writeFileSync(join(directory, "cleanup-journal.json"), JSON.stringify({
      schema: "puddles.openclaw-retention-cleanup/v1",
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      entries: [{ id: "success-one", kind: "successful-build", bytes: 1, metadataSha256, status: "moved" }],
    }));
    renameSync(source, trash);
    expect(planArtifactCleanup(directory).remove).toEqual([]);
    expect(existsSync(trash)).toBe(false);
    expect(existsSync(join(directory, "objects/success-three"))).toBe(true);
  });

  it("recovers interrupted registration staging without blocking cleanup", () => {
    const directory = pool();
    object(directory, "success-one", "successful-build", "2026-01-01T00:00:00.000Z");
    const interrupted = join(directory, "trash/.register-deadbeef");
    mkdirSync(interrupted);
    writeFileSync(join(interrupted, "partial"), "partial copied asset");
    expect(planArtifactCleanup(directory).retained.map((entry: { id: string }) => entry.id))
      .toEqual(["success-one"]);
    applyArtifactCleanup(directory);
    expect(existsSync(interrupted)).toBe(false);
    expect(planArtifactCleanup(directory).remove).toEqual([]);
  });

  it("blocks cleanup when a retained object contains undeclared bytes", () => {
    const directory = pool();
    object(directory, "success-one", "successful-build", "2026-01-01T00:00:00.000Z");
    writeFileSync(join(directory, "objects/success-one/unowned"), "not registered");
    expect(() => planArtifactCleanup(directory)).toThrow("undeclared");
  });

  it("keeps declared logs across artifact cleanup and reports actual space separately from logical bytes", () => {
    const directory = pool();
    const run = root();
    mkdirSync(join(run, "logs"));
    writeFileSync(join(run, "logs/0.log"), "ordinary diagnostic");
    registerDiagnosticLogs(directory, run, new Date("2020-01-01T00:00:00.000Z"));
    for (let index = 0; index < 4; index++) {
      object(directory, `success-${index}`, "successful-build", `2026-01-0${index + 1}T00:00:00.000Z`);
    }
    const result = applyArtifactCleanup(directory);
    expect(result.summary.removableBytes).toBeGreaterThan(0);
    expect(result.summary.diagnosticsBytes).toBe("ordinary diagnostic".length);
    expect(result.summary.diskAfter.freeBytes).toBeGreaterThan(0);
    expect(readdirSync(join(directory, "objects")).some((name) => name.startsWith("log-"))).toBe(true);
    const space = retentionSpaceSummary(directory, Number.MAX_SAFE_INTEGER);
    expect(space.sufficient).toBe(false);
    expect(space.requiredBytes).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("removes an obsolete producer-owned physical target only after its retained proof closure moves", () => {
    const directory = pool();
    object(directory, "target-old", "target-rehearsal", "2026-01-01T00:00:00.000Z", [], "large synthetic target");
    object(directory, "target-proof-old", "target-proof", "2026-01-01T01:00:00.000Z", ["target-old"], "proof");
    object(directory, "build-old", "successful-build", "2026-01-01T02:00:00.000Z", ["target-proof-old"], "bundle");
    setRetentionReference(directory, { id: "current", kind: "current", objectIds: ["build-old"] });
    expect(planArtifactCleanup(directory).remove).toEqual([]);

    object(directory, "target-new", "target-rehearsal", "2026-01-02T00:00:00.000Z", [], "new target");
    object(directory, "target-proof-new", "target-proof", "2026-01-02T01:00:00.000Z", ["target-new"], "new proof");
    object(directory, "build-new", "successful-build", "2026-01-02T02:00:00.000Z", ["target-proof-new"], "new bundle");
    object(directory, "build-newer", "successful-build", "2026-01-03T02:00:00.000Z", [], "newer bundle");
    setRetentionReference(directory, { id: "current", kind: "current", objectIds: ["build-newer"] });
    const plan = planArtifactCleanup(directory);
    expect(plan.remove.map((entry: { id: string }) => entry.id)).toEqual(expect.arrayContaining([
      "target-old", "target-proof-old",
    ]));
    applyArtifactCleanup(directory);
    expect(existsSync(join(directory, "objects/target-old"))).toBe(false);
    expect(existsSync(join(directory, "objects/target-new"))).toBe(true);
  });
});

describe("retention CLI", () => {
  it("initializes, dry-runs, applies, and no-ops through the real command", () => {
    const directory = join(root(), "pool");
    const cli = resolve(import.meta.dirname, "../bin/openclaw-artifact-retention.mjs");
    const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    run("init", directory);
    for (let index = 0; index < 3; index++) {
      const source = join(root(), `asset-${index}`);
      writeFileSync(source, `asset-${index}`);
      const spec = join(root(), `spec-${index}.json`);
      writeFileSync(spec, JSON.stringify({
        id: `success-${index}`,
        kind: "successful-build",
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        dependencies: [],
        assets: [{ source, path: "bundle.tar.gz" }],
      }));
      run("register", directory, spec);
    }
    expect(JSON.parse(run("dry-run", directory)).remove).toHaveLength(1);
    expect(JSON.parse(run("apply", directory)).remove).toHaveLength(1);
    expect(JSON.parse(run("apply", directory)).remove).toHaveLength(0);
  });

  it("returns the primary command failure when cleanup is separately blocked", () => {
    const directory = pool();
    mkdirSync(join(directory, "objects/unregistered"));
    const cli = resolve(import.meta.dirname, "../bin/openclaw-artifact-retention.mjs");
    const result = spawnSync(process.execPath, [cli, "apply", directory], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ownership");
  });
});
