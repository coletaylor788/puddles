import { spawn } from 'node:child_process';
import { once } from 'node:events';

export async function connect(entry, env, args = ['mcp', '--tools', 'core,state,tabs,mobile']) {
  const child = spawn(process.execPath, [entry, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '', next = 1, errors = '';
  const fail = error => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pending.clear();
  };
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Browser MCP exited: ' + errors)));
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line), waiter = pending.get(message.id);
        if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); }
      } catch (error) { fail(error); child.kill(); }
    }
  });
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  function request(method, params = {}) {
    const id = next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP request timed out: ' + method)); }, 30_000);
      pending.set(id, { resolve, reject, timer }); send({ id, method, params });
    });
  }
  async function close() {
    if (child.exitCode !== null || child.signalCode) return;
    const stopped = once(child, 'exit'); child.kill();
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await stopped; } finally { clearTimeout(kill); }
  }
  let initialized;
  try {
    initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'puddles-browser-fixture', version: '1' } });
    if (initialized.error) throw new Error(JSON.stringify(initialized.error));
    send({ method: 'notifications/initialized' });
  } catch (error) { await close(); throw error; }
  return { initialized, request, close,
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    async tools() {
      const tools = []; let cursor;
      do {
        const response = await request('tools/list', cursor ? { cursor } : {});
        if (response.error) throw new Error(JSON.stringify(response.error));
        tools.push(...response.result.tools); cursor = response.result.nextCursor;
      } while (cursor);
      return tools;
    },
  };
}
