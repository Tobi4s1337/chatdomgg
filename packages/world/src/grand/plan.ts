import { hashString, rng } from './noise';
import type { GrandCharacter, GrandLandSeed } from './types';
import type { GenesisTier, GenesisBiome } from '../genesis/contracts';
import type { GrandPaletteStyle, StoneFamily, GrassSeason } from './palette';

/**
 * The authored macro layout. Fully procedural macro land reads as noise soup; a composed island reads as a
 * place. The plan fixes one island, one mountain spine, a castle rock at its foot, a town flat between the
 * rock and a harbour bay, a patchwork of fields to one side, forest to the other and a mere, then lets
 * erosion, rivers and noise fill it in. Everything is in voxels in an island frame (u along the long axis,
 * v across, harbour toward -v) rotated into the world by `rotation`.
 */
export interface GrandPlan {
  readonly size: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly seed: number;
  readonly rotation: number;
  /** u is mirrored for half the kingdoms, so fields sit left or right of the castle. */
  readonly mirror: 1 | -1;
  readonly radiusU: number;
  readonly radiusV: number;
  /** Polar harmonics of the coast: amplitude and phase for k = 2..6. */
  readonly harmonics: readonly { readonly k: number; readonly a: number; readonly phase: number }[];
  readonly bay: { readonly angle: number; readonly depth: number; readonly width: number };
  readonly cliffCoast: { readonly angle: number; readonly width: number; readonly height: number };
  readonly islets: readonly { readonly u: number; readonly v: number; readonly r: number; readonly h: number }[];
  /** Mountain spines as polylines in island-frame voxels, each with a peak height above the sea. */
  readonly spines: readonly { readonly points: readonly (readonly [number, number])[]; readonly width: number; readonly peak: number }[];
  readonly jag: number;
  readonly hills: number;
  readonly castle: { readonly u: number; readonly v: number; readonly radius: number; readonly top: number };
  readonly town: { readonly u: number; readonly v: number; readonly ru: number; readonly rv: number; readonly level: number };
  readonly fields: { readonly u: number; readonly v: number; readonly radius: number };
  readonly forest: { readonly u: number; readonly v: number; readonly radius: number; readonly density: number };
  readonly mere: { readonly u: number; readonly v: number; readonly radius: number; readonly depth: number };
  readonly seaStacks: number;
  readonly snowline: number;
  readonly treeline: number;
  /** Relative species weights for this land's groves. */
  readonly groves: Readonly<Record<string, number>>;
  readonly heroTrees: number;
  readonly treeTarget: number;
  readonly style: GrandPaletteStyle;
}

const SIZES: Record<GenesisTier, number> = { hamlet: 1280, village: 1280, town: 1536, city: 1536, capital: 1792 };

