import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// The Gateway owns this client. No server configuration is handed to Claude.
export async function connectBrowser(config) {
  const transport = new StdioClientTransport({ command: config.command, args: config.args,
    env: config.env, stderr: 'pipe' });
  const client = new Client({ name: 'puddles-agent-browser', version: '0.1.0' }, { capabilities: {} });
  try {
    const connecting = client.connect(transport, { timeout: 30_000 });
    transport.stderr?.resume();
    await connecting;
    if (client.getServerVersion()?.version !== '0.43.0') throw new Error('Unexpected Vercel browser version');
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

export function browserConnection(config, connect = connectBrowser) {
  let connection, stopped = false, queue = Promise.resolve();
  function get() {
    if (stopped) throw new Error('Browser plugin is stopped');
    if (!connection) {
      const pending = connect(config).then(client => {
        client.onclose = () => { if (connection === pending) connection = undefined; };
        return client;
      }).catch(error => { if (connection === pending) connection = undefined; throw error; });
      connection = pending;
    }
    return connection;
  }
  return {
    call(name, args, signal) {
      // A shared page has ordered actions. Do not retry failed calls, whose side
      // effects may already have happened. The next call can reconnect.
      const result = queue.then(async () => {
        signal?.throwIfAborted();
        const client = await get();
        signal?.throwIfAborted();
        if (stopped) throw new Error('Browser plugin is stopped');
        return client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120_000 });
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
    async close() {
      stopped = true;
      const pending = connection;
      if (pending) {
        const client = await pending.catch(() => null);
        if (client) await client.close();
      }
      await queue;
    },
  };
}
