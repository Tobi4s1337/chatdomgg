import type { AvatarPartBlueprint } from '@chatdom/shared';
import { GARB, materialName, resolveSkin, type SkinSwatchId } from './palette';
import { Sculpt } from './sculpt';

/** Body silhouettes, named for shape. All share the frozen rig, joints, sockets and ground datum. */
export const BODY_FAMILIES = ['balanced', 'slender', 'broad', 'round'] as const;
export type BodyFamily = (typeof BODY_FAMILIES)[number];

/** One horizontal slice of the torso: half-width from the centre line, back and front faces (cells). */
export interface Section { readonly half: number; readonly back: number; readonly front: number }

/**
 * Contours in root-local avatar cells. The rig's joints never move: shoulders stay at x = ±5, hips at
 * x = ±2, and every family keeps the same head, so a family changes the volume around the bones,
 * never a bone's length, the head or the height.
 */
export interface Contour {
  /** Torso slices for rows 8–15, bottom first: hips 8–9, waist 10–11 (belt on 10), chest 12–15. */
  readonly torso: readonly Section[];
  /** Widest/deepest extent over the chest (12–15), waist (10–11) and hip (8–9) rows, for fitting garments. */
  readonly chest: Section;
  readonly waist: Section;
  readonly hip: Section;
  /** Leg columns: outer and inner X edges of the left leg (mirrored), and depth. */
  readonly leg: { readonly outer: number; readonly inner: number; readonly back: number; readonly front: number };
  /**
   * Arm column X edges (right side; mirrored) and depth. `top` is the arm's highest row: 15 on a square
   * shoulder, lower where the shoulder slopes; `cap` widens the arm inward at its top rows so it meets a
   * sloping chest instead of leaving daylight under the collar.
   */
  readonly arm: { readonly inner: number; readonly outer: number; readonly back: number; readonly front: number; readonly top: number; readonly cap: number };
}

const rows = (...slices: readonly (readonly [half: number, back: number, front: number])[]): readonly Section[] =>
  slices.map(([half, back, front]) => ({ half, back, front }));

/** Author a family by its torso slices; the summary sections are derived so they never disagree. */
function contour(torso: readonly Section[], leg: Contour['leg'], arm: Contour['arm']): Contour {
  if (torso.length !== 8) throw new Error('A torso has eight rows, 8–15.');
  const extent = (from: number, to: number): Section => {
    const band = torso.slice(from - 8, to - 8);
    return { half: Math.max(...band.map(s => s.half)), back: Math.min(...band.map(s => s.back)), front: Math.max(...band.map(s => s.front)) };
  };
  return { torso, chest: extent(12, 16), waist: extent(10, 12), hip: extent(8, 10), leg, arm };
}

/**
 * Four families that read apart as unlit silhouettes, across the arms at shoulder height:
 * - balanced: an even column, twelve cells across the arms, shoulders as wide as the hips.
 * - slender: a narrow column the width of the head, shallow through the body, with two-cell legs.
 * - broad: square shoulders eighteen cells across a deep chest, tapering to the waist; thick arms
 *   hang clear of the waist, so daylight shows under them.
 * - round: shoulders that slope from the collar, widening to a soft forward belly and full hips over
 *   a sturdy four-cell stance; the arms rest against the belly.
 */
const CONTOURS: Record<BodyFamily, Contour> = {
  balanced: contour(
    rows([4, -3, 3], [4, -3, 3], [4, -3, 3], [4, -3, 3], [4, -3, 3], [4, -3, 3], [4, -3, 3], [4, -3, 3]),
    { outer: -4, inner: -1, back: -2, front: 2 },
    { inner: 4, outer: 6, back: -1, front: 1, top: 15, cap: 0 },
  ),
  slender: contour(
    rows([3, -2, 2], [3, -2, 2], [3, -2, 2], [3, -2, 2], [3, -2, 3], [3, -2, 3], [3, -2, 3], [3, -2, 2]),
    { outer: -3, inner: -1, back: -1, front: 1 },
    { inner: 3, outer: 5, back: -1, front: 1, top: 15, cap: 0 },
  ),
  broad: contour(
    rows([4, -3, 3], [4, -3, 3], [4, -3, 3], [5, -3, 3], [5, -3, 4], [6, -4, 4], [6, -4, 4], [6, -4, 3]),
    { outer: -4, inner: -1, back: -2, front: 2 },
    { inner: 6, outer: 9, back: -2, front: 1, top: 15, cap: 0 },
  ),
  round: contour(
    rows([5, -3, 3], [5, -3, 4], [5, -3, 5], [5, -3, 5], [5, -3, 4], [5, -3, 4], [4, -3, 3], [3, -2, 2]),
    { outer: -5, inner: -1, back: -2, front: 2 },
    { inner: 5, outer: 7, back: -1, front: 1, top: 14, cap: 1 },
  ),
};

