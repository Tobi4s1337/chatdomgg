import { MAT } from '../materials';
import type { StyleKey } from '../materials';
import { add, bough, heading, mossWood, patch, roots, shadeCrown } from './grow';
import { between, FOLIAGE, Sculpt, type V3 } from './sculpt';

/** What a grower hands back besides its cells: where the crown begins and ends, in build cells above the root. */
export interface Growth { sculpt: Sculpt; crown: { base: number; top: number } }
export type Grower = (r: () => number, style: StyleKey, variant: number, seed: number) => Growth;

interface Tones { body: number; lit: number; shade?: number; accent?: number }
const FOLIAGE_TONES = new Set<number>([...FOLIAGE, MAT.thatch]);

/**
 * Broad branched oak: a short stout bole, three or four heavy limbs thrown out wide, and a crown of separate leafy
 * pads at their tips with sky between them. The pads overlap the limbs, so wood shows where it enters the crown.
 */
const OAK_TONES: Record<StyleKey, readonly [Tones, Tones]> = {
  // Hearth and Grove oaks alternate: a deep summer green, and a lighter oak whose sunlit caps run to honey.
  hearth: [{ body: MAT.grass, lit: MAT.moss, shade: MAT.leaf }, { body: MAT.moss, lit: MAT.goldLeaf, shade: MAT.grass }],
  tide: [{ body: MAT.leaf, lit: MAT.moss, shade: MAT.leaf }, { body: MAT.grass, lit: MAT.moss, shade: MAT.leaf }],
  grove: [{ body: MAT.grass, lit: MAT.moss, shade: MAT.leaf }, { body: MAT.moss, lit: MAT.goldLeaf, shade: MAT.grass }],
};
export const growOak: Grower = (r, style, variant, seed) => {
  const s = new Sculpt(96, 112, 96), tones = OAK_TONES[style][variant % 2]!;
  const fork = Math.round(between(r, 22, 28)), lean = r() * Math.PI * 2;
  roots(s, r, 5, 4.4, 13);
  const bole = bough(s, r, [0, 0, 0], [Math.cos(lean) * 0.08, 1, Math.sin(lean) * 0.08], fork, 4.4, 3.4, { segments: 3, wander: 0.05 });
  const limbs = 3 + (variant % 2), turn = r() * Math.PI * 2, pads: { at: V3; size: number }[] = [];
  for (let i = 0; i < limbs; i++) {
    const azimuth = turn + (i / limbs) * Math.PI * 2 + between(r, -0.3, 0.3);
    const limb = bough(s, r, add(bole.end, [0, -3, 0]), heading(azimuth, between(r, 0.55, 0.9)), between(r, 18, 24), 3.0, 1.7, { segments: 4, rise: 0.04, wander: 0.1 });
    // A pad over the limb's middle fills the crown; the twigs beyond carry the outer pads.
    pads.push({ at: add(limb.joints[2]!, [0, 6, 0]), size: 0.8 });
    for (const side of [-1, 1]) {
      const twig = bough(s, r, limb.end, heading(azimuth + side * between(r, 0.35, 0.65), between(r, 0.5, 0.95)), between(r, 8, 12), 1.6, 0.9, { segments: 2, rise: 0.05, wander: 0.1 });
      pads.push({ at: add(twig.end, [0, 3, 0]), size: between(r, 0.85, 1) });
    }
  }
  const leader = bough(s, r, bole.end, [between(r, -0.1, 0.1), 1, between(r, -0.1, 0.1)], between(r, 28, 34), 2.6, 1.2, { segments: 3, wander: 0.06 });
  // The crown's dome: the leader's own head and two shoulders below it.
  pads.push({ at: add(leader.end, [0, 1, 0]), size: 1 });
  for (const side of [0, 1]) {
    const a = turn + Math.PI / limbs + side * Math.PI;
    pads.push({ at: add(leader.joints[2]!, [Math.cos(a) * 9, 2, Math.sin(a) * 9]), size: 0.9 });
  }
  pads.forEach(pad => {
    const rx = between(r, 10.5, 12.5) * pad.size;
    s.clump(pad.at, rx, rx * between(r, 0.68, 0.8), rx * between(r, 0.85, 1.1), tones.body, r, 0.6);
  });
  const crown = { base: fork, top: s.extent().top };
  shadeCrown(s, FOLIAGE_TONES, tones, crown, seed);
  return { sculpt: s, crown };
};

