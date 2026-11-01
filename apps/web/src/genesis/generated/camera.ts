import type { Vec3 } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type SettlementPlan } from '@chatdom/world';
import { sampleGenesisSurface, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import type { GeneratedSites } from './compose';

const FOV = 46, ASPECT = 16 / 9;

/**
 * The hero view of a generated kingdom: the market, the keep and the landmarks in one frame, from a side where the
 * land itself is the backdrop (the open sea beyond a harbour, the ridges and pass behind a hill town, the valley
 * along a river town). Sixteen bearings are scored for what they hold in frame, what the ground hides and what lies
 * behind; the channel's seed chooses among the views that score nearly as well as the best, so two kingdoms on the
 * same kind of land are not shot from one angle.
 */
export function frameCamera(plan: SettlementPlan, landscape: DeepReadonly<GenesisLandscape>, sites: GeneratedSites, roll: number): { eye: Vec3; target: Vec3; fov: number } {
  const ground = (x: number, z: number) => {
    const inside = x > plan.bounds.minX && x < plan.bounds.maxX && z > plan.bounds.minZ && z < plan.bounds.maxZ;
    return inside ? terrainHeight(plan, x, z) : Math.max(sampleGenesisSurface(landscape, x, z).ground, 0);
  };
  const keyPoints: { p: Vec3; w: number; reach?: number }[] = [
    { p: [sites.market[0], sites.market[1] + 3, sites.market[2]], w: 3 },
    { p: [sites.castle[0], sites.castle[1] + 14, sites.castle[2]], w: 2.5 },
  ];
  if (sites.landmark) keyPoints.push({ p: [sites.landmark.at[0], sites.landmark.at[1] + 10, sites.landmark.at[2]], w: 2 });
  if (sites.family) keyPoints.push({ p: [sites.family.at[0], sites.family.at[1] + 3, sites.family.at[2]], w: 1.5 });
  if (sites.inn) keyPoints.push({ p: [sites.inn[0], sites.inn[1] + 5, sites.inn[2]], w: 1 });
  if (sites.cathedral) keyPoints.push({ p: [sites.cathedral[0], sites.cathedral[1] + 2, sites.cathedral[2]], w: .8 });
  // The skyline's tall pieces read from much farther off: framed by their upper half, out to a longer reach.
  for (const piece of sites.skyline) keyPoints.push({ p: [piece.at[0], piece.at[1] + piece.height * .6, piece.at[2]], w: 1.6, reach: 260 });
  // A site far out beyond the lanes is not part of the heart the view frames.
  for (let i = keyPoints.length - 1; i >= 2; i--) {
    if (Math.hypot(keyPoints[i]!.p[0] - sites.market[0], keyPoints[i]!.p[2] - sites.market[2]) > (keyPoints[i]!.reach ?? 150)) keyPoints.splice(i, 1);
  }

  // The homes nearest the market: the part of town the view should hold.
  const distances = plan.homes.map(home => Math.hypot(home.position[0] - sites.market[0], home.position[2] - sites.market[2])).sort((a, b) => a - b);
  const reach = distances[Math.min(distances.length - 1, Math.max(0, Math.floor(Math.min(distances.length, 160) * .85) - 1))] ?? 60;
  // The skyline leans the view toward itself but does not widen it: a tall piece reads above the town from afar.
  const pull = (k: typeof keyPoints[number]) => k.reach ? k.w * .3 : k.w;
  const weight = keyPoints.reduce((sum, k) => sum + pull(k), 0);
  const centre: [number, number, number] = [0, 0, 0];
  for (const k of keyPoints) for (const i of [0, 1, 2] as const) centre[i] += k.p[i] * pull(k) / weight;
  const spread = Math.max(...keyPoints.filter(k => !k.reach).map(k => Math.hypot(k.p[0] - centre[0], k.p[2] - centre[2])));
  // A street-height hero view, not a map: close enough that the heart of the town fills the frame and low enough that
  // the land's backdrop and the dusk sky stand above it. A big town runs on past the frame's edges, which is how a
  // big town should read.
  const distance = Math.min(240, Math.max(84, Math.max(spread * 1.45, reach * .5) + 40));
  const elevation = (12 + roll * 5) * Math.PI / 180;

  const turn = landscape.coast.oceanToward;
  const sea = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]);
  const ridge = transformCardinalPoint([0, 0, 0], turn, [0, 0, -1]);
  const candidates: { eye: Vec3; score: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    const dir: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const eye: [number, number, number] = [centre[0] - dir[0] * distance * Math.cos(elevation), centre[1] + distance * Math.sin(elevation), centre[2] - dir[2] * distance * Math.cos(elevation)];
    eye[1] = Math.max(eye[1], ground(eye[0], eye[2]) + 14);
    let score = 0;
    // What is in frame, and how much of the frame the town fills.
    const forward = norm([centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]]);
    const right = norm([forward[2], 0, -forward[0]]), up = cross(right, forward);
    const tan = Math.tan(FOV * Math.PI / 360);
    for (const k of keyPoints) {
      const v: Vec3 = [k.p[0] - eye[0], k.p[1] - eye[1], k.p[2] - eye[2]];
      const depth = dot(v, forward);
      if (depth <= 1) { score -= 4 * k.w; continue; }
      const sx = dot(v, right) / (depth * tan * ASPECT), sy = dot(v, up) / (depth * tan);
      if (Math.abs(sx) < .82 && Math.abs(sy) < .78) score += 2 * k.w; else score -= 2 * k.w;
      // Hidden behind rising ground on the way.
      for (let s = 1; s < 12; s++) {
        const t = s / 12, p: Vec3 = [eye[0] + v[0] * t, eye[1] + v[1] * t, eye[2] + v[2] * t];
        if (ground(p[0], p[2]) > p[1] - 1.5) { score -= 2.5 * k.w; break; }
      }
    }
    // The realm's landmark is met from its front, not from behind.
    if (sites.family && keyPoints.some(k => k.p[0] === sites.family!.at[0] && k.p[2] === sites.family!.at[2])) {
      const toEye = norm([eye[0] - sites.family.at[0], 0, eye[2] - sites.family.at[2]]);
      score += 3 * (toEye[0] * sites.family.front[0] + toEye[2] * sites.family.front[1]);
    }
    // The land's own landmark stands clear of the keep, not hidden behind it.
    if (sites.landmark) {
      const keep = norm([sites.castle[0] - eye[0], 0, sites.castle[2] - eye[2]]), mark = norm([sites.landmark.at[0] - eye[0], 0, sites.landmark.at[2] - eye[2]]);
      const behind = Math.hypot(sites.landmark.at[0] - eye[0], sites.landmark.at[2] - eye[2]) > Math.hypot(sites.castle[0] - eye[0], sites.castle[2] - eye[2]);
      if (behind && dot(keep, mark) > Math.cos(14 * Math.PI / 180)) score -= 4;
    }
    // The keep behind the market reads as a town under its castle.
    const castleDepth = dot([sites.castle[0] - eye[0], 0, sites.castle[2] - eye[2]], forward);
    const marketDepth = dot([sites.market[0] - eye[0], 0, sites.market[2] - eye[2]], forward);
    if (castleDepth > marketDepth) score += 3;
    // The land's backdrop: the open sea beyond a harbour, the ridges beyond a hill town.
    const look = norm([forward[0], 0, forward[2]]);
    if (landscape.character === 'coastal-harbour') score += 5 * dot(look, sea);
    if (landscape.character === 'mountain-pass') score += 5 * dot(look, ridge);
    if (landscape.character === 'river-valley') score += 2 * Math.abs(dot(look, ridge));
    // The eye stands over land or shallow water, not over open sea far out.
    if (sampleGenesisSurface(landscape, eye[0], eye[2]).water === 'ocean') score -= 3;
    candidates.push({ eye, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!.score;
  const close = candidates.filter(c => c.score >= best - Math.max(2, Math.abs(best) * .08));
  const chosen = close[Math.min(close.length - 1, Math.floor(roll * close.length))]!;
  // Aim a little below the heart so the horizon sits in the upper third.
  const target: Vec3 = [centre[0], centre[1] - distance * .04, centre[2]];
  return { eye: chosen.eye, target, fov: FOV };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
