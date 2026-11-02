import { Sculpt, loft, fishModel, type FishModel } from './model';
import { MAT } from '../materials';

/** A cool, long river fish with a blush behind the gill and small dark freckles. */
export function createMistfinTrout(): FishModel {
  const s = new Sculpt(9, 11, 15);
  loft(s, 4.5, [
    {z:3,y0:4,y1:6,half:1.5},{z:4,y0:3,y1:7,half:2.5},
    {z:5,y0:3,y1:7,half:2.5},{z:6,y0:2,y1:8,half:2.5},
    {z:7,y0:2,y1:8,half:2.5},{z:8,y0:2,y1:8,half:2.5},
    {z:9,y0:2,y1:8,half:2.5},{z:10,y0:3,y1:7,half:2.5},
    {z:11,y0:3,y1:7,half:2.5},{z:12,y0:4,y1:6,half:1.5},
    {z:13,y0:4,y1:6,half:1.5},{z:14,y0:4,y1:5,half:0.5},
  ], MAT.stone);
  s.paint((x,y,z,m) => y >= 7 ? MAT.slate : y <= 3 ? MAT.cream : (z >= 5 && z <= 10 && y === 5 ? MAT.petal : m));
  // Forked tail and its narrow wrist.
  s.box(4,4,2,5,7,4,MAT.slate).box(4,3,1,5,8,3,MAT.slate);
  s.box(4,2,0,5,4,2,MAT.slate).box(4,7,0,5,9,2,MAT.slate);
  s.box(4,8,6,5,10,8,MAT.slate).box(4,8,8,5,9,9,MAT.slate);
  s.box(1,3,8,3,4,10,MAT.slate).box(6,3,8,8,4,10,MAT.slate);
  for (const x of [2,6]) for (const [y,z] of [[6,5],[7,7],[6,9]] as const) s.set(x,y,z,MAT.darkStone);
  s.set(2,5,11,MAT.petal).set(6,5,11,MAT.petal);
  s.set(3,6,13,MAT.hairBlack).set(5,6,13,MAT.hairBlack).set(4,4,14,MAT.darkStone);
  return fishModel('fish:mistfin-trout', s, [4.5,4.5,15], [4.5,5.5,3]);
}

/** Deep golden body and a high, comb-like dorsal distinguish the sun bream in silhouette. */
export function createSunBream(): FishModel {
  const s = new Sculpt(9, 15, 13);
  loft(s, 4.5, [
    {z:3,y0:5,y1:7,half:1.5},{z:4,y0:3,y1:9,half:2.5},
    {z:5,y0:2,y1:10,half:2.5},{z:6,y0:1,y1:11,half:3.5},
    {z:7,y0:1,y1:11,half:3.5},{z:8,y0:2,y1:10,half:2.5},
    {z:9,y0:3,y1:9,half:2.5},{z:10,y0:4,y1:8,half:2.5},
    {z:11,y0:5,y1:7,half:1.5},{z:12,y0:5,y1:6,half:0.5},
  ], MAT.fabricGold);
  s.paint((_x,y,_z,m) => y <= 3 ? MAT.cream : y >= 9 ? MAT.thatch : m);
  s.box(4,5,2,5,8,4,MAT.fabricMutedOrange).box(4,4,1,5,9,3,MAT.fabricMutedOrange);
  s.box(4,3,0,5,5,2,MAT.fabricMutedOrange).box(4,8,0,5,10,2,MAT.fabricMutedOrange);
  s.box(4,10,5,5,13,9,MAT.fabricMutedOrange).box(4,12,6,5,14,8,MAT.fabricGold);
  s.box(4,1,5,5,3,8,MAT.fabricMutedOrange);
  s.box(0,4,7,2,5,9,MAT.thatch).box(7,4,7,9,5,9,MAT.thatch);
  s.set(2,7,10,MAT.hairBlack).set(6,7,10,MAT.hairBlack).set(4,5,12,MAT.darkStone);
  return fishModel('fish:sun-bream', s, [4.5,5.5,13], [4.5,6.5,3]);
}

