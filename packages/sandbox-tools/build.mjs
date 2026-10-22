import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveImage } from './archive.mjs';

const component = dirname(fileURLToPath(import.meta.url));
export function componentDigest(root = component) {
  const hash = createHash('sha256');
  function visit(path, prefix = '') {
    for (const entry of readdirSync(path, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules') continue;
      const name = prefix + entry.name;
      if (entry.isDirectory()) visit(join(path,entry.name),name+'/');
      else if (entry.isFile()) hash.update(name+'\0').update(readFileSync(join(path,entry.name))).update('\0');
      else throw new Error('Sandbox build source must contain ordinary files');
    }
  }
  visit(root); return hash.digest('hex');
}
export function prepareSandboxTools(output, docker = process.env.PUDDLES_DOCKER ?? 'docker', execute = execFileSync) {
  output = resolve(output);
  const cache = output + '.sandbox-tools';
  const builder = process.env.PUDDLES_SANDBOX_BUILDER;
  const source = componentDigest();
  const platform = execute(docker,['info','--format','{{.OSType}}/{{.Architecture}}'],{encoding:'utf8',timeout:30000}).trim();
  const marker = join(cache,'manifest.json');
  let prior;
  if (existsSync(marker)) prior=JSON.parse(readFileSync(marker,'utf8'));
  if (prior?.source !== source || prior?.platform !== platform || prior?.builder !== builder || !existsSync(join(cache,'image.tar'))) {
    mkdirSync(cache,{recursive:true});
    const temporary = join(cache,'image.tar.tmp');
    let image;
    if (builder) {
      if (!/^puddles-ci-[a-z0-9-]{1,48}$/.test(builder)) throw new Error('Invalid dedicated CI builder');
      const inspection = execute(docker,['buildx','inspect',builder],{encoding:'utf8',timeout:30000});
      if (!/^Driver:\s+docker-container\s*$/m.test(inspection)) throw new Error('CI requires a dedicated docker-container builder');
      const metadata = join(cache,'build-metadata.json');
      execute(docker,['buildx','build','--builder',builder,'--provenance=false','--output','type=docker,dest='+temporary,'--metadata-file',metadata,component],{stdio:'inherit',timeout:60*60_000});
      image = JSON.parse(readFileSync(metadata,'utf8'))['containerimage.config.digest'];
      if (archiveImage(temporary,{untagged:true}) !== image) throw new Error('Exported sandbox image differs from build metadata');
      rmSync(metadata);
    } else {
      const tag = 'puddles-sandbox-media:' + source.slice(0,16);
      execute(docker,['build','--provenance=false','--tag',tag,component],{stdio:'inherit',timeout:60*60_000});
      image = execute(docker,['image','inspect','--format','{{.Id}}',tag],{encoding:'utf8',timeout:30000}).trim();
      execute(docker,['image','save','--output',temporary,tag],{stdio:'inherit',timeout:300000});
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid sandbox image identity');
    renameSync(temporary,join(cache,'image.tar'));
    const archiveSha256=createHash('sha256').update(readFileSync(join(cache,'image.tar'))).digest('hex');
    prior={version:1,source,platform,image,archiveSha256,...(builder ? {builder,untagged:true} : {})};
    writeFileSync(marker,JSON.stringify(prior,null,2)+'\n');
  }
  const digest=createHash('sha256').update(readFileSync(join(cache,'image.tar'))).digest('hex');
  if (digest!==prior.archiveSha256) throw new Error('Cached sandbox archive changed');
  const destination=join(output,'sandbox-tools');
  rmSync(destination,{recursive:true,force:true});mkdirSync(destination,{recursive:true});
  cpSync(marker,join(destination,'manifest.json'));cpSync(join(cache,'image.tar'),join(destination,'image.tar'));
  cpSync(join(component,'test/installed.mjs'),join(destination,'installed.mjs'));
  const skill=join(output,'skills/sandbox-media');mkdirSync(skill,{recursive:true});cpSync(join(component,'SKILL.md'),join(skill,'SKILL.md'));
  return prior;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: build.mjs APPLICATION_OUTPUT');
  console.log(JSON.stringify(prepareSandboxTools(process.argv[2])));
}
