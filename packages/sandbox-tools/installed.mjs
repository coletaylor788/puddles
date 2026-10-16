import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function sandboxManifest(runtime) {
  const directory=join(resolve(runtime),'sandbox-tools');
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
  if (manifest.version!==1 || !/^sha256:[a-f0-9]{64}$/.test(manifest.image) || !/^[a-f0-9]{64}$/.test(manifest.archiveSha256)) throw new Error('Invalid sandbox manifest');
  const digest=createHash('sha256').update(readFileSync(join(directory,'image.tar'))).digest('hex');
  if (digest!==manifest.archiveSha256) throw new Error('Sandbox archive integrity failed');
  return manifest;
}
export function loadSandbox(runtime,docker=process.env.PUDDLES_DOCKER ?? 'docker',execute=execFileSync) {
  const manifest=sandboxManifest(runtime);
  execute(docker,['image','load','--input',join(runtime,'sandbox-tools/image.tar')],{stdio:'inherit',timeout:300000});
  const actual=execute(docker,['image','inspect','--format','{{.Id}}',manifest.image],{encoding:'utf8',timeout:30000}).trim();
  if(actual!==manifest.image) throw new Error('Loaded sandbox image differs from manifest');
  return manifest;
}
export function testSandbox(runtime,docker=process.env.PUDDLES_DOCKER ?? 'docker',execute=execFileSync,{load=true}={}) {
  const manifest=load ? loadSandbox(runtime,docker,execute) : sandboxManifest(runtime);
  // A fresh, unprivileged, network-disabled container exercises the installed
  // image without reading user files or mutating an existing agent container.
  execute(docker,['run','--pull=never','--rm','--network','none','--read-only','--tmpfs','/tmp:rw,size=256m','--mount',`type=bind,src=${resolve(runtime,'sandbox-tools')},dst=/acceptance,readonly`,manifest.image,'node','/acceptance/installed.mjs'],{stdio:'inherit',timeout:300000});
  return manifest;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [action,runtime]=process.argv.slice(2);
  if(!runtime || !['load','test','verify'].includes(action)) throw new Error('Usage: installed.mjs load|test|verify RUNTIME');
  console.log(JSON.stringify(action==='load'?loadSandbox(runtime):action==='test'?testSandbox(runtime):sandboxManifest(runtime)));
}
