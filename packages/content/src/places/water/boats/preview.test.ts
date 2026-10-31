import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { MATERIALS } from '../../../materials';
import { meshCost, voxels } from '../piece-checks';
import { BOAT_PIECES } from './index';

const colour = (m: number) => {
  const hex = MATERIALS.materials.find(x => x.id === m)!.colour;
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
};

function render(b: Parameters<typeof voxels>[0], dir: [number, number, number], file: string, scale = 14) {
  const { at, size } = voxels(b);
  const [sx, sy, sz] = size;
  const n = Math.hypot(...dir), d = dir.map(v => v / n) as [number, number, number];
  // right = d x up(0,1,0) normalised, up = right x d
  let r = [d[2], 0, -d[0]]; const rn = Math.hypot(...r); r = r.map(v => v / rn);
  const u = [-(r[1] * d[2] - r[2] * d[1]), -(r[2] * d[0] - r[0] * d[2]), -(r[0] * d[1] - r[1] * d[0])];
  const c = [sx / 2, sy / 2, sz / 2], R = Math.hypot(sx, sy, sz) / 2 + 1;
  const W = Math.ceil(2 * R * scale) | 0, H = W;
  const img = Buffer.alloc(W * H * 3, 0);
  const light = [0.4, 0.8, 0.3];
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    img[(py * W + px) * 3] = 150; img[(py * W + px) * 3 + 1] = 170; img[(py * W + px) * 3 + 2] = 190;
    const a = (px + 0.5) / scale - R, bb = R - (py + 0.5) / scale;
    const o = [0, 1, 2].map(i => c[i]! + a * r[i]! + bb * u[i]! - d[i]! * (R + 2));
    // Amanatides-Woo traversal
    let hitM = 0, normal = [0, 1, 0];
    const cell = o.map(Math.floor);
    const stepv = d.map(v => (v > 0 ? 1 : -1));
    const tDelta = d.map(v => Math.abs(1 / v));
    const tMax = o.map((v, i) => { const di = d[i]!; const nb = di > 0 ? Math.floor(v) + 1 : Math.floor(v); return Math.abs((nb - v) / di); });
    for (let k = 0; k < 400; k++) {
      let ax = 0; if (tMax[1]! < tMax[ax]!) ax = 1; if (tMax[2]! < tMax[ax]!) ax = 2;
      cell[ax] = cell[ax]! + stepv[ax]!; tMax[ax] = tMax[ax]! + tDelta[ax]!;
      const m = at(cell[0]!, cell[1]!, cell[2]!);
      if (m) { hitM = m; normal = [0, 0, 0]; normal[ax] = -stepv[ax]!; break; }
    }
    if (!hitM) continue;
    const base = colour(hitM);
    const shade = 0.55 + 0.45 * Math.max(0, normal[0]! * light[0]! + normal[1]! * light[1]! + normal[2]! * light[2]!);
    base.forEach((v, i) => { img[(py * W + px) * 3 + i] = Math.min(255, Math.round(v * shade)); });
  }
  writeFileSync(file, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
}

it('renders previews', () => {
  for (const p of BOAT_PIECES.filter(p => (process.env.BOATS ?? '').split(',').some(k => p.blueprint.id.endsWith(k)))) {
    const id = p.blueprint.id;
    console.log(id, p.blueprint.boxes.length, JSON.stringify(meshCost(p.blueprint)), JSON.stringify(p.mounts), p.footings.length);
    render(p.blueprint, [-1, -0.9, -0.7], `/tmp/boats/${id}-iso.ppm`);
    render(p.blueprint, [1, -0.6, 1.1], `/tmp/boats/${id}-iso2.ppm`);
    render(p.blueprint, [-1, -0.05, 0], `/tmp/boats/${id}-side.ppm`);
    render(p.blueprint, [0.01, -1, 0.001], `/tmp/boats/${id}-top.ppm`);
  }
}, 300_000);
