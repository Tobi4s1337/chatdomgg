import type { AvatarPartBlueprint, Vec3 } from '@chatdom/shared';
import { BODY_FAMILIES, bodyContour, headVolume, skullVolume, type BodyFamily } from './body';
import { GARB, materialName, resolveHair, type HairSwatchId } from './palette';
import { Sculpt } from './sculpt';
import type { HeadwearId } from './wearables';

/**
 * Scalp and hair treatments, in catalogue order. Every one binds rigidly to the frozen head bone;
 * `bareScalp` is a real choice with no hair geometry at all.
 */
export const HAIR_FORMS = ['bareScalp', 'closeCrop', 'roundedCurls', 'coiledHighCrown', 'sidePart', 'bob', 'longBraid', 'pairedTwists'] as const;
export type HairForm = (typeof HAIR_FORMS)[number];

/** Lane-local selection: the body, a registered hair swatch, and the headwear the hair must fit under. */
export interface HairFit {
  readonly body: BodyFamily;
  readonly hair: HairSwatchId;
  readonly headwear: HeadwearId | null;
}

/**
 * The head the hair is grown on. Skull coordinates: x ∈ [−5, 5), y ∈ [16, 24), z ∈ [−4, 4), the
 * face plane at z = 3, eyes on rows 19–20, ears at x = −6 and 5 on rows 18–19.
 */
interface Scalp {
  readonly m: number;
  readonly skull: Sculpt;
  readonly head: Sculpt;
  /** Offset shells of the skull, one to three cells out. */
  readonly shells: readonly [Sculpt, Sculpt, Sculpt];
}

function scalp(m: number): Scalp {
  const skull = skullVolume(m);
  return { m, skull, head: headVolume(m), shells: [skull.shell(1, m), skull.shell(2, m), skull.shell(3, m)] };
}

/** True in front of the face plate below `brow`, where hair would cover the eyes or cheeks. */
const overFace = (x: number, y: number, z: number, brow: number, half = 5): boolean => z >= 2 && x >= -half && x < half && y < brow;

/** Finishes a form: no cell inside the head (so layers meet face to face) and the face kept clear. */
function finish(hair: Sculpt, s: Scalp, brow: number): Sculpt {
  hair.carveWhere((x, y, z) => overFace(x, y, z, brow, 4) || (z >= 3 && y < brow - 1 && x >= -5 && x < 5));
  return hair.subtract(s.head);
}

/**
 * Close crop: one even cell of hair over the crown, a clean hairline high on the forehead, neat
 * edges around the ears and a tapered nape. The simplest silhouette, so it carries the skull's shape.
 */
function closeCrop(s: Scalp): Sculpt {
  const hair = new Sculpt().merge(s.shells[0], (x, y, z) => {
    if (z >= 3) return y >= 23;
    if (z >= 1) return y >= 21;
    if (z >= -2) return y >= 20;
    return y >= 18;
  });
  // Squared sideburns in front of each ear.
  for (const x of [-6, 5]) hair.box([x, 19, 1], [x + 1, 21, 2], s.m);
  return finish(hair, s, 23);
}

/** A rounded bobble of hair: a small ellipsoid, the unit every curly form is built from. */
function bobble(hair: Sculpt, centre: Vec3, r: number, m: number): void {
  hair.ellipsoid(centre, [r, r * .9, r], m);
}

/** Points on a horizontal ellipse around the head axis (x centred between cells), from the back. */
function ring(y: number, rx: number, rz: number, count: number, from = 0, to = 360, zc = -.25): Vec3[] {
  const out: Vec3[] = [];
  const span = to - from;
  for (let i = 0; i < count; i++) {
    const a = (from + (span === 360 ? span * i / count : span * i / Math.max(count - 1, 1))) * Math.PI / 180;
    out.push([Math.sin(a) * rx, y, zc - Math.cos(a) * rz]);
  }
  return out;
}

/**
 * Rounded curls: a full head of springy curls, built as rings of large rounded bobbles over a close
 * base, so it reads as distinct curls at street distance rather than a cap with texture. The fringe
 * is a row of smaller curls across the forehead; the back falls to the nape.
 */
