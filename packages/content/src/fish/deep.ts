import { Sculpt, loft, fishModel, type FishModel } from './model';
import { MAT } from '../materials';

/** A long, gently winding ribbon, with warm markings that catch light but never emit it. */
export function createLanternEel(): FishModel {
  const s = new Sculpt(13, 11, 26);
  const centres = [6,6,6,6,5,5,5,5,5,6,6,6,7,7,7,7,7,6,6,6,6,6,6,6,6,6];
  for (let z = 2; z <= 24; z++) {
    const half = z < 5 ? 1.5 : z > 21 ? 1.5 : 2.5;
    loft(s, centres[z]!, [{ z, y0: z < 5 ? 4 : 3, y1: z < 5 ? 6 : 7, half }], MAT.hairBrown);
  }
  // Low continuous dorsal ribbon and a rounded, vertical paddle at the tail.
  for (let z = 5; z < 22; z++) s.box(centres[z]! - 1, 8, z, centres[z]! + 1, 9, z + 1, MAT.bark);
  s.box(5, 3, 1, 7, 8, 4, MAT.bark).box(5, 4, 0, 7, 7, 1, MAT.bark);
  s.paint((x, y, z, m) => {
    if (y <= 3 && z > 5) return MAT.earth;
    if (z >= 7 && z <= 20 && (z === 8 || z === 12 || z === 16 || z === 20) && y >= 5 && y <= 6) return MAT.goldLeaf;
    return m;
  });
  s.set(4, 6, 22, MAT.hairBlack).set(7, 6, 22, MAT.hairBlack);
  s.box(5, 4, 25, 7, 5, 26, MAT.earth);
  return fishModel('fish:lantern-eel', s, [6, 4.5, 26], [6, 5, 3]);
}

/** A narrow hunting fish: a long, flattened snout and fins set far back. */
export function createMoonlitPike(): FishModel {
  const s = new Sculpt(13, 13, 26);
  const spans: readonly [number, number, number][] = [
    [4,6,1.5],[3,7,2.5],[3,8,2.5],[3,8,3.5],[2,9,3.5],[2,9,3.5],
    [2,9,3.5],[2,9,3.5],[2,9,3.5],[2,9,3.5],[3,8,3.5],[3,8,3.5],
    [3,8,2.5],[3,8,2.5],[3,7,2.5],[3,7,2.5],[4,7,2.5],[4,7,2.5],
    [4,6,2.5],[4,6,2.5],[4,6,1.5],[4,6,1.5],
  ];
  spans.forEach(([y0,y1,half], i) => loft(s, 6.5, [{ z: i + 3, y0, y1, half }], MAT.slate));
  s.paint((x,y,z,m) => y <= 3 ? MAT.cream : y >= 8 ? MAT.darkStone : (z > 6 && z < 18 && (z === 8 || z === 12 || z === 16) && y === 6 ? MAT.stone : m));
  // Fork tail and swept-back dorsal/anal fins.
  s.box(6, 4, 2, 7, 7, 4, MAT.darkStone)
    .box(5, 7, 1, 8, 9, 3, MAT.slate).box(6, 9, 0, 7, 10, 2, MAT.slate)
    .box(5, 2, 1, 8, 4, 3, MAT.slate).box(6, 1, 0, 7, 2, 2, MAT.slate)
    .box(6, 9, 7, 7, 11, 12, MAT.darkStone).box(6, 11, 7, 7, 12, 10, MAT.darkStone)
    .box(6, 1, 8, 7, 3, 12, MAT.slate);
  s.set(4, 6, 19, MAT.hairBlack).set(8, 6, 19, MAT.hairBlack);
  // The upper lip projects over a narrow lower jaw.
  s.box(5, 5, 25, 8, 6, 26, MAT.slate).box(5, 3, 22, 8, 4, 25, MAT.cream);
  return fishModel('fish:moonlit-pike', s, [6.5, 4.5, 26], [6.5, 5.5, 3]);
}

