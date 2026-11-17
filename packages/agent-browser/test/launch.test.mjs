import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { validateSpec, browserRunArgs, inspectBrowser, containerName, stopBrowser, ensureBrowser } from '../launch.mjs';
const spec = { version: 1, image: 'sha256:' + 'a'.repeat(64), docker: '/usr/bin/docker',
  dockerHost: 'unix:///host/docker.sock', stateDir: '/protected/vercel',
  profile: '/browser/profile', downloads: '/workspace/downloads', headless: false };
const id = 'b'.repeat(64);
function fixture() {
  const args = browserRunArgs(spec, '/protected/vercel/browser.env');
  const labels = Object.fromEntries(args.flatMap((arg, i) => arg === '--label' ? [args[i + 1].split('=')] : []));
  const record = { id, image: spec.image, running: true, labels, ports: {}, mounts: [
    { Type: 'bind', Source: spec.profile, Destination: '/profile', RW: true },
    { Type: 'bind', Source: spec.downloads, Destination: '/downloads', RW: true },
  ] };
  let present = true;
  const execute = (_, args) => {
    if (args[0] === 'ps') return present ? id : '';
    if (args[0] === 'inspect') return JSON.stringify(record);
    if (args[0] === 'stop') { assert.equal(args.at(-1), id); present = false; return id; }
    throw new Error('Unexpected Docker operation');
  };
  return { record, execute };
}
test('container launch keeps host secrets out of mounts and command arguments', () => {
  validateSpec(spec);
  const args = browserRunArgs(spec, '/protected/vercel/browser.env');
  assert.ok(args.includes('--rm') && args.includes('--read-only'));
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
  assert.equal(args[args.indexOf('--security-opt') + 1], 'no-new-privileges');
  assert.ok(!args.includes('--privileged') && !args.includes('--network=host'));
  const mounts = args.flatMap((arg, i) => arg === '--mount' ? [args[i + 1]] : []);
  assert.equal(mounts.length, 2);
  assert.ok(mounts.every(mount => !mount.includes(spec.stateDir) && !mount.includes('docker.sock')));
  for (const [i, arg] of args.entries()) if (arg === '--publish') assert.match(args[i + 1], /^127\.0\.0\.1::/);
  assert.equal(args.at(-1), spec.image);
  assert.match(containerName(spec), /^puddles-browser-[a-f0-9]{20}$/);
});
test('refuses vault directories reachable through a browser bind', () => {
  for (const change of [{ stateDir: '/browser/profile/vault' }, { profile: '/protected' },
    { downloads: '/protected/vercel/downloads' }, { image: 'browser:latest' }]) {
    assert.throws(() => validateSpec({ ...spec, ...change }));
  }
});
test('browser timezone uses the native container environment and rejects invalid zones', () => {
  const pacific = { ...spec, timezone: 'America/Los_Angeles' };
  validateSpec(pacific);
  const args = browserRunArgs(pacific, '/protected/vercel/browser.env');
  assert.equal(args[args.indexOf('--env') + 1], 'TZ=America/Los_Angeles');
  assert.ok(!browserRunArgs(spec, '/protected/vercel/browser.env').includes('--env'));
  for (const timezone of ['Unknown/Place', 'PST8PDT', 'America/Los_Angeles\nX=1', '', 8]) {
    assert.throws(() => validateSpec({ ...spec, timezone }), /timezone/);
  }
});
test('reuses and stops only the exact owned container', () => {
  const { record, execute } = fixture();
  assert.equal(inspectBrowser(spec, execute).id, id);
  const saved = record.labels['puddles.browser.spec'];
  record.labels['puddles.browser.spec'] = 'foreign';
  assert.throws(() => stopBrowser(spec, execute), /ownership/);
  record.labels['puddles.browser.spec'] = saved;
  record.mounts.push({ Type: 'bind', Source: spec.stateDir, Destination: '/vault', RW: true });
  assert.throws(() => inspectBrowser(spec, execute), /mount/);
  record.mounts.pop();
  stopBrowser(spec, execute);
  assert.equal(inspectBrowser(spec, execute), null);
});

async function startupFixture(t, run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'browser-launch-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = { ...spec, stateDir: join(root, 'state'), profile: join(root, 'profile'), downloads: join(root, 'downloads') };
  const server = createServer((_, response) => response.end('{}'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let record = null, attempts = 0;
  const execute = (_, args) => {
    if (args[0] === 'ps') return record ? id : '';
    if (args[0] === 'inspect') return JSON.stringify(record);
    assert.equal(args[0], 'run');
    const created = { id, image: local.image, running: true,
      labels: Object.fromEntries(args.flatMap((arg, i) => arg === '--label' ? [args[i + 1].split('=')] : [])),
      ports: { '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: String(server.address().port) }],
        '6080/tcp': [{ HostIp: '127.0.0.1', HostPort: '12345' }] },
      mounts: [{ Type: 'bind', Source: local.profile, Destination: '/profile', RW: true },
        { Type: 'bind', Source: local.downloads, Destination: '/downloads', RW: true }] };
    run(++attempts, local, overrides => { record = { ...created, ...overrides }; });
    record = created;
    return id;
  };
  return { local, execute, attempts: () => attempts };
}
function missingBind(path) {
  return Object.assign(new Error('Docker bind mount failed'), { status: 125,
    stderr: `docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /host_mnt${path}\n` });
}
test('recovers transient Docker visibility of an existing profile or downloads directory', async t => {
  for (const field of ['profile', 'downloads']) {
    const f = await startupFixture(t, (attempt, local) => { if (attempt === 1) throw missingBind(local[field]); });
    assert.ok((await ensureBrowser(f.local, f.execute)).cdpPort);
    assert.equal(f.attempts(), 2);
  }
});
test('bounds repeated Docker bind failures and preserves the native error', async t => {
  let failure;
  const f = await startupFixture(t, (_, local) => { failure = missingBind(local.profile); throw failure; });
  await assert.rejects(ensureBrowser(f.local, f.execute), error => error === failure);
  assert.equal(f.attempts(), 5);
});
test('does not retry unrelated errors, missing host directories or replaced symlinks', async t => {
  for (const kind of ['unrelated', 'other-bind', 'missing', 'symlink']) {
    let failure;
    const f = await startupFixture(t, (_, local) => {
      failure = kind === 'unrelated' ? new Error('Docker unavailable') : missingBind(kind === 'other-bind' ? '/other' : local.profile);
      if (kind === 'missing' || kind === 'symlink') rmSync(local.profile, { recursive: true });
      if (kind === 'symlink') { const target = local.profile + '-other'; mkdirSync(target); symlinkSync(target, local.profile); }
      throw failure;
    });
    await assert.rejects(ensureBrowser(f.local, f.execute), error => error === failure);
    assert.equal(f.attempts(), 1);
  }
});
test('failed startup reuses only a running owned container and never removes residue', async t => {
  for (const kind of ['owned-running', 'owned-stopped', 'foreign']) {
    let failure;
    const f = await startupFixture(t, (_, local, publish) => {
      publish(kind === 'foreign' ? { labels: {} } : { running: kind === 'owned-running' });
      failure = missingBind(local.profile);
      throw failure;
    });
    if (kind === 'owned-running') assert.ok((await ensureBrowser(f.local, f.execute)).cdpPort);
    else if (kind === 'foreign') await assert.rejects(ensureBrowser(f.local, f.execute), /ownership/);
    else await assert.rejects(ensureBrowser(f.local, f.execute), error => error === failure);
    assert.equal(f.attempts(), 1);
  }
});
