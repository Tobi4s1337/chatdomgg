import { CLAY, KitBuilder, random, type ArtisanKit } from '../kit';

/** Grand terrain cells are 0.5 m; y=0 is the still water surface. The ships point along +x. */
export function createShip(seedKey: string): ArtisanKit {
  const kit = new KitBuilder();
  const variation = random(`${seedKey}:ship`);
  const stripe = variation() < 0.5 ? CLAY.roof : CLAY.banner;
  // The hull is built in short longitudinal stations: a fuller beam, a tucked stern,
  // and a fine raised bow. The bottom begins below the water plane.
  for (let x = -25; x <= 25; x++) {
    const t = x / 26;
    const beam = Math.max(1, Math.round(7 * Math.pow(Math.max(0, 1 - t * t), 0.62)));
    const keel = -3 + Math.floor(2 * Math.abs(t));
    const sheer = 4 + Math.round(2 * t * t) + (x > 16 ? 1 : 0);
    for (let y = keel; y <= sheer; y++) {
      const bottomTuck = Math.max(0, Math.ceil((1 - y) / 2));
      const width = Math.max(1, beam - bottomTuck);
      const colour = y <= -1 ? CLAY.timber : y === 2 ? CLAY.timberLight : y === sheer ? CLAY.trim : CLAY.timber;
      kit.box(x, y, -width, 1, 1, width * 2 + 1, colour);
    }
  }
  // Open deck, raised stern cabin, and fine continuous gunwales.
  kit.box(-21, 5, -5, 42, 1, 11, CLAY.timberLight);
  kit.box(-22, 6, -5, 9, 5, 10, CLAY.timber);
  kit.box(-23, 11, -6, 11, 1, 12, CLAY.roofDark);
  kit.box(-21, 12, -5, 8, 1, 10, CLAY.roof);
  kit.box(-19, 8, -6, 3, 2, 1, CLAY.stoneDark);
  kit.box(-19, 8, 5, 3, 2, 1, CLAY.stoneDark);
  for (const z of [-7, 6]) {
    kit.box(-18, 6, z, 37, 1, 1, CLAY.timber);
    for (let x = -17; x <= 17; x += 5) kit.box(x, 7, z, 1, 2, 1, CLAY.timber);
    kit.box(-18, 9, z, 37, 1, 1, CLAY.timberLight);
  }
  // Two masts with long fore-and-aft canvas, banded and stepped at its edges.
  // Each cloth strip shares a face with its neighbour so it is a solid sail.
  for (const [mast, height, reach] of [[-5, 40, 14], [12, 32, 11]] as const) {
    kit.box(mast, 6, 0, 2, height - 5, 2, CLAY.timber);
    kit.box(mast - 1, height, -1, 4, 1, 4, CLAY.brass);
    kit.box(mast - 3, height - 2, 0, 7, 1, 1, CLAY.timber);
    const bottom = 12, top = height - 4;
    for (let y = bottom; y <= top; y++) {
      const p = (y - bottom) / (top - bottom);
      const left = mast - Math.round(reach * (0.35 + 0.65 * p));
      const right = mast - 1;
      kit.box(left, y, -1, right - left + 1, 1, 1, y === bottom + 5 || y === top - 3 ? stripe : CLAY.sail);
      // A weather side in warm shade gives the canvas fullness without noise.
      if (y > bottom + 2 && y < top - 1) kit.box(left, y, -2, 1, 1, 1, CLAY.trim);
    }
    kit.box(mast - reach - 1, top + 1, -1, reach + 2, 1, 2, CLAY.timberLight);
    kit.box(mast - reach - 1, bottom - 1, -1, reach + 2, 1, 2, CLAY.timberLight);
    kit.box(mast + 2, height - 1, 0, 5, 2, 1, stripe);
    kit.box(mast + 6, height - 1, 0, 2, 1, 1, stripe);
  }
  // Bowsprit and a small fore-stay, articulated as coherent steps.
  kit.box(22, 7, 0, 12, 1, 1, CLAY.timberLight);
  for (let i = 0; i < 12; i++) {
    const y = 8 + Math.floor(i / 3);
    // A one-cell riser joins each higher run to the previous horizontal run.
    kit.box(21 + i, y - (i > 0 && i % 3 === 0 ? 1 : 0), 0, 1, i > 0 && i % 3 === 0 ? 2 : 1, 1, CLAY.timber);
  }
  return kit.finish('harbour-ship', { waterline: [0, 0, 0], bow: [30, 6, 0], stern: [-25, 5, 0], deck: [0, 6, 0] });
}

