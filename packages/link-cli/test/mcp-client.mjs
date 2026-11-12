import { spawn } from 'node:child_process';
import { once } from 'node:events';

export async function connect(entry, env) {
  const child = spawn(process.execPath, [entry, '--mcp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '', next = 1, errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-3000); });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line), waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); }
    }
  });
  child.on('exit', () => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Link MCP exited: ' + errors)); }
    pending.clear();
  });
  function send(message) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }
  function request(method, params = {}) {
    const id = next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP request timed out: ' + method)); }, 15_000);
      pending.set(id, { resolve, reject, timer }); send({ id, method, params });
    });
  }
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'link-fixture', version: '1' } });
  send({ method: 'notifications/initialized' });
  return { request, call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    async close() { if (child.exitCode !== null || child.signalCode) return; const stopped = once(child, 'exit'); child.kill(); await stopped; } };
}

export function result(message) {
  if (message.error) throw new Error(JSON.stringify(message.error));
  if (message.result.isError) throw new Error(JSON.stringify(message.result));
  return JSON.parse(message.result.content[0].text);
}
