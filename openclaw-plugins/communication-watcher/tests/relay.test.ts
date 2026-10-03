import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ factory: vi.fn(), send: vi.fn(), read: vi.fn() }));
vi.mock('openclaw/plugin-sdk/agent-harness', () => ({ createOpenClawCodingTools: state.factory }));
vi.mock('../src/memory.js', () => ({ notePath: (path: unknown) => {
  if (typeof path !== 'string' || !/^memory\/correspondence\/[a-f0-9]{32}\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) throw new Error('invalid');
  return path;
}, readNote: state.read }));
import { Relay } from '../src/relay.js';
const path = `memory/correspondence/${'a'.repeat(32)}/2026-09-26.md`;
const ctx = { agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:main:heartbeat', sessionId: randomUUID(), workspaceDir: '/fixture/watcher', sandboxed: true };
const config = { agents: { entries: { 'communication-watcher': { workspace: '/fixture/watcher', tools: { deny: ['sessions_send'] } } } }, tools: { agentToAgent: { enabled: false } } };
const input = { paths: [path], category: 'decision-request', summary: 'A scheduling decision is needed.' };
let workspace: string;
afterEach(() => rmSync(workspace, { recursive: true, force: true }));
beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'watcher-relay-')));
  ctx.workspaceDir = workspace; ctx.sessionId = randomUUID();
  state.factory.mockReset().mockImplementation(() => [{ name: 'sessions_send', execute: state.send }]);
  state.send.mockReset().mockResolvedValue({ details: { status: 'accepted', runId: 'run1', extra: 'RAW_NOT_FOR_MODEL' } });
  state.read.mockReset().mockResolvedValue({ path, text: 'Saved handoff.' });
});
it('uses checked fixed-main native send privately with real identity and no runtime config mutation', async () => {
  const snapshot = JSON.stringify(config);
  const signal = new AbortController().signal;
  const guard = vi.fn(async (s: string) => s.replace('SECRET', '[redacted]'));
  const relay = new Relay('agent:main:owner', guard);
  const output = await relay.report(ctx, config as any, 'call', { ...input, summary: 'SECRET proposal' }, signal);
  expect(output).toEqual({ status: 'accepted', runId: 'run1', paths: [path], ownerReceived: false });
  expect(JSON.stringify(config)).toBe(snapshot);
  expect(state.factory).toHaveBeenCalledWith(expect.objectContaining({ agentId: ctx.agentId, sessionKey: ctx.sessionKey, abortSignal: signal, toolConstructionPlan: expect.objectContaining({ includePluginTools: false, includeShellTools: false }) }));
  expect(state.send).toHaveBeenCalledWith('call', expect.objectContaining({ sessionKey: 'agent:main:owner', timeoutSeconds: 0, message: expect.stringContaining('[redacted] proposal') }), signal);
  expect(state.send.mock.calls[0][1].message).not.toContain('SECRET');
});
it('rejects untrusted routing fields and absent, blocked, or unavailable notes before dispatch', async () => {
  const relay = new Relay('agent:main:owner', async s => s);
  await expect(relay.report(ctx, config as any, 'call', { ...input, sessionKey: 'agent:other:main' })).rejects.toBeDefined();
  state.read.mockRejectedValueOnce(new Error('private failure'));
  await expect(relay.report(ctx, config as any, 'call', input)).rejects.toBeDefined();
  expect(state.send).not.toHaveBeenCalled();
});
it('keeps failed sends capped across a new relay instance and allows the next heartbeat', async () => {
  const relay = new Relay('agent:main:owner', async s => s);
  state.send.mockResolvedValue({ details: { status: 'error', error: 'SECRET native message' } });
  await expect(relay.report(ctx, config as any, 'first', input)).rejects.toMatchObject({ code: 'unavailable' });
  const restarted = new Relay('agent:main:owner', async s => s);
  await expect(restarted.report(ctx, config as any, 'retry', input)).rejects.toMatchObject({ code: 'limit' });
  await expect(restarted.report({ ...ctx, sessionId: randomUUID() }, config as any, 'next', input)).rejects.toMatchObject({ code: 'unavailable' });
  expect(state.send).toHaveBeenCalledTimes(2);
});
it('combines several checked notes and refuses another send in the same heartbeat', async () => {
  const other = path.replace('2026-09-26', '2026-09-27');
  const relay = new Relay('agent:main:owner', async s => s);
  await relay.report(ctx, config as any, 'combined', { ...input, paths: [path, other] });
  expect(state.read).toHaveBeenCalledWith(workspace, other, expect.any(Function));
  expect(state.send.mock.calls[0][1].message).toContain(other);
  await expect(relay.report(ctx, config as any, 'followup', input)).rejects.toMatchObject({ code: 'limit' });
  expect(state.send).toHaveBeenCalledOnce();
});
it('atomically caps concurrent relay instances and rejects non-heartbeat callers', async () => {
  const make = () => new Relay('agent:main:owner', async s => s);
  const outcomes = await Promise.allSettled([make().report(ctx, config as any, 'a', input), make().report(ctx, config as any, 'b', input)]);
  expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
  expect(state.send).toHaveBeenCalledOnce();
  await expect(make().report({ ...ctx, sessionKey: 'agent:communication-watcher:main', sessionId: randomUUID() }, config as any, 'manual', input)).rejects.toMatchObject({ code: 'denied' });
  await expect(make().report({ ...ctx, sessionId: undefined }, config as any, 'missing', input)).rejects.toMatchObject({ code: 'denied' });
});
it('rejects a linked budget directory', async () => {
  symlinkSync(tmpdir(), join(workspace, '.communication-report-budget'));
  await expect(new Relay('agent:main:owner', async s => s).report(ctx, config as any, 'call', input)).rejects.toMatchObject({ code: 'denied' });
  expect(state.send).not.toHaveBeenCalled();
});
it('checks cancellation and retained invocation authority immediately before sending', async () => {
  const controller = new AbortController(); controller.abort();
  const relay = new Relay('agent:main:owner', async s => s);
  await expect(relay.report(ctx, config as any, 'call', input, controller.signal)).rejects.toBeDefined();
  expect(state.send).not.toHaveBeenCalled();
});
