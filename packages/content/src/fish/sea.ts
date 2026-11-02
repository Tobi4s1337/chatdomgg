import { Sculpt, loft, fishModel, type FishModel } from './model';
import { MAT } from '../materials';

type Span = readonly [y0: number, y1: number, half: number];
/** Lofts consecutive cross-sections, starting at `z0`, about the centre line `cx`. */
function body(s: Sculpt, cx: number, z0: number, spans: readonly Span[], material: number): Sculpt {
  spans.forEach(([y0, y1, half], i) => loft(s, cx, [{ z: z0 + i, y0, y1, half }], material));
  return s;
}

/** A sleek spindle with a pinched, keeled wrist, finlet teeth and a wide crescent tail; wavy tiger bars on the back. */
export function createHarbourMackerel(): FishModel {
  const s = new Sculpt(7, 13, 18);
  body(s, 3.5, 5, [
    [5, 7, 0.5], [5, 7, 1.5], [4, 8, 1.5], [4, 8, 2.5], [4, 8, 2.5], [4, 8, 2.5],
    [4, 8, 2.5], [4, 8, 2.5], [4, 8, 2.5], [4, 8, 2.5], [4, 8, 1.5], [5, 7, 1.5], [5, 6, 0.5],
  ], MAT.hairSilver);
  s.paint((x, y, z, m) => {
    if (y <= 4) return MAT.cream;
    const back = z <= 13 ? 6 : 7;
    if (y < back) return m;
    // Dark wavy bars: chevrons from above, bent bars from the side.
    if (z >= 5 && z <= 12 && (z + Math.abs(x - 3) + (y === 7 ? 1 : 0)) % 3 === 0) return MAT.hairBlack;
    return y >= 8 ? MAT.slate : MAT.fabricGreen;
  });
  // Pinched wrist with side keels, then a broad crescent fork.
  s.box(3, 5, 3, 4, 8, 5, MAT.slate).box(2, 6, 3, 5, 7, 5, MAT.slate);
  s.box(3, 4, 2, 4, 9, 3, MAT.slate)
    .box(3, 3, 1, 4, 5, 2, MAT.slate).box(3, 8, 1, 4, 10, 2, MAT.slate)
    .box(3, 2, 0, 4, 4, 1, MAT.slate).box(3, 9, 0, 4, 11, 1, MAT.slate);
  // Finlet teeth above and below the wrist.
  s.set(3, 8, 4, MAT.fabricMutedGold).set(3, 8, 6, MAT.fabricMutedGold);
  s.set(3, 4, 4, MAT.fabricMutedGold).set(3, 4, 6, MAT.fabricMutedGold);
  // Second dorsal and anal fin, then the tall spiny first dorsal.
  s.box(3, 9, 9, 4, 10, 11, MAT.slate).set(3, 10, 10, MAT.slate);
  s.box(3, 3, 9, 4, 4, 11, MAT.slate).set(3, 2, 10, MAT.slate);
  s.box(3, 9, 12, 4, 10, 15, MAT.slate).box(3, 10, 13, 4, 11, 15, MAT.slate).set(3, 11, 14, MAT.slate);
  s.box(0, 5, 12, 1, 6, 14, MAT.slate).box(6, 5, 12, 7, 6, 14, MAT.slate);
  s.set(1, 6, 14, MAT.hairBlack).set(5, 6, 14, MAT.hairBlack);
  s.set(3, 5, 17, MAT.darkStone);
  return fishModel('fish:harbour-mackerel', s, [3.5, 5.5, 18], [3.5, 6.5, 3]);
}

/** A thin, compressed blade with a deep V tail, one small dorsal and a large eye; sea-glass back over bright silver. */
export function createDriftglassHerring(): FishModel {
  const s = new Sculpt(3, 11, 15);
  body(s, 1.5, 4, [
    [4, 6, 0.5], [4, 6, 1.5], [3, 7, 1.5], [3, 7, 1.5], [2, 7, 1.5], [2, 7, 1.5],
    [2, 7, 1.5], [3, 7, 1.5], [3, 7, 1.5], [3, 6, 1.5], [3, 4, 0.5],
  ], MAT.hairSilver);
  s.paint((_x, y, z, m) => y >= 6 ? MAT.skinFeyMoss : y === 5 && z <= 10 ? MAT.blueFlower : y <= 2 ? MAT.cream : m);
  // A deep, narrow V fork behind the pinched wrist.
  s.box(1, 4, 3, 2, 7, 4, MAT.waterbed)
    .box(1, 3, 2, 2, 5, 3, MAT.waterbed).box(1, 6, 2, 2, 8, 3, MAT.waterbed)
    .box(1, 2, 1, 2, 4, 2, MAT.waterbed).box(1, 7, 1, 2, 9, 2, MAT.waterbed)
    .box(1, 1, 0, 2, 3, 1, MAT.waterbed).box(1, 8, 0, 2, 10, 1, MAT.waterbed);
  // One small dorsal at mid-back, a pelvic and an anal fin below.
  s.box(1, 8, 8, 2, 9, 10, MAT.waterbed).set(1, 9, 9, MAT.waterbed);
  s.set(1, 1, 8, MAT.skinFeyMoss).box(1, 2, 6, 2, 3, 8, MAT.skinFeyMoss);
  // A large eye on each side with a pale catchlight, and the slightly jutting lower jaw.
  for (const x of [0, 2]) s.box(x, 4, 11, x + 1, 6, 13, MAT.hairBlack).set(x, 5, 12, MAT.cream);
  return fishModel('fish:driftglass-herring', s, [1.5, 3.5, 15], [1.5, 5.5, 3]);
}

