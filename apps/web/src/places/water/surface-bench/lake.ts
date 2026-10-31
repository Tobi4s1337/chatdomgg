// SIMULATED lake for the water surface bench: one lake in the land's own `WaterBody` record, a shelving bed, a
// near bank where a citizen stands, a lakeside row and a second row of real home blueprints on the far bank and
// the real keep on the hill above with its beacon. Every height, site and presence here is a bench fixture, never
// a land decision; production code never imports this module.
import { createCastle, CASTLE_BEACON_ANCHOR_METRES, createHome, type StyleKey } from '@chatdom/content';
import type { HomeTier, Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { WaterBody } from '@chatdom/world';
import { createLilies, createReeds } from '../../../../../../packages/content/src/places/water/shore/index';

export const SIMULATED_LAKE = 'SIMULATED · WATER SURFACE BENCH · fixture lake and town, simulated presence';

const CELL = 0.125;
export interface LakePlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly slot?: number }
export interface LakeView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }

export interface LakeFixture {
  readonly label: string;
  readonly ground: { readonly origin: [number, number]; readonly step: number; readonly width: number; readonly depth: number; readonly data: Float32Array };
  readonly body: WaterBody;
  readonly placements: readonly LakePlacement[];
  /** Homes with a presence window, by slot; `present` slots are lit in the SIMULATED evening. */
  readonly homes: readonly { readonly slot: number; readonly present: boolean }[];
  readonly beacon: Vec3;
  readonly views: Readonly<Record<'lake-postcard', { readonly wide: LakeView; readonly tall: LakeView }>>;
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const LAKE: WaterBody = { id: 'lake', x: 0, z: 0, radiusX: 34, radiusZ: 22, level: 0, depth: 2.4 };
const KEEP = { x: -10, z: -96 } as const;
/** Lakeside row then the higher row: tier, style, x, z (front edge). Slots follow this order. */
const ROWS: readonly (readonly [HomeTier, StyleKey, number, number])[] = [
  ['cottage', 'hearth', -31, -26.5], ['house', 'tide', -21.5, -27.5], ['hut', 'grove', -12.5, -28], ['house', 'hearth', -3.5, -28.5],
  ['manor', 'tide', 6.5, -28], ['cottage', 'grove', 16.5, -27.5], ['house', 'hearth', 26, -26.5],
  ['house', 'grove', -26, -44], ['cottage', 'tide', -16, -46], ['house', 'hearth', -6, -47], ['hall', 'grove', 5, -47], ['cottage', 'tide', 16.5, -45],
];
/** Dark homes in the SIMULATED evening: not everyone is in. */
const AWAY = new Set([2, 9]);

export function lakeFixture(): LakeFixture {
  const homes = ROWS.map(([tier, style, x, z], slot) => {
    const blueprint = createHome(tier, style, slot);
    const [w, , d] = blueprint.size.map(v => v * CELL) as [number, number, number];
    return { slot, blueprint, x0: x - w / 2, z0: z - d, w, d };
  });
  const keep = createCastle('tide'), [kw, , kd] = keep.size.map(v => v * CELL) as [number, number, number];

  const land = (x: number, z: number): number => {
    const e = Math.hypot((x - LAKE.x) / LAKE.radiusX, (z - LAKE.z) / LAKE.radiusZ);
    let h = 0.35 + 1.15 * smooth(1, 1.35, e) + 0.07 * Math.sin(x * 0.41 + z * 0.23) + 0.05 * Math.sin(z * 0.31 - x * 0.17);
    // The far bank climbs in two terraces to the castle hill.
    h += 1.6 * smooth(-36, -42, z) + 9.5 * smooth(-52, -82, z) * Math.exp(-(((x - KEEP.x) / 46) ** 2));
    if (e < 1.12) {
      // A shelving bed: shallow margins, deepest toward the middle, meeting the bank at the outline.
      const bed = LAKE.level - LAKE.depth * Math.pow(Math.max(0, 1 - e * e), 0.75) - 0.06 * smooth(0.8, 1, e) * (1 - smooth(1, 1.12, e));
      h = e < 1 ? Math.min(h, bed) : lerp(Math.min(h, bed + 0.02), h, smooth(1, 1.12, e));
    }
    return h;
  };
  const flats: { x0: number; x1: number; z0: number; z1: number; y: number }[] = [];
  const height = (x: number, z: number): number => {
    let h = land(x, z);
    for (const f of flats) {
      const out = Math.hypot(Math.max(0, f.x0 - x, x - f.x1), Math.max(0, f.z0 - z, z - f.z1));
      if (out < 2.5) h = lerp(f.y - 0.03, h, smooth(0, 2.5, out));
    }
    return h;
  };
  // Each home and the keep stand on their own levelled plot, at the lowest corner of the land under them.
  const plots = homes.map(home => {
    const y = Math.min(...[[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]].map(([u, v]) => land(home.x0 + u! * home.w, home.z0 + v! * home.d)));
    flats.push({ x0: home.x0, x1: home.x0 + home.w, z0: home.z0, z1: home.z0 + home.d, y });
    return y;
  });
  const keepX0 = KEEP.x - kw / 2, keepZ0 = KEEP.z - kd / 2;
  const keepY = Math.min(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => land(keepX0 + u! * kw, keepZ0 + v! * kd)));
  flats.push({ x0: keepX0, x1: keepX0 + kw, z0: keepZ0, z1: keepZ0 + kd, y: keepY });

