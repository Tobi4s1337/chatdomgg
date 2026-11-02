import { MAT } from '../materials';
import { Sculpt, loft, fishModel, type FishModel } from './model';

/** Copper flanks, a high stepped dorsal comb, and three dark bars make this little perch unmistakable. */
export function createCopperPerch(): FishModel {
  const s = new Sculpt(7, 11, 14);
  loft(s, 3.5, [
    { z: 2, y0: 4, y1: 5, half: 1 }, { z: 3, y0: 3, y1: 6, half: 2 },
    { z: 4, y0: 2, y1: 7, half: 2 }, { z: 5, y0: 2, y1: 7, half: 3 },
    { z: 6, y0: 2, y1: 7, half: 3 }, { z: 7, y0: 2, y1: 7, half: 3 },
    { z: 8, y0: 3, y1: 6, half: 2 }, { z: 9, y0: 3, y1: 6, half: 2 },
    { z: 10, y0: 3, y1: 6, half: 2 }, { z: 11, y0: 3, y1: 6, half: 1 },
    { z: 12, y0: 4, y1: 5, half: 1 }, { z: 13, y0: 4, y1: 4, half: 1 },
  ], MAT.forgeCopper);
  s.paint((_x, y, z, m) => y <= 2 ? MAT.cream : y >= 7 ? MAT.bark : (z === 4 || z === 6 || z === 8) && y >= 4 ? MAT.bark : m);
  // Forked tail, joined through a narrow wrist.
  s.box(3, 4, 1, 4, 6, 3, MAT.terracotta).box(3, 3, 0, 4, 4, 2, MAT.terracotta).box(3, 6, 0, 4, 7, 2, MAT.terracotta);
  s.box(3, 7, 4, 4, 9, 8, MAT.bark).box(3, 9, 5, 4, 10, 7, MAT.bark);
  s.box(3, 1, 5, 4, 2, 7, MAT.terracotta);
  s.set(1, 5, 9, MAT.hairBlack).set(5, 5, 9, MAT.hairBlack);
  return fishModel('fish:copper-perch', s, [3.5, 4.5, 14], [3.5, 4.5, 2.5]);
}

/** The round, short minnow has a gold throat and a wide, two-lobed tail. */
export function createBellMinnow(): FishModel {
  const s = new Sculpt(5, 8, 10);
  loft(s, 2.5, [
    { z: 2, y0: 3, y1: 4, half: 1 }, { z: 3, y0: 2, y1: 5, half: 2 },
    { z: 4, y0: 1, y1: 6, half: 2 }, { z: 5, y0: 1, y1: 6, half: 2 },
    { z: 6, y0: 2, y1: 5, half: 2 }, { z: 7, y0: 2, y1: 5, half: 1 },
    { z: 8, y0: 3, y1: 4, half: 1 }, { z: 9, y0: 3, y1: 3, half: 1 },
  ], MAT.cream);
  s.paint((_x, y, z, m) => y >= 5 ? MAT.goldLeaf : y <= 2 && z >= 5 ? MAT.fabricGold : m);
  s.box(2, 3, 1, 3, 5, 3, MAT.brass).box(2, 2, 0, 3, 3, 2, MAT.goldLeaf).box(2, 5, 0, 3, 6, 2, MAT.goldLeaf);
  s.box(2, 6, 4, 3, 7, 6, MAT.goldLeaf);
  s.set(1, 4, 6, MAT.hairBlack).set(3, 4, 6, MAT.hairBlack);
  return fishModel('fish:bell-minnow', s, [2.5, 3.5, 10], [2.5, 3.5, 2.5]);
}

/** A deep silver body and russet lower fins give the reed roach a broad, upright profile. */
export function createReedRoach(): FishModel {
  const s = new Sculpt(7, 11, 12);
  loft(s, 3.5, [
    { z: 2, y0: 4, y1: 5, half: 1 }, { z: 3, y0: 2, y1: 7, half: 2 },
    { z: 4, y0: 1, y1: 8, half: 2 }, { z: 5, y0: 1, y1: 8, half: 3 },
    { z: 6, y0: 1, y1: 8, half: 3 }, { z: 7, y0: 2, y1: 7, half: 2 },
    { z: 8, y0: 3, y1: 6, half: 2 }, { z: 9, y0: 3, y1: 6, half: 1 },
    { z: 10, y0: 4, y1: 5, half: 1 }, { z: 11, y0: 4, y1: 4, half: 1 },
  ], MAT.stone);
  s.paint((_x, y, _z, m) => y >= 7 ? MAT.darkStone : y <= 2 ? MAT.cream : m);
  s.box(3, 4, 1, 4, 6, 3, MAT.terracotta).box(3, 2, 0, 4, 4, 2, MAT.terracotta).box(3, 6, 0, 4, 8, 2, MAT.terracotta);
  s.box(3, 8, 4, 4, 10, 6, MAT.darkStone).box(3, 0, 5, 4, 1, 7, MAT.terracotta);
  // Red eye surrounds retain a clearly dark pupil on both sides.
  s.set(1, 5, 8, MAT.terracotta).set(5, 5, 8, MAT.terracotta);
  s.set(1, 5, 7, MAT.hairBlack).set(5, 5, 7, MAT.hairBlack);
  return fishModel('fish:reed-roach', s, [3.5, 4.5, 12], [3.5, 4.5, 2.5]);
}

/** Slender silver dart with a long straight flank and a sharply forked tail. */
export function createSilverDace(): FishModel {
  const s = new Sculpt(5, 7, 12);
  loft(s, 2.5, [
    { z: 2, y0: 3, y1: 3, half: 1 }, { z: 3, y0: 2, y1: 4, half: 1 },
    { z: 4, y0: 2, y1: 4, half: 2 }, { z: 5, y0: 1, y1: 5, half: 2 },
    { z: 6, y0: 1, y1: 5, half: 2 }, { z: 7, y0: 1, y1: 5, half: 2 },
    { z: 8, y0: 2, y1: 4, half: 2 }, { z: 9, y0: 2, y1: 4, half: 1 },
    { z: 10, y0: 2, y1: 4, half: 1 }, { z: 11, y0: 3, y1: 3, half: 1 },
  ], MAT.stone);
  s.paint((_x, y, _z, m) => y >= 5 ? MAT.darkStone : y <= 1 ? MAT.cream : m);
  s.box(2, 3, 1, 3, 4, 3, MAT.slate).box(2, 1, 0, 3, 3, 2, MAT.slate).box(2, 4, 0, 3, 6, 2, MAT.slate);
  s.box(2, 5, 5, 3, 6, 7, MAT.slate);
  s.set(1, 3, 9, MAT.hairBlack).set(3, 3, 9, MAT.hairBlack);
  return fishModel('fish:silver-dace', s, [2.5, 3.5, 12], [2.5, 3.5, 2.5]);
}
