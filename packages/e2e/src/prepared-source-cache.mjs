import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The caller owns stopped source and checks its exact digest before and after
// preparation. This operation does not change any digest exclusions.
export function assertEmptyCacheParentAbsent(source, expected) {
  if (expected === undefined) return false;
  assert.deepEqual(expected, { before: 'absent', mode: 0o755 });
  assert.equal(lstatSync(join(source, '.cache'), { throwIfNoEntry: false }), undefined,
    'Cache parent must match the reviewed absent preimage');
  return true;
}

export function prepareEmptyCacheParent(source, expected) {
  if (!assertEmptyCacheParentAbsent(source, expected)) return;
  const path = join(source, '.cache');
  mkdirSync(path, { mode: 0o755 });
  chmodSync(path, 0o755);
}
