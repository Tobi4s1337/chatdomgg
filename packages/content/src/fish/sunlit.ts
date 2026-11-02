import { Sculpt, loft, fishModel, type FishModel } from './model';
import { mix } from '../places/water/critters/rig';
import { MAT } from '../materials';

type Span = readonly [y0: number, y1: number, half: number];
const body = (s: Sculpt, cx: number, from: number, spans: readonly Span[], material: number) =>
  spans.forEach(([y0, y1, half], i) => loft(s, cx, [{ z: from + i, y0, y1, half }], material));
/** Fins grow from the body's outline: `rise` fills a column up from the back to `top`, `sink` down from the belly. */
function rise(s: Sculpt, x: number, z: number, top: number, material: number): void {
  let y = s.sy - 1; while (y > 0 && !s.get(x, y - 1, z)) y--;
  for (; y <= top; y++) s.set(x, y, z, material);
}
function sink(s: Sculpt, x: number, z: number, bottom: number, material: number): void {
  let y = 0; while (y < s.sy - 1 && !s.get(x, y + 1, z)) y++;
  for (; y >= bottom; y--) s.set(x, y, z, material);
}
/** Paired eyes on the outermost flank cell of a row, so they always sit on the surface. */
function eyes(s: Sculpt, y: number, z: number, material: number): void {
  let x = 0; while (!s.get(x, y, z)) x++;
  s.set(x, y, z, material);
  x = s.sx - 1; while (!s.get(x, y, z)) x--;
  s.set(x, y, z, material);
}

/** A flat, near-round pumpkinseed: a disc with a long rear-weighted dorsal, blue cheek lines and one coal by the ear. */
export function createEmberSunfish(): FishModel {
  const s = new Sculpt(7, 14, 12);
  body(s, 3.5, 2, [
    [5, 7, 1], [3, 9, 1.5], [2, 10, 2], [1, 11, 2], [1, 11, 2],
    [1, 11, 2], [1, 10, 2], [2, 10, 2], [3, 9, 1.5], [4, 7, 1],
  ], MAT.moss);
  // Wavy blue cheek lines, a dark olive back and an orange belly.
  const cheek = new Set(['9,5', '9,7', '10,4', '10,6', '11,5']);
  s.paint((_x, y, z, m) => y <= 3 ? MAT.fabricOrange : cheek.has(`${z},${y}`) ? MAT.fabricBlue : y >= 9 ? MAT.fabricMutedGreen : m);
  // Long dorsal, low spines in front rising to a soft rear lobe; the anal fin mirrors it underneath.
  const fin = MAT.fabricMutedGold;
  s.box(3, 11, 8, 4, 12, 10, fin).box(3, 12, 6, 4, 13, 8, fin).box(3, 12, 5, 4, 14, 6, fin)
    .box(3, 11, 4, 4, 14, 5, fin).box(3, 10, 3, 4, 13, 4, fin);
  s.box(3, 1, 3, 4, 3, 4, fin).box(3, 0, 4, 4, 2, 5, fin).box(3, 0, 5, 4, 1, 6, fin);
  // Short, slightly notched fan tail.
  s.box(3, 3, 1, 4, 10, 2, fin).box(3, 2, 0, 4, 6, 1, fin).box(3, 7, 0, 4, 11, 1, fin);
  s.box(0, 5, 6, 1, 6, 8, fin).box(6, 5, 6, 7, 6, 8, fin);
  // Orange freckles on the flank.
  for (const x of [1, 5]) for (const [y, z] of [[5, 4], [7, 5], [5, 7], [8, 6]] as const) s.set(x, y, z, MAT.fabricOrange);
  // The black ear flap behind the gill, tipped with a single ember that stands proud of the flank.
  for (const x of [1, 5]) s.box(x, 7, 8, x + 1, 9, 9, MAT.hairBlack);
  s.box(0, 7, 7, 1, 9, 8, MAT.fabricRed).box(6, 7, 7, 7, 9, 8, MAT.fabricRed);
  s.set(2, 8, 10, MAT.hairBlack).set(4, 8, 10, MAT.hairBlack).set(3, 5, 11, MAT.bark);
  return fishModel('fish:ember-sunfish', s, [3.5, 5.5, 12], [3.5, 6.5, 2.5]);
}

/** A slim pearl river fish under a towering violet-spotted sail of a dorsal fin. */
export function createPearlGrayling(): FishModel {
  const s = new Sculpt(7, 16, 17);
  body(s, 3.5, 2, [
    [4, 5, 1], [3, 6, 1], [3, 7, 1.5], [2, 7, 2], [2, 8, 2], [2, 8, 2], [2, 8, 2], [2, 8, 2],
    [2, 8, 2], [2, 8, 2], [2, 7, 2], [3, 7, 2], [3, 7, 1.5], [4, 6, 1.5], [4, 5, 1],
  ], MAT.stone);
  s.paint((_x, y, z, m) => y >= 7 ? MAT.darkStone : y <= 2 ? MAT.cream : y <= 4 ? MAT.hairSilver : (y === 5 && (z === 11 || z === 13) ? MAT.darkStone : m));
  // The sail: rising from behind the head to its tallest rear rays, then sweeping down towards the tail.
  const tops: readonly [number, number][] = [[4, 9], [5, 12], [6, 14], [7, 15], [8, 15], [9, 14], [10, 13], [11, 12], [12, 11], [13, 10]];
  for (const [z, top] of tops) { rise(s, 3, z, top, MAT.fabricMutedViolet); s.set(3, top, z, MAT.fabricMutedRed); }
  for (const [z, y] of [[6, 11], [6, 13], [8, 10], [8, 13], [9, 12], [10, 12], [11, 10], [12, 9]] as const) s.set(3, y, z, MAT.fabricViolet);
  // Deeply forked tail, keel fins.
  s.box(3, 3, 1, 4, 7, 2, MAT.darkStone).box(3, 1, 0, 4, 4, 1, MAT.darkStone).box(3, 6, 0, 4, 9, 1, MAT.darkStone);
  s.box(3, 1, 4, 4, 3, 6, MAT.fabricMutedViolet).box(3, 1, 8, 4, 2, 10, MAT.fabricMutedViolet);
  eyes(s, 6, 14, MAT.hairBlack);
  s.set(3, 4, 16, MAT.darkStone);
  return fishModel('fish:pearl-grayling', s, [3.5, 4.5, 17], [3.5, 4.5, 2.5]);
}

