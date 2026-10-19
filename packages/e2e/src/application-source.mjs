import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Native plugin discovery uses the Git index, including intent-to-add entries.
export const sourcePreparationVersion = 1;

export function applicationSourceFiles(source) {
  return [...new Set(execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', source,
    'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean))].sort();
}

export function prepareApplicationSource(source, owner) {
  const canonical = realpathSync(source);
  if (owner?.source !== canonical || typeof owner.output !== 'string' ||
      dirname(resolve(owner.output)) !== dirname(canonical) || resolve(owner.output) === canonical) {
    throw new Error('Source preparation requires its managed application output owner');
  }
  const recorded = JSON.parse(readFileSync(owner.output + '.owner.json', 'utf8'));
  if (recorded.source !== canonical || recorded.output !== owner.output ||
      JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).name !== 'openclaw') {
    throw new Error('Source preparation requires owned OpenClaw source, not an author checkout');
  }
  const git = (args, input) => execFileSync('git', ['-c', 'core.fsmonitor=false', '--literal-pathspecs', '-C', source, ...args],
    { encoding: 'utf8', input, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== realpathSync(source)) {
    throw new Error('Application source must be the root of its own Git checkout');
  }
  const indexedBefore = new Set(git(['ls-files', '--cached', '-z']).split('\0'));
  const files = applicationSourceFiles(source).filter(file => !indexedBefore.has(file));
  if (!files.length) return [];
  const deleted = new Set(git(['diff', '--cached', '--name-only', '--diff-filter=D', '-z']).split('\0'));
  for (const file of files) {
    if (deleted.has(file)) throw new Error(`Application source recreates a staged deletion: ${file}`);
    const stat = lstatSync(join(source, file));
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported authored source entry: ${file}`);
  }
  git(['add', '--intent-to-add', '--pathspec-from-file=-', '--pathspec-file-nul'], files.join('\0') + '\0');
  const indexed = new Set(git(['ls-files', '--cached', '-z']).split('\0'));
  for (const file of files) if (!indexed.has(file)) throw new Error(`Authored source was not indexed: ${file}`);
  return files;
}
