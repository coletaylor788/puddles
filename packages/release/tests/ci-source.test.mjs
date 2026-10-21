import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../src/ci-candidate.mjs';
import { inspectSources, mergeSources } from '../src/ci-source.mjs';

function fixture() {
  const source = { repository: 'example/app', head: '1'.repeat(40), base: '2'.repeat(40), tree: '3'.repeat(40), pullRequest: 1 };
  const inputs = { repositories: [source] }, inputsDigest = digest(inputs), artifactDigest = 'a'.repeat(64);
  const manifest = { version: 1, id: digest({ artifactDigest, inputsDigest }), inputs, inputsDigest, artifactDigest, repositories: inputs.repositories };
  const pr = { head: { sha: source.head }, base: { ref: 'main', repo: { full_name: source.repository } }, draft: false, merged: false, state: 'open', mergeable: true };
  const protection = { required_status_checks: { strict: true, contexts: ['checks'] }, enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true } };
  const checks = { total_count: 1, check_runs: [{ name: 'checks', status: 'completed', conclusion: 'success' }] };
  const reviews = [{ user: { id: 1 }, state: 'APPROVED', commit_id: source.head }];
  let main = source.base; let merges = 0;
  const api = async args => {
    const path = args[0];
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } };
    if (path.endsWith('/pulls/1')) return pr;
    if (path.includes('/git/commits/')) return { tree: { sha: source.tree } };
    if (path.includes('/compare/')) return { merge_base_commit: { sha: source.base }, behind_by: 0 };
    if (path.endsWith('/branches/main/protection')) return protection;
    if (path.includes('/check-runs?')) return checks;
    if (path.endsWith('/status')) return { total_count: 0, statuses: [] };
    if (path.includes('/reviews?')) return reviews;
    if (path.endsWith('/merge')) { assert.ok(args.includes(`sha=${source.head}`)); merges++; pr.merged = true; main = '4'.repeat(40); return { merged: true }; }
    throw new Error('Unexpected API: ' + path);
  };
  return { source, manifest, pr, protection, checks, reviews, api, moveMain: value => { main = value; }, merges: () => merges };
}
test('production preflight requires current main, enforced checks and current approving review', async () => {
  const f = fixture(); assert.equal((await inspectSources(f.manifest, f.api)).length, 1);
  f.moveMain('5'.repeat(40)); await assert.rejects(inspectSources(f.manifest, f.api), /needs-refresh/);
  f.moveMain(f.source.base); f.protection.required_status_checks.strict = false;
  await assert.rejects(inspectSources(f.manifest, f.api), /strict main protection/);
  f.protection.required_status_checks.strict = true; f.checks.check_runs = [];
  await assert.rejects(inspectSources(f.manifest, f.api), /checks have not passed/);
  f.checks.check_runs = [{ name: 'checks', status: 'completed', conclusion: 'success' }]; f.reviews[0].commit_id = '0'.repeat(40);
  await assert.rejects(inspectSources(f.manifest, f.api), /review has not passed/);
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
