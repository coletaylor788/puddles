import { accessSync, constants } from 'node:fs';
import { Socket } from 'node:net';
import { isAbsolute, join } from 'node:path';

try {
  // A dead launcher closes the pipe. Only a complete payload sent after durable
  // registration permits exec; partial data or EOF alone cannot start work.
  const payload = await new Promise((resolve, reject) => {
    const input = new Socket({ fd: 3, readable: true, writable: false });
    let value = '';
    input.setEncoding('utf8');
    input.on('data', chunk => {
      value += chunk;
      if (Buffer.byteLength(value) > 2 * 1024 * 1024) input.destroy(new Error('Launch payload exceeds limit'));
    });
    input.once('error', reject);
    input.once('end', () => resolve(value));
  });
  if (!payload) throw new Error('Missing launch payload');
  const { command, args, nodeOptions } = JSON.parse(payload);
  if (nodeOptions !== undefined && typeof nodeOptions !== 'string') throw new Error('Invalid Node options');
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('Invalid command');
  let executable = command;
  if (!isAbsolute(command) && !command.includes('/')) {
    executable = (process.env.PATH ?? '/usr/bin:/bin').split(':').map(directory => join(directory || '.', command))
      .find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
    if (!executable) throw new Error('Executable unavailable');
  }
  const targetEnv = { ...process.env };
  if (nodeOptions !== undefined) targetEnv.NODE_OPTIONS = nodeOptions;
  process.execve(executable, [command, ...args], targetEnv);
} catch {
  // Never echo private argv, environment or payload on startup failure.
  process.stderr.write('Owned command could not start\n');
  process.exit(125);
}
