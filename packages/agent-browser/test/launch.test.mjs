import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSpec, browserRunArgs, inspectBrowser, containerName, stopBrowser } from '../launch.mjs';
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
