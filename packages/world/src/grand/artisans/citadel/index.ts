import { CLAY, KitBuilder, random, type ArtisanKit } from '../kit';

/** Small rounded masonry volumes retain the same half-metre lattice as terrain.
 * Separate, disjoint horizontal runs make the radius legible without a dense voxel array. */
function round(b: KitBuilder, x: number, y: number, z: number, r: number, h: number, colour: string): void {
  for (let dz = -r; dz <= r; dz++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dz * dz)));
    b.box(x - dx, y, z + dz, dx * 2 + 1, h, 1, colour);
  }
}

/** Roof steps are broad enough to remain a single silhouette after distant simplification. */
function cone(b: KitBuilder, x: number, y: number, z: number, radius: number, height: number): void {
  for (let level = 0; level < height; level++) {
    const r = Math.max(0, Math.round(radius * (1 - (level + 0.45) / height)));
    round(b, x, y + level, z, r, 1, level < 2 ? CLAY.roofDark : level % 5 === 4 ? CLAY.roofLight : CLAY.roof);
  }
  b.box(x, y + height, z, 1, 3, 1, CLAY.brass);
}

function flag(b: KitBuilder, x: number, y: number, z: number, colour: string): void {
  b.box(x, y, z, 1, 8, 1, CLAY.brass);
  // A notched, slightly rising swallowtail; its solid colour can take a channel crest at adoption.
  b.box(x + 1, y + 5, z, 6, 2, 1, colour);
  b.box(x + 1, y + 3, z, 4, 2, 1, colour);
  b.box(x + 1, y + 2, z, 2, 1, 1, colour);
}

function slit(b: KitBuilder, x: number, y: number, z: number, r: number): void {
  // Shadowed glass, not presence light: each slit projects one cell from the masonry.
  for (const [dx, dz, sx, sz] of [[-1, -r - 1, 3, 1], [-1, r + 1, 3, 1], [-r - 1, -1, 1, 3], [r + 1, -1, 1, 3]] as const) {
    b.box(x + dx, y, z + dz, sx, 6, sz, '#566070');
    b.box(x + dx, y + 6, z + dz, sx, 1, sz, CLAY.trim);
  }
}

function tower(b: KitBuilder, x: number, z: number, base: number, shaft: number, radius: number, roofHeight: number, banner: string): void {
  round(b, x, base, z, radius + 1, 3, CLAY.stoneDark);
  round(b, x, base + 3, z, radius, shaft - 3, CLAY.stoneLight);
  for (const level of [9, Math.round(shaft * 0.58), shaft - 4]) {
    if (level > 0 && level < shaft) round(b, x, base + level, z, radius + 1, 2, CLAY.stone);
  }
  for (let h = 14; h < shaft - 8; h += 14) slit(b, x, base + h, z, radius);
  round(b, x, base + shaft, z, radius + 2, 2, CLAY.trim);
  round(b, x, base + shaft + 2, z, radius + 1, 2, CLAY.roofDark);
  cone(b, x, base + shaft + 4, z, radius + 2, roofHeight);
  flag(b, x, base + shaft + roofHeight + 6, z, banner);
}

function crenellations(b: KitBuilder, x0: number, x1: number, y: number, z: number, thickness: number): void {
  b.box(x0, y, z, x1 - x0, 2, thickness, CLAY.trim);
  for (let x = x0 + 1; x < x1 - 1; x += 6) b.box(x, y + 2, z, Math.min(3, x1 - x), 3, thickness, CLAY.stoneLight);
}

/** A broken outcrop: broad beds are cut into offset, shallow ledges. The central
 * mass supports the plinth; coarse folds break the outline without cell noise. */