/** A headland tower with warm carved stone, indigo roof and a non-emissive glazed lantern. */
export function createLighthouse(seedKey: string): ArtisanKit {
  const kit = new KitBuilder();
  const variation = random(`${seedKey}:lighthouse`);
  const crest = variation() < 0.5 ? CLAY.banner : CLAY.roofLight;
  // Octagonal courses with an inward batter. Broad foundation fits into graded land.
  for (let y = -3; y < 45; y++) {
    const radius = y < 2 ? 11 : y < 13 ? 9 : y < 29 ? 8 : 7;
    const colour = y < 0 ? CLAY.stoneDark : y % 8 === 0 ? CLAY.stoneLight : CLAY.stone;
    for (let z = -radius; z <= radius; z++) {
      const width = radius - Math.max(0, Math.abs(z) - Math.floor(radius * 0.55));
      // The ground floor has an open, continuous passage to a hollow interior.
      // Emit two runs around empty space instead of layering solids over it.
      const room = y >= 1 && y <= 42 && Math.abs(z) <= 5;
      const entry = y >= 1 && y <= 8 && z < -5;
      if (room || entry) {
        const left = room ? -5 : -2, right = room ? 5 : 1;
        kit.box(-width, y, z, left + width, 1, 1, colour);
        kit.box(right + 1, y, z, width - right, 1, 1, colour);
      } else {
        kit.box(-width, y, z, 2 * width + 1, 1, 1, colour);
      }
    }
  }
  kit.box(-10, 12, -2, 2, 22, 4, CLAY.stoneLight);
  kit.box(8, 12, -2, 2, 22, 4, CLAY.stoneLight);
  kit.box(-6, 12, -10, 3, 22, 2, CLAY.stoneLight);
  kit.box(3, 12, -10, 3, 22, 2, CLAY.stoneLight);
  kit.box(-2, 12, 8, 4, 22, 2, CLAY.stoneLight);
  // The opening remains empty all the way to the interior; no false interactive door.
  // Both jambs tie the projecting lintel back into the wall and down to the foundation.
  kit.box(-3, 1, -11, 1, 9, 3, CLAY.stoneLight);
  kit.box(2, 1, -11, 1, 9, 3, CLAY.stoneLight);
  kit.box(-3, 9, -11, 6, 1, 1, CLAY.trim);
  // Overhanging gallery and guardrails.
  kit.box(-10, 45, -10, 21, 2, 21, CLAY.stoneDark);
  kit.box(-11, 47, -11, 23, 1, 23, CLAY.trim);
  for (const v of [-10, 10]) {
    kit.box(v, 48, -10, 1, 4, 21, CLAY.timber);
    kit.box(-10, 48, v, 21, 4, 1, CLAY.timber);
    for (let p = -8; p <= 8; p += 4) {
      kit.box(v, 48, p, 1, 5, 1, CLAY.brass);
      kit.box(p, 48, v, 1, 5, 1, CLAY.brass);
    }
  }
  // Non-emissive sea glass and four structural mullions: a navigation landmark,
  // never a citizen window or a fabricated presence light.
  kit.box(-6, 48, -6, 13, 10, 13, '#88acb2');
  for (const x of [-7, 6]) for (const z of [-7, 6]) kit.box(x, 48, z, 2, 11, 2, CLAY.timber);
  kit.box(-7, 58, -7, 15, 2, 15, CLAY.trim);
  for (let y = 0; y < 8; y++) {
    const radius = Math.max(1, 8 - y);
    kit.box(-radius, 60 + y, -radius, 2 * radius + 1, 1, 2 * radius + 1, y < 3 ? CLAY.roof : CLAY.roofDark);
  }
  kit.box(-1, 68, -1, 3, 4, 3, CLAY.brass);
  kit.box(1, 69, 0, 7, 2, 1, crest);
  return kit.finish('harbour-lighthouse', { foundation: [0, 0, 0], entrance: [0, 1, -11], lantern: [0, 53, 0], top: [0, 72, 0] });
}

