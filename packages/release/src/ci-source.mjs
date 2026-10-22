import { execFileSync } from 'node:child_process';
import { validateCandidate } from './ci-candidate.mjs';

const execute = args => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', timeout: 30_000 }));
async function verifyMerge(source, pr, main, api, expectedMerge) {
  if (!pr.merged || !pr.merge_commit_sha || main.object.sha !== pr.merge_commit_sha ||
      expectedMerge && expectedMerge !== pr.merge_commit_sha) throw new Error('Partial merge needs reconciliation: main differs from PR merge');
  const commit = await api([`repos/${source.repository}/git/commits/${pr.merge_commit_sha}`]);
  if (commit.tree.sha !== source.tree || commit.parents?.length !== 2 ||
      commit.parents[0].sha !== source.base || commit.parents[1].sha !== source.head) {
    throw new Error('Partial merge needs reconciliation: merge differs from tested base, head, or tree');
  }
}
export async function inspectSources(manifest, api = execute, { allowMerged = false } = {}) {
  validateCandidate(manifest);
  const results = [];
  for (const source of manifest.repositories) {
    const prefix = `repos/${source.repository}`;
    const main = await api([`${prefix}/git/ref/heads/main`]);
    if (!source.pullRequest) {
      if (source.head !== source.base) throw new Error('Changed source requires a pull request');
      if (main.object.sha !== source.base) throw new Error('needs-refresh: unchanged companion main moved');
      const commit = await api([`${prefix}/git/commits/${source.head}`]);
      if (commit.tree.sha !== source.tree) throw new Error('Unchanged companion tree differs');
      results.push({ source, unchanged: true, merged: false }); continue;
    }
    const pr = await api([`${prefix}/pulls/${source.pullRequest}`]);
    if (pr.head.sha !== source.head || pr.base.ref !== 'main' || pr.base.repo.full_name !== source.repository || pr.draft) throw new Error('Reviewed pull request changed');
    if (pr.merged) {
      if (!allowMerged) throw new Error('Pull request already merged');
      await verifyMerge(source, pr, main, api);
      results.push({ source, merged: true }); continue;
    }
    if (pr.state !== 'open' || main.object.sha !== source.base) throw new Error('needs-refresh: main changed; update, rebuild, and rejoin');
    const head = await api([`${prefix}/git/commits/${source.head}`]);
    if (head.tree.sha !== source.tree) throw new Error('Source tree changed');
    const comparison = await api([`${prefix}/compare/${source.base}...${source.head}`]);
    if (comparison.merge_base_commit.sha !== source.base || comparison.behind_by !== 0) throw new Error('Feature must incorporate main before queueing');
    if (pr.mergeable === false || pr.mergeable_state === 'dirty') throw new Error('Pull request conflicts');
    // The single-owner pipeline carries its expected checks in frozen inputs.
    // Human authorization and retained agent review belong to the owning task;
    // neither a GitHub approving review nor paid branch protection is required.
    const contexts = source.requiredChecks;
    if (!Array.isArray(contexts) || !contexts.length || contexts.length > 100 ||
        contexts.some(name => typeof name !== 'string' || !name.trim() || name.length > 200) ||
        new Set(contexts).size !== contexts.length) throw new Error('Explicit required repository checks are missing or invalid');
    const checks = await api([`${prefix}/commits/${source.head}/check-runs?per_page=100`]);
    if (checks.total_count > 100 || checks.check_runs.length !== checks.total_count) throw new Error('Check inventory is incomplete');
    const statuses = await api([`${prefix}/commits/${source.head}/status?per_page=100`]);
    if (statuses.total_count > 100 || statuses.statuses.length !== statuses.total_count) throw new Error('Status inventory is incomplete');
    const successful = new Set([
      ...checks.check_runs.filter(check => check.status === 'completed' && check.conclusion === 'success').map(check => check.name),
      ...statuses.statuses.filter(status => status.state === 'success').map(status => status.context),
    ]);
    if (contexts.some(context => !successful.has(context)) ||
        checks.check_runs.some(check => check.status !== 'completed' || !['success', 'neutral', 'skipped'].includes(check.conclusion)) ||
        statuses.total_count > 0 && statuses.state !== 'success') throw new Error('Required repository checks have not passed');
    results.push({ source, merged: false });
  }
  return results;
}
export async function mergeSources(manifest, api = execute) {
  // Inspect the whole pair before the first mutation. Resume queries actual state.
  const sources = await inspectSources(manifest, api, { allowMerged: true });
  for (const { source, merged, unchanged } of sources) {
    if (merged || unchanged) continue;
    const prefix = `repos/${source.repository}`;
    const current = await api([`${prefix}/git/ref/heads/main`]);
    if (current.object.sha !== source.base) throw new Error('Main moved during release');
    // GitHub binds head but not base atomically. All main writers use this lane;
    // an unexpected outside write is detected below and holds reconciliation.
    const result = await api([`${prefix}/pulls/${source.pullRequest}/merge`, '--method', 'PUT', '-f', `sha=${source.head}`, '-f', 'merge_method=merge']);
    if (!result.merged) throw new Error('Merge did not complete');
    const main = await api([`${prefix}/git/ref/heads/main`]);
    const pr = await api([`${prefix}/pulls/${source.pullRequest}`]);
    await verifyMerge(source, pr, main, api, result.sha);
  }
  // An unchanged companion also has to remain current across paired integration.
  await inspectSources(manifest, api, { allowMerged: true });
}
