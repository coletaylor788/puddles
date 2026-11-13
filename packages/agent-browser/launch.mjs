#!/usr/bin/env node
// Host launch wiring only. Vercel owns MCP, tools, credentials and browser actions.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateSpec(spec) {
  if (spec.version !== 1 || !/^sha256:[a-f0-9]{64}$/.test(spec.image ?? '')) throw new Error('Pinned browser image required');
  for (const key of ['docker', 'stateDir', 'profile', 'downloads']) {
    if (typeof spec[key] !== 'string' || !isAbsolute(spec[key]) || /[\0\r\n,]/.test(spec[key])) throw new Error('Absolute browser binding required: ' + key);
  }
  if (!/^unix:\/\/\/[^\0\r\n]+$/.test(spec.dockerHost ?? '')) throw new Error('Explicit local Docker socket required');
  if (typeof spec.headless !== 'boolean') throw new Error('Explicit browser display mode required');
  const inside = (parent, child) => { const r = relative(parent, child); return !r || (!r.startsWith('..') && !isAbsolute(r)); };
  if (inside(spec.profile, spec.stateDir) || inside(spec.downloads, spec.stateDir)
    || inside(spec.stateDir, spec.profile) || inside(spec.stateDir, spec.downloads)
    || inside(spec.profile, spec.downloads) || inside(spec.downloads, spec.profile)) {
    throw new Error('Browser state, profile and downloads must be separate');
  }
  return spec;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const containerName = spec => 'puddles-browser-' + digest(spec.profile).slice(0, 20);
