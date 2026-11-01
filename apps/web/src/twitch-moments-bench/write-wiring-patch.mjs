// Writes work/lanes/sky-moments/wiring.patch from the wiring list, against the files as they stand in this tree.
//   node apps/web/src/twitch-moments-bench/write-wiring-patch.mjs
// Main applies it from the repository root with `git apply work/lanes/sky-moments/wiring.patch`.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIRING, wire } from './wiring.mjs';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'sky-wiring-'));
let patch = '';
try {
  for (const { file } of WIRING) {
    const before = await readFile(join(root, file), 'utf8');
    for (const [side, text] of [['a', before], ['b', wire(file, before)]]) {
      await mkdir(dirname(join(scratch, side, file)), { recursive: true });
      await writeFile(join(scratch, side, file), text);
    }
    try {
      execFileSync('diff', ['-u', '--label', `a/${file}`, '--label', `b/${file}`, join(scratch, 'a', file), join(scratch, 'b', file)], { encoding: 'utf8' });
    } catch (difference) {
      if (difference.status !== 1) throw difference;
      patch += `diff --git a/${file} b/${file}\n${difference.stdout}`;
    }
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
const out = join(root, 'work/lanes/sky-moments/wiring.patch');
await writeFile(out, patch);
console.log(`Wrote ${out.slice(root.length)} (${WIRING.length} files)`);
