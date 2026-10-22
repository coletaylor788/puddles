import { existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { canonical, lock, separate } from '../../release/src/files.mjs';
import { command, stopInterruptedChild } from '../../release/src/commands.mjs';

// One bounded sibling workspace; SQLite commits preserve ownership through
// SIGKILL without creating random temporary metadata outside the owned tree.
export async function applicationTestOperation({ source, artifact, env = process.env }, execute = command) {
  canonical(source); canonical(artifact);
  const root = artifact + '.tests', scratch = join(root, 'scratch'), control = root + '.lock';
  const tool = fileURLToPath(new URL('../bin/openclaw-test-env.mjs', import.meta.url));
  separate([source, artifact, root, control]);
  const owner = { version: 1, kind: 'application-tests', source, artifact, root, scratch, tool };
  const unlock = lock(control); let database;
  try {
    const path = join(control, 'operation.sqlite');
    for (const file of [path, path + '-journal']) {
      canonical(file);
      if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).nlink !== 1)) throw new Error('Unknown application operation metadata');
    }
    if (existsSync(path + '-wal') || existsSync(path + '-shm')) throw new Error('Unknown application operation sidecars');
    database = new DatabaseSync(path);
    database.exec('PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA max_page_count=32; CREATE TABLE IF NOT EXISTS operation (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)');
    const previous = database.prepare('SELECT payload FROM operation WHERE id=1').get();
    if (!previous && existsSync(root)) throw new Error('Refusing an unowned application test workspace');
    let state = previous ? JSON.parse(previous.payload) : { owner, child: null };
    if (JSON.stringify(state.owner) !== JSON.stringify(owner)) throw new Error('Application test operation binding changed');
    const save = () => database.prepare('INSERT OR REPLACE INTO operation VALUES(1, ?)').run(JSON.stringify(state));
    await stopInterruptedChild(state.child, () => { state.child = null; save(); });
    canonical(root); rmSync(root, { recursive: true, force: true });
    save(); // Durable ownership precedes all generated allocation.
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    try {
      await execute({ command: process.execPath, args: [tool, 'ci'], cwd: process.cwd(), timeoutMs: 6 * 60 * 60_000,
        env: { ...env, OPENCLAW_SRC: source, OPENCLAW_CANDIDATE_DIR: artifact, OPENCLAW_APPLICATION_TEST_SCRATCH: scratch } }, {}, child => { state.child = child; save(); });
    } finally {
      // A failed process join deliberately retains all recovery ownership.
      if (!state.child) { canonical(root); rmSync(root, { recursive: true, force: true }); }
    }
  } finally { database?.close(); unlock(); }
}
