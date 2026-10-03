import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ reminders: [] as any[], complete: vi.fn(), readNote: vi.fn(), searchNotes: vi.fn(), saveNote: vi.fn(), pendingNotes: vi.fn() }));
vi.mock('../src/backend.js', () => ({ cli: () => vi.fn(), reminders: () => ({
  list: async () => state.reminders,
  get: async (id: string) => state.reminders.find(v => v.id === id),
  complete: async (id: string) => { state.complete(id); state.reminders.find(v => v.id === id).isCompleted = true; },
}) }));
vi.mock('../src/memory.js', () => ({ readNote: state.readNote, saveNote: state.saveNote, searchNotes: state.searchNotes, pendingNotes: state.pendingNotes, notePath: (s: string) => { if (!s.startsWith('memory/correspondence/')) throw new Error(); return s; }, safeNote: () => {} }));
vi.mock('mcp-hooks', async original => ({ ...await original<any>(), loadLLMProvider: async () => ({ classify: async (_c: string, _p: string, opts: any) => opts.label === 'secret-redact' ? '{"findings":[]}' : '{"detected":false,"evidence":""}' }) }));
vi.mock('openclaw/plugin-sdk/agent-harness', () => ({ createOpenClawCodingTools: vi.fn() }));
import plugin from '../src/plugin.js';
function setup() {
  let factory: any, hook: any, child: string;
  const runtime = { run: vi.fn(async (params: any) => {
    child = params.sessionKey;
    const tools = factory({ agentId: 'communication-reader', sessionKey: child });
    await tools[0].execute('read', {});
    return { runId: 'run' };
  }), waitForRun: vi.fn(async () => ({ status: 'ok' })), getSessionMessages: vi.fn(async () => ({ messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Dinner proposed by claimed sender.' }] }] })), deleteSession: vi.fn(async () => {}) };
  plugin.register({ pluginConfig: { watcherAgent: 'communication-watcher', readerAgent: 'communication-reader', mainSession: 'agent:main:owner', listId: 'inbox', reminderCli: '/fixture/reminders', calendarCli: '/fixture/calendar', calendarId: 'personal', configDir: '/fixture/config', profile: 'communication', llmProvider: '/fixture/provider' }, runtime: { subagent: runtime }, registerTool: (f: any) => { factory = f; }, on: (_n: string, h: any) => { hook = h; } } as any);
  return { factory, hook, runtime };
}
beforeEach(() => { state.complete.mockReset(); state.reminders = [{ id: 'item1', listId: 'inbox', isCompleted: false, title: 'Message', notes: JSON.stringify({ version: 1, sender: '+15555550123', timestamp: '2026-09-26T12:00:00Z', timestampKind: 'captured', body: 'Dinner at six?' }) }]; });
describe('registered source-specific agent boundaries', () => {
  it('only provides read access to the dedicated reader and rejects unrelated callers', () => {
    const { factory } = setup();
    expect(factory({ agentId: 'stranger', sessionKey: 'agent:stranger:main' })).toEqual([]);
    expect(factory({ agentId: 'communication-reader', sessionKey: 'agent:main:owner' })).toEqual([]);
    expect(factory({ agentId: 'communication-reader', sessionKey: 'agent:communication-reader:job' }).map((v: any) => v.name)).toEqual(['communication_inbox_read']);
  });
  it('runs a fresh reader without delivery and returns checked text and bound receipts', async () => {
    const { factory, runtime } = setup();
    const tools = factory({ agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:heartbeat:1', workspaceDir: '/fixture/main/communication-watcher' });
    const review = tools.find((v: any) => v.name === 'communication_review');
    const output = await review.execute('review', {});
    expect(output.isError).toBeUndefined();
    expect(output.details.receipts).toHaveLength(1);
    expect(JSON.stringify(output)).not.toContain('private');
    expect(runtime.run.mock.calls[0][0]).toMatchObject({ deliver: false });
    expect(runtime.deleteSession).toHaveBeenCalledOnce();
    expect(state.complete).not.toHaveBeenCalled();
    const complete = tools.find((v: any) => v.name === 'communication_inbox_complete');
    expect((await complete.execute('complete', { ticket: output.details.receipts[0].ticket })).details.status).toBe('completed');
  });
  it('keeps native main relay pinned and denies tool escapes before dispatch', async () => {
    const { hook } = setup();
    const ctx = { agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:heartbeat:1' };
    for (const toolName of ['exec', 'read', 'skill_workshop', 'sessions_spawn', 'calendar_write']) expect(await hook({ toolName, params: {} }, ctx)).toMatchObject({ block: true });
    expect(await hook({ toolName: 'sessions_send', params: { sessionKey: 'agent:stranger:main', message: 'report' } }, ctx)).toMatchObject({ block: true });
    expect(await hook({ toolName: 'sessions_send', params: { sessionKey: 'agent:main:owner', message: 'report' } }, ctx)).toMatchObject({ block: true });
    expect(await hook({ toolName: 'write', params: { path: 'AGENTS.md', content: 'change rules' } }, ctx)).toMatchObject({ block: true });
    expect(await hook({ toolName: 'sessions_send', params: {} }, { agentId: 'communication-reader', sessionKey: 'agent:communication-reader:job' })).toMatchObject({ block: true });
  });
  it('reports failed transcript cleanup and retries cleanup before starting another reader', async () => {
    const { factory, runtime } = setup();
    runtime.deleteSession.mockRejectedValueOnce(new Error('private backend error'));
    const tools = factory({ agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:heartbeat:1', workspaceDir: '/fixture/main/communication-watcher' });
    const review = tools.find((v: any) => v.name === 'communication_review');
    expect(await review.execute('first', {})).toMatchObject({ isError: true, details: { status: 'unavailable' } });
    runtime.deleteSession.mockRejectedValueOnce(new Error('still unavailable'));
    expect(await review.execute('second', {})).toMatchObject({ isError: true, details: { status: 'unavailable' } });
    expect(runtime.run).toHaveBeenCalledOnce();
    expect((await review.execute('third', {})).isError).toBeUndefined();
    expect(runtime.run).toHaveBeenCalledTimes(2);
  });
  it('saves through its own tool without relying on lifecycle hooks', async () => {
    const { factory } = setup();
    const ctx = { agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:heartbeat:1', workspaceDir: '/fixture/main/communication-watcher' };
    const save = factory(ctx).find((t: any) => t.name === 'communication_memory_save');
    const path = `memory/correspondence/${'a'.repeat(32)}/2026-09-26.md`;
    state.saveNote.mockResolvedValueOnce({ status: 'saved', path });
    expect((await save.execute('save', { path, content: 'Dinner proposal', previousRevision: null, pending: true })).details.status).toBe('saved');
    expect(state.saveNote).toHaveBeenCalledWith(ctx.workspaceDir, path, 'Dinner proposal', null, expect.any(Function), true);
    expect((await save.execute('extra', { path, content: 'Dinner proposal', previousRevision: null, pending: true, raw: true })).isError).toBe(true);
  });
  it('retains review ownership until delayed transcript cleanup has finished', async () => {
    const { factory, runtime } = setup();
    let failCleanup!: (error: Error) => void;
    let started!: () => void;
    const cleanupStarted = new Promise<void>(resolve => { started = resolve; });
    runtime.deleteSession.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failCleanup = reject; started(); }));
    const review = factory({ agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:heartbeat:1', workspaceDir: '/fixture/main/communication-watcher' }).find((t: any) => t.name === 'communication_review');
    const first = review.execute('first', {});
    await cleanupStarted;
    expect((await review.execute('parallel', {})).details.status).toBe('limit');
    expect(runtime.run).toHaveBeenCalledOnce();
    failCleanup(new Error('cleanup unavailable'));
    expect((await first).details.status).toBe('unavailable');
    expect((await review.execute('next', {})).isError).toBeUndefined();
    expect(runtime.deleteSession).toHaveBeenCalledTimes(3);
  });
  it('discovers unfinished correspondence without invoking inbox or calendar tools', async () => {
    const { factory, runtime } = setup();
    const ctx = { agentId: 'communication-watcher', sessionKey: 'agent:communication-watcher:main:heartbeat', workspaceDir: '/fixture/main/communication-watcher' };
    const pending = factory(ctx).find((t: any) => t.name === 'communication_memory_pending');
    const path = `memory/correspondence/${'a'.repeat(32)}/2026-09-26.md`;
    state.pendingNotes.mockResolvedValue({ results: [{ path, text: 'Report pending' }], next: null });
    expect((await pending.execute('check', {})).details.results).toHaveLength(1);
    expect(runtime.run).not.toHaveBeenCalled();
    expect(state.pendingNotes).toHaveBeenCalledWith(ctx.workspaceDir, undefined, expect.any(Function));
    expect((await pending.execute('escape', { after: '../other.md' })).isError).toBe(true);
  });

});