/** Deep-bodied carp with an arched mossy back and a softly rounded belly. */
export function createMossbackCarp(): FishModel {
  const s = new Sculpt(15, 17, 18);
  const spans: readonly [number,number,number][] = [
    [6,8,1.5],[5,9,2.5],[4,11,3.5],[3,12,4.5],[2,13,4.5],[2,14,5.5],
    [2,14,5.5],[2,14,5.5],[2,13,5.5],[3,12,4.5],[3,11,4.5],[4,10,3.5],
    [5,9,3.5],[5,9,2.5],[6,8,1.5],
  ];
  spans.forEach(([y0,y1,half],i) => loft(s, 7.5, [{z:i+2,y0,y1,half}], MAT.fabricMutedGold));
  s.paint((x,y,z,m) => y >= 11 ? MAT.moss : y <= 4 ? MAT.cream : y >= 9 ? MAT.fabricMutedGreen : m);
  s.box(7, 8, 5, 8, 16, 10, MAT.moss).box(7, 14, 6, 8, 17, 8, MAT.moss)
    .box(6, 6, 1, 9, 9, 3, MAT.bark).box(6, 9, 0, 9, 11, 2, MAT.fabricMutedGreen)
    .box(6, 4, 0, 9, 6, 2, MAT.fabricMutedGreen)
    .box(2, 4, 10, 4, 6, 13, MAT.fabricMutedGreen).box(11, 4, 10, 13, 6, 13, MAT.fabricMutedGreen);
  s.set(4, 8, 14, MAT.hairBlack).set(10, 8, 14, MAT.hairBlack);
  s.box(6, 6, 17, 9, 8, 18, MAT.earth);
  return fishModel('fish:mossback-carp', s, [7.5, 7, 18], [7.5, 7, 2]);
}

/** Broad flattened head, long barbels and a tapering body give this fish its own profile. */
export function createWhiskerCatfish(): FishModel {
  const s = new Sculpt(17, 11, 20);
  const spans: readonly [number,number,number][] = [
    [4,6,1.5],[3,7,2.5],[3,7,2.5],[3,7,3.5],[3,7,3.5],[3,7,3.5],
    [3,7,4.5],[3,7,4.5],[3,7,4.5],[3,7,4.5],[3,7,5.5],[3,7,5.5],
    [3,7,5.5],[3,7,5.5],[3,6,5.5],[3,6,4.5],[3,5,3.5],
  ];
  spans.forEach(([y0,y1,half],i) => loft(s, 8.5, [{z:i+2,y0,y1,half}], MAT.fabricMutedBlue));
  s.paint((x,y,z,m) => y <= 3 ? MAT.limestone : y >= 7 ? MAT.darkStone : m);
  s.box(8, 7, 7, 9, 10, 10, MAT.darkStone).box(8, 9, 7, 9, 11, 8, MAT.darkStone)
    .box(7, 3, 1, 10, 8, 3, MAT.slate).box(7, 2, 0, 10, 4, 2, MAT.slate).box(7, 7, 0, 10, 9, 2, MAT.slate)
    .box(2, 2, 10, 5, 4, 13, MAT.slate).box(12, 2, 10, 15, 4, 13, MAT.slate);
  s.set(3, 6, 15, MAT.hairBlack).set(13, 6, 15, MAT.hairBlack);
  s.box(6, 3, 19, 11, 4, 20, MAT.earth);
  // Two attached whiskers curl outward and forward, with mirrored stepped ends.
  s.box(3, 4, 17, 6, 5, 18, MAT.cream).box(2, 4, 17, 3, 5, 19, MAT.cream).box(1, 4, 18, 3, 5, 19, MAT.cream)
    .box(11, 4, 17, 14, 5, 18, MAT.cream).box(14, 4, 17, 15, 5, 19, MAT.cream).box(14, 4, 18, 16, 5, 19, MAT.cream);
  return fishModel('fish:whisker-catfish', s, [8.5, 3.5, 20], [8.5, 5, 2]);
}
