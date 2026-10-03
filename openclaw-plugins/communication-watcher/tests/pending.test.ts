import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('openclaw/plugin-sdk/memory-host-search', () => ({ getActiveMemorySearchManager: vi.fn() }));
vi.mock('openclaw/plugin-sdk/file-access-runtime', () => ({ root: async (workspace: string) => ({
  read: async (path: string) => { const fs = await import('node:fs/promises'); return { buffer: await fs.readFile(join(workspace, path)), stat: await fs.stat(join(workspace, path)) }; },
}) }));
import { pendingNotes } from '../src/memory.js';
let workspace: string;
beforeEach(() => { workspace = realpathSync(mkdtempSync(join(tmpdir(), 'watcher-pending-'))); });
afterEach(() => rmSync(workspace, { recursive: true, force: true }));
function note(n: number, pending: boolean, body = 'Waiting for main') {
  const sender = n.toString(16).padStart(32, '0');
  const path = `memory/correspondence/${sender}/2026-10-02.md`;
  mkdirSync(join(workspace, 'memory/correspondence', sender), { recursive: true });
  writeFileSync(join(workspace, path), `Sender key: ${sender}\nWatcher pending: ${pending ? 'yes' : 'no'}\n${body}`);
  return path;
}
it('discovers pending notes across senders without semantic recall or new intake, and skips acknowledged work', async () => {
  note(1, false); const path = note(2, true);
  const guard = vi.fn(async (s: string) => s.replace('Waiting', 'Checked'));
  const page = await pendingNotes(workspace, undefined, guard);
  expect(page.next).toBeNull(); expect(page.results.map(r => r.path)).toEqual([path]);
  expect(page.results[0].text).toContain('Checked for main'); expect(guard).toHaveBeenCalledOnce();
});
it('paginates beyond closed notes and across restart without skipping an open sender', async () => {
  for (let n = 1; n <= 101; n++) note(n, false);
  const expected = Array.from({ length: 7 }, (_, i) => note(102 + i, true));
  let after: string | undefined; const found: string[] = [];
  do {
    const page = await pendingNotes(workspace, after, async s => s);
    found.push(...page.results.map(r => r.path));
    after = page.next ?? undefined;
  } while (after);
  expect(found).toEqual(expected);
});
it('fails closed on blocked notes, symlinks, and oversized content', async () => {
  const path = note(1, true, 'INJECT');
  await expect(pendingNotes(workspace, undefined, async () => { throw new Error('blocked'); })).rejects.toThrow('blocked');
  writeFileSync(join(workspace, path), 'x'.repeat(16001));
  await expect(pendingNotes(workspace, undefined, async s => s)).rejects.toMatchObject({ code: 'limit' });
  rmSync(join(workspace, path)); symlinkSync('/etc/hosts', join(workspace, path));
  await expect(pendingNotes(workspace, undefined, async s => s)).rejects.toMatchObject({ code: 'denied' });
});
it('returns quiet empty and acknowledged-only pages', async () => {
  expect(await pendingNotes(workspace, undefined, async s => s)).toEqual({ results: [], next: null });
  note(1, false);
  expect(await pendingNotes(workspace, undefined, async s => s)).toEqual({ results: [], next: null });
});
