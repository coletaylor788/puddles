import { chmodSync, copyFileSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileDigest, jsonDigest } from "./native-state.mjs";

function databaseFiles(databasePath, label) {
  return ["", "-wal", "-shm", "-journal"].map((suffix) => {
    const path = `${databasePath}${suffix}`;
    const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!stat) return { suffix, identity: null, sha256: null };
    if (!stat.isFile()) throw new Error(`${label} database inspection requires ordinary files`);
    // A hot rollback journal needs recovery by its owning runtime. Never omit
    // it and silently inspect an incomplete database.
    if (suffix === "-journal") throw new Error(`${label} database has a rollback journal; resolve it with the owning runtime before retrying`);
    return { suffix, identity: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String), sha256: fileDigest(path) };
  });
}

export function inspectDatabaseCopy(databasePath, inspect, label = "State") {
  // SQLite readOnly still creates or changes WAL/SHM beside its input. Copy
  // stable database bytes and committed WAL frames before opening SQLite.
  const before = databaseFiles(databasePath, label);
  const root = mkdtempSync(join(tmpdir(), "state-inspect-"));
  try {
    chmodSync(root, 0o700);
    const copy = join(root, "openclaw.sqlite");
    for (const entry of before) {
      // SHM is coordination state. SQLite rebuilds it only in the private copy.
      if (entry.identity === null || entry.suffix === "-shm") continue;
      copyFileSync(`${databasePath}${entry.suffix}`, `${copy}${entry.suffix}`);
      chmodSync(`${copy}${entry.suffix}`, 0o600);
      if (fileDigest(`${copy}${entry.suffix}`) !== entry.sha256) throw new Error(`${label} database changed while copying; retry inspection`);
    }
    if (jsonDigest(databaseFiles(databasePath, label)) !== jsonDigest(before)) throw new Error(`${label} database changed while copying; retry inspection`);
    const db = new DatabaseSync(copy, { readOnly: true });
    try { return inspect(db); } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

