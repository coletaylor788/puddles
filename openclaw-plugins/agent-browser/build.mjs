import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { browserTools } from '../../packages/agent-browser/configuration.mjs';
import { version } from '../../packages/agent-browser/build.mjs';

const root = dirname(fileURLToPath(import.meta.url)), out = join(root, 'dist');
const requireBrowser = createRequire(new URL('../../packages/agent-browser/package.json', import.meta.url));
const upstream = dirname(requireBrowser.resolve('agent-browser/package.json'));
if (JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8')).version !== version) throw new Error('Unexpected Vercel browser pin');
const scratch = mkdtempSync(join(tmpdir(), 'browser-catalog-'));
const client = new Client({ name: 'puddles-browser-build', version: '1' }, { capabilities: {} });
let tools = [], instructions = '';
try {
  const config = join(scratch, 'empty.json'); writeFileSync(config, '{}');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(upstream, 'bin/agent-browser.js'), 'mcp', '--tools', 'core,state,tabs,mobile', '--config', config],
    cwd: scratch, env: { HOME: scratch, PATH: process.env.PATH ?? '', AGENT_BROWSER_SOCKET_DIR: join(scratch, 'sockets') }, stderr: 'pipe' });
  const connecting = client.connect(transport, { timeout: 30_000 }); transport.stderr?.resume(); await connecting;
  if (client.getServerVersion()?.version !== version) throw new Error('Unexpected Vercel MCP version');
  instructions = client.getInstructions() ?? '';
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools); cursor = page.nextCursor;
  } while (cursor);
  tools = browserTools.map(name => {
    const matches = tools.filter(tool => tool.name === name);
    if (matches.length !== 1) throw new Error('Missing or duplicate native browser tool: ' + name);
    return matches[0];
  });
} finally { await client.close(); rmSync(scratch, { recursive: true, force: true }); }
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'instructions.txt'), instructions);
await build({ entryPoints: [join(root, 'src/plugin.mjs')], bundle: true, platform: 'node', format: 'esm',
  target: 'node22', outfile: join(out, 'plugin.js'),
  banner: { js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);' } });
writeFileSync(join(out, 'tools.json'), JSON.stringify(tools, null, 2) + '\n');
const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: source.name, version: source.version,
  type: 'module', main: './plugin.js', openclaw: { extensions: ['./plugin.js'] } }, null, 2) + '\n');
const manifest = JSON.parse(readFileSync(join(root, 'openclaw.plugin.json'), 'utf8'));
manifest.contracts = { tools: browserTools };
writeFileSync(join(out, 'openclaw.plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