function roundedCurls(s: Scalp): Sculpt {
  const hair = new Sculpt().merge(s.shells[1], (_x, y, z) => (z >= 2 ? y >= 22 : y >= 18));
  const curls: [Vec3[], number][] = [
    [[[0, 25.4, -.5]], 2.6],
    [ring(25, 3.2, 2.8, 6, 30), 1.9],
    [ring(23, 5.6, 4.9, 10, 18), 1.9],
    [ring(20.6, 6.1, 5.1, 7, -110, 110), 1.8],
    [ring(18.4, 5.6, 4.8, 5, -70, 70), 1.7],
    // The fringe: smaller curls over the brow.
    [[[-3.4, 23.2, 4.2], [-1.2, 23.6, 4.5], [1.2, 23.6, 4.5], [3.4, 23.2, 4.2]], 1.4],
  ];
  for (const [centres, r] of curls) for (const c of centres) bobble(hair, c, r, s.m);
  return finish(hair, s, 22);
}

/**
 * Coiled high crown: tight coils gathered into a tall rounded crown, a substantial mass that lifts the
 * silhouette above the head, with close-cropped sides and nape. Big lobes break the outline into a
 * soft cloud; there is no scattered single-voxel texture.
 */
function coiledHighCrown(s: Scalp): Sculpt {
  const hair = new Sculpt().merge(s.shells[0], (_x, y, z) => (z >= 2 ? y >= 23 : z >= -1 ? y >= 20 : y >= 18));
  hair.ellipsoid([0, 26, -.6], [5.6, 4, 5], s.m);
  for (const c of ring(27.2, 3.6, 3.2, 6, 0)) bobble(hair, c, 2.1, s.m);
  for (const c of ring(25.2, 5.1, 4.5, 8, 22)) bobble(hair, c, 1.9, s.m);
  bobble(hair, [0, 29.2, -.6], 2.2, s.m);
  // Below the mass the crown narrows into the close sides.
  hair.carveWhere((x, y, z) => y < 22 && (x < -6 || x >= 6 || z < -6));
  return finish(hair, s, 23);
}

/**
 * Side part. Built from offset shells of the skull, so it follows the head exactly: one cell close on
 * the parted (left) side, two cells of lift over the crown and the full right side, a rounded
 * occipital mass and a tidy nape. The fringe is one sheet whose lower edge steps down diagonally
 * from the parting to the right temple, where a short lock falls past the ear.
 */
function sidePart(s: Scalp): Sculpt {
  const [near, far] = s.shells;
  const hair = new Sculpt();
  hair.merge(near, (_x, y) => y >= 18);
  hair.merge(far, (x, y, z) => (y >= 23 && x >= -2) || (x >= 3 && y >= 19 && z < 3) || (z <= -4 && y >= 19 && y < 25));
  // Fringe line: high at the parting, falling two cells at a time toward the right temple.
  const fringe = (x: number): number => x < -4 ? 21 : x < -2 ? 23 : x < 0 ? 22 : x < 4 ? 21 : 19;
  hair.carveWhere((x, y, z) => {
    if (z >= 3 && x >= -6 && x < 4 && y < fringe(x)) return true;
    // The parted side lies close above the ear and tapers to the nape.
    if (x < -5 && z >= -2 && y < 21) return true;
    if (x < -5 && y < 19) return true;
    if (x >= 5 && z >= -2 && z < 1 && y < 20) return true;
    if (z <= -5 && y < 19 && (x < -3 || x >= 3)) return true;
    return false;
  });
  // The right temple lock: a short fall of hair in front of the ear.
  hair.box([5, 18, 1], [7, 21, 4], s.m);
  hair.set(5, 18, 3, 0).set(6, 18, 3, 0).set(6, 18, 1, 0);
  // Parting: a notch where the close side meets the lift.
  for (let z = -1; z < 4; z++) hair.set(-2, 24, z, 0);
  return hair.subtract(s.head);
}

/**
 * Bob: a smooth chin-length cut with a straight, heavy fringe. Two cells of hair everywhere, a crisp
 * level hem at the jaw that tucks under by one cell, and front corners that frame the cheeks.
 */
function bob(s: Scalp): Sculpt {
  const hair = new Sculpt().merge(s.shells[1], (_x, y) => y >= 17);
  // The blunt fringe stands one cell proud of the brow, cut level just above the eyes.
  hair.box([-5, 22, 4], [5, 24, 5], s.m);
  hair.box([-4, 24, 3], [4, 25, 5], s.m);
  hair.carveWhere((x, y, z) => {
    if (z >= 3 && x >= -5 && x < 5 && y < 22) return true;
    // Tuck the hem: the innermost ring of the lowest row is cut away so the cut curves under.
    if (y === 17 && Math.abs(x + .5) < 6.5 && z > -6 && z < 4) return !(Math.abs(x + .5) >= 6 || z <= -5);
    return false;
  });
  // The front corners of the bob reach a cell past the face plane, framing the cheeks.
  for (const x of [-7, -6, 5, 6]) hair.box([x, 17, 4], [x + 1, 22, 5], s.m);
  hair.set(-7, 17, 4, 0).set(6, 17, 4, 0);
  return hair.subtract(s.head);
}

