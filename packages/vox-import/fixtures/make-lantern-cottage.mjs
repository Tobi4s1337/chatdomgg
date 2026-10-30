// Writes lantern-cottage.vox: an original two-object MagicaVoxel 200 file used by the boundary test and the
// browser flow. Model 0 is a small cottage, deliberately asymmetric so a mirrored or lying import is obvious:
// the door and its two-colour emblem sit left of centre on the front (MagicaVoxel y = 0, which faces the street),
// the chimney rises back right, and only the right side has a window. Model 1 is a crooked lantern post.
// Run: node packages/vox-import/fixtures/make-lantern-cottage.mjs
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COLOURS = {
  wall: [230, 211, 174], roof: [176, 90, 66], door: [94, 63, 44], stone: [203, 188, 164], chimney: [188, 108, 84],
  glass: [224, 176, 112], gold: [182, 145, 85], blue: [127, 149, 191], knob: [0, 0, 0], glow: [212, 166, 106], post: [107, 74, 53],
};
/** Colour index i is RGBA record i - 1; `wall` is deliberately index 1. */
const INDEX = Object.fromEntries(Object.keys(COLOURS).map((name, i) => [name, i + 1]));

function model(size, build) {
  const cells = new Map();
  const set = (x, y, z, name) => cells.set(`${x},${y},${z}`, [x, y, z, INDEX[name]]);
  const fill = (x0, x1, y0, y1, z0, z1, name) => { for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, z, name); };
  build(set, fill);
  return { size, voxels: [...cells.values()] };
}

const cottage = model([20, 16, 26], (set, fill) => {
  fill(1, 18, 1, 14, 0, 1, 'stone');
  for (let z = 2; z <= 12; z++) for (let y = 2; y <= 13; y++) for (let x = 2; x <= 17; x++) {
    if (x === 2 || x === 17 || y === 2 || y === 13) set(x, y, z, 'wall');
  }
  fill(4, 7, 2, 2, 2, 8, 'door');
  set(6, 1, 5, 'knob');
  fill(12, 15, 2, 2, 6, 9, 'glass');
  fill(17, 17, 6, 9, 6, 9, 'glass');
  for (const [x, z, name] of [[4, 10, 'gold'], [5, 10, 'blue'], [6, 10, 'blue'], [7, 10, 'gold'], [4, 11, 'blue'], [5, 11, 'gold'], [6, 11, 'gold'], [7, 11, 'blue']]) set(x, 1, z, name);
  for (let i = 0; i <= 7; i++) {
    const z = 13 + i;
    for (let x = 1; x <= 18; x++) for (const y of new Set([i, i + 1, 14 - i, 15 - i])) set(x, y, z, 'roof');
    for (const x of [2, 17]) for (let y = i + 2; y <= 13 - i; y++) set(x, y, z, 'wall');
  }
  fill(14, 15, 10, 11, 13, 23, 'chimney');
});

const lantern = model([6, 6, 14], (set, fill) => {
  fill(1, 1, 2, 2, 0, 11, 'post');
  fill(2, 3, 2, 2, 11, 11, 'post');
  fill(3, 4, 1, 3, 8, 10, 'glow');
  fill(3, 4, 1, 3, 11, 11, 'post');
});

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const str = s => Buffer.concat([i32(Buffer.byteLength(s)), Buffer.from(s, 'latin1')]);
const dict = entries => Buffer.concat([i32(entries.length), ...entries.flatMap(([k, v]) => [str(k), str(v)])]);
const chunk = (id, content, children = Buffer.alloc(0)) => Buffer.concat([Buffer.from(id, 'latin1'), u32(content.length), u32(children.length), content, children]);

const models = [cottage, lantern].flatMap(m => [
  chunk('SIZE', Buffer.concat(m.size.map(i32))),
  chunk('XYZI', Buffer.concat([u32(m.voxels.length), Buffer.from(m.voxels.flat())])),
]);
const transform = (id, child, t) => chunk('nTRN', Buffer.concat([i32(id), dict([]), i32(child), i32(-1), i32(0), i32(1), dict(t ? [['_t', t]] : [])]));
const scene = [
  transform(0, 1), chunk('nGRP', Buffer.concat([i32(1), dict([]), i32(2), i32(2), i32(4)])),
  transform(2, 3, '0 0 13'), chunk('nSHP', Buffer.concat([i32(3), dict([]), i32(1), i32(0), dict([])])),
  transform(4, 5, '16 -10 7'), chunk('nSHP', Buffer.concat([i32(5), dict([]), i32(1), i32(1), dict([])])),
  chunk('LAYR', Buffer.concat([i32(0), dict([['_name', 'cottage']]), i32(-1)])),
];
const rgba = Buffer.alloc(1024);
for (let r = 0; r < 256; r++) {
  const c = Object.values(COLOURS)[r] ?? [r, 255 - r, (r * 7) & 255];
  rgba.set([...c, 255], r * 4);
}
const materials = [
  chunk('MATL', Buffer.concat([i32(INDEX.glass), dict([['_type', '_glass'], ['_alpha', '0.5']])])),
  chunk('MATL', Buffer.concat([i32(INDEX.glow), dict([['_type', '_emit'], ['_emit', '0.8']])])),
];
const main = chunk('MAIN', Buffer.alloc(0), Buffer.concat([...models, ...scene, chunk('RGBA', rgba), ...materials, chunk('rOBJ', dict([['_type', '_bg']]))]));
const bytes = Buffer.concat([Buffer.from('VOX ', 'latin1'), u32(200), main]);
writeFileSync(fileURLToPath(new URL('./lantern-cottage.vox', import.meta.url)), bytes);
console.log(`lantern-cottage.vox: ${bytes.length} bytes, ${cottage.voxels.length} + ${lantern.voxels.length} blocks`);