export function planGrandLand(seed: GrandLandSeed): GrandPlan {
  const base = hashString(`grand-land-1/${seed.seedKey}`);
  const r = rng(base);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(r() * items.length)]!;
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const size = SIZES[seed.tier];
  const seaLevel = 48;
  const character: GrandCharacter = seed.character;
  const biome: GenesisBiome = seed.biome;
  const radiusU = size * between(0.36, 0.41);
  const radiusV = size * between(0.27, 0.32);
  const harmonics = [2, 3, 4, 5, 6].map(k => ({ k, a: between(0.02, 0.085) / Math.sqrt(k - 1), phase: between(0, Math.PI * 2) }));
  // The bay opens toward the front (-v), slightly off the axis, so the town and harbour face the default view.
  const bayAngle = -Math.PI / 2 + between(-0.35, 0.35);
  const bay = { angle: bayAngle, depth: character === 'coastal-harbour' ? between(0.2, 0.28) : between(0.11, 0.17), width: between(0.2, 0.3) };
  const cliffCoast = { angle: Math.PI / 2 + between(-1.1, 1.1), width: between(0.55, 0.9), height: between(18, 34) };

  const highland = biome === 'highland' ? 1.12 : 1;
  // Nominal peaks above the sea, in cells; crest, needles and relief add up to ~60 %, which must stay under
  // the 384-cell world (no clipped tops).
  const peak = (character === 'mountain-pass' ? between(150, 175) : character === 'river-valley' ? between(130, 150) : between(115, 138)) * highland;
  const spineV = radiusV * between(0.42, 0.55);
  const meander = () => radiusV * between(-0.12, 0.12);
  const spines: GrandPlan['spines'][number][] = [];
  if (character === 'mountain-pass') {
    // Two massifs and the saddle between them; the castle keeps the pass.
    spines.push({ points: [[-radiusU * 0.95, spineV + meander()], [-radiusU * 0.55, spineV * 0.9 + meander()], [-radiusU * 0.16, spineV + meander()]], width: radiusV * 0.68, peak });
    spines.push({ points: [[radiusU * 0.14, spineV + meander()], [radiusU * 0.55, spineV * 1.05 + meander()], [radiusU * 0.98, spineV * 0.8 + meander()]], width: radiusV * 0.62, peak: peak * between(0.86, 0.98) });
  } else {
    const start = -radiusU * between(0.85, 1.0), end = radiusU * between(0.35, 0.7);
    const points: [number, number][] = [];
    for (let i = 0; i <= 4; i++) points.push([start + (end - start) * i / 4, spineV + meander() + (i === 2 ? radiusV * 0.06 : 0)]);
    spines.push({ points, width: radiusV * (character === 'river-valley' ? 0.6 : 0.68), peak });
    if (r() < 0.6) spines.push({ points: [[radiusU * 0.6, radiusV * 0.35], [radiusU * 0.92, radiusV * 0.05]], width: radiusV * 0.42, peak: peak * 0.55 });
  }
  const castleU = character === 'mountain-pass' ? between(-0.05, 0.05) * radiusU : between(-0.2, 0.08) * radiusU;
  const castle = { u: castleU, v: spineV * between(0.36, 0.48), radius: size * between(0.055, 0.066), top: seaLevel + between(46, 62) };
  const town = { u: castleU + radiusU * between(0.05, 0.16), v: -radiusV * between(0.2, 0.3), ru: size * between(0.12, 0.15), rv: size * between(0.08, 0.1), level: seaLevel + between(6, 10) };
  const fields = { u: radiusU * between(0.42, 0.55), v: -radiusV * between(0.0, 0.15), radius: size * (biome === 'meadow' ? between(0.15, 0.18) : between(0.11, 0.14)) };
  const forest = { u: -radiusU * between(0.45, 0.6), v: -radiusV * between(0.0, 0.25), radius: size * between(0.17, 0.22), density: biome === 'woodland' ? 1.25 : biome === 'meadow' ? 0.8 : 1 };
  const mere = character === 'river-valley'
    ? { u: radiusU * between(0.12, 0.28), v: radiusV * between(0.02, 0.14), radius: size * between(0.04, 0.055), depth: between(8, 12) }
    : { u: radiusU * between(0.2, 0.34), v: radiusV * between(0.14, 0.26), radius: size * between(0.03, 0.045), depth: between(7, 10) };
  const islets: GrandPlan['islets'][number][] = [];
  const isletCount = (biome === 'coastal' || character === 'coastal-harbour' ? 3 : 1) + Math.floor(r() * 2);
  for (let i = 0; i < isletCount; i++) {
    const a = between(0, Math.PI * 2);
    islets.push({ u: Math.cos(a) * radiusU * between(1.08, 1.2), v: Math.sin(a) * radiusV * between(1.12, 1.3), r: size * between(0.012, 0.03), h: between(6, 26) });
  }
  const stone: StoneFamily = biome === 'highland' ? pick(['granite', 'slate', 'sandstone'] as const)
    : biome === 'coastal' ? pick(['chalk', 'sandstone', 'granite'] as const)
      : pick(['sandstone', 'sandstone', 'granite', 'chalk', 'slate'] as const);
  const grass: GrassSeason = biome === 'highland' ? 'highland' : biome === 'meadow' ? pick(['spring', 'summer'] as const) : pick(['spring', 'summer', 'late'] as const);
  const groves: Record<string, number> = {
    oak: 1, lime: 0.7, birch: 0.35, 'autumn-gold': 0.55, 'autumn-red': 0.35, cherry: 0.18, teal: 0.12, willow: 0.12, pine: 0.4, spruce: 0.3,
  };
  if (biome === 'woodland') { groves.teal = 0.3; groves['autumn-gold'] = 0.75; groves.oak = 1.2; }
  if (biome === 'highland') { groves.pine = 0.9; groves.spruce = 0.8; groves.birch = 0.55; groves.cherry = 0.08; }
  if (biome === 'meadow') { groves.cherry = 0.3; groves.lime = 0.9; }
  if (biome === 'coastal') { groves.pine = 0.6; groves.willow = 0.18; }
  const heroCount = 1 + Math.floor(r() * 2) + (biome === 'woodland' ? 1 : 0);
  return {
    size, height: 384, seaLevel, seed: base, rotation: between(0, Math.PI * 2), mirror: r() < 0.5 ? 1 : -1,
    radiusU, radiusV, harmonics, bay, cliffCoast, islets, spines, jag: character === 'mountain-pass' ? between(24, 30) : between(16, 24),
    hills: biome === 'meadow' ? between(10, 14) : between(13, 20),
    castle, town, fields, forest, mere, seaStacks: 3 + Math.floor(r() * 4) + (biome === 'coastal' ? 3 : 0),
    snowline: seaLevel + peak * between(0.7, 0.78), treeline: seaLevel + peak * between(0.52, 0.6),
    groves, heroTrees: heroCount, treeTarget: Math.round((size * size) / 1536 / 1536 * (biome === 'woodland' ? 5600 : biome === 'meadow' ? 3800 : 4600)),
    style: { stone, grass, hueDrift: between(-1, 1), autumn: between(0.2, 1) },
  };
}

/** World column → island frame. */
export function toIsland(plan: GrandPlan, x: number, z: number): [number, number] {
  const c = plan.size / 2, dx = x - c, dz = z - c;
  const cos = Math.cos(plan.rotation), sin = Math.sin(plan.rotation);
  return [(dx * cos + dz * sin) * plan.mirror, -dx * sin + dz * cos];
}
/** Island frame → world column. */
export function toWorld(plan: GrandPlan, u: number, v: number): [number, number] {
  const c = plan.size / 2, uu = u * plan.mirror;
  const cos = Math.cos(plan.rotation), sin = Math.sin(plan.rotation);
  return [c + uu * cos - v * sin, c + uu * sin + v * cos];
}
