import assert from 'node:assert/strict';
import test from 'node:test';
import { command } from '../src/commands.mjs';

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