/** Quay and piers alone. Local y=0 is the water plane and +z points inland. */
export function createQuay(seedKey: string): ArtisanKit {
  void seedKey; // Reserved for independent material/style variation; geometry is stable.
  const kit = new KitBuilder();
  // Lower courses are submerged. Front is built as deliberately staggered stone blocks,
  // while the broad cap and inner mass merge into the builder's graded shoreline.
  kit.box(-60, -5, 3, 121, 11, 18, CLAY.stoneDark);
  for (let row = 0; row < 4; row++) {
    const y = -2 + row * 2;
    for (let x = -60 - (row % 2) * 3; x < 60; x += 7) {
      const lo = Math.max(-60, x), end = Math.min(61, x + 6);
      kit.box(lo, y, 2, end - lo, 2, 1, row % 2 ? CLAY.stone : CLAY.stoneLight);
    }
  }
  kit.box(-61, 6, 1, 123, 2, 22, CLAY.stoneLight);
  kit.box(-61, 8, 1, 123, 1, 2, CLAY.trim);
  // Planked finger piers extend over water, carried by timber pilings below the tide.
  for (const centre of [-34, 26]) {
    kit.box(centre - 5, 6, -32, 11, 2, 34, CLAY.timber);
    for (let z = -31; z < 2; z += 4) kit.box(centre - 5, 8, z, 11, 1, 3, CLAY.timberLight);
    for (const x of [centre - 4, centre + 3]) for (let z = -29; z <= -1; z += 9) {
      kit.box(x, -5, z, 2, 14, 2, CLAY.timber);
      kit.box(x, 9, z, 2, 1, 2, CLAY.brass);
    }
  }
  // Wide landing stairs descend from cap level to below water level.
  for (let n = 0; n < 9; n++) kit.box(4, -1 + n, -8 + n, 13, 1, 2, n % 2 ? CLAY.stoneLight : CLAY.stone);
  for (let x = -52; x <= 52; x += 13) {
    kit.box(x, 9, 4, 2, 3, 2, CLAY.timber);
    kit.box(x - 1, 11, 4, 4, 1, 2, CLAY.brass);
  }
  // A low, curved breakwater and cap cradle the basin without sealing its entrance.
  for (let i = 0; i < 26; i++) {
    const x = 60 - i, z = -2 - Math.floor(i * i / 52);
    kit.box(x, -4, z, 3, 9, 5, CLAY.stoneDark);
    kit.box(x, 5, z, 3, 2, 5, CLAY.stone);
    kit.box(x, 7, z, 3, 1, 5, CLAY.stoneLight);
  }
  return kit.finish('harbour-quay', {
    seaLevel: [0, 0, 0], quayTop: [0, 8, 10], shoreJoin: [0, 6, 21],
    westPier: [-34, 9, -16], eastPier: [26, 9, -16], landing: [10, 0, -8],
  });
}

export type QuaySectionKind = 'frontage' | 'pier' | 'landing';
export type QuayShoreOffset = -4 | -2 | 0 | 2 | 4;

/**
 * Fit a dry inland connection to sampled terrain. All heights are source-cell top
 * coordinates relative to sea level, not occupied-cell indices. Ground samples run
 * z-major then x-major, starting at x=-3, z=23. Nothing here implies walkability.
 */
export function createQuayInlandStairs(treadHeights: readonly number[], ground: readonly number[], apronGround: readonly number[], shoreOffset: QuayShoreOffset = 0): ArtisanKit {
  if (![-4, -2, 0, 2, 4].includes(shoreOffset)) throw new RangeError('Unsupported shoreline offset');
  if (treadHeights.length < 1 || treadHeights.length > 64 || ground.length !== treadHeights.length * 12 || apronGround.length !== 12) {
    throw new RangeError('Invalid inland stair footprint');
  }
  if ((treadHeights[0] !== 8 && treadHeights[0] !== 9) || treadHeights.some((h, i) => !Number.isSafeInteger(h) || h <= 0 || (i > 0 && (h > treadHeights[i - 1]! || treadHeights[i - 1]! - h > 1)))) {
    throw new RangeError('Inland stairs must descend from the cap by at most one cell per tread');
  }
  const last = treadHeights[treadHeights.length - 1]!;
  if (ground.some((g, i) => !Number.isSafeInteger(g) || g <= 0 || g > treadHeights[Math.floor(i / 12)]!) || ground.slice(-12).some(g => g !== last) || apronGround.some(g => !Number.isSafeInteger(g) || g !== last)) {
    throw new RangeError('Inland stairs require sampled dry support and a level joined apron');
  }
  const kit = new KitBuilder();
  const shift = (x: number) => Math.round((x + 8) / 15 * shoreOffset);
  for (let row = 0; row < treadHeights.length * 2; row++) for (let col = 0; col < 6; col++) {
    const top = treadHeights[Math.floor(row / 2)]!, support = ground[row * 6 + col]!;
    // A flush paving cell replaces the existing top cell when support already
    // reaches the intended surface; otherwise fill only the sampled gap.
    kit.box(col - 3, Math.min(support, top - 1), 23 + row + shift(col - 3), 1, Math.max(1, top - support), 1, (Math.floor(row / 2) % 2) ? CLAY.stone : CLAY.stoneLight);
  }
  const apronZ = 23 + treadHeights.length * 2;
  for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
    kit.box(col - 3, last - 1, apronZ + row + shift(col - 3), 1, 1, 1, CLAY.stone);
  }
  return kit.finish('harbour-quay-inland-stairs', {
    quay: [0, treadHeights[0]!, 23 + shift(0)], land: [0, last, apronZ + shift(0)], 'apron-end': [0, last, apronZ + 2 + shift(0)],
  });
}