export function bodyContour(family: BodyFamily): Contour {
  const found = Object.hasOwn(CONTOURS, family) ? CONTOURS[family] : undefined;
  if (!found) throw new Error(`Unknown body family ${String(family)}.`);
  return found;
}

/** The torso slice at a row (8–15). */
export function torsoRow(c: Contour, y: number): Section {
  const section = c.torso[y - 8];
  if (!section) throw new Error(`Row ${y} is not a torso row.`);
  return section;
}

/**
 * The shared chibi head: ten cells wide, eight tall (one third of the 24-cell height), eight deep,
 * bevelled on every edge with a softer crown and jaw. Front face plane is z = 4 (the face socket).
 */
export function headVolume(material: number): Sculpt {
  const head = new Sculpt();
  // A rounder skull behind the ears, a crisp face plate in front: r=2 back and crown, r=1 face.
  head.rounded([-5, 16, -4], [5, 24, 4], material, 2, [true, true, false, true, true, false]);
  head.rounded([-5, 16, 0], [5, 23, 4], material, 1, [true, true, true, true, false, true]);
  head.rounded([-4, 16, 0], [4, 24, 4], material, 1, [true, true, false, true, false, true]);
  // Tuck the jaw so the chin sits a little in from the cheeks.
  head.box([-5, 16, 0], [-4, 17, 4], 0).box([4, 16, 0], [5, 17, 4], 0);
  return head;
}

/**
 * Face details sit on the front plane: catch-lit eyes and warm cheeks, readable at street distance.
 * Each eye has a linen white on its outer side. On pale skin it nearly vanishes; on the darkest skins,
 * where the pupil is as dark as the face, it is what draws the eye.
 */
function paintFace(head: Sculpt): void {
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -3 : 1;
    head.box([x0, 19, 3], [x0 + 2, 21, 4], GARB.eye);
    const white = side < 0 ? x0 - 1 : x0 + 2;
    head.box([white, 19, 3], [white + 1, 21, 4], GARB.sclera);
    // The catch-light faces the same way on both eyes, like a single lamp.
    head.set(x0, 20, 3, GARB.catchLight);
    const cheek = side < 0 ? -4 : 3;
    head.set(cheek, 18, 3, GARB.blush);
  }
  head.box([-1, 17, 3], [1, 18, 4], GARB.blush);
}

/** One torso row with its vertical corners cut, so every slice is a softened ring rather than a slab. */
function slice(s: Sculpt, c: Contour, y: number, material: number, inset = 0): void {
  const { half, back, front } = torsoRow(c, y);
  s.rounded([-half + inset, y, back + inset], [half - inset, y + 1, front - inset], material, 1, [true, true, false, false, true, true]);
}

function torso(c: Contour, skin: SkinSwatchId): { chest: Sculpt; pelvis: Sculpt } {
  const chest = new Sculpt();
  for (let y = 12; y < 16; y++) slice(chest, c, y, GARB.linen);
  // An open collar shows a little skin under the chin, so the body carries its skin, not only the head.
  const collar = torsoRow(c, 15);
  chest.box([-1, 15, collar.front - 1], [1, 16, collar.front], skin);
  // Hidden tongue into the pelvis keeps the waist closed when the chest bows.
  for (let y = 10; y < 12; y++) slice(chest, c, y, GARB.linen, 1);

  const pelvis = new Sculpt();
  for (let y = 8; y < 12; y++) slice(pelvis, c, y, y < 10 ? GARB.breeches : GARB.linen);
  // Belt at the waist, with a brass buckle a little off-centre.
  const belt = torsoRow(c, 10);
  pelvis.paint([-belt.half, 10, belt.back], [belt.half, 11, belt.front], GARB.leather);
  pelvis.box([1, 10, belt.front - 1], [3, 11, belt.front], GARB.clasp);
  return { chest, pelvis };
}