/**
 * Tiered pine: a straight pole carrying stacked, drooping skirts of needles that narrow to a spire. Dark undersides
 * between the tiers give the silhouette its rhythm. Tide pines carry the sea wind in a one-sided lean.
 */
const PINE_TONES: Record<StyleKey, Tones> = {
  hearth: { body: MAT.leaf, lit: MAT.leaf },
  tide: { body: MAT.leaf, lit: MAT.leaf },
  grove: { body: MAT.leaf, lit: MAT.leaf },
};
/**
 * One pine bough: a flat, tapering spray of needles from the pole out to a drooping tip, two cells thick near the
 * pole and one block at the tip. A tier is a whorl of these, so its hem is toothed like real branches, not a disc.
 */
function frond(s: Sculpt, from: V3, azimuth: number, length: number, width: number, droop: number, m: number): void {
  const steps = Math.ceil(length / 1.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, w = Math.max(1.2, width * (1 - 0.75 * t));
    const x = from[0] + Math.cos(azimuth) * length * t, z = from[2] + Math.sin(azimuth) * length * t, y = from[1] - droop * t * t;
    const cx = x + s.cx, cz = z + s.cz;
    for (let bz = Math.floor((cz - w) / 2) * 2; bz <= cz + w; bz += 2) for (let bx = Math.floor((cx - w) / 2) * 2; bx <= cx + w; bx += 2) {
      if (Math.hypot(bx + 1 - cx, bz + 1 - cz) > w) continue;
      const by = Math.floor(y / 2) * 2;
      s.setBlock(bx, by, bz, m);
      if (t < 0.45) s.setBlock(bx, by + 2, bz, m);
    }
  }
}

export const growPine: Grower = (r, style, variant, seed) => {
  const s = new Sculpt(72, 88, 72), tones = PINE_TONES[style];
  const height = Math.round(between(r, 76, 84)), bend = style === 'tide' ? 0.14 + 0.05 * (variant % 2) : between(r, 0, 0.03);
  const wind = r() * Math.PI * 2, wx = Math.cos(wind), wz = Math.sin(wind);
  roots(s, r, 4, 3, 8);
  // The pole bends downwind only above head height, so the base stands plumb on its roots.
  const at = (y: number): V3 => { const t = y / height; return [wx * bend * height * t * t, y, wz * bend * height * t * t]; };
  for (let i = 0; i < 8; i++) s.limb(at(height * i / 8), at(height * (i + 1) / 8), 2.8 - 2.0 * (i / 8), 2.8 - 2.0 * ((i + 1) / 8), MAT.bark);
  // Broad whorled tiers narrowing upward, a dark band of pole between each, the top ones running into the spire.
  const tiers = 5 + (variant % 2), first = between(r, 15, 19), spire = height - 12, gap = (spire - first) / tiers, widest = between(r, 24, 27);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, y = first + gap * i + between(r, -1, 1), radius = widest * (1 - t * 0.8), centre = at(y + 3);
    const boughs = Math.max(5, Math.round(8 - i)), turn = r() * Math.PI * 2;
    for (let k = 0; k < boughs; k++) {
      const a = turn + (k / boughs) * Math.PI * 2 + between(r, -0.2, 0.2), length = radius * between(r, 0.85, 1.05);
      // Downwind boughs reach further on a tide pine, upwind ones are cut short by the weather.
      const weather = 1 + bend * 2.2 * (Math.cos(a) * wx + Math.sin(a) * wz);
      s.limb(centre, add(centre, [Math.cos(a) * length * weather * 0.6, -2, Math.sin(a) * length * weather * 0.6]), 1.1, 0.7, MAT.bark);
      frond(s, centre, a, length * weather, Math.max(3.2, radius * 0.32), 3 + radius * 0.16, tones.body);
    }
    s.clump(add(centre, [0, 2.5, 0]), radius * 0.38, 3.5, radius * 0.38, tones.body, r, 0.6);
  }
  // The spire: narrowing courses to a point.
  for (const [dy, radius] of [[0, 5], [4, 3.6], [8, 2.4], [11, 1.2]] as const) s.clump(at(spire + dy), radius, 2.5, radius, tones.body, r, 0.6);
  // One cool needle tone: lit tips scattered over every frond read as speckle, so the light alone models the tiers.
  void seed;
  return { sculpt: s, crown: { base: Math.round(first - 4), top: s.extent().top } };
};