/** Oblong and thick-lipped, with one long ink-dark dorsal from neck to tail and a small rounded tail. */
export function createInkfinWrasse(): FishModel {
  const s = new Sculpt(7, 13, 16);
  body(s, 3.5, 3, [
    [5, 7, 1.5], [4, 8, 1.5], [3, 9, 2.5], [3, 9, 2.5], [2, 9, 2.5], [2, 9, 2.5], [2, 9, 2.5],
    [2, 9, 2.5], [2, 9, 2.5], [3, 9, 2.5], [3, 8, 2.5], [3, 7, 1.5],
  ], MAT.slate);
  s.paint((_x, y, _z, m) => y <= 3 ? MAT.fabricBlue : m);
  // Small rounded tail.
  s.box(3, 4, 2, 4, 9, 3, MAT.hairBlack).box(3, 3, 1, 4, 10, 2, MAT.hairBlack).box(3, 4, 0, 4, 9, 1, MAT.hairBlack);
  // The long continuous ink dorsal and a matching anal fin.
  s.box(3, 9, 4, 4, 10, 5, MAT.hairBlack).box(3, 10, 4, 4, 11, 13, MAT.hairBlack).box(3, 11, 5, 4, 12, 12, MAT.hairBlack);
  s.box(3, 2, 5, 4, 3, 7, MAT.hairBlack).box(3, 1, 5, 4, 2, 10, MAT.hairBlack);
  s.box(0, 4, 8, 1, 6, 10, MAT.fabricMutedViolet).box(6, 4, 8, 7, 6, 10, MAT.fabricMutedViolet);
  // A pale scribble across each cheek, and eyes with a pale rim behind.
  for (const x of [1, 5]) {
    s.set(x, 5, 11, MAT.cream).set(x, 5, 12, MAT.cream).set(x, 4, 12, MAT.cream).set(x, 4, 13, MAT.cream);
    s.set(x, 7, 13, MAT.hairBlack).set(x, 7, 12, MAT.cream);
  }
  // Thick pale lips, upper and lower, around a dark mouth line.
  s.box(2, 5, 14, 5, 6, 16, MAT.cream).box(2, 3, 14, 5, 4, 16, MAT.limestone).box(3, 4, 14, 4, 5, 15, MAT.earth);
  return fishModel('fish:inkfin-wrasse', s, [3.5, 4.5, 16], [3.5, 6.5, 3]);
}

/** All head: a broad flat skull with frill horns over raised eyes, banded fan pectorals and a short tapering tail. */
export function createTidepoolSculpin(): FishModel {
  const s = new Sculpt(15, 10, 13);
  body(s, 7.5, 2, [
    [2, 3, 0.5], [1, 4, 1.5], [1, 4, 1.5], [1, 4, 2.5], [1, 4, 2.5], [1, 5, 3.5],
    [1, 6, 4.5], [1, 7, 5.5], [1, 7, 5.5], [1, 6, 4.5], [1, 5, 3.5],
  ], MAT.moss);
  // Camouflage in mirrored two-cell blotches: rust and olive over moss, a cream belly.
  s.paint((x, y, z, m) => {
    if (y <= 1) return MAT.cream;
    const blotch = (Math.floor(Math.abs(x - 7) / 2) * 3 + Math.floor(y / 2) * 5 + Math.floor(z / 2) * 2) % 7;
    return blotch === 0 ? MAT.hairCopper : blotch === 3 ? MAT.fabricMutedGold : m;
  });
  // Small rounded tail.
  s.box(7, 1, 1, 8, 5, 2, MAT.fabricMutedGold).box(7, 2, 0, 8, 4, 1, MAT.hairCopper);
  // Low spiny dorsal ridge rising toward the head.
  s.box(7, 5, 3, 8, 6, 7, MAT.terracotta).box(7, 6, 5, 8, 7, 8, MAT.hairCopper).set(7, 7, 6, MAT.hairCopper);
  // Fan pectorals: flat, rounded and banded, spread wide behind the head.
  const fan: readonly [dx: number, z0: number, z1: number, material: number][] = [
    [0, 5, 7, MAT.moss], [1, 4, 8, MAT.moss], [2, 3, 9, MAT.cream], [3, 3, 9, MAT.fabricMutedGold], [4, 4, 8, MAT.hairCopper],
  ];
  for (const [dx, z0, z1, material] of fan) for (const x of [10 + dx, 4 - dx]) s.box(x, 2, z0, x + 1, dx === 4 ? 4 : 3, z1, material);
  // Raised eyes on the skull, each with a frill horn just behind it.
  for (const x of [5, 9]) s.box(x, 8, 9, x + 1, 10, 10, MAT.hairCopper).set(x, 7, 10, MAT.terracotta).set(x, 8, 10, MAT.hairBlack);
  // Pale cheek patches under the eyes, then a wide, flat mouth.
  s.box(2, 3, 10, 3, 5, 12, MAT.cream).box(12, 3, 10, 13, 5, 12, MAT.cream);
  s.box(5, 2, 12, 10, 3, 13, MAT.earth);
  return fishModel('fish:tidepool-sculpin', s, [7.5, 2.5, 13], [7.5, 2.5, 2]);
}
