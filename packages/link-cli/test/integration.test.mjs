import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { configureOfficialCLI } from '../build.mjs';
import { authTools, paymentTools, insightTools } from '../policy.mjs';
import { connect, result } from './mcp-client.mjs';
import { fixture } from './fixture.mjs';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('@stripe/link-cli/package.json'));

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'link-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = join(dir, 'cli.mjs');
  writeFileSync(entry, configureOfficialCLI(readFileSync(join(packageRoot, 'dist/cli.js'), 'utf8')));
  copyFileSync(new URL('../policy.mjs', import.meta.url), join(dir, 'puddles-policy.mjs'));
  symlinkSync(dirname(dirname(packageRoot)), join(dir, 'node_modules'));
  const service = await fixture(); t.after(() => service.close());
  const auth = join(dir, 'auth.json');
  const env = { PATH: process.env.PATH, HOME: dir, NO_UPDATE_NOTIFIER: '1', LINK_AUTH_FILE: auth,
    LINK_AUTH_BASE_URL: service.url, LINK_API_BASE_URL: service.url, LINK_CLIENT_NAME: 'Fixture Assistant' };
  async function client(capability, authenticated = false) {
    const cli = await connect(entry, { ...env, PUDDLES_LINK_CAPABILITY: capability,
      ...(authenticated ? { LINK_ACCESS_TOKEN: 'fixture-integration-only' } : {}) });
    t.after(() => cli.close()); return cli;
  }
  return { client, service, auth };
}

test('role catalogs and hidden invocation reject cross-capability and generic dispatch', async t => {
  const { client, service } = await setup(t);
  for (const [role, allowed, rejected] of [['payments', paymentTools, insightTools], ['insights', insightTools, paymentTools]]) {
    const cli = await client(role, true);
    const listed = (await cli.request('tools/list')).result.tools.map(tool => tool.name).sort();
    assert.deepEqual(listed, [...authTools, ...allowed].sort());
    for (const name of [...rejected, 'call_write_tool', 'call_read_tool', 'auth_logout', 'approval-policy_update']) {
      const answer = await cli.call(name); assert.ok(answer.error || answer.result?.isError, name);
    }
  }
  assert.equal(service.calls.length, 0);
});

const purchase = { amount: 1200, currency: 'usd', merchantName: 'Fixture Shop', merchantUrl: 'https://example.test',
  context: 'Owner requested one fixture item. The full price is twelve dollars including tax and delivery. This is a local automated fixture.', idempotencyKey: 'fixture-purchase-1' };

test('payments require manual approval and reject file output, delegated and recurring options', async t => {
  const { client, service } = await setup(t), cli = await client('payments', true);
  for (const extra of [{ outputFile: '/tmp/forbidden' }, { approve: true }, { useApprovalPolicy: true },
    { approvalDetail: '{}' }, { recurringInterval: 'month' }, { requestApproval: false }]) {
    const answer = await cli.call('spend-request_create', { ...purchase, ...extra });
    assert.ok(answer.error || answer.result?.isError, JSON.stringify(extra));
  }
  assert.equal(service.calls.length, 0);
  const pending = result(await cli.call('spend-request_create', purchase));
  assert.equal(pending[0].status, 'pending_approval');
  const body = JSON.parse(service.calls[0].body);
  assert.equal(body.request_approval, true);
  assert.ok(!body.approve && !body.use_approval_policy && !body.recurring);
  for (const status of ['denied', 'expired', 'approved']) {
    service.state.spend = status;
    const retrieved = result(await cli.call('spend-request_retrieve', { id: 'sr_fixture', include: ['card'], interval: 0 }));
    assert.equal(retrieved.at(-1).status, status);
    if (status !== 'approved') assert.equal(retrieved.at(-1).card, undefined);
  }
  assert.equal(service.calls.filter(call => call.method === 'POST').length, 1, 'resuming never creates another spend request');
});

test('first use returns an interactive URL, persists the connection and shares it across roles after restart', async t => {
  const { client, service, auth } = await setup(t);
  const main = await client('insights');
  const browser = await client('payments');
  assert.equal(result(await main.call('auth_status')).at(-1).authenticated, false);
  const login = result(await main.call('auth_login'));
  assert.equal(login[0].verification_url, 'https://example.test/connect/fixture');
  assert.equal(login[0].phrase, 'quiet river');
  const form = new URLSearchParams(service.calls.at(-1).body);
  assert.equal(form.get('scope'), 'userinfo:read payment_methods.agentic');
  assert.match(form.toString(), /read_balances/);
  service.state.auth = 'approved';
  const status = result(await main.call('auth_status', { interval: 1, maxAttempts: 1, timeout: 2 }));
  assert.equal(status.at(-1).authenticated, true);
  assert.ok(!JSON.stringify(status).includes('fixture-refresh-token-that-is-not-a-secret'));
  assert.equal(statSync(auth).mode & 0o777, 0o600);
  await main.close();
  assert.equal(result(await browser.call('auth_status')).at(-1).authenticated, true);
  const restarted = await client('insights');
  const balances = result(await restarted.call('balances_list'));
  assert.match(JSON.stringify(balances), /12345/);
  service.state.denied = true;
  assert.ok((await restarted.call('balances_list')).result.isError);
});
