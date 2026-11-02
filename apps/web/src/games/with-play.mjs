// The tavern with play's door, before either lane is merged: assembles a throwaway tree in /tmp from this checkout,
// play's branch and the patches gather has written for the merge, so the journey from the street door into the
// tavern and back can be walked in a browser exactly as the merged build will run it.
//   nice -n 10 node apps/web/src/games/with-play.mjs [--play lane/play] [--out /tmp/chatdom-gather/with-play]
// Read-only for git (archive, show, diff). Nothing is written in this checkout or on any branch.
//
// The tree is: this checkout's files (the working tree, so unreviewed changes are included), then every file play
// changed since the merge base, then, where both lanes touched the same file, play's version with gather's lines
// added by the patches in work/lanes/gather/patches/with-play-*.patch (the merge resolution, written out), then
// play's own front-door patch for the kingdom entry's door binding, and gather's play-walk-founded.patch (the two
// optional walk-feature fields the tavern door needs). node_modules are links to this checkout's.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, symlink, writeFile, readlink, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('../../../..', import.meta.url)).replace(/\/$/, '');
const { values } = parseArgs({ options: { play: { type: 'string', default: 'lane/play' }, out: { type: 'string', default: '/tmp/chatdom-gather/with-play' } } });
assert.ok(values.out.startsWith('/tmp/'), 'the tree is assembled under /tmp only');
const tree = join(values.out, 'tree');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
const gitBytes = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 28 });
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...options });

const playHead = git('rev-parse', values.play).trim();
const ownHead = git('rev-parse', 'HEAD').trim();
const base = git('merge-base', 'HEAD', values.play).trim();
// Both lanes' own changes since the merge base (working tree included for this lane).
const theirs = git('diff', '--name-status', base, playHead).trim().split('\n').filter(Boolean).map(line => line.split('\t'));
const ours = new Set(git('diff', '--name-only', base).trim().split('\n').filter(Boolean)
  .concat(git('ls-files', '--others', '--exclude-standard').trim().split('\n').filter(Boolean)));
const RESOLVED = { 'apps/realm/src/kingdom-room.ts': 'with-play-kingdom-room.patch', 'apps/realm/src/main.ts': 'with-play-main.patch',
  'apps/web/src/play/providers.ts': 'with-play-providers.patch' };
const playFiles = theirs.filter(([, path]) => !path.startsWith('work/'));
for (const [status, path] of playFiles) {
  assert.ok(/^[AM]$/.test(status), `play ${status} ${path}: only additions and changes are composed here`);
  if (ours.has(path)) assert.ok(RESOLVED[path], `both lanes changed ${path} and no resolution is written for it`);
}

await rm(tree, { recursive: true, force: true });
await mkdir(tree, { recursive: true });
// This checkout's tracked and new files as they are now, without build output or dependencies.
const files = git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(path => path && existsSync(join(repo, path)));
run('tar', ['-c', '-f', join(values.out, 'own.tar'), '-C', repo, '--null', '-T', '-'], { input: files.join('\0') });
run('tar', ['-x', '-f', join(values.out, 'own.tar'), '-C', tree]);
await rm(join(values.out, 'own.tar'));
for (const [, path] of playFiles) {
  await mkdir(dirname(join(tree, path)), { recursive: true });
  await writeFile(join(tree, path), gitBytes('show', `${playHead}:${path}`));
}
const patches = [
  ...Object.values(RESOLVED).map(name => join(repo, 'work/lanes/gather/patches', name)),
  join(repo, 'work/lanes/gather/patches/play-walk-founded.patch'),
];
const frontDoor = join(values.out, 'kingdom-entry-door.patch');
await writeFile(frontDoor, gitBytes('show', `${playHead}:work/lanes/play/patches/kingdom-entry-door.patch`));
patches.push(frontDoor);
for (const patch of patches) run('patch', ['-p1', '--forward', '--batch', '--no-backup-if-mismatch', '-d', tree, '-i', patch]);

// Dependencies: the same installed packages, linked; workspace links inside them are relative and land in this tree.
await symlink(join(repo, 'node_modules'), join(tree, 'node_modules'));
for (const group of ['apps', 'packages']) for (const name of await readdir(join(repo, group))) {
  const from = join(repo, group, name, 'node_modules');
  if (!existsSync(from) || !existsSync(join(tree, group, name))) continue;
  await mkdir(join(tree, group, name, 'node_modules'), { recursive: true });
  const copy = async (source, target) => {
    for (const entry of await readdir(source)) {
      const at = join(source, entry), stat = await lstat(at);
      if (stat.isSymbolicLink()) await symlink(await readlink(at), join(target, entry));
      else if (stat.isDirectory()) { await mkdir(join(target, entry), { recursive: true }); await copy(at, join(target, entry)); }
    }
  };
  await copy(from, join(tree, group, name, 'node_modules'));
}
const manifest = { assembled: new Date().toISOString(), gather: { head: ownHead, workingTree: true }, play: { ref: values.play, head: playHead }, base,
  playFiles: playFiles.length, resolved: Object.keys(RESOLVED), patches: patches.map(path => path.startsWith(repo) ? path.slice(repo.length + 1) : `${values.play}:work/lanes/play/patches/kingdom-entry-door.patch`) };
await writeFile(join(values.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`with-play: ${tree} (gather ${ownHead.slice(0, 8)} + working tree, play ${playHead.slice(0, 8)}, ${playFiles.length} play files, ${patches.length} patches)`);
