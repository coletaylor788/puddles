import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonical, readJson } from './files.mjs';

function git(root, args) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8' }).trim();
}
export function rebaseRepositories(repositories) {
  if (!Array.isArray(repositories) || !repositories.length) throw new Error('Feature repositories are required');
  for (const repo of repositories) {
    canonical(repo.path);
    if (git(repo.path, ['status', '--porcelain'])) throw new Error('Commit feature changes before joining the queue');
    const common = resolve(repo.path, git(repo.path, ['rev-parse', '--git-common-dir']));
    const gitDir = resolve(repo.path, git(repo.path, ['rev-parse', '--git-dir']));
    if (common === gitDir) throw new Error('Rebase cannot change a primary checkout');
    const branch = git(repo.path, ['branch', '--show-current']);
    if (branch === 'main' || !branch || branch !== repo.branch) throw new Error('Rebase requires the owned feature branch');
    git(repo.path, ['fetch', 'origin']);
    repo.base = git(repo.path, ['rev-parse', 'origin/main']);
    git(repo.path, ['rebase', repo.base]);
    git(repo.path, ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`]);
    repo.head = git(repo.path, ['rev-parse', 'HEAD']);
  }
  return repositories;
}
export function mergeRepositories(repositories) {
  if (!Array.isArray(repositories) || !repositories.length) throw new Error('Feature repositories are required');
  for (const repo of repositories) {
    if (!/^[a-f0-9]{40}$/.test(repo.head ?? '') || !/^[a-f0-9]{40}$/.test(repo.base ?? '')) throw new Error('Tested head and base are required');
    canonical(repo.path);
    if (git(repo.path, ['rev-parse', 'HEAD']) !== repo.head || git(repo.path, ['status', '--porcelain'])) throw new Error('Tested feature revision changed');
    if (!/^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/[0-9]+$/.test(repo.pullRequest ?? '')) throw new Error('Reviewed pull request is required');
    const result = JSON.parse(execFileSync('gh', ['pr', 'view', repo.pullRequest, '--json', 'state,headRefOid'], { encoding: 'utf8', cwd: repo.path }));
    if (result.headRefOid !== repo.head) throw new Error('Pull request head changed after testing');
    git(repo.path, ['fetch', 'origin']);
    if (result.state !== 'MERGED' && git(repo.path, ['rev-parse', 'origin/main']) !== repo.base) throw new Error('Main changed after feature testing; restore and rebase');
    if (result.state !== 'MERGED') execFileSync('gh', ['pr', 'merge', repo.pullRequest, '--merge', '--match-head-commit', repo.head], { stdio: 'inherit', cwd: repo.path });
    git(repo.path, ['fetch', 'origin']);
    if (git(repo.path, ['rev-parse', 'origin/main^{tree}']) !== git(repo.path, ['rev-parse', `${repo.head}^{tree}`])) throw new Error('Merged source differs from tested feature; resolve before advancing');
  }
}