function leftArm(c: Contour, skin: SkinSwatchId): { upper: Sculpt; fore: Sculpt; hand: Sculpt } {
  const { outer, inner, back, front, top, cap } = c.arm;
  const [x0, x1] = [-outer, -inner];
  const upper = new Sculpt().box([x0, 11, back], [x1, top + 1, front], GARB.linen);
  // A sloping shoulder: the top of the sleeve reaches in to meet the collar.
  if (cap) upper.box([x1, top, back], [x1 + cap, top + 1, front], GARB.linen);
  // Round the shoulder cap outward.
  upper.set(x0, top, back, 0).set(x0, top, front - 1, 0);
  const fore = new Sculpt().box([x0, 8, back], [x1, 11, front], GARB.linen);
  const hand = new Sculpt().box([x0, 6, back], [x1, 8, front + 1], skin);
  hand.set(x0, 6, front, 0);
  return { upper, fore, hand };
}

function leftLeg(c: Contour): { thigh: Sculpt; shin: Sculpt; foot: Sculpt } {
  const { outer, inner, back, front } = c.leg;
  const thigh = new Sculpt().box([outer, 4, back], [inner, 8, front], GARB.breeches);
  // Hip cap: a half disc about the hip axis inside the pelvis keeps the seat closed through a stride.
  for (let y = 8; y < 10; y++) for (let z = back; z < front; z++) if ((y + .5 - 8) ** 2 + (z + .5) ** 2 <= 4.5) thigh.box([outer + 1, y, z], [inner, y + 1, z + 1], GARB.breeches);
  const shin = new Sculpt().box([outer, 2, back], [inner, 4, front], GARB.breeches);
  // Knee cap inside the thigh, same reasoning for the walk's bent knee. A two-cell leg has no room for one.
  if (inner - outer > 2) for (let y = 4; y < 6; y++) for (let z = back; z < front; z++) if ((y + .5 - 4) ** 2 + (z + .5) ** 2 <= 3.2) shin.box([outer + 1, y, z], [inner - 1, y + 1, z + 1], GARB.breeches);
  const foot = new Sculpt();
  foot.rounded([outer, 0, back], [inner, 2, front + 2], GARB.leather, 1, [false, false, false, true, true, true]);
  // A darker welt is the shoe's sole line; soft shoes keep it flush.
  foot.paint([outer, 0, back], [inner, 1, front + 2], GARB.breeches);
  return { thigh, shin, foot };
}

/**
 * The body in its comfortable neutral garb: linen shirt and tunic, belted breeches and soft shoes.
 * Head and hands carry the chosen skin; nothing about the body depends on any account or reward.
 */
export function createBodyParts(family: BodyFamily, skin: SkinSwatchId): readonly AvatarPartBlueprint[] {
  const c = bodyContour(family);
  const swatch = resolveSkin(skin);
  const tag = `${family}.${materialName(swatch)}`;
  const head = headVolume(swatch);
  paintFace(head);
  const { chest, pelvis } = torso(c, swatch);
  const parts: AvatarPartBlueprint[] = [
    pelvis.toPart(`body.${tag}.pelvis`, 'pelvis', 'body'),
    chest.toPart(`body.${tag}.chest`, 'chest', 'body'),
    head.toPart(`body.${tag}.head`, 'head', 'body'),
  ];
  for (const side of ['Left', 'Right'] as const) {
    const arm = leftArm(c, swatch), leg = leftLeg(c);
    const flip = (s: Sculpt): Sculpt => side === 'Left' ? s : mirrored(s);
    parts.push(
      flip(arm.upper).toPart(`body.${tag}.upperArm${side}`, `upperArm${side}`, 'body'),
      flip(arm.fore).toPart(`body.${tag}.forearm${side}`, `forearm${side}`, 'body'),
      flip(arm.hand).toPart(`body.${tag}.hand${side}`, `hand${side}`, 'body'),
      flip(leg.thigh).toPart(`body.${tag}.thigh${side}`, `thigh${side}`, 'body'),
      flip(leg.shin).toPart(`body.${tag}.shin${side}`, `shin${side}`, 'body'),
      flip(leg.foot).toPart(`body.${tag}.foot${side}`, `foot${side}`, 'body'),
    );
  }
  return parts;
}

/** A copy reflected across x = 0 (cell x maps to -1 - x). */
export function mirrored(source: Sculpt): Sculpt {
  const { min, max } = source.bounds();
  const out = new Sculpt();
  for (let z = min[2]; z < max[2]; z++) for (let y = min[1]; y < max[1]; y++) for (let x = min[0]; x < max[0]; x++) {
    const m = source.get(x, y, z);
    if (m) out.set(-1 - x, y, z, m);
  }
  return out;
}
