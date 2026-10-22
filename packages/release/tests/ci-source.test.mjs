import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../src/ci-candidate.mjs';
import { inspectSources, mergeSources } from '../src/ci-source.mjs';

function fixture() {
  const source = { repository: 'example/app', head: '1'.repeat(40), base: '2'.repeat(40), tree: '3'.repeat(40), pullRequest: 1, requiredChecks: ['checks'] };
  const inputs = { repositories: [source] }, inputsDigest = digest(inputs), artifactDigest = 'a'.repeat(64);
  const manifest = { version: 1, id: digest({ artifactDigest, inputsDigest }), inputs, inputsDigest, artifactDigest, repositories: inputs.repositories };
  const pr = { head: { sha: source.head }, base: { ref: 'main', repo: { full_name: source.repository } }, draft: false, merged: false, state: 'open', mergeable: true };
  const checks = { total_count: 1, check_runs: [{ name: 'checks', status: 'completed', conclusion: 'success' }] };
  const statuses = { total_count: 0, statuses: [] };
  const mergeCommit = { tree: { sha: source.tree }, parents: [{ sha: source.base }, { sha: source.head }] };
  const mergeSha = '4'.repeat(40);
  let main = source.base; let merges = 0;
  const api = async args => {
    const path = args[0];
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } };
    if (path.endsWith('/pulls/1')) return pr;
    if (path.endsWith('/git/commits/' + mergeSha)) return mergeCommit;
    if (path.includes('/git/commits/')) return { tree: { sha: source.tree } };
    if (path.includes('/compare/')) return { merge_base_commit: { sha: source.base }, behind_by: 0 };
    if (path.includes('/check-runs?')) return checks;
    if (path.endsWith('/status?per_page=100')) return statuses;
    if (path.endsWith('/merge')) { assert.ok(args.includes(`sha=${source.head}`)); merges++; pr.merged = true; pr.merge_commit_sha = main = mergeSha; return { merged: true, sha: mergeSha }; }
    throw new Error('Unexpected API: ' + path);
  };
  return { source, manifest, pr, checks, statuses, mergeCommit, api, moveMain: value => { main = value; }, merges: () => merges };
}
test('single-owner preflight needs current source and explicit checks without GitHub policy or review APIs', async () => {
  const f = fixture(); assert.equal((await inspectSources(f.manifest, f.api)).length, 1);
  f.moveMain('5'.repeat(40)); await assert.rejects(inspectSources(f.manifest, f.api), /needs-refresh/);
  f.moveMain(f.source.base); f.checks.check_runs[0].name = 'unrelated';
  await assert.rejects(inspectSources(f.manifest, f.api), /checks have not passed/);
  f.checks.check_runs = []; f.checks.total_count = 0;
  await assert.rejects(inspectSources(f.manifest, f.api), /checks have not passed/);
});
test('missing check policy, pending or failed checks, and incomplete inventories block production', async () => {
  for (const requiredChecks of [undefined, [], ['checks', 'checks']]) {
    const f = fixture(); f.source.requiredChecks = requiredChecks;
    f.manifest.inputsDigest = digest(f.manifest.inputs);
    f.manifest.id = digest({ artifactDigest: f.manifest.artifactDigest, inputsDigest: f.manifest.inputsDigest });
    await assert.rejects(inspectSources(f.manifest, f.api), /Explicit required repository checks/);
  }
  for (const check of [{ name: 'checks', status: 'in_progress' }, { name: 'checks', status: 'completed', conclusion: 'failure' }]) {
    const f = fixture(); f.checks.check_runs[0] = check;
    await assert.rejects(inspectSources(f.manifest, f.api), /checks have not passed/);
  }
  const f = fixture(); f.checks.total_count = 101;
  await assert.rejects(inspectSources(f.manifest, f.api), /inventory is incomplete/);
  f.checks.total_count = 1; f.statuses.total_count = 1;
  await assert.rejects(inspectSources(f.manifest, f.api), /inventory is incomplete/);
  f.statuses.statuses = [{ context: 'extra', state: 'failure' }]; f.statuses.state = 'failure';
  await assert.rejects(inspectSources(f.manifest, f.api), /checks have not passed/);
});
test('normal PR merge binds head and retry queries actual completed merge', async () => {
  const f = fixture(); await mergeSources(f.manifest, f.api); assert.equal(f.merges(), 1);
  await mergeSources(f.manifest, f.api); assert.equal(f.merges(), 1);
});
test('uncertain successful GitHub response is reconciled without repeating merge', async () => {
  const f = fixture();
  await assert.rejects(mergeSources(f.manifest, async args => { const value = await f.api(args); if (args[0].endsWith('/merge')) throw new Error('connection lost'); return value; }), /connection lost/);
  await mergeSources(f.manifest, f.api); assert.equal(f.merges(), 1);
});
test('outside changes during merge cannot be accepted or cleared by retry even with the same tree', async () => {
  for (const change of [
    f => { f.mergeCommit.parents[0].sha = '5'.repeat(40); },
    f => { f.mergeCommit.parents[1].sha = '5'.repeat(40); },
    f => { f.mergeCommit.tree.sha = '5'.repeat(40); },
    f => { f.moveMain('5'.repeat(40)); },
  ]) {
    const f = fixture();
    const api = async args => { const value = await f.api(args); if (args[0].endsWith('/merge')) change(f); return value; };
    await assert.rejects(mergeSources(f.manifest, api), /needs reconciliation/);
    await assert.rejects(mergeSources(f.manifest, f.api), /needs reconciliation/);
    assert.equal(f.merges(), 1);
  }
});
test('main drift immediately before merge prevents the request', async () => {
  const f = fixture(); let reads = 0;
  await assert.rejects(mergeSources(f.manifest, async args => {
    if (args[0].endsWith('/git/ref/heads/main') && ++reads === 2) f.moveMain('5'.repeat(40));
    return f.api(args);
  }), /Main moved/);
  assert.equal(f.merges(), 0);
});

test('unchanged companion binds exact current main without manufacturing a PR', async () => {
  const f = fixture(), companion = { repository: 'example/companion', head: '5'.repeat(40), base: '5'.repeat(40), tree: '6'.repeat(40) };
  f.manifest.inputs.repositories.push(companion);
  f.manifest.inputsDigest = digest(f.manifest.inputs);
  f.manifest.id = digest({ artifactDigest: f.manifest.artifactDigest, inputsDigest: f.manifest.inputsDigest });
  let current = companion.base;
  const api = async args => {
    if (!args[0].startsWith('repos/example/companion/')) return f.api(args);
    if (args[0].endsWith('/git/ref/heads/main')) return { object: { sha: current } };
    if (args[0].includes('/git/commits/')) return { tree: { sha: companion.tree } };
    assert.fail('Unchanged companion must not require or merge a PR');
  };
  await mergeSources(f.manifest, api); assert.equal(f.merges(), 1);
  current = '7'.repeat(40);
  await assert.rejects(inspectSources(f.manifest, api, { allowMerged: true }), /companion main moved/);
});
