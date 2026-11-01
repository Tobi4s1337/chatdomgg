/** Assemble a disposable adoption candidate without editing the builder checkout or running git. */
import { cp, mkdir, symlink, access, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = resolve('../grand-kingdom');
const destination = resolve(process.env.ARTISAN_CANDIDATE ?? '/tmp/grand-artisans-candidate');
if (!/^\/tmp\/grand-artisans-candidate(?:-[a-z0-9-]+)?$/.test(destination)) throw new Error('Candidate destination must be a dedicated /tmp/grand-artisans-candidate[-name] folder');
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
for(const name of ['apps','packages','scripts','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','vitest.config.ts']) {
  await cp(resolve(source,name),resolve(destination,name),{recursive:true,force:true,filter:path=>
    !basename(path).startsWith('.env') &&
    !['node_modules','dist','.vite','shots','.git'].includes(basename(path)) &&
    // Runtime stores stay out; source modules named data (Atlas loaders/models) are code.
    (!['data','logs'].includes(basename(path)) || path.includes('/src/'))});
}
await cp('packages/world/src/grand/artisans',resolve(destination,'packages/world/src/grand/artisans'),{recursive:true,force:true});
await cp('apps/web/src/grand/artisans',resolve(destination,'apps/web/src/grand/artisans'),{recursive:true,force:true});
const dependencyPaths=['node_modules'];
for(const group of ['apps','packages']) for(const entry of await readdir(group,{withFileTypes:true})) {
  if(entry.isDirectory()) {
    const dependencyPath=`${group}/${entry.name}/node_modules`;
    try { await access(dependencyPath); await access(resolve(destination,group,entry.name)); dependencyPaths.push(dependencyPath); } catch { /* A source-only module has no dependencies. */ }
  }
}
for(const path of dependencyPaths) {
  try { await access(resolve(destination,path)); } catch { await symlink(resolve(path),resolve(destination,path),'dir'); }
}
const patches=['adoption.patch',...(process.env.ARTISAN_APPLY_SITE_PROPOSAL==='1'?['adoption-sites.needs.patch']:[])];
let patchLog='';
for(const name of patches) {
  const patch=spawnSync('patch',['--batch','-p1','-i',resolve('work/lanes/grand-artisans',name)],{cwd:destination,encoding:'utf8'});
  if(patch.status!==0)throw new Error(patch.stdout+patch.stderr);
  patchLog+=patch.stdout;
}
await writeFile('work/evidence/grand-artisans/candidate-source.txt',`Disposable candidate: ${destination}\nBuilder sources copied read-only from ${source}\nArtisans source overlaid from ${process.cwd()}\nPatches: ${patches.join(', ')}\nNo git operations in candidate, no builder files changed.\n${patchLog}`);
console.log(destination);
