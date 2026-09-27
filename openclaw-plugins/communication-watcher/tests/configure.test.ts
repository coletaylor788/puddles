import { it, expect } from 'vitest';
// @ts-expect-error executable staging helper is checked at runtime
import { configure, SYSTEM_FILES } from '../scripts/configure.mjs';
const options = { mainWorkspace: '/fixture/main', readerWorkspace: '/fixture/reader', pluginPath: '/fixture/plugin', pluginConfig: { watcherAgent: 'communication-watcher', readerAgent: 'communication-reader' } };
it('preserves existing explicit heartbeat schedules and isolates watcher capabilities', () => {
  const original = { agents: { entries: { main: { workspace: '/fixture/main', heartbeat: { every: '1h' } }, household: { workspace: '/fixture/household' } } } };
  const result = configure(original, options);
  expect(result.agents.entries.main).toEqual({ ...original.agents.entries.main, tools: { alsoAllow: ['communication_memory_read'] } });
  expect(result.agents.entries.household).toEqual(original.agents.entries.household);
  expect(result.agents.entries['communication-watcher'].heartbeat).toMatchObject({ every: '0m', target: 'none', isolatedSession: true });
  expect(result.agents.entries['communication-reader'].tools.allow).toEqual(['session_status', 'communication_inbox_read']);
  expect(result.agents.entries['communication-reader'].tools.deny).toContain('session_status');
  expect(result.agents.entries['communication-watcher'].tools.deny).toEqual(expect.arrayContaining(['write', 'sessions_send']));
  expect(result.agents.entries['communication-watcher'].tools.sandbox.tools.allow).toEqual(result.agents.entries['communication-watcher'].tools.allow);
  expect(result.session?.agentToAgent).toBeUndefined();
  const binds = result.agents.entries['communication-watcher'].sandbox.docker.binds;
  expect(binds).toHaveLength(SYSTEM_FILES.length);
  expect(binds.every((value: string) => value.endsWith(':ro'))).toBe(true);
  expect(original.agents.entries).not.toHaveProperty('communication-watcher');
});
it('adds optional main tools without changing its existing allowlist style and rejects unguarded recall targets', () => {
  const base = { agents: { entries: { main: { workspace: '/fixture/main', tools: { allow: ['read'] } } } } };
  expect(configure(base, options).agents.entries.main.tools.allow).toEqual(['read', 'communication_memory_read']);
  expect(() => configure({ ...base, plugins: { entries: { 'active-memory': { config: { agents: ['communication-watcher'] } } } } }, options)).toThrow('automatic recall');
});
it('preserves inherited main heartbeat and rejects replacement or unnormalized agent layouts', () => {
  expect(configure({ agents: { defaults: { heartbeat: { every: '45m' } }, entries: { main: { workspace: '/fixture/main' } } } }, options).agents.entries.main.heartbeat).toEqual({ every: '45m' });
  expect(() => configure({ agents: { list: [] } }, options)).toThrow('Normalize');
  expect(() => configure({ agents: { entries: { 'communication-watcher': {} } } }, options)).toThrow('replace');
});

it('requires explicit activation and uses the approved 30-minute cadence', () => {
  const base = { agents: { entries: { main: { workspace: '/fixture/main' } } } };
  expect(configure(base, { ...options, enableHeartbeat: true }).agents.entries['communication-watcher'].heartbeat.every).toBe('30m');
  expect(() => configure(base, { ...options, enableHeartbeat: 'true' })).toThrow('activation');
});