/**
 * Light slender birch: a white stem (two from one root on some), dark lenticel dashes and a rough dark foot, short
 * thin branches angled up, and a loose airy crown of small pads with plenty of sky through it.
 */
const BIRCH_TONES: Record<StyleKey, Tones> = {
  // The Hearth birch is the warm note of its woods: a golden crown over a white stem.
  hearth: { body: MAT.goldLeaf, lit: MAT.goldLeaf },
  tide: { body: MAT.grass, lit: MAT.moss },
  grove: { body: MAT.moss, lit: MAT.goldLeaf },
};
export const growBirch: Grower = (r, style, variant, seed) => {
  const s = new Sculpt(48, 80, 48), tones = BIRCH_TONES[style];
  const stems = variant % 2 ? 2 : 1, splay = r() * Math.PI * 2;
  let top = 0;
  for (let i = 0; i < stems; i++) {
    const a = splay + i * Math.PI, out = stems > 1 ? 0.12 : 0.04, height = between(r, 58, 66) * (i ? 0.86 : 1);
    const stem = bough(s, r, [0, 0, 0], [Math.cos(a) * out, 1, Math.sin(a) * out], height, stems > 1 ? 1.7 : 2.1, 0.9, { segments: 6, wander: 0.05 }, MAT.cream);
    top = Math.max(top, stem.end[1]);
    // The crown: a narrow oval that hugs the upper stem, built from overlapping pads up the leader, widest a third
    // of the way up and drawn to a point. Short side sprays on thin branches break its edge and let sky through.
    // Pads sit closer than their own height, so the oval reads as one mass with a lumpy edge, never a stack.
    const base = stem.joints[2]![1], span = stem.end[1] - base, pads = 8, girth = stems > 1 ? 6 : 8;
    for (let k = 0; k <= pads; k++) {
      const t = k / pads, joint = stem.joints[Math.min(stem.joints.length - 1, 2 + Math.round(t * (stem.joints.length - 3)))]!;
      const width = girth * Math.sin(Math.PI * (0.12 + 0.8 * t)) + 2, wobble = between(r, 0, Math.PI * 2), off = between(r, 0, 1.6);
      s.clump([joint[0] + Math.cos(wobble) * off, base + span * 0.92 * t + 3, joint[2] + Math.sin(wobble) * off], width, 5, width * between(r, 0.85, 1.05), tones.body, r, 0.8);
    }
    const branches = (stems > 1 ? 3 : 5) + Math.floor(r() * 2);
    for (let k = 0; k < branches; k++) {
      const joint = stem.joints[2 + Math.floor((k / branches) * 3)]!, side = a + k * 2.4 + between(r, -0.3, 0.3);
      const twig = bough(s, r, joint, heading(side, between(r, 0.35, 0.7)), between(r, 8, 11), 1.0, 0.6, { segments: 2, rise: -0.04, wander: 0.08 }, MAT.cream);
      const spray = between(r, 3.5, 4.5);
      s.clump(add(twig.end, [0, 0.5, 0]), spray, spray * 0.8, spray, tones.body, r, 0.7);
    }
    s.clump(add(stem.end, [0, 2, 0]), 2.5, 4, 2.5, tones.body, r, 0.7);
  }
  // Bark: a rough dark foot, then short horizontal lenticel dashes up the white stem.
  for (let z = 0; z < s.d; z++) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (s.get(x, y, z) !== MAT.cream) continue;
    if (y < 5 + Math.floor(patch(seed, x, 0, z, 2) * 4)) s.set(x, y, z, MAT.bark);
    else if (y % 4 === 1 && patch(seed, x * 2, y, z * 2, 3) > 0.62) s.set(x, y, z, MAT.darkStone);
  }
  roots(s, r, 3, 2.1, 5);
  const crown = { base: Math.round(top * 0.4), top: s.extent().top };
  shadeCrown(s, FOLIAGE_TONES, tones, crown, seed, 0.5);
  return { sculpt: s, crown };
};

/**
 * Weeping willow for the water's edge: a thick leaning bole, arching limbs, a low dome, and long curtains of leaves
 * that fall from the dome's rim almost to the ground in sheets with gaps, so light and water show through.
 */
