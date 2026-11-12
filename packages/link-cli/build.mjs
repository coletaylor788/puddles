import { createHash } from 'node:crypto';
import { cpSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeRuntimeForDev } from '../e2e/src/native-package.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export const version = '1.4.1';
export function configureOfficialCLI(source) {
  let result = source;
  function replace(before, after) {
    if (result.split(before).length !== 2) throw new Error('Pinned Link CLI integration point changed');
    result = result.replace(before, after);
  }
  replace('    command: buildMcpCommand()\n', '    command: buildMcpCommand(),\n    tools: puddlesMcpTools(process.env.PUDDLES_LINK_CAPABILITY)\n');
  for (const name of ['login', 'upgrade', 'status', 'create', 'retrieve']) {
    replace(`    options: ${name}Options,`, `    options: puddlesCommandOptions("${name}", ${name}Options, puddlesZ),`);
  }
  const imports = 'import { z as puddlesZ } from "zod";\nimport { mcpTools as puddlesMcpTools, commandOptions as puddlesCommandOptions } from "./puddles-policy.mjs";\n';
  const newline = result.startsWith('#!') ? result.indexOf('\n') + 1 : 0;
  return result.slice(0, newline) + imports + result.slice(newline);
}

// Called only inside the feature-owned application component cache. The normal
// release builder owns that cache and copies this output into the frozen runtime.
export async function prepareLinkCLI(destination) {
  destination = resolve(destination);
  const source = realpathSync(dirname(createRequire(import.meta.url).resolve('@stripe/link-cli/package.json')));
  await materializeRuntimeForDev(source, destination);
  const packageRoot = destination;
  if (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version !== version) throw new Error('Link CLI version differs from pin');
  const entry = join(packageRoot, 'dist/cli.js');
  const original = readFileSync(entry, 'utf8');
  const configured = configureOfficialCLI(original);
  writeFileSync(entry, configured);
  cpSync(join(root, 'policy.mjs'), join(packageRoot, 'dist/puddles-policy.mjs'));
  cpSync(join(root, 'skills'), join(destination, 'puddles-skills'), { recursive: true });
  for (const [role, upstream] of [['link-payments', 'payments.md'], ['link-financial-insights', 'financial-insights.md']]) {
    for (const name of ['setup.md', upstream, 'LICENSE']) cpSync(join(root, 'upstream', name), join(destination, 'puddles-skills', role, name));
  }
  writeFileSync(join(destination, 'puddles-link.json'), JSON.stringify({ version: 1, cliVersion: version,
    upstreamRevision: '1e319681ad4a4747a83b08d95e37375ad75ab83d',
    upstreamSha256: createHash('sha256').update(original).digest('hex'),
    configuredSha256: createHash('sha256').update(configured).digest('hex') }, null, 2) + '\n');
  return destination;
}
