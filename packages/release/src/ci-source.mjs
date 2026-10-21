import { execFileSync } from 'node:child_process';
import { validateCandidate } from './ci-candidate.mjs';

const execute = args => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', timeout: 30_000 }));
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
      const commit = await api([`${prefix}/git/commits/${main.object.sha}`]);
      if (commit.tree.sha !== source.tree) throw new Error('Partial merge needs reconciliation');
      results.push({ source, merged: true }); continue;
    }
    if (pr.state !== 'open' || main.object.sha !== source.base) throw new Error('needs-refresh: main changed; update, rebuild, and rejoin');
    const head = await api([`${prefix}/git/commits/${source.head}`]);
    if (head.tree.sha !== source.tree) throw new Error('Source tree changed');
    const comparison = await api([`${prefix}/compare/${source.base}...${source.head}`]);
    if (comparison.merge_base_commit.sha !== source.base || comparison.behind_by !== 0) throw new Error('Feature must incorporate main before queueing');
    if (pr.mergeable === false || pr.mergeable_state === 'dirty') throw new Error('Pull request conflicts');
    // Strict server-side protection closes the race between this preflight and
    // the ordinary PR merge endpoint. Missing/unsupported protection fails shut.
    const protection = await api([`${prefix}/branches/main/protection`]);
    const required = protection.required_status_checks;
    const contexts = [...new Set([...(required?.contexts ?? []), ...(required?.checks ?? []).map(check => check.context)])];
    const reviewCount = protection.required_pull_request_reviews?.required_approving_review_count;
    if (!required?.strict || !contexts.length || !protection.enforce_admins?.enabled ||
        !Number.isSafeInteger(reviewCount) || reviewCount < 1 || !protection.required_pull_request_reviews.dismiss_stale_reviews) {
      throw new Error('Production requires enforced strict main protection, required checks, and current approving review');
    }
    const checks = await api([`${prefix}/commits/${source.head}/check-runs?per_page=100`]);
    if (checks.total_count > 100) throw new Error('Check inventory exceeds supported page');
    const statuses = await api([`${prefix}/commits/${source.head}/status`]);
    const successful = new Set([
      ...checks.check_runs.filter(check => check.status === 'completed' && check.conclusion === 'success').map(check => check.name),
      ...statuses.statuses.filter(status => status.state === 'success').map(status => status.context),
    ]);
    if (contexts.some(context => !successful.has(context)) ||
        checks.check_runs.some(check => check.status !== 'completed' || !['success', 'neutral', 'skipped'].includes(check.conclusion)) ||
        statuses.total_count > 0 && statuses.state !== 'success') throw new Error('Required repository checks have not passed');
    const reviews = await api([`${prefix}/pulls/${source.pullRequest}/reviews?per_page=100`]);
    if (reviews.length === 100) throw new Error('Review inventory exceeds supported page');
    const latest = new Map();
    for (const review of reviews) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user.id, review);
    const currentReviews = [...latest.values()];
    if (currentReviews.some(review => review.state === 'CHANGES_REQUESTED') ||
        currentReviews.filter(review => review.state === 'APPROVED' && review.commit_id === source.head).length < reviewCount) throw new Error('Required pull request review has not passed');
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
    const result = await api([`${prefix}/pulls/${source.pullRequest}/merge`, '--method', 'PUT', '-f', `sha=${source.head}`, '-f', 'merge_method=merge']);
    if (!result.merged) throw new Error('Merge did not complete');
    const main = await api([`${prefix}/git/ref/heads/main`]);
    const commit = await api([`${prefix}/git/commits/${main.object.sha}`]);
    if (commit.tree.sha !== source.tree) throw new Error('Merged source differs from tested source');
  }
  // An unchanged companion also has to remain current across paired integration.
  await inspectSources(manifest, api, { allowMerged: true });
}
