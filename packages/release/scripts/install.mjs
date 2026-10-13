import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson } from '../src/files.mjs';
import { installTool } from '../src/install.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const [config,destination]=process.argv.slice(2);
if(!config||!destination) throw new Error('Usage: node packages/release/scripts/install.mjs CONFIG INSTALLATION');
for(const action of ['build','test']) execFileSync('corepack',['pnpm',action],{cwd:root,stdio:'inherit'});
console.log(JSON.stringify(installTool(root+'dist',destination,readJson(config))));
