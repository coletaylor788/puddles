import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';

function managed(action, runtime, execute) {
  if (!process.env.PUDDLES_CI_DOCKER_IMPORT) return null;
  const binding = JSON.parse(process.env.PUDDLES_CI_DOCKER_IMPORT);
  if (![binding.node,binding.script,binding.config].every(value => typeof value === 'string' && isAbsolute(value))) throw new Error('Invalid installed CI Docker adapter');
  execute(binding.node,[binding.script,action,binding.config,resolve(runtime)],{stdio:'inherit',timeout:1300000});
  return sandboxManifest(runtime);
}

export function sandboxManifest(runtime) {
  const directory=join(resolve(runtime),'sandbox-tools');
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
  if (manifest.version!==1 || !/^sha256:[a-f0-9]{64}$/.test(manifest.image) || !/^[a-f0-9]{64}$/.test(manifest.archiveSha256)) throw new Error('Invalid sandbox manifest');
  const digest=createHash('sha256').update(readFileSync(join(directory,'image.tar'))).digest('hex');
  if (digest!==manifest.archiveSha256) throw new Error('Sandbox archive integrity failed');
  return manifest;
}
export function loadSandbox(runtime,docker=process.env.PUDDLES_DOCKER ?? 'docker',execute=execFileSync) {
  const result=managed('load',runtime,execute); if(result) return result;
  const manifest=sandboxManifest(runtime);
  execute(docker,['image','load','--input',join(runtime,'sandbox-tools/image.tar')],{stdio:'inherit',timeout:300000});
  const actual=execute(docker,['image','inspect','--format','{{.Id}}',manifest.image],{encoding:'utf8',timeout:30000}).trim();
  if(actual!==manifest.image) throw new Error('Loaded sandbox image differs from manifest');
  return manifest;
}
export function testSandbox(runtime,docker=process.env.PUDDLES_DOCKER ?? 'docker',execute=execFileSync,{load=true}={}) {
  const result=managed(load?'test':'test-existing',runtime,execute); if(result) return result;
  const manifest=load ? loadSandbox(runtime,docker,execute) : sandboxManifest(runtime);
  // A fresh, unprivileged, network-disabled container exercises the installed
  // image without reading user files or mutating an existing agent container.
  const script=readFileSync(join(runtime,'sandbox-tools/installed.mjs'));
  execute(docker,['run','--interactive','--pull=never','--rm','--network','none','--read-only','--tmpfs','/tmp:rw,size=256m',manifest.image,'node','--input-type=module'],{input:script,stdio:['pipe','inherit','inherit'],timeout:300000});
  return manifest;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [action,runtime]=process.argv.slice(2);
  if(!runtime || !['load','test','verify'].includes(action)) throw new Error('Usage: installed.mjs load|test|verify RUNTIME');
  console.log(JSON.stringify(action==='load'?loadSandbox(runtime):action==='test'?testSandbox(runtime):sandboxManifest(runtime)));
}