/**
 * A 16-cell frontage, optionally carrying a pier or a boat landing. `shoreOffset`
 * advances the right end along local Z, allowing neighbouring sections to follow
 * a changing shore while both ends still meet at the same deck elevation.
 */
export function createQuaySection(seedKey: string, kind: QuaySectionKind = 'frontage', shoreOffset: QuayShoreOffset = 0): ArtisanKit {
  void seedKey;
  if (!(['frontage', 'pier', 'landing'] as const).includes(kind) || ![-4, -2, 0, 2, 4].includes(shoreOffset)) {
    throw new RangeError('Unsupported quay section');
  }
  const kit = new KitBuilder();
  const shift = (x: number) => Math.round((x + 8) / 15 * shoreOffset);
  // Each column overlaps its neighbours along Z; a one-cell change of shoreline
  // leaves a continuous stone core, cap and seam at a single shared height.
  for (let x = -8; x < 8; x++) {
    const dz = shift(x);
    kit.box(x, -5, 3 + dz, 1, 11, 18, CLAY.stoneDark);
    for (let row = 0; row < 4; row++) {
      const joint = ((x + 8 + (row % 2) * 3) % 7 + 7) % 7 === 6;
      kit.box(x, -2 + row * 2, 2 + dz, 1, 2, 1, joint ? CLAY.stoneDark : row % 2 ? CLAY.stone : CLAY.stoneLight);
    }
    kit.box(x, 6, 1 + dz, 1, 3, 22, CLAY.stoneLight);
    kit.box(x, 8, 1 + dz, 1, 1, 2, CLAY.trim);
  }
  for (const x of [-5, 4]) {
    const dz = shift(x);
    kit.box(x, 9, 4 + dz, 2, 3, 2, CLAY.timber);
    kit.box(x - 1, 11, 4 + dz, 4, 1, 2, CLAY.brass);
  }
  const middle = shift(0);
  if (kind === 'pier') {
    kit.box(-5, 6, -32 + middle, 11, 2, 34, CLAY.timber);
    for (let z = -31; z < 2; z += 4) kit.box(-5, 8, z + middle, 11, 1, 3, CLAY.timberLight);
    for (const x of [-4, 3]) for (let z = -29; z <= -1; z += 9) {
      kit.box(x, -5, z + middle, 2, 14, 2, CLAY.timber);
      kit.box(x, 9, z + middle, 2, 1, 2, CLAY.brass);
    }
  }
  if (kind === 'landing') {
    for (let n = 0; n < 9; n++) kit.box(-6, -1 + n, -8 + n + middle, 12, 1, 2, n % 2 ? CLAY.stoneLight : CLAY.stone);
  }
  return kit.finish(`harbour-quay-${kind}`, {
    seaLevel: [0, 0, 0], 'shore-left': [-8, 6, 21], 'shore-right': [8, 6, 21 + shoreOffset],
    shoreJoin: [0, 6, 21 + middle], deck: [0, 9, 10 + middle], seaward: [0, 9, 1 + middle],
    ...(kind === 'pier' ? { pier: [0, 9, -16 + middle] as const } : {}),
    ...(kind === 'landing' ? { landing: [0, 0, -8 + middle] as const } : {}),
  });
}

/** The same assembled review view; install each part separately against actual land. */
export function createHarbour(seedKey: string): ArtisanKit {
  const kit = new KitBuilder();
  const quay = createQuay(seedKey);
  kit.add(quay);
  kit.add(createShip(`${seedKey}:west-berth`), [-35, 0, -45]);
  kit.add(createShip(`${seedKey}:east-berth`), [28, 0, -48], 2);
  kit.add(createLighthouse(seedKey), [54, 8, 20]);
  return kit.finish('harbour', {
    ...quay.anchors,
    lighthouseFoundation: [54, 8, 20], westShipWaterline: [-35, 0, -45], eastShipWaterline: [28, 0, -48],
  });
}