export function dockerCommand(spec, args) {
  return execFileSync(spec.docker, ['--host', spec.dockerHost, ...args], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
export function inspectBrowser(spec, execute = dockerCommand) {
  const name = containerName(spec);
  const ids = execute(spec, ['ps', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$']);
  if (!ids) return null;
  if (!/^[a-f0-9]{64}$/.test(ids)) throw new Error('Ambiguous browser container identity');
  const result = JSON.parse(execute(spec, ['inspect', '--format',
    '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}', ids]));
  if (result.id !== ids || result.image !== spec.image
    || result.labels?.['puddles.browser.spec'] !== digest(spec)
    || result.labels?.['puddles.browser.profile'] !== spec.profile
    || result.labels?.['openclaw.sandbox'] !== '1') throw new Error('Browser container ownership or configuration differs');
  const mounts = result.mounts.filter(m => m.Type === 'bind');
  if (mounts.length !== 2 || !mounts.some(m => m.Source === spec.profile && m.Destination === '/profile' && m.RW)
    || !mounts.some(m => m.Source === spec.downloads && m.Destination === '/downloads' && m.RW)) throw new Error('Unexpected browser host mount');
  return result;
}
export function browserRunArgs(spec, envFile) {
  return ['run', '--detach', '--rm', '--pull', 'never', '--name', containerName(spec),
    '--label', 'openclaw.sandbox=1', '--label', 'puddles.browser.spec=' + digest(spec),
    '--label', 'puddles.browser.profile=' + spec.profile,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '512', '--memory', '2g', '--cpus', '2',
    '--tmpfs', '/tmp:rw,nosuid,size=1g', '--tmpfs', '/run:rw,nosuid,size=16m',
    '--shm-size', '256m', '--publish', '127.0.0.1::9222',
    ...(spec.headless ? [] : ['--publish', '127.0.0.1::6080']),
    '--mount', 'type=bind,src=' + spec.profile + ',dst=/profile',
    '--mount', 'type=bind,src=' + spec.downloads + ',dst=/downloads',
    '--env-file', envFile, spec.image];
}
function protectedFile(path, contents) {
  try { writeFileSync(path, contents, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (realpathSync(path) !== path) throw new Error('Browser control file must not be a symlink');
  chmodSync(path, 0o600);
}
function port(record, internal) {
  const bindings = record.ports[internal + '/tcp'];
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
    || !/^\d+$/.test(bindings[0].HostPort)) throw new Error('Browser port must bind only to loopback');
  return Number(bindings[0].HostPort);
}
export async function ensureBrowser(spec, execute = dockerCommand) {
  validateSpec(spec);
  for (const path of [spec.stateDir, spec.profile, spec.downloads]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (realpathSync(path) !== path) throw new Error('Browser directories must be canonical');
  }
  const envFile = join(spec.stateDir, 'browser.env');
  protectedFile(envFile, [
    'OPENCLAW_BROWSER_CDP_PORT=9222', 'OPENCLAW_BROWSER_NO_SANDBOX=1',
    'OPENCLAW_BROWSER_USER_DATA_DIR=/profile', 'OPENCLAW_BROWSER_ENABLE_NOVNC=' + (spec.headless ? '0' : '1'),
    'OPENCLAW_BROWSER_HEADLESS=' + (spec.headless ? '1' : '0'),
    'OPENCLAW_BROWSER_CDP_AUTH_TOKEN=' + randomBytes(32).toString('hex'),
    'OPENCLAW_BROWSER_NOVNC_PASSWORD=' + randomBytes(4).toString('hex'), '',
  ].join('\n'));
  const token = /^OPENCLAW_BROWSER_CDP_AUTH_TOKEN=([a-f0-9]{64})$/m.exec(readFileSync(envFile, 'utf8'))?.[1];
  if (!token) throw new Error('Missing protected browser relay credential');
  let record = inspectBrowser(spec, execute);
  if (!record) {
    try { execute(spec, browserRunArgs(spec, envFile)); }
    catch (error) {
      // Docker's unique container name serializes concurrent MCP startups.
      // Reuse only the exact expected container, never adopt an unrelated one.
      record = inspectBrowser(spec, execute);
      if (!record?.running) throw error;
    }
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    record = inspectBrowser(spec, execute);
    if (!record?.running) throw new Error('Browser container exited before CDP was ready');
    const cdpPort = port(record, 9222);
    try {
      const response = await fetch('http://127.0.0.1:' + cdpPort + '/json/version', {
        headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      if (response.ok) return { cdpPort, token, ...(spec.headless ? {} : { viewerPort: port(record, 6080) }) };
      if (response.status === 401) throw new Error('Browser relay credential does not match');
    } catch (error) {
      if (error.message === 'Browser relay credential does not match') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Browser CDP startup timed out');
}
export function stopBrowser(spec, execute = dockerCommand) {
  validateSpec(spec);
  const record = inspectBrowser(spec, execute);
  if (record?.running) execute(spec, ['stop', '--time', '10', record.id]);
  if (inspectBrowser(spec, execute)) throw new Error('Browser container remains after stop');
}
// The native daemon outlives individual MCP clients. Close it before Docker
// shutdown so backup and rollback see neither browser nor controller writers.
export function stopService(spec, execute = execFileSync) {
  validateSpec(spec);
  const sockets = join(spec.stateDir, 'sockets');
  if (existsSync(sockets)) {
    const cli = join(dirname(fileURLToPath(import.meta.url)), 'upstream/bin/agent-browser.js');
    const config = join(spec.stateDir, 'agent-browser.json');
    if (!existsSync(cli) || !existsSync(config)) throw new Error('Configured browser requires its native shutdown runtime');
    execute(process.execPath, [cli, '--config', config, 'close', '--all'], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(spec.stateDir, 'home'), AGENT_BROWSER_SOCKET_DIR: sockets },
      timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  stopBrowser(spec);
}
export async function launch(specPath) {
  const spec = validateSpec(JSON.parse(readFileSync(specPath, 'utf8')));
  const browser = await ensureBrowser(spec);
  const home = join(spec.stateDir, 'home'), sockets = join(spec.stateDir, 'sockets');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(sockets, { recursive: true, mode: 0o700 });
  const nativeConfig = join(spec.stateDir, 'agent-browser.json');
  // --config selects only this trusted file, avoiding project/user discovery.
  protectedFile(nativeConfig, JSON.stringify({ cdp: String(browser.cdpPort), downloadPath: '/downloads' }) + '\n');
  // The mapped port changes when Docker recreates the container. Supply the
  // current port in the native environment, which takes precedence over config.
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'upstream/bin/agent-browser.js');
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home,
    AGENT_BROWSER_CDP: String(browser.cdpPort),
    AGENT_BROWSER_CDP_HEADERS: JSON.stringify({ Authorization: 'Bearer ' + browser.token }),
    AGENT_BROWSER_SOCKET_DIR: sockets,
    AGENT_BROWSER_SCREENSHOT_DIR: spec.downloads,
    AGENT_BROWSER_CONTENT_BOUNDARIES: '1', AGENT_BROWSER_MAX_OUTPUT: '50000',
  };
  if (!existsSync(cli)) throw new Error('Packaged stock agent-browser CLI missing');
  process.execve(process.execPath, [process.execPath, cli, 'mcp', '--tools', 'core,state,tabs,mobile', '--config', nativeConfig], env);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    if (process.argv[2] === 'stop' && process.argv.length === 4) stopService(JSON.parse(readFileSync(process.argv[3], 'utf8')));
    else if (process.argv.length === 3) await launch(process.argv[2]);
    else throw new Error('Usage: launch.mjs [stop] /absolute/trusted-browser.json');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