/** Low diamond body with eyes on its upper face and a sandy scalloped edge. */
export function createPebbleFlounder(): FishModel {
  const s = new Sculpt(15, 6, 13);
  loft(s, 7.5, [
    {z:3,y0:2,y1:3,half:1.5},{z:4,y0:1,y1:3,half:3.5},
    {z:5,y0:1,y1:3,half:5.5},{z:6,y0:1,y1:3,half:6.5},
    {z:7,y0:1,y1:3,half:6.5},{z:8,y0:1,y1:3,half:5.5},
    {z:9,y0:1,y1:3,half:4.5},{z:10,y0:1,y1:3,half:3.5},
    {z:11,y0:2,y1:3,half:2.5},{z:12,y0:2,y1:2,half:1.5},
  ], MAT.thatch);
  s.paint((x,y,z,m) => y === 1 ? MAT.cream : (y === 3 && (x === 3 || x === 11 || z === 4 || z === 10) ? MAT.fabricMutedGold : m));
  s.box(6,2,2,9,3,4,MAT.fabricMutedGold).box(5,2,1,10,3,3,MAT.fabricMutedGold).box(4,2,0,11,3,2,MAT.thatch);
  // Raised eyes share the upper face; their cream rims hold them apart at portrait scale.
  s.box(5,3,9,7,4,11,MAT.cream).box(8,3,9,10,4,11,MAT.cream);
  s.set(6,4,10,MAT.hairBlack).set(8,4,10,MAT.hairBlack);
  s.set(7,2,12,MAT.darkStone);
  for (const [x,z] of [[4,6],[6,5],[9,6],[10,8],[5,8],[7,7]] as const) s.set(x,3,z,MAT.fabricMutedOrange);
  return fishModel('fish:pebble-flounder', s, [7.5,2.5,13], [7.5,2.5,3]);
}

/** A muscular char, with russet fins and a projecting lower jaw. */
export function createRedfinChar(): FishModel {
  const s = new Sculpt(9, 11, 17);
  loft(s, 4.5, [
    {z:3,y0:4,y1:6,half:1.5},{z:4,y0:3,y1:7,half:1.5},
    {z:5,y0:3,y1:7,half:2.5},{z:6,y0:2,y1:8,half:2.5},
    {z:7,y0:2,y1:8,half:2.5},{z:8,y0:2,y1:8,half:2.5},
    {z:9,y0:2,y1:8,half:2.5},{z:10,y0:2,y1:8,half:2.5},
    {z:11,y0:3,y1:7,half:2.5},{z:12,y0:3,y1:7,half:2.5},
    {z:13,y0:3,y1:7,half:2.5},{z:14,y0:4,y1:6,half:1.5},
    {z:15,y0:4,y1:6,half:1.5},
  ], MAT.fabricMutedGreen);
  s.paint((_x,y,_z,m) => y >= 7 ? MAT.moss : y <= 3 ? MAT.fabricMutedOrange : m);
  s.box(4,4,2,5,7,4,MAT.fabricMutedRed).box(4,3,1,5,8,3,MAT.fabricMutedRed);
  s.box(4,2,0,5,4,2,MAT.fabricRed).box(4,7,0,5,9,2,MAT.fabricRed);
  s.box(4,8,7,5,10,10,MAT.fabricMutedRed).box(4,8,5,5,9,7,MAT.fabricMutedRed);
  s.box(1,2,9,3,3,11,MAT.fabricRed).box(6,2,9,8,3,11,MAT.fabricRed);
  s.box(3,3,15,6,4,17,MAT.fabricMutedOrange).set(4,4,15,MAT.darkStone);
  s.set(3,6,14,MAT.hairBlack).set(5,6,14,MAT.hairBlack);
  for (const x of [2,6]) for (const [y,z] of [[5,6],[6,8],[5,10],[6,11]] as const) s.set(x,y,z,MAT.cream);
  return fishModel('fish:redfin-char', s, [4.5,3.5,17], [4.5,5.5,3]);
}
