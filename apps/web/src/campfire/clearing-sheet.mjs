#!/usr/bin/env node
/*
 * Top view of the kingdom's campfire clearing blueprint (packages/content/src/campfire), one character per
 * 0.125 m build cell, looking straight down: +X to the right, +Z (the footpath, the town and the stream camera) at
 * the bottom, so the Magistrate's chair is at the top. Prints to stdout.
 *
 *   node apps/web/src/campfire/clearing-sheet.mjs
 *
 * Solids show their highest material: = wood (logs, chair, stump, firewood), o stone, * embers, : ash and earth,
 * & cloth, gold and brass, ~ moss. Overlays: 0..9 and T are seat hips (0 the Magistrate, T seat 10), A the spot
 * in front of a seat where its sitter stands, + the shared route waypoints, l a seat's lantern, X the hearth centre.
 * Ground inside the clearing's radius is '.', beyond it blank.
 */
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-clearing-sheet',
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const [{ createCampfireClearing }, { MAT }] = await Promise.all([
    loader.ssrLoadModule('/packages/content/src/campfire/index.ts'), loader.ssrLoadModule('/packages/content/src/materials.ts')]);
  const clearing = createCampfireClearing(), { blueprint, pivot, radius, seats, seatTop } = clearing, M = .125;
  const [sx, sy, sz] = blueprint.size, top = new Map();
  for (const box of blueprint.boxes) for (let z = box.from[2]; z < box.to[2]; z++) for (let x = box.from[0]; x < box.to[0]; x++) {
    const key = x + sx * z, was = top.get(key);
    if (box.to[1] > pivot[1] && (!was || box.to[1] > was.y)) top.set(key, { y: box.to[1], material: box.material });
  }
  const glyph = m => [MAT.stone, MAT.limestone, MAT.darkStone].includes(m) ? 'o' : [MAT.forgeCopper, MAT.fabricOrange].includes(m) ? '*'
    : m === MAT.earth ? ':' : m === MAT.moss ? '~' : [MAT.bark, MAT.timber, MAT.cream].includes(m) ? '=' : '&';
  const half = Math.ceil(radius / M) + 1, lines = [];
  const cellOf = p => [Math.floor(p[0] / M), Math.floor(p[1] / M)];
  const marks = new Map(), mark = (p, ch) => { const [i, k] = cellOf(p); marks.set(`${i},${k}`, ch); };
  for (const seat of seats) {
    for (const p of seat.approach.slice(0, -1)) if (!marks.has(cellOf(p).join(','))) mark(p, '+');
  }
  for (const seat of seats) { mark(seat.approach.at(-1), 'A'); mark(seat.lantern, 'l'); mark(seat.hip, seat.seat === 10 ? 'T' : String(seat.seat)); }
  marks.set('0,0', 'X');
  for (let k = -half; k < half; k++) {
    let row = '';
    for (let i = -half; i < half; i++) {
      const x = i + pivot[0], z = k + pivot[2], solid = x >= 0 && z >= 0 && x < sx && z < sz ? top.get(x + sx * z) : undefined;
      const inside = Math.hypot((i + .5) * M, (k + .5) * M) <= radius;
      row += marks.get(`${i},${k}`) ?? (solid ? glyph(solid.material) : inside ? '.' : ' ');
    }
    lines.push(row.replace(/\s+$/, ''));
  }
  const tall = Math.max(...blueprint.boxes.map(b => b.to[1])) - pivot[1];
  console.log(`campfire clearing ${blueprint.id}: ${sx}x${sy}x${sz} cells, ${blueprint.boxes.length} boxes, pivot ${pivot.join(',')}, seat top ${seatTop} m, radius ${radius} m, tallest ${tall * M} m above the ground`);
  console.log('top: the Magistrate (-Z); bottom: the footpath, the town and the stream camera (+Z); one character = 0.125 m');
  console.log(lines.join('\n'));
  for (const seat of seats) console.log(`seat ${String(seat.seat).padStart(2)} ${seat.kind.padEnd(10)} hip ${seat.hip.map(v => v.toFixed(3)).join(', ')} heading ${seat.heading.toFixed(3)} stand ${seat.approach.at(-1).map(v => v.toFixed(3)).join(', ')} lantern ${seat.lantern.map(v => v.toFixed(2)).join(', ')} (${seat.approach.length} waypoints)`);
} finally {
  await loader.close();
}
