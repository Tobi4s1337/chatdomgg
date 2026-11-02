/**
 * Renders the town's land-use plan top-down: the founded scene's real plan (GRAND_FOUNDED_SCENE, default
 * /tmp/grand-world-scene.json), its placements as the occupied ground, and the town walls the client raises.
 * CPU only: no web server is listened on and no capture slot is used.
 *
 *   nice -n 10 node work/lanes/grand-world/town-ground-map.mjs [out.png]
 *
 * Each use is drawn in its intended tint (TOWN_USE_LOOK) with field rows striped at an exaggerated 2 m pitch so their
 * direction reads at this scale; lots are dark, paving grey, squares sand, the castle slate, the lake blue, placements
 * brown. Loose cover pieces show as darker dots, cottage borders as pink bars.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

const scenePath = process.env.GRAND_FOUNDED_SCENE ?? '/tmp/grand-world-scene.json';
const out = resolve(process.argv[2] ?? 'work/evidence/grand-world/gw15-town-use-map.png');
const SCALE = 2.5;

const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const town = await server.ssrLoadModule('/apps/web/src/kingdom/grand-land/town-ground/plan.ts');
  const walls = await server.ssrLoadModule('/packages/world/src/grand/kingdom/walls/index.ts');
  const frame = await server.ssrLoadModule('/packages/world/src/grand/kingdom/frame.ts');
  const world = await server.ssrLoadModule('/packages/world/src/index.ts');
  const scene = JSON.parse(readFileSync(scenePath, 'utf8')), plan = scene.plan;
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const occupied = scene.placements.map(p => ({ blueprint: assets.get(p.assetHash), position: p.position, yaw: p.rotation * Math.PI / 2 }));
  let started = performance.now();
  const ring = walls.planTownWalls(plan, { seedKey: `${scene.kingdomId}:walls`, style: 'tide', region: frame.frameSettlement(plan).region,
    ground: (x, z) => world.terrainHeight(plan, x, z), water: frame.settlementWater(plan) });
  for (const piece of ring.pieces) occupied.push({ blueprint: piece.blueprint, position: piece.position, yaw: piece.rotation * Math.PI / 2 });
  console.log(`walls: ${ring.pieces.length} pieces in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  started = performance.now();
  const result = town.planTownGround(plan, { occupied });
  const planned = (performance.now() - started) / 1000;
  const { keep } = town.townKeepOut(plan, { occupied });
  const { mask } = result, [x0, z0] = mask.origin;
  console.log(JSON.stringify({ seconds: +planned.toFixed(2), ...result.report, pieces: [...result.pieces.values()].reduce((n, l) => n + l.length, 0) }, null, 1));

  const width = Math.round(mask.width * SCALE), height = Math.round(mask.depth * SCALE), rgb = new Uint8Array(width * height * 3);
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const names = Object.keys(town.TOWN_USE), look = names.map(name => ({ tint: hex(town.TOWN_USE_LOOK[name].tint), rows: town.TOWN_USE_LOOK[name].rows }));
  const K = town.TOWN_KEEP, lawn = look[0].tint;
  const KEEP_COLOUR = { [K.lot]: [44, 48, 42], [K.paving]: [156, 152, 142], [K.square]: [184, 170, 140], [K.castle]: [78, 80, 98],
    [K.lake]: [58, 98, 146], [K.occupied]: [86, 70, 56] };
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = x0 + (px + 0.5) / SCALE, z = z0 + (py + 0.5) / SCALE, k = Math.floor(x - x0) + Math.floor(z - z0) * mask.width;
    const use = mask.data[k];
    let c;
    if (use) {
      const { tint, rows } = look[use];
      c = tint;
      if (rows) {
        const phi = town.townRowAngle(mask.rows[k]), across = -x * Math.sin(phi) + z * Math.cos(phi);
        const f = ((across / 2) % 1 + 1) % 1 < 0.5 ? 1 - rows * 0.45 : 1;
        c = c.map(v => v * f);
      }
    } else c = KEEP_COLOUR[keep[k]] ?? (keep[k] === K.verge ? lawn.map(v => v * 1.06) : lawn);
    const at = (px + py * width) * 3;
    rgb[at] = c[0]; rgb[at + 1] = c[1]; rgb[at + 2] = c[2];
  }
  const dot = (x, z, colour, r) => {
    const cx = (x - x0) * SCALE, cz = (z - z0) * SCALE;
    for (let py = Math.floor(cz - r); py <= cz + r; py++) for (let px = Math.floor(cx - r); px <= cx + r; px++) {
      if (px < 0 || py < 0 || px >= width || py >= height || Math.hypot(px + 0.5 - cx, py + 0.5 - cz) > r) continue;
      const at = (px + py * width) * 3; rgb[at] = colour[0]; rgb[at + 1] = colour[1]; rgb[at + 2] = colour[2];
    }
  };
  for (const list of result.pieces.values()) for (const piece of list) {
    const form = piece.blueprint.id, w = piece.blueprint.size[0] * 0.0625, d = piece.blueprint.size[2] * 0.0625;
    const c = Math.cos(piece.yaw), s = Math.sin(piece.yaw), x = piece.position[0] + c * w + s * d, z = piece.position[2] - s * w + c * d;
    if (form.includes('crop')) continue;
    if (form.includes('border')) { for (let a = 0.25; a < 3; a += 0.4) dot(piece.position[0] + c * a + s * 0.5, piece.position[2] - s * a + c * 0.5, form.includes('warm') ? [214, 120, 150] : [120, 140, 214], 0.8); continue; }
    const colour = form.includes('heather') ? [92, 62, 92] : form.includes('bracken') ? [104, 84, 34] : form.includes('wildflowers') ? [240, 236, 220] : [70, 104, 48];
    dot(x, z, colour, 0.9);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png(width, height, rgb));
  console.log(`wrote ${out} (${width}×${height})`);
} finally {
  await server.close();
}

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1); }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buffer => { let c = 0xffffffff; for (const b of buffer) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
