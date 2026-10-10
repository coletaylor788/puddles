import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error Executable lifecycle module.
import { inspectDatabaseCopy } from "../src/native-sqlite-inspection.mjs";

const probe = vi.hoisted(() => ({
  copies: 0, roots: [] as string[],
  afterCopy: undefined as undefined | ((source: string, destination: string) => void),
  copyError: undefined as undefined | Error,
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual,
    copyFileSync: (...args: Parameters<typeof actual.copyFileSync>) => {
      probe.copies++;
      if (probe.copyError) throw probe.copyError;
      actual.copyFileSync(...args);
      probe.afterCopy?.(String(args[0]), String(args[1]));
    },
    mkdtempSync: (...args: Parameters<typeof actual.mkdtempSync>) => {
      const root = actual.mkdtempSync(...args);
      if (String(args[0]).includes("state-inspect-")) probe.roots.push(String(root));
      return root;
    },
  };
});
const roots: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const root of probe.roots) expect(existsSync(root)).toBe(false);
  probe.afterCopy = undefined; probe.copyError = undefined; probe.copies = 0; probe.roots = [];
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(wal = false) {
  const root = mkdtempSync(join(tmpdir(), "sqlite-inspection-source-")); roots.push(root);
  const path = join(root, "source.sqlite");
  const db = new DatabaseSync(path); databases.push(db);
  if (wal) db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  db.exec("CREATE TABLE findings(value INTEGER); INSERT INTO findings VALUES(1)");
  const inspect = vi.fn((copy: DatabaseSync) => copy.prepare("SELECT value FROM findings").get()?.value);
  return { path, db, inspect };
}

it("reacquires a fresh copy after source drift and inspects only the stable version", () => {
  const f = fixture();
  probe.afterCopy = () => { if (probe.copies === 1) f.db.exec("UPDATE findings SET value=2"); };
  expect(inspectDatabaseCopy(f.path, f.inspect)).toBe(2);
  expect(f.inspect).toHaveBeenCalledTimes(1);
  expect(probe.roots).toHaveLength(2);
});

it("retries a copied-byte mismatch without opening the inconsistent copy", () => {
  const f = fixture();
  probe.afterCopy = (_source, destination) => { if (probe.copies === 1) writeFileSync(destination, "inconsistent copy"); };
  expect(inspectDatabaseCopy(f.path, f.inspect)).toBe(1);
  expect(f.inspect).toHaveBeenCalledTimes(1);
  expect(probe.roots).toHaveLength(2);
});

it("refuses persistent drift after three acquisitions without calling inspection", () => {
  const f = fixture();
  probe.afterCopy = () => f.db.exec("UPDATE findings SET value=value+1");
  expect(() => inspectDatabaseCopy(f.path, f.inspect, "Plugin")).toThrow("Plugin database changed while copying; retry inspection");
  expect(probe.roots).toHaveLength(3);
  expect(f.inspect).not.toHaveBeenCalled();
});

it("retains the SHM metadata guard even though SHM is never copied", () => {
  const f = fixture(true);
  probe.afterCopy = (source) => {
    if (source === f.path && probe.roots.length === 1) utimesSync(`${f.path}-shm`, 100, 100);
  };
  expect(inspectDatabaseCopy(f.path, f.inspect)).toBe(1);
  expect(probe.roots).toHaveLength(2);
  expect(f.inspect).toHaveBeenCalledTimes(1);
});

it("does not retry an inspection error that resembles an acquisition error", () => {
  const f = fixture();
  const error = new Error("State database changed while copying; retry inspection"); error.name = "CopyChanged";
  f.inspect.mockImplementation(() => { throw error; });
  expect(() => inspectDatabaseCopy(f.path, f.inspect)).toThrow(error);
  expect(f.inspect).toHaveBeenCalledTimes(1);
  expect(probe.roots).toHaveLength(1);
});

it("does not retry copy IO errors", () => {
  const f = fixture();
  probe.copyError = Object.assign(new Error("copy permission denied"), { code: "EACCES" });
  expect(() => inspectDatabaseCopy(f.path, f.inspect)).toThrow(probe.copyError);
  expect(probe.copies).toBe(1);
  expect(probe.roots).toHaveLength(1);
  expect(f.inspect).not.toHaveBeenCalled();
});

it("does not retry a hot rollback journal", () => {
  const f = fixture(); writeFileSync(`${f.path}-journal`, "pending");
  expect(() => inspectDatabaseCopy(f.path, f.inspect)).toThrow("rollback journal");
  expect(probe.roots).toHaveLength(0);
  expect(f.inspect).not.toHaveBeenCalled();
});

it("does not retry invalid SQLite bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "sqlite-inspection-invalid-")); roots.push(root);
  const path = join(root, "invalid.sqlite"); writeFileSync(path, "invalid database");
  const inspect = vi.fn((db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master").all());
  expect(() => inspectDatabaseCopy(path, inspect)).toThrow();
  expect(probe.roots).toHaveLength(1);
});

it("reads committed WAL records without changing the source database or sidecars", () => {
  const f = fixture(true);
  const paths = [f.path, `${f.path}-wal`, `${f.path}-shm`];
  const before = paths.map(path => readFileSync(path));
  expect(inspectDatabaseCopy(f.path, f.inspect)).toBe(1);
  expect(paths.map(path => readFileSync(path))).toEqual(before);
  expect(probe.roots).toHaveLength(1);
  expect(f.inspect).toHaveBeenCalledTimes(1);
});
