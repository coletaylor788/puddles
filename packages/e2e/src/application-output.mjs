import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { atomicJson } from './native-state.mjs';

export function ownApplicationOutput(sourcePath, outputPath) {
  const source = realpathSync(sourcePath), output = resolve(outputPath);
  if (source !== resolve(sourcePath) || dirname(output) !== dirname(source) || output === source) throw new Error('Application output must be a direct sibling of its owned source');
  if (realpathSync(dirname(output)) !== dirname(output)) throw new Error('Application output parent is linked');
  const marker = output + '.owner.json';
  const previous = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : null;
  if (previous && (previous.source !== source || previous.output !== output)) throw new Error('Application output belongs to another source');
  if (existsSync(output) && (!previous || realpathSync(output) !== output)) throw new Error('Refusing to replace an unowned application output');
  const owner = previous ?? { source, output };
  atomicJson(marker, owner);
  return { source, output, owner, save: changes => atomicJson(marker, Object.assign(owner, changes)) };
}
