import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { command } from '../src/commands.mjs';

for (const code of [0, 7]) test(`protocol command keeps binary stdout separate from diagnostics on exit ${code}`, () => {
  const input = Buffer.from([0, 255, 13, 10, 123, 34, 120, 34, 125]);
  const driver = `
    import { command } from ${JSON.stringify(new URL('../src/commands.mjs', import.meta.url).href)};
    let child;
    try {
      await command({ command: process.execPath,
        args: ['-e', 'process.stdin.pipe(process.stdout);process.exitCode=${code}'],
        cwd: process.cwd(), timeoutMs: 10000 }, {}, value => { child = value; }, value => {
          if (child !== null) throw Error('Report preceded child closure');
          process.stderr.write(JSON.stringify(value) + '\\n');
        });
    } catch (error) { process.exitCode = error.exitCode ?? 99; }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
    input, timeout: 20000, env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, code);
  assert.deepEqual(result.stdout, input);
  const report = JSON.parse(result.stderr.toString('utf8'));
  assert.ok(Number.isSafeInteger(report.durationMs) && report.durationMs >= 0);
  assert.deepEqual(Object.keys(report), ['durationMs']);
});

test('CI command failures retain bounded output tails without exposing command arguments', async () => {
  let child;
  const script = "process.stdout.write('x'.repeat(100000) + 'stdout-end');process.stderr.write('y'.repeat(100000) + 'stderr-end');process.exitCode=7;";
  await assert.rejects(command({ command: process.execPath, args: ['-e', script, 'unprinted-argument'],
    cwd: process.cwd(), timeoutMs: 10000 }, { PUDDLES_CI_RUN: 'fixture', PUDDLES_RELEASE_PHASE: 'dev-tests' }, value => { child = value; }), error => {
    assert.equal(error.exitCode, 7);
    assert.ok(error.message.includes('stdout-end'));
    assert.ok(error.message.includes('stderr-end'));
    assert.ok(Buffer.byteLength(error.message) < 17000);
    assert.ok(!error.message.includes('unprinted-argument'));
    return true;
  });
  assert.equal(child, null);
});
