import { hashString, rng } from './noise';
import { GRAND_REGION, type GrandCharacter, type GrandLandSeed } from './types';
import type { GenesisTier, GenesisBiome } from '../genesis/contracts';
import type { GrandPaletteStyle, StoneFamily, GrassSeason } from './palette';
import { worldGroves, type GrandLandform } from './world';

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
  /** `grand-land-2` only: the world's large form. Absent on a `grand-land-1` plan, which keeps its exact bytes. */
  readonly landform?: GrandLandform;
  /** Highland: the land rises behind the town toward +v, `height` cells between v/radiusV = from and to. */
  readonly plateau?: { readonly height: number; readonly from: number; readonly to: number };
  /** Lake country: more basins beside the mere, carved the same way. */
  readonly meres?: readonly { readonly u: number; readonly v: number; readonly radius: number; readonly depth: number }[];
}

const SIZES: Record<GenesisTier, number> = { hamlet: 1280, village: 1280, town: 1536, city: 1536, capital: 1792 };

export function planGrandLand(seed: GrandLandSeed): GrandPlan {
  const base = hashString(`grand-land-1/${seed.seedKey}`);
  const r = rng(base);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(r() * items.length)]!;
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  if (seed.minSize !== undefined && (!Number.isSafeInteger(seed.minSize) || seed.minSize <= 0)) {
    throw new Error('Grand land minimum size must be a positive safe integer');
  }
  const size = Math.max(SIZES[seed.tier], Math.ceil((seed.minSize ?? 0) / GRAND_REGION) * GRAND_REGION);
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
  const plan: GrandPlan = {
    size, height: 384, seaLevel, seed: base, rotation: between(0, Math.PI * 2), mirror: r() < 0.5 ? 1 : -1,
    radiusU, radiusV, harmonics, bay, cliffCoast, islets, spines, jag: character === 'mountain-pass' ? between(24, 30) : between(16, 24),
    hills: biome === 'meadow' ? between(10, 14) : between(13, 20),
    castle, town, fields, forest, mere, seaStacks: 3 + Math.floor(r() * 4) + (biome === 'coastal' ? 3 : 0),
    snowline: seaLevel + peak * between(0.7, 0.78), treeline: seaLevel + peak * between(0.52, 0.6),
    groves, heroTrees: heroCount, treeTarget: Math.round((size * size) / 1536 / 1536 * (biome === 'woodland' ? 5600 : biome === 'meadow' ? 3800 : 4600)),
    style: { stone, grass, hueDrift: between(-1, 1), autumn: between(0.2, 1) },
  };
  return seed.world ? shapeWorld(plan, seed) : plan;
}

/**
 * `grand-land-2`: give the island plan the channel's own large form. It draws from its own random stream, so the
 * `grand-land-1` plan above (and every land already raised from it) never changes. Every landform keeps what a town
 * needs: dry gentle ground between a castle rock and a sheltered bay that opens toward -v, and the sea beyond it.
 */
