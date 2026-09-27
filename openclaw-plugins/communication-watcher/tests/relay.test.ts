import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ factory: vi.fn(), send: vi.fn(), read: vi.fn() }));
vi.mock('openclaw/plugin-sdk/agent-harness', () => ({ createOpenClawCodingTools: state.factory }));
vi.mock('../src/memory.js', () => ({ notePath: (path: unknown) => {
  if (typeof path !== 'string' || !/^memory\/correspondence\/[a-f0-9]{32}\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) throw new Error('invalid');
  return path;
}, readNote: state.read }));
import { Relay } from '../src/relay.js';
const path = `memory/correspondence/${'a'.repeat(32)}/2026-09-26.md`;
const ctx = { agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:heartbeat:1', workspaceDir: '/fixture/watcher', sandboxed: true };
const config = { agents: { entries: { 'communication-watcher': { workspace: '/fixture/watcher', tools: { deny: ['sessions_send'] } } } }, tools: { agentToAgent: { enabled: false } } };
const input = { path, category: 'decision-request', summary: 'A scheduling decision is needed.' };
beforeEach(() => {
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
  expect(output).toEqual({ status: 'accepted', runId: 'run1', path, ownerReceived: false });
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
it('does not disclose native errors, replies, or metadata and caps attempts across sessions', async () => {
  const relay = new Relay('agent:main:owner', async s => s);
  state.send.mockResolvedValue({ details: { status: 'error', error: 'SECRET native message' } });
  for (let n = 0; n < 3; n++) await expect(relay.report({ ...ctx, sessionKey: `agent:communication-watcher:heartbeat:${n}` }, config as any, 'call', input)).rejects.toMatchObject({ code: 'unavailable' });
  await expect(relay.report(ctx, config as any, 'call', input)).rejects.toMatchObject({ code: 'limit' });
  expect(state.send).toHaveBeenCalledTimes(3);
});
it('checks cancellation and retained invocation authority immediately before sending', async () => {
  const controller = new AbortController(); controller.abort();
  const relay = new Relay('agent:main:owner', async s => s);
  await expect(relay.report(ctx, config as any, 'call', input, controller.signal)).rejects.toBeDefined();
  expect(state.send).not.toHaveBeenCalled();
});
