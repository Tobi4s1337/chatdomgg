import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { it } from 'vitest';
import type { VoxelAsset } from '@chatdom/shared';
import { MATERIALS } from '../materials';

/**
 * A software review sheet for voxel content, drawn on the CPU with no browser and no capture lock:
 * side, top, front and a three-quarter view per model, flat-shaded by face so silhouettes and colour
 * blocks read. Run with PIER_PREVIEW=<comma list of ids or a prefix> and PIER_PREVIEW_OUT=<png path>.
 * It is a sculptor's tool, not the production look; final review is the lit bench.
 */
const colours = new Map(MATERIALS.materials.map(m => [m.id, m.colour]));
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function png(width: number, height: number, pixels: Uint8Array): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { rows[y * (width * 3 + 1)] = 0; pixels.subarray(y * width * 3, (y + 1) * width * 3).forEach((v, i) => { rows[y * (width * 3 + 1) + 1 + i] = v; }); }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

type View = (asset: VoxelAsset, px: number, py: number, cell: number) => [number, number, number] | null;
const at = (a: VoxelAsset, x: number, y: number, z: number) =>
  x < 0 || y < 0 || z < 0 || x >= a.size[0] || y >= a.size[1] || z >= a.size[2] ? 0 : a.voxels[x + a.size[0] * (y + a.size[1] * z)]!;
const shade = (m: number, k: number): [number, number, number] => rgb(colours.get(m) ?? '#ff00ff').map(v => Math.min(255, Math.round(v * k))) as [number, number, number];

/** Axis views: march along one axis, shade by depth. Side looks at the fish's left flank (+X), nose to the right. */
const side: View = (a, px, py, c) => {
  const z = Math.floor(px / c), y = a.size[1] - 1 - Math.floor(py / c);
  for (let x = a.size[0] - 1; x >= 0; x--) { const m = at(a, x, y, z); if (m) return shade(m, .72 + .28 * x / Math.max(1, a.size[0] - 1)); }
  return null;
};
const top: View = (a, px, py, c) => {
  const z = Math.floor(px / c), x = Math.floor(py / c);
  for (let y = a.size[1] - 1; y >= 0; y--) { const m = at(a, x, y, z); if (m) return shade(m, .7 + .3 * y / Math.max(1, a.size[1] - 1)); }
  return null;
};
const front: View = (a, px, py, c) => {
  const x = a.size[0] - 1 - Math.floor(px / c), y = a.size[1] - 1 - Math.floor(py / c);
  for (let z = a.size[2] - 1; z >= 0; z--) { const m = at(a, x, y, z); if (m) return shade(m, .7 + .3 * z / Math.max(1, a.size[2] - 1)); }
  return null;
};

/** Three-quarter ray march (orthographic DDA), lit from the upper left front. */
function quarter(a: VoxelAsset, W: number, H: number, scale: number): (px: number, py: number) => [number, number, number] | null {
  const dir = [-.62, -.5, -.6]; const n = Math.hypot(...dir); const d = dir.map(v => v / n) as [number, number, number];
  // Camera basis: right and up perpendicular to d.
  const r = [d[2], 0, -d[0]]; const rn = Math.hypot(...r); const right = r.map(v => v / rn);
  const up = [right[1]! * d[2] - right[2]! * d[1], right[2]! * d[0] - right[0]! * d[2], right[0]! * d[1] - right[1]! * d[0]];
  const centre = a.size.map(v => v / 2); const far = Math.hypot(...a.size);
  const light = [.45, .75, .5];
  return (px, py) => {
    const u = (px - W / 2) / scale, v = -(py - H / 2) / scale;
    const o = [0, 1, 2].map(i => centre[i]! + right[i]! * u - up[i]! * v - d[i]! * far);
    let t = 0; let normal = [0, 0, 0];
    // Slab entry.
    let t0 = 0, t1 = far * 3;
    for (let i = 0; i < 3; i++) {
      const a0 = (0 - o[i]!) / d[i]!, a1 = (a.size[i]! - o[i]!) / d[i]!;
      t0 = Math.max(t0, Math.min(a0, a1)); t1 = Math.min(t1, Math.max(a0, a1));
    }
    if (t0 > t1) return null;
    t = t0 + 1e-6;
    const p = o.map((v, i) => v + d[i]! * t);
    const cell = p.map((v, i) => Math.min(a.size[i]! - 1, Math.max(0, Math.floor(v))));
    const step = d.map(v => v > 0 ? 1 : -1);
    const tMax = [0, 1, 2].map(i => ((cell[i]! + (step[i]! > 0 ? 1 : 0)) - p[i]!) / d[i]! + t);
    const tDelta = d.map(v => Math.abs(1 / v));
    // Entry face normal.
    const entry = [0, 1, 2].map(i => Math.min((0 - o[i]!) / d[i]!, (a.size[i]! - o[i]!) / d[i]!));
    const ax = entry.indexOf(Math.max(...entry)); normal = [0, 0, 0]; normal[ax] = -step[ax]!;
    for (let guard = 0; guard < 200; guard++) {
      const m = at(a, cell[0]!, cell[1]!, cell[2]!);
      if (m) {
        const k = .55 + .45 * Math.max(0, normal[0]! * light[0]! + normal[1]! * light[1]! + normal[2]! * light[2]!);
        return shade(m, k);
      }
      const i = tMax[0]! < tMax[1]! ? (tMax[0]! < tMax[2]! ? 0 : 2) : (tMax[1]! < tMax[2]! ? 1 : 2);
      cell[i]! += step[i]!; tMax[i]! += tDelta[i]!; normal = [0, 0, 0]; normal[i] = -step[i]!;
      if (cell[i]! < 0 || cell[i]! >= a.size[i]!) return null;
    }
    return null;
  };
}