const WILLOW_TONES: Record<StyleKey, Tones> = {
  hearth: { body: MAT.moss, lit: MAT.moss, shade: MAT.grass },
  tide: { body: MAT.moss, lit: MAT.moss, shade: MAT.grass },
  grove: { body: MAT.moss, lit: MAT.moss, shade: MAT.grass },
};
export const growWillow: Grower = (r, style, variant, seed) => {
  const s = new Sculpt(96, 88, 96), tones = WILLOW_TONES[style];
  const fork = Math.round(between(r, 16, 20)), lean = r() * Math.PI * 2;
  roots(s, r, 5, 5, 13);
  const bole = bough(s, r, [0, 0, 0], [Math.cos(lean) * 0.25, 1, Math.sin(lean) * 0.25], fork, 5, 3.8, { segments: 3, wander: 0.08 });
  const limbs = 5 + (variant % 2), turn = r() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const azimuth = turn + (i / limbs) * Math.PI * 2 + between(r, -0.25, 0.25);
    const rise = bough(s, r, bole.end, heading(azimuth, between(r, 0.8, 1.05)), between(r, 18, 22), 2.8, 1.6, { segments: 3, wander: 0.08 });
    const arch = bough(s, r, rise.end, heading(azimuth, 0.45), between(r, 18, 22), 1.6, 0.9, { segments: 4, rise: -0.2, wander: 0.05 });
    // The dome follows each arch: a crown pad over the rise, softer pads along the fall.
    s.clump(add(rise.end, [0, 4, 0]), between(r, 9, 11), between(r, 8, 9.5), between(r, 9, 11), tones.body, r, 0.5);
    s.clump(add(arch.joints[2]!, [0, 2, 0]), between(r, 7.5, 9), 5.5, between(r, 7.5, 9), tones.body, r, 0.5);
    s.clump(add(arch.end, [0, 2, 0]), between(r, 5, 6.5), 4, between(r, 5, 6.5), tones.body, r, 0.5);
  }
  s.clump(add(bole.end, [0, 27, 0]), 12, 9, 12, tones.body, r, 0.55);
  const crown = { base: fork, top: s.extent().top };
  shadeCrown(s, FOLIAGE_TONES, { lit: tones.lit }, crown, seed, 0.4);
  // Curtains fall from the open underside of the dome's outer part. Neighbouring strands share a length from one
  // broad field, so they hang as sheets with a ragged hem; a few sectors stay open, where the bole shows through.
  const { half } = s.extent(), strands: [number, number, number][] = [], opening = r() * Math.PI * 2;
  for (let bz = 0; bz < s.d; bz += 2) for (let bx = 0; bx < s.w; bx += 2) {
    const dx = bx + 1 - s.cx, dz = bz + 1 - s.cz, radial = Math.hypot(dx, dz);
    if (radial < half * 0.45 || Math.sin(Math.atan2(dz, dx) * 3 + opening) > 0.6) continue;
    for (let by = 2; by < s.h; by += 2) {
      if (!FOLIAGE_TONES.has(s.block(bx, by, bz))) continue;
      if (patch(seed + 3, bx, 0, bz, 4) > 0.38) strands.push([bx, by, bz]);
      break;
    }
  }
  for (const [bx, by, bz] of strands) {
    const reach = Math.hypot(bx + 1 - s.cx, bz + 1 - s.cz) / half;
    const length = Math.round((12 + 34 * patch(seed + 5, bx, 0, bz, 6) * reach) / 2) * 2;
    for (let y = by - 2, n = 2; y >= Math.max(6, by - length); y -= 2, n += 2) {
      s.setBlock(bx, y, bz, n > length * 0.55 && patch(seed + 7, bx, y, bz, 6) > 0.45 ? tones.shade! : tones.body);
    }
  }
  return { sculpt: s, crown };
};

/**
 * A gnarled elder: a vast twisting bole with buttress roots and a hollow at its foot, massive limbs thrown out nearly
 * level, one bleached dead limb, moss in the bark, and a broken crown of heavy dark pads. Rare, and remembered.
 */