function bedrock(b: KitBuilder): void {
  const beds = [
    { y: 0, h: 3, r: 44, colour: CLAY.stoneDark, phase: 0 },
    { y: 3, h: 3, r: 43, colour: '#8b7e7b', phase: 1.4 },
    { y: 6, h: 3, r: 41, colour: '#9d8e83', phase: 2.1 },
    { y: 9, h: 2, r: 40, colour: '#a79889', phase: 3.6 },
  ] as const;
  // Each run is a whole geological band. One long slanted break and two large
  // folds make the rock feel fractured, while ensuring no part exceeds r=46.
  for (const bed of beds) for (let z = -42; z <= 42; z++) {
    const zz = z / (bed.r * .93);
    if (Math.abs(zz) >= 1) continue;
    const half = Math.sqrt(1 - zz * zz) * bed.r;
    const fold = 1.8 * Math.sin(z * .13 + bed.phase) + 1.2 * Math.sin(z * .063 - bed.phase);
    const cut = z > -18 && z < 10 ? 2 : z > 25 ? -2 : 0;
    const lo = Math.max(-46, Math.ceil(-half + fold - 1));
    const hi = Math.min(45, Math.floor(half + fold + cut));
    if (hi >= lo) b.box(lo, bed.y, z, hi - lo + 1, bed.h, 1, bed.colour);
  }
  // Solid support is hidden under the castle and does not form its outer edge.
  b.box(-32, 0, -25, 64, 11, 50, '#9d8e83');
  // A few broad, shaded moss seams rest on exposed ledges rather than speckling rock.
  b.box(-32, 6, -31, 10, 1, 3, '#727e5b');
  b.box(25, 6, 30, 9, 1, 3, '#727e5b');
  b.box(-38, 9, 9, 3, 1, 9, '#7c865e');
  b.box(33, 9, -22, 3, 1, 8, '#7c865e');
}

/** Ceremonial approach in terrain cells. Solid risers carry each succeeding tread;
 * the upper landing meets the entry floor, while the lower landing meets y=0. */
function citadelApproach(b: KitBuilder): void {
  for (let i = 0; i < 13; i++) {
    const z = -62 + i * 2;
    b.box(-6, 0, z, 12, i + 1, 2, i % 3 === 0 ? CLAY.stoneLight : CLAY.stone);
  }
  b.box(-6, 0, -36, 12, 13, 6, CLAY.stone);
  // Low, continuous flanking masonry gives the broad flight a finished edge.
  for (let i = 0; i < 13; i++) {
    const z = -62 + i * 2;
    for (const x of [-8, 6]) b.box(x, 0, z, 2, i + 2, 2, CLAY.stoneDark);
  }
}

/** A few engaged buttresses and deep bays establish the major structural rhythm. */
function citadelButtresses(b: KitBuilder): void {
  for (const x of [-9, 1, 9]) {
    b.box(x, 35, -20, 3, 20, 3, CLAY.stone);
    b.box(x - 1, 35, -21, 5, 2, 4, CLAY.stoneDark);
    b.box(x - 1, 54, -21, 5, 2, 4, CLAY.trim);
  }
  // Two lower buttresses terminate beneath the upper terrace.
  for (const x of [-28, 25]) {
    b.box(x, 13, -32, 3, 18, 4, CLAY.stone);
    b.box(x - 1, 13, -33, 5, 3, 5, CLAY.stoneDark);
    b.box(x - 1, 29, -33, 5, 2, 5, CLAY.trim);
  }
}

/**
 * An unoccupied architectural study for the castle's surrounding visual silhouette. The caller must
 * fit it around the installed castle/physical supports; it is never an authoritative replacement.
 */