export function voxelSheet(assets: readonly VoxelAsset[], out: string): void {
  const cell = 8, pad = 12, col = 4;
  const rowsH = assets.map(a => Math.max(a.size[1], a.size[0]) * cell + pad * 2 + Math.max(a.size[0], a.size[1], a.size[2]) * cell);
  const widths = assets.map(a => (a.size[2] * 2 + a.size[0]) * cell + pad * 5 + Math.round(Math.hypot(...a.size) * cell));
  const W = Math.max(...widths), H = rowsH.reduce((s, h) => s + h, 0);
  const pixels = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { pixels[i * 3] = 0x32; pixels[i * 3 + 1] = 0x38; pixels[i * 3 + 2] = 0x3c; }
  const put = (x: number, y: number, c: [number, number, number]) => { if (x >= 0 && y >= 0 && x < W && y < H) pixels.set(c, (y * W + x) * 3); };
  let oy = 0;
  assets.forEach((a, index) => {
    let ox = pad;
    const blit = (view: View, w: number, h: number) => {
      for (let py = 0; py < h * cell; py++) for (let px = 0; px < w * cell; px++) { const c = view(a, px, py, cell); if (c) put(ox + px, oy + pad + py, c); }
      ox += w * cell + pad;
    };
    blit(side, a.size[2], a.size[1]); blit(top, a.size[2], a.size[0]); blit(front, a.size[0], a.size[1]);
    const qs = Math.round(Math.hypot(...a.size) * cell), q = quarter(a, qs, qs, cell);
    for (let py = 0; py < qs; py++) for (let px = 0; px < qs; px++) { const c = q(px, py); if (c) put(ox + px, oy + pad + py, c); }
    oy += rowsH[index]!;
    void col;
  });
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, png(W, H, pixels));
}

function report(asset: VoxelAsset): string {
  const [sx, sy, sz] = asset.size; const cells: string[] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) if (asset.voxels[x + sx * (y + sy * z)]) cells.push(`${x},${y},${z}`);
  const left = new Set(cells); let parts = 0;
  while (left.size) {
    parts++; const queue = [left.values().next().value!]; left.delete(queue[0]!);
    while (queue.length) {
      const [x, y, z] = queue.pop()!.split(',').map(Number) as [number, number, number];
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const key = `${x + dx!},${y + dy!},${z + dz!}`; if (left.delete(key)) queue.push(key);
      }
    }
  }
  return `${asset.id}: size ${asset.size.join('x')}, ${cells.length} cells, ${parts} connected part${parts === 1 ? '' : 's'}`;
}

/** PIER_PREVIEW_MODULE=./still draws every exported create* factory of one model file, without the catalogue. */
it.skipIf(!process.env.PIER_PREVIEW && !process.env.PIER_PREVIEW_MODULE)('draws a software review sheet', async () => {
  let assets: VoxelAsset[];
  if (process.env.PIER_PREVIEW_MODULE) {
    const module = await import(/* @vite-ignore */ process.env.PIER_PREVIEW_MODULE) as Record<string, unknown>;
    assets = Object.entries(module).filter(([name, value]) => name.startsWith('create') && typeof value === 'function')
      .map(([, factory]) => { const made = (factory as () => { asset?: VoxelAsset } | VoxelAsset)(); return 'asset' in made && made.asset ? made.asset : made as VoxelAsset; });
  } else {
    const { createFishModel, FISH_SPECIES } = await import('./index');
    const wanted = process.env.PIER_PREVIEW!.split(',');
    const ids = FISH_SPECIES.map(f => f.id).filter(id => wanted.some(w => w === '*' || id === w || id.startsWith(w)));
    assets = ids.map(id => createFishModel(id).asset);
  }
  for (const asset of assets) console.info(report(asset));
  voxelSheet(assets, resolve(process.env.PIER_PREVIEW_OUT ?? `${process.cwd()}/../../shots/pier/fish-preview.png`));
});