/**
 * Long braid: hair drawn smoothly back from the face into a knot at the nape, then one three-strand
 * braid that falls straight down the back to the waist, tied with a leather cord and finished with a
 * soft tuft. The plait reads as alternating lobes stepping left and right every two rows.
 * The braid hangs one cell clear of the deepest point of the wearer's back.
 */
function longBraid(s: Scalp, body: BodyFamily): Sculpt {
  const c = bodyContour(body);
  const hair = new Sculpt().merge(s.shells[0], (_x, y, z) => (z >= 3 ? y >= 23 : z >= 0 ? y >= 21 : y >= 18));
  // Fuller over the crown and back, where the hair is gathered.
  hair.merge(s.shells[1], (_x, y, z) => z <= -2 && y >= 19 && y < 24);
  const deepest = Math.min(c.chest.back, c.waist.back, c.hip.back);
  const front = Math.min(-4, deepest - 1);
  // The gathered knot at the nape.
  hair.rounded([-2, 18, front - 3], [2, 22, front + 1], s.m, 1);
  // Five plait segments, each two rows, alternating a cell to each side; the strand crossing shows as a step.
  for (let i = 0; i < 5; i++) {
    const top = 18 - i * 2, shift = i % 2 === 0 ? -1 : 0;
    hair.box([-1 + shift, top - 2, front - 2], [2 + shift, top, front], s.m);
    // Round each lobe's outer lower corner so the segments read as separate bundles.
    hair.set(shift < 0 ? -2 : 1, top - 2, front - 2, 0);
  }
  // Leather tie and a short tuft below it.
  hair.box([-1, 7, front - 2], [1, 8, front], GARB.leather);
  hair.box([-1, 5, front - 2], [1, 7, front], s.m);
  hair.set(-1, 5, front - 2, 0).set(0, 5, front - 1, 0);
  return finish(hair, s, 23);
}

/**
 * Paired twists: a centre parting and two chunky twisted bunches gathered above each ear, each
 * falling outward and down to the jaw. The twist reads as segments that step back and forth by a
 * cell; the ends finish in a rounded tuft above the shoulder.
 */
function pairedTwists(s: Scalp): Sculpt {
  const hair = new Sculpt().merge(s.shells[0], (_x, y, z) => (z >= 3 ? y >= 23 : z >= 0 ? y >= 21 : y >= 18));
  hair.merge(s.shells[1], (_x, y, z) => y >= 23 && z < 3);
  // Centre parting, front to crown.
  for (let z = -2; z < 5; z++) hair.set(-1, 25, z, 0).set(0, 25, z, 0);
  // The left twist; the right is its mirror. Each segment is 3 × 2 × 3 cells.
  const twist = new Sculpt();
  const segments: Vec3[] = [[-8, 22, -2], [-9, 20, -1], [-9, 18, -2], [-9, 16, -1]];
  for (const [x, y, z] of segments) twist.rounded([x, y, z], [x + 3, y + 2, z + 3], s.m, 1, [true, true, false, false, true, true]);
  // The gathered root over the ear.
  twist.rounded([-8, 22, -3], [-5, 25, 1], s.m, 1);
  hair.merge(twist);
  hair.merge(mirrorX(twist));
  return finish(hair, s, 23);
}

function mirrorX(source: Sculpt): Sculpt {
  const out = new Sculpt();
  source.forEachCell((x, y, z, m) => { out.set(-1 - x, y, z, m); });
  return out;
}

const FORMS: Record<HairForm, ((s: Scalp, body: BodyFamily) => Sculpt) | null> = {
  bareScalp: null, closeCrop, roundedCurls, coiledHighCrown, sidePart, bob, longBraid, pairedTwists,
};

export function createHairParts(form: HairForm, fit: HairFit): readonly AvatarPartBlueprint[] {
  if (!HAIR_FORMS.includes(form)) throw new Error(`Unknown hair form ${String(form)}.`);
  if (!BODY_FAMILIES.includes(fit.body)) throw new Error(`Unknown body family ${String(fit.body)}.`);
  if (fit.headwear !== null) throw new Error(`${form} has no authored fit under ${String(fit.headwear)}.`);
  const swatch = resolveHair(fit.hair);
  const build = FORMS[form];
  if (!build) return [];
  return [build(scalp(swatch), fit.body).toPart(`hair.${form}.${materialName(swatch)}.${fit.body}`, 'head', 'hair')];
}