function shapeWorld(plan: GrandPlan, seed: GrandLandSeed): GrandPlan {
  const world = seed.world!;
  const r = rng(hashString(`grand-land-2/${seed.seedKey}/${world.landform}`));
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const { size, seaLevel } = plan;
  const groves = worldGroves(world, plan.groves);
  const peakOf = (spines: GrandPlan['spines']) => Math.max(...spines.map(spine => spine.peak));
  const base: GrandPlan = { ...plan, landform: world.landform, groves };
  switch (world.landform) {
    case 'island': return base;
    case 'cliff-coast': {
      // Most of the shore stands as a wall of strata over the sea; the town keeps one cove.
      return { ...base, radiusV: plan.radiusV * 1.08,
        cliffCoast: { angle: Math.PI / 2 + between(-0.5, 0.5), width: between(1.25, 1.6), height: between(44, 60) },
        bay: { angle: plan.bay.angle, depth: between(0.14, 0.2), width: between(0.14, 0.19) },
        seaStacks: plan.seaStacks + 6 + Math.floor(r() * 4) };
    }
    case 'mountain-valley': {
      // A horseshoe of ranges around the town's valley, open to the sea through the bay in front of it.
      const radiusU = plan.radiusU * 1.04, radiusV = plan.radiusV * 1.24, peak = peakOf(plan.spines);
      const back = radiusV * between(0.58, 0.68), arm = radiusU * between(0.74, 0.84), width = radiusV * between(0.4, 0.48);
      const wobble = () => radiusV * between(-0.06, 0.06);
      const spines: GrandPlan['spines'][number][] = [
        { points: [[-arm, back + wobble()], [-arm * 0.4, back * 1.08 + wobble()], [arm * 0.35, back + wobble()], [arm, back * 0.94 + wobble()]], width, peak },
        { points: [[-arm * 1.04, back * 0.9], [-arm * 1.02, -radiusV * 0.2 + wobble()], [-arm * 0.9, -radiusV * between(0.62, 0.78)]], width: width * 0.86, peak: peak * between(0.74, 0.88) },
        { points: [[arm * 1.03, back * 0.86], [arm * 1.0, -radiusV * 0.16 + wobble()], [arm * 0.86, -radiusV * between(0.58, 0.74)]], width: width * 0.82, peak: peak * between(0.7, 0.86) },
      ];
      const castleU = plan.castle.u;
      return { ...base, radiusU, radiusV, spines,
        bay: { angle: plan.bay.angle, depth: between(0.38, 0.46), width: between(0.18, 0.24) },
        castle: { ...plan.castle, u: castleU, v: radiusV * between(0.08, 0.18) },
        town: { ...plan.town, u: castleU + radiusU * between(0.05, 0.12), v: -radiusV * between(0.16, 0.24) },
        fields: { u: radiusU * between(0.28, 0.4), v: radiusV * between(0.12, 0.26), radius: plan.fields.radius * 0.9 },
        forest: { ...plan.forest, u: -radiusU * between(0.42, 0.55), v: radiusV * between(0.0, 0.2) },
        mere: { u: radiusU * between(-0.12, 0.12), v: back * between(0.55, 0.7), radius: size * between(0.035, 0.05), depth: between(8, 12) } };
    }
    case 'river-delta': {
      // Low country running out into a wide shallow bay, broken into islands where the rivers reach the sea.
      const spines = plan.spines.map(spine => ({ ...spine, peak: spine.peak * between(0.55, 0.66),
        points: spine.points.map(([u, v]) => [u, v * 1.18] as const) }));
      const bay = { angle: plan.bay.angle, depth: between(0.4, 0.48), width: between(0.4, 0.5) };
      const islets: GrandPlan['islets'][number][] = [...plan.islets];
      // Small islands with channels between them, not one new shore: each keeps clear of the others.
      const count = 8 + Math.floor(r() * 4), delta: { u: number; v: number; r: number }[] = [];
      for (let attempt = 0; attempt < 120 && delta.length < count; attempt++) {
        const a = bay.angle + between(-0.9, 0.9) * bay.width, rho = 1 - bay.depth * between(-0.15, 0.8), radius = size * between(0.007, 0.013);
        const u = Math.cos(a) * plan.radiusU * rho, v = Math.sin(a) * plan.radiusV * rho;
        if (delta.every(other => Math.hypot(u - other.u, v - other.v) > (radius + other.r) * 1.9)) delta.push({ u, v, r: radius });
      }
      for (const islet of delta) islets.push({ ...islet, h: between(2, 5) });
      // Snow only on the few highest crowns: the snowline keeps the island's height while the ranges sink.
      const peak = peakOf(plan.spines);
      return { ...base, spines, bay, islets, hills: between(6, 9), jag: plan.jag * 0.8,
        town: { ...plan.town, level: seaLevel + between(5, 7) },
        fields: { ...plan.fields, radius: plan.fields.radius * 1.3 },
        mere: { ...plan.mere, radius: plan.mere.radius * 1.15 },
        snowline: seaLevel + peak * between(0.74, 0.8), treeline: seaLevel + peak * between(0.56, 0.62) };
    }
    case 'lake-country': {
      // Rolling wooded hills holding a chain of lakes; the mere is the largest of them.
      const spines = plan.spines.map(spine => ({ ...spine, peak: spine.peak * between(0.8, 0.9) }));
      const mere = { ...plan.mere, radius: plan.mere.radius * 1.25 };
      const meres: { u: number; v: number; radius: number; depth: number }[] = [];
      const want = 3 + Math.floor(r() * 2);
      const clear = (u: number, v: number, radius: number) => {
        const away = (pu: number, pv: number, reach: number) => Math.hypot(u - pu, v - pv) > reach + radius;
        return away(plan.town.u, plan.town.v, Math.max(plan.town.ru, plan.town.rv) * 1.5)
          && away(plan.castle.u, plan.castle.v, plan.castle.radius * 2.6)
          && away(plan.fields.u, plan.fields.v, plan.fields.radius * 1.1)
          && away(mere.u, mere.v, mere.radius * 1.6)
          && meres.every(other => away(other.u, other.v, other.radius + size * 0.06));
      };
      for (let attempt = 0; attempt < 200 && meres.length < want; attempt++) {
        const u = plan.radiusU * between(-0.72, 0.72), v = plan.radiusV * between(-0.55, 0.62), radius = size * between(0.026, 0.042);
        if (Math.hypot(u / plan.radiusU, v / plan.radiusV) < 0.78 && clear(u, v, radius)) meres.push({ u, v, radius, depth: between(7, 11) });
      }
      return { ...base, spines, mere, meres, hills: between(18, 24) };
    }
    case 'highland': {
      // The land climbs behind the town onto a high moor under taller ranges.
      const plateau = { height: between(18, 26), from: between(-0.2, -0.08), to: between(0.25, 0.4) };
      const lift = Math.min(1.1, (370 - seaLevel - plateau.height) / 1.6 / peakOf(plan.spines));
      const spines = plan.spines.map(spine => ({ ...spine, peak: spine.peak * lift }));
      if (spines.length < 2) spines.push({ points: [[plan.radiusU * 0.25, plan.radiusV * 0.32], [plan.radiusU * 0.6, plan.radiusV * 0.42], [plan.radiusU * 0.92, plan.radiusV * 0.18]], width: plan.radiusV * 0.4, peak: peakOf(spines) * between(0.62, 0.74) });
      const peak = peakOf(spines);
      return { ...base, spines, plateau, hills: between(16, 22),
        snowline: seaLevel + plateau.height + peak * between(0.6, 0.66), treeline: seaLevel + plateau.height + peak * between(0.38, 0.46) };
    }
  }
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
