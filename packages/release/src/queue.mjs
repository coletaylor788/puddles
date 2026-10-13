import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, readJson, withLock } from './files.mjs';

export const queuePath = root => join(root, 'queue.json');
export const readQueue = root => existsSync(queuePath(root)) ? readJson(queuePath(root)) : { version: 1, ready: [], active: null };
export function updateQueue(root, action) {
  return withLock(join(root, 'queue.lock'), () => {
    const state = readQueue(root);
    if (state.version !== 1 || !Array.isArray(state.ready)) throw new Error('Invalid queue');
    const result = action(state);
    atomicJson(queuePath(root), state);
    return result;
  });
}
export function enqueue(root, ticket) {
  return updateQueue(root, state => {
    if (!ticket.workspace || !existsSync(ticket.workspace) || existsSync(join(ticket.workspace, '.finalizing'))) throw new Error('Feature workspace is missing or finalizing');
    if (state.active?.id === ticket.id || state.ready.some(item => item.id === ticket.id)) throw new Error('Ticket already queued');
    state.ready.push(ticket);
    return { id: ticket.id, position: state.ready.length };
  });
}
export function cancel(root, id) {
  return updateQueue(root, state => {
    if (state.active?.id === id) throw new Error('An active release requires recovery before cancellation');
    const index = state.ready.findIndex(item => item.id === id);
    if (index < 0) throw new Error('Ticket is not queued');
    state.ready.splice(index, 1);
  });
}