const ELDER_TONES: Record<StyleKey, Tones> = {
  hearth: { body: MAT.leaf, lit: MAT.grass, accent: MAT.goldLeaf },
  tide: { body: MAT.leaf, lit: MAT.moss },
  grove: { body: MAT.leaf, lit: MAT.moss, accent: MAT.goldLeaf },
};
export const growElder: Grower = (r, style, variant, seed) => {
  const s = new Sculpt(128, 128, 128), tones = ELDER_TONES[style];
  const fork = Math.round(between(r, 26, 32)), lean = r() * Math.PI * 2;
  roots(s, r, 7, 7.5, 22, MAT.bark, 2);
  const bole = bough(s, r, [0, 0, 0], [Math.cos(lean) * 0.15, 1, Math.sin(lean) * 0.15], fork, 7.8, 5.6, { segments: 4, wander: 0.16, grain: 2 });
  const limbs = 5, turn = r() * Math.PI * 2, dead = Math.floor(r() * limbs), pads: { at: V3; size: number }[] = [];
  for (let i = 0; i < limbs; i++) {
    const azimuth = turn + (i / limbs) * Math.PI * 2 + between(r, -0.3, 0.3);
    const limb = bough(s, r, add(bole.end, [0, -between(r, 2, 8), 0]), heading(azimuth, between(r, 0.3, 0.75)), between(r, 28, 36), 4.4, 2.2, { segments: 5, rise: 0.06, wander: 0.18, grain: 2 });
    if (i === dead && variant === 0) {
      // The dead limb: no leaves, its outer wood bleached pale, ending in a broken fork.
      for (const side of [-1, 1]) bough(s, r, limb.end, heading(azimuth + side * 0.6, 0.7), between(r, 7, 11), 1.6, 0.8, { segments: 2, wander: 0.2 }, MAT.limestone);
      for (let z = 0; z < s.d; z++) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (s.get(x, y, z) !== MAT.bark) continue;
        const px = x + 0.5 - s.cx - limb.joints[2]![0], pz = z + 0.5 - s.cz - limb.joints[2]![2];
        if ((px * Math.cos(azimuth) + pz * Math.sin(azimuth)) > 0 && Math.hypot(px, pz) < 26 && y > fork - 4) s.set(x, y, z, MAT.limestone);
      }
      continue;
    }
    for (const side of [-1, 1]) {
      const twig = bough(s, r, limb.end, heading(azimuth + side * between(r, 0.4, 0.8), between(r, 0.5, 0.95)), between(r, 10, 14), 2.2, 1.1, { segments: 2, wander: 0.15 });
      pads.push({ at: add(twig.end, [0, 3, 0]), size: between(r, 0.9, 1.05) });
    }
    pads.push({ at: add(limb.joints[3]!, [0, 7, 0]), size: 0.8 });
  }
  const leader = bough(s, r, bole.end, [between(r, -0.2, 0.2), 1, between(r, -0.2, 0.2)], between(r, 34, 40), 4, 1.8, { segments: 4, wander: 0.15, grain: 2 });
  pads.push({ at: add(leader.end, [0, 2, 0]), size: 1.1 });
  for (const side of [0, 1, 2]) {
    const a = turn + side * 2.1;
    pads.push({ at: add(leader.joints[2]!, [Math.cos(a) * 11, 4, Math.sin(a) * 11]), size: 0.95 });
  }
  const accent = tones.accent !== undefined ? Math.floor(r() * pads.length) : -1;
  pads.forEach((pad, i) => {
    const rx = between(r, 11.5, 14) * pad.size;
    s.clump(pad.at, rx, rx * between(r, 0.62, 0.74), rx * between(r, 0.8, 1.1), i === accent ? tones.accent! : tones.body, r, 0.55);
  });
  // The hollow at the foot of the bole, facing out between two roots.
  const h = turn + Math.PI / limbs, hx = Math.cos(h) * 6, hz = Math.sin(h) * 6;
  for (let z = 0; z < s.d; z++) for (let y = 1; y < 14; y++) for (let x = 0; x < s.w; x++) {
    const dx = x + 0.5 - s.cx - hx, dz = z + 0.5 - s.cz - hz, dy = (y - 6) / 7;
    if (dx * dx / 9 + dz * dz / 9 + dy * dy < 1 && s.get(x, y, z) === MAT.bark) s.set(x, y, z, y < 3 ? MAT.earth : MAT.air);
  }
  const crown = { base: fork, top: s.extent().top };
  shadeCrown(s, FOLIAGE_TONES, tones, crown, seed);
  mossWood(s, MAT.bark, MAT.moss, seed, 3, 0.4, 9);
  return { sculpt: s, crown };
};

export const GROWERS = { oak: growOak, pine: growPine, birch: growBirch, willow: growWillow, elder: growElder } as const;