export function createCitadel(seedKey: string): ArtisanKit {
  const b = new KitBuilder();
  const rnd = random(`${seedKey}/citadel`);
  const banner = rnd() < 0.5 ? CLAY.banner : '#a96876';
  const high = Math.floor(rnd() * 5);

  // Irregular native rock below one worked stone course.
  bedrock(b);
  round(b, 0, 11, 0, 37, 2, CLAY.trim);
  citadelApproach(b);

  // Compound volume: a lower wall and a stepped, narrower inner court. Kept unlit.
  b.box(-31, 13, -24, 25, 11, 49, CLAY.stone);
  b.box(6, 13, -24, 25, 11, 49, CLAY.stone);
  b.box(-6, 13, -12, 12, 11, 37, CLAY.stone);
  b.box(-31, 24, -24, 62, 8, 49, CLAY.stone);
  b.box(-27, 32, -20, 54, 4, 41, CLAY.trim);
  b.box(-23, 36, -17, 46, 23, 35, CLAY.stoneLight);
  b.box(-19, 59, -14, 38, 3, 29, CLAY.trim);
  b.box(-15, 62, -11, 30, 14, 23, CLAY.stone);
  // Strong offsets and supporting wings keep the silhouette readable from either coast.
  b.box(-31, 19, -29, 15, 14, 10, CLAY.stoneLight);
  b.box(16, 19, -29, 15, 14, 10, CLAY.stoneLight);
  b.box(-29, 18, 17, 14, 14, 11, CLAY.stoneLight);
  b.box(15, 18, 17, 14, 14, 11, CLAY.stoneLight);
  crenellations(b, -31, 31, 32, -25, 3);
  crenellations(b, -31, 31, 32, 23, 3);

  // A recessed entry through the frontage ends against the inner compound wall.
  // It is a visual void, not a collision or walking promise.
  b.box(-8, 13, -30, 2, 11, 6, CLAY.stoneDark);
  b.box(6, 13, -30, 2, 11, 6, CLAY.stoneDark);
  b.box(-6, 13, -13, 12, 11, 1, '#3e4051');
  b.box(-8, 24, -31, 16, 2, 2, CLAY.trim);
  b.box(-10, 13, -32, 2, 13, 3, CLAY.trim);
  b.box(8, 13, -32, 2, 13, 3, CLAY.trim);
  for (const x of [-23, -13, 12, 22]) {
    b.box(x, 38, -18, 3, 9, 1, '#667080');
    b.box(x - 1, 47, -18, 5, 1, 1, CLAY.trim);
  }
  citadelButtresses(b);
  // Terraced family of spires, with a single clear central peak.
  tower(b, 0, 0, 72, 29 + high, 7, 22, banner);
  tower(b, -19, -11, 53, 25, 6, 17, banner);
  tower(b, 19, -11, 53, 27, 6, 18, banner);
  tower(b, -25, 17, 30, 29, 6, 16, banner);
  tower(b, 25, 17, 30, 29, 6, 16, banner);
  tower(b, -31, -22, 28, 22, 5, 15, banner);
  tower(b, 31, -22, 28, 22, 5, 15, banner);
  tower(b, -11, 14, 59, 22, 5, 15, banner);
  tower(b, 11, 14, 59, 23, 5, 16, banner);
  return b.finish('citadel', { base: [0, 0, 0], approach: [0, 0, -62], gate: [0, 13, -32], summit: [0, 137 + high, 0] });
}

/** Open-front town wall study. `gate` is the empty passage centre, not a navigation anchor. */
export function createTownWalls(seedKey: string): ArtisanKit {
  const b = new KitBuilder();
  const rnd = random(`${seedKey}/town-walls`);
  const banner = rnd() < 0.5 ? CLAY.banner : '#a96876';
  const span = 74, y = 0, wallHeight = 13;
  // Four sides. Front wall is deliberately split around the open, 16-cell-wide gate.
  b.box(-span, y, -span, span - 8, wallHeight, 4, CLAY.stone);
  b.box(8, y, -span, span - 8, wallHeight, 4, CLAY.stone);
  b.box(-span, y, span - 4, span * 2, wallHeight, 4, CLAY.stone);
  b.box(-span, y, -span, 4, wallHeight, span * 2, CLAY.stone);
  b.box(span - 4, y, -span, 4, wallHeight, span * 2, CLAY.stone);
  crenellations(b, -span, -8, wallHeight, -span, 4);
  crenellations(b, 8, span, wallHeight, -span, 4);
  crenellations(b, -span, span, wallHeight, span - 4, 4);
  for (const x of [-span, span - 4]) {
    b.box(x, wallHeight, -span, 4, 2, span * 2, CLAY.trim);
    for (let z = -span + 1; z < span; z += 6) b.box(x, wallHeight + 2, z, 4, 3, 3, CLAY.stoneLight);
  }
  // Entry lintel is raised above the open passage. Gatehouse towers flank it.
  b.box(-10, 13, -span - 3, 20, 4, 10, CLAY.stoneLight);
  b.box(-10, 17, -span - 3, 20, 2, 10, CLAY.trim);
  tower(b, -15, -span + 1, 0, 25, 5, 13, banner);
  tower(b, 15, -span + 1, 0, 25, 5, 13, banner);
  for (const [x, z] of [[-span, -span], [span, -span], [-span, span], [span, span]] as const) {
    tower(b, x, z, 0, 20, 5, 12, banner);
  }
  return b.finish('town-walls', { base: [0, 0, 0], gate: [0, 0, -span], gateInterior: [0, 0, -span + 8] });
}
