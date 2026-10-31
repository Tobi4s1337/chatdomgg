import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { MATERIALS } from '../../../materials';
import { voxels } from '../piece-checks';
import { BOATHOUSE_REVIEW_SITE, createBoathouse, type BoathouseSite } from './index';
import type { StyleKey } from '../../../materials';

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
const COL = MATERIALS.materials.map(m => hex(m.colour));

function render(style: StyleKey, site: BoathouseSite, view: [number, number, number], name: string, W = 720, Hh = 620, zoom = 1) {
  const piece = createBoathouse(style, site), { at, size } = voxels(piece.blueprint);
  const [sx, sy, sz] = size;
  const gnd = (x: number, z: number) => (x >= 0 && z >= 0 && x < sx && z < sz ? site.ground(x, z) : 0);
  const solid = (x: number, y: number, z: number): number => {
    const m = at(x, y, z); if (m) return m;
    if (y < 0 || x < 0 || z < 0 || x >= sx || z >= sz) return 0;
    if (y < Math.round(gnd(x, z))) return y >= site.water - 1 ? 1 : 22;
    return 0;
  };
  const d = view.map(v => v / Math.hypot(...view)) as [number, number, number];
  const up0 = [0, 1, 0];
  const right = [d[1] * up0[2] - d[2] * up0[1], d[2] * up0[0] - d[0] * up0[2], d[0] * up0[1] - d[1] * up0[0]];
  const rl = Math.hypot(...right); right.forEach((v, i) => (right[i] = v / rl));
  const up = [right[1] * d[2] - right[2] * d[1], right[2] * d[0] - right[0] * d[2], right[0] * d[1] - right[1] * d[0]];
  const c = [sx / 2, sy / 2.3, sz / 2];
  const sun = [0.45, 0.8, 0.35].map(v => v / Math.hypot(0.45, 0.8, 0.35));
  const scale = (Math.hypot(sx, sz) * 1.15) / W / zoom;
  const march = (o: number[], dir: number[], maxT: number) => {
    let x = Math.floor(o[0]!), y = Math.floor(o[1]!), z = Math.floor(o[2]!);
    const step = dir.map(v => (v > 0 ? 1 : -1));
    const tDelta = dir.map(v => Math.abs(1 / (v || 1e-9)));
    const tMax = [0, 1, 2].map(i => { const p = o[i]!, cell = Math.floor(p); return dir[i]! > 0 ? (cell + 1 - p) * tDelta[i]! : (p - cell) * tDelta[i]!; });
    let t = 0, face = -1;
    while (t < maxT) {
      const m = solid(x, y, z);
      if (m && face >= 0) return { m, t, face, x, y, z };
      const a = tMax[0]! < tMax[1]! ? (tMax[0]! < tMax[2]! ? 0 : 2) : (tMax[1]! < tMax[2]! ? 1 : 2);
      t = tMax[a]!; tMax[a]! += tDelta[a]!; face = a;
      if (a === 0) x += step[0]!; else if (a === 1) y += step[1]!; else z += step[2]!;
    }
    return undefined;
  };
  const img = Buffer.alloc(W * Hh * 3);
  for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
    const u = (px - W / 2) * scale, v = (Hh / 2 - py) * scale;
    const o = [0, 1, 2].map(i => c[i]! + right[i]! * u + up[i]! * v - d[i]! * 300);
    const hit = march(o, d, 700);
    let col = [0.62 + 0.2 * (py / Hh), 0.72 + 0.1 * (py / Hh), 0.85];
    const tw = (site.water - o[1]!) / d[1]!;
    if (hit) {
      const n = [0, 0, 0]; n[hit.face] = -Math.sign(d[hit.face]!);
      const lam = Math.max(0, n[0]! * sun[0]! + n[1]! * sun[1]! + n[2]! * sun[2]!);
      const p = o.map((oo, i) => oo + d[i]! * hit.t + n[i]! * 0.01);
      const sh = march(p, sun, 200) ? 0.45 : 1;
      const k = 0.42 + 0.58 * lam * sh;
      const base = COL[hit.m]!;
      const jitter = 0.96 + 0.08 * (((hit.x * 73856093) ^ (hit.y * 19349663) ^ (hit.z * 83492791)) >>> 0) / 4294967296;
      col = base.map(b => b * k * jitter);
      if (tw > 0 && tw < hit.t) col = col.map((cc, i) => cc * 0.45 + [0.2, 0.38, 0.48][i]! * 0.55);
    } else if (tw > 0) col = [0.2, 0.38, 0.48];
    for (let i = 0; i < 3; i++) img[(py * W + px) * 3 + i] = Math.max(0, Math.min(255, Math.round(Math.pow(col[i]!, 1 / 1.1) * 255)));
  }
  writeFileSync(`/tmp/bh-shots/${name}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${Hh} 255\n`), img]));
}

const styles = (process.env.BH_STYLE ?? 'tide').split(',') as StyleKey[];
it('render', () => { for (const style of styles) {
  render(style, BOATHOUSE_REVIEW_SITE, [-1.1, -0.7, -1.4], `${style}-front`);
  if (process.env.BH_ALL) render(style, BOATHOUSE_REVIEW_SITE, [1.3, -0.6, 1.0], `${style}-back`);
  if (process.env.BH_ALL) render(style, BOATHOUSE_REVIEW_SITE, [0.0001, -0.12, -1], `${style}-mouth`, 720, 620, 1.3);
  if (process.env.BH_ALL) render(style, BOATHOUSE_REVIEW_SITE, [-1, -0.25, 0.0001], `${style}-side`);
} }, 900000);
