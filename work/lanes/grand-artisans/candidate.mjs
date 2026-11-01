/** Assemble a disposable adoption candidate without editing the builder checkout or running git. */
import { cp, mkdir, symlink, access, writeFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = resolve('../grand-kingdom');
const destination = '/tmp/grand-artisans-candidate';
await mkdir(destination,{recursive:true});
for(const name of ['apps','packages','scripts','package.json','pnpm-workspace.yaml','tsconfig.json','vitest.config.ts']) {
  await cp(resolve(source,name),resolve(destination,name),{recursive:true,force:true,filter:path=>!basename(path).startsWith('.env') && !['node_modules','dist','.vite','shots','.git','data','logs'].includes(basename(path))});
}
await cp('packages/world/src/grand/artisans',resolve(destination,'packages/world/src/grand/artisans'),{recursive:true,force:true});
await cp('apps/web/src/grand/artisans',resolve(destination,'apps/web/src/grand/artisans'),{recursive:true,force:true});
const dependencyPaths=['node_modules'];
for(const group of ['apps','packages']) for(const entry of await readdir(group,{withFileTypes:true})) {
  if(entry.isDirectory()) {
    const dependencyPath=`${group}/${entry.name}/node_modules`;
    try { await access(dependencyPath); dependencyPaths.push(dependencyPath); } catch { /* A source-only module has no dependencies. */ }
  }
}
for(const path of dependencyPaths) {
  try { await access(resolve(destination,path)); } catch { await symlink(resolve(path),resolve(destination,path),'dir'); }
}
const patch = spawnSync('patch',['--batch','-p1','-i',resolve('work/lanes/grand-artisans/adoption.patch')],{cwd:destination,encoding:'utf8'});
if(patch.status!==0) throw new Error(patch.stdout+patch.stderr);
await writeFile('work/evidence/grand-artisans/candidate-source.txt',`Disposable candidate: ${destination}\nBuilder sources copied read-only from ${source}\nArtisans source overlaid from ${process.cwd()}\nPatch: work/lanes/grand-artisans/adoption.patch\nNo git operations in candidate, no builder files changed.\n${patch.stdout}`);
console.log(destination);