  const step = 0.5, origin: [number, number] = [-60, -116];
  const width = 120 / step + 1, depth = (116 + 46) / step + 1;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = height(origin[0] + i * step, origin[1] + k * step);

  const placements: LakePlacement[] = homes.map((home, i) => ({ id: `home-${home.slot}`, blueprint: home.blueprint, origin: [home.x0, plots[i]!, home.z0], slot: home.slot }));
  placements.push({ id: 'keep', blueprint: keep, origin: [keepX0, keepY, keepZ0] });
  // Reeds at the near bank frame the water in front of the citizen; lilies rest in the calm margin.
  const reeds: readonly [number, number, number][] = [[-14, 21.4, 0], [-9.5, 22.3, 1], [9, 22.2, 2], [15.5, 21, 0], [-24, 16.8, 1], [24.5, 15.5, 2]];
  reeds.forEach(([x, z, v], i) => {
    const piece = createReeds(i % 2 ? 'grove' : 'hearth', v), [sx, , sz] = piece.blueprint.size;
    placements.push({ id: `reeds-${i}`, blueprint: piece.blueprint, origin: [x - (sx * CELL) / 2, height(x, z) - 0.05, z - (sz * CELL) / 2] });
  });
  const lilies: readonly [number, number, number][] = [[-18, 15, 0], [12.5, 17.2, 1], [21, 10.5, 2]];
  lilies.forEach(([x, z, v], i) => {
    const piece = createLilies(i % 2 ? 'hearth' : 'grove', v), [sx, , sz] = piece.blueprint.size;
    placements.push({ id: `lilies-${i}`, blueprint: piece.blueprint, origin: [x - (sx * CELL) / 2, LAKE.level + 0.01, z - (sz * CELL) / 2] });
  });

  const beacon: Vec3 = [keepX0 + CASTLE_BEACON_ANCHOR_METRES[0], keepY + CASTLE_BEACON_ANCHOR_METRES[1], keepZ0 + CASTLE_BEACON_ANCHOR_METRES[2]];
  // The citizen stands on the near bank at eye height; water in front, roofs across the middle, keep and beacon high.
  const stand = (x: number, z: number, eye: number): Vec3 => [x, height(x, z) + eye, z];
  return {
    label: SIMULATED_LAKE,
    ground: { origin, step, width, depth, data },
    body: LAKE, placements,
    homes: homes.map(home => ({ slot: home.slot, present: !AWAY.has(home.slot) })),
    beacon,
    views: {
      'lake-postcard': {
        wide: { eye: stand(-2, 27.5, 1.6), target: [3, 6.5, -40], fov: 52 },
        tall: { eye: stand(-1, 30, 1.6), target: [-2, 9.5, -40], fov: 66 },
      },
    },
    shadowBounds: { min: [origin[0], -3, origin[1]], max: [origin[0] + (width - 1) * step, 45, origin[1] + (depth - 1) * step] },
  };
}