/** A long, mottled cold-water cod: a broad flat head, one chin barbel and low fins running into a round tail. */
export function createHollowBurbot(): FishModel {
  const s = new Sculpt(9, 10, 22);
  body(s, 4.5, 2, [
    [3, 5, 1], [3, 5, 1], [2, 6, 1], [2, 6, 1.5], [2, 6, 1.5], [2, 6, 2], [2, 6, 2], [2, 7, 2],
    [2, 7, 2], [2, 7, 2.5], [2, 7, 2.5], [2, 7, 2.5], [2, 7, 2.5], [2, 6, 3], [2, 6, 3], [2, 6, 3.5],
    [2, 5, 3.5], [2, 5, 3.5], [2, 5, 3], [2, 4, 2.5],
  ], MAT.hairBrown);
  // Blotches in two-cell patches, olive and dark bark, over a pale belly.
  s.paint((x, y, z, m) => {
    if (y <= 2 && z > 4) return MAT.limestone;
    const h = mix(x >> 1, y >> 1, z >> 1, 7);
    return h < .22 ? MAT.moss : h > .82 ? MAT.bark : m;
  });
  const fin = MAT.bark;
  // Small first dorsal, then a long low second dorsal and anal fin that run into the rounded tail.
  s.box(4, 8, 13, 5, 9, 15, fin).set(4, 9, 14, fin);
  for (let z = 3; z <= 11; z++) { rise(s, 4, z, 8, fin); if (z <= 10) sink(s, 4, z, 1, fin); }
  s.box(4, 1, 2, 5, 8, 3, fin).box(4, 1, 1, 5, 8, 2, fin).box(4, 2, 0, 5, 7, 1, fin);
  s.box(0, 3, 14, 1, 4, 16, fin).box(8, 3, 14, 9, 4, 16, fin);
  s.box(2, 3, 21, 7, 4, 22, MAT.earth);
  s.set(2, 5, 19, MAT.hairBlack).set(6, 5, 19, MAT.hairBlack);
  // The single chin barbel.
  s.box(4, 0, 20, 5, 2, 21, MAT.cream);
  return fishModel('fish:hollow-burbot', s, [4.5, 3.5, 22], [4.5, 4.5, 2.5]);
}

/** A round torpedo with a blunt head, two small separate dorsals and a deep fork; grey lines run its flank. */
export function createSaltmarshMullet(): FishModel {
  const s = new Sculpt(9, 11, 17);
  // Elliptical sections (z, half-width, half-height) keep the torpedo round instead of boxy.
  const radii: readonly [number, number][] = [
    [1.2, 1.6], [1.6, 2.1], [2.1, 2.6], [2.6, 3.0], [3.0, 3.3], [3.3, 3.5], [3.4, 3.6], [3.4, 3.6],
    [3.4, 3.6], [3.4, 3.6], [3.4, 3.6], [3.3, 3.5], [3.1, 3.3], [2.2, 2.6],
  ];
  radii.forEach(([rx, ry], i) => {
    for (let y = 0; y < s.sy; y++) for (let x = 0; x < s.sx; x++)
      if (((x + .5 - 4.5) / rx) ** 2 + ((y + .5 - 5.5) / ry) ** 2 <= 1) s.set(x, y, i + 3, MAT.hairSilver);
  });
  s.paint((_x, y, _z, m) => y >= 7 ? MAT.darkStone : y <= 2 ? MAT.cream : y === 4 || y === 6 ? MAT.stone : m);
  const fin = MAT.slate;
  // Two separate small dorsals, a spiny triangle ahead and a soft one behind.
  rise(s, 4, 11, 10, fin); rise(s, 4, 10, 10, fin); rise(s, 4, 9, 9, fin);
  rise(s, 4, 6, 10, fin); rise(s, 4, 5, 9, fin);
  sink(s, 4, 6, 1, fin); sink(s, 4, 5, 1, fin);
  for (const x of [3, 5]) { sink(s, x, 10, 1, fin); sink(s, x, 9, 1, fin); }
  s.box(0, 6, 10, 1, 7, 12, fin).box(8, 6, 10, 9, 7, 12, fin);
  // Deep fork with long lobes.
  s.box(4, 2, 2, 5, 9, 3, fin).box(4, 1, 1, 5, 5, 2, fin).box(4, 6, 1, 5, 10, 2, fin)
    .box(4, 0, 0, 5, 3, 1, fin).box(4, 8, 0, 5, 11, 1, fin);
  eyes(s, 6, 15, MAT.hairBlack);
  s.set(4, 4, 16, MAT.darkStone);
  return fishModel('fish:saltmarsh-mullet', s, [4.5, 4.5, 17], [4.5, 5.5, 3]);
}
