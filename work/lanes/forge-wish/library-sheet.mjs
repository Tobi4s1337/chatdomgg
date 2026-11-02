// Renders and checks Forge library motifs (kit revision 3) without a browser.
//   nice -n 10 node work/lanes/forge-wish/library-sheet.mjs <group> [family|all] [--out dir]
// <group> is a file in packages/content/src/forge-library/ that exports MOTIFS: Record<id, (family) => LibraryMotif>.
// Writes <out>/<group>-<family>.png: per motif, the whole sculpture then its front relief, each lit from the
// front and from three-quarters. Prints one line per motif with its checks; exits 1 if any check fails.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const group = args[0];
if (!group) { console.error('usage: library-sheet.mjs <group> [hearth|tide|grove|all] [--out dir]'); process.exit(2); }
const family = args[1] && !args[1].startsWith('--') ? args[1] : 'all';
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : '/tmp/forge-library';
mkdirSync(out, { recursive: true });

const server = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
let failed = false;
try {
  const { MOTIFS } = await server.ssrLoadModule(`/packages/content/src/forge-library/${group}.ts`);
  const { reliefForm } = await server.ssrLoadModule('/packages/forge/src/motif-forms.ts');
  const { renderForgeCertificationSheet } = await server.ssrLoadModule('/apps/codex/src/contact-sheet.ts');
  const { STYLES, MAT } = await server.ssrLoadModule('/packages/content/src/materials.ts');
  const { rasterizeBlueprint } = await server.ssrLoadModule('/packages/voxel/src/index.ts');
  const families = family === 'all' ? ['hearth', 'tide', 'grove'] : [family];
  for (const fam of families) {
    const pieces = [];
    for (const [id, make] of Object.entries(MOTIFS)) {
      const motif = make(fam);
      const problems = [];
      const [sx, sy, sz] = motif.size;
      if (sx !== 24 || sy !== 16 || sz !== 18) problems.push(`size ${motif.size}`);
      if (String(motif.mount) !== '12,0,9') problems.push(`mount ${motif.mount}`);
      const blueprint = { version: 1, id: `library-${id}`, kind: 'prop', styleId: STYLES[fam].id, lattice: 'build', size: motif.size, boxes: motif.boxes, windows: [] };
      let solid = 0, materials = new Set(), connected = false, mountSolid = false;
      try {
        const asset = rasterizeBlueprint(blueprint), v = asset.voxels;
        const index = (x, y, z) => x + sx * (y + sy * z);
        mountSolid = v[index(12, 0, 9)] !== 0;
        for (const m of v) if (m) { solid++; materials.add(m); }
        // One 6-neighbour flood from the mount must reach every solid cell.
        if (mountSolid) {
          const seen = new Uint8Array(v.length), queue = [index(12, 0, 9)]; seen[queue[0]] = 1;
          for (let i = 0; i < queue.length; i++) {
            const n = queue[i], x = n % sx, y = Math.floor(n / sx) % sy, z = Math.floor(n / (sx * sy));
            for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
              const X = x + dx, Y = y + dy, Z = z + dz;
              if (X < 0 || Y < 0 || Z < 0 || X >= sx || Y >= sy || Z >= sz) continue;
              const j = index(X, Y, Z);
              if (v[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
            }
          }
          connected = queue.length === solid;
        }
      } catch (error) { problems.push(String(error.message ?? error)); }
      if (!mountSolid) problems.push('mount cell (12,0,9) is empty');
      if (!connected) problems.push('not one connected piece from the mount');
      if (materials.size > 6) problems.push(`${materials.size} materials (max 6)`);
      if (solid < 60) problems.push(`only ${solid} cells`);
      if ([...materials].some(m => m >= MAT.skin1 && m <= MAT.fabricMutedViolet)) problems.push('uses a skin, hair or fabric swatch');
      if (problems.length) failed = true;
      console.log(`${fam} ${id.padEnd(14)} cells ${String(solid).padStart(5)} materials ${materials.size} boxes ${String(motif.boxes.length).padStart(3)} ${problems.length ? 'FAIL ' + problems.join('; ') : 'ok'}`);
      pieces.push(blueprint);
      const relief = reliefForm(motif, 'front');
      pieces.push({ ...blueprint, id: `library-${id}-relief`, size: relief.size, boxes: relief.boxes });
    }
    for (let page = 0; page * 16 < pieces.length; page++) {
      const png = renderForgeCertificationSheet(pieces.slice(page * 16, page * 16 + 16), 4);
      const file = `${out}/${group}-${fam}${page ? `-${page + 1}` : ''}.png`;
      writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
      console.log('wrote', file);
    }
  }
} finally { await server.close(); }
process.exit(failed ? 1 : 0);
