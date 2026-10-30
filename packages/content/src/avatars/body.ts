import type { AvatarPartBlueprint } from '@chatdom/shared';
import { GARB, materialName, resolveSkin, type SkinSwatchId } from './palette';
import { Sculpt } from './sculpt';

/** Body silhouettes, named for shape. All share the frozen rig, joints, sockets and ground datum. */
export const BODY_FAMILIES = ['balanced'] as const;
export type BodyFamily = (typeof BODY_FAMILIES)[number];

/**
 * Contours in root-local avatar cells. Half-widths are measured from the centre line; the rig's
 * joints never move, so a family changes volume around the bones, never bone length or height.
 */
interface Contour {
  /** Chest and shoulder half-width, chest depth back/front. */
  readonly chest: { readonly half: number; readonly back: number; readonly front: number };
  /** Waist (belt row) and hip (tunic hem) half-widths and depths. */
  readonly waist: { readonly half: number; readonly back: number; readonly front: number };
  readonly hip: { readonly half: number; readonly back: number; readonly front: number };
  /** Leg columns: outer and inner X edges of the left leg (mirrored), and depth. */
  readonly leg: { readonly outer: number; readonly inner: number; readonly back: number; readonly front: number };
  /** Arm column X edges (right side; mirrored) and depth. */
  readonly arm: { readonly inner: number; readonly outer: number; readonly back: number; readonly front: number };
}

const CONTOURS: Record<BodyFamily, Contour> = {
  balanced: {
    chest: { half: 4, back: -3, front: 3 },
    waist: { half: 4, back: -3, front: 3 },
    hip: { half: 4, back: -3, front: 3 },
    leg: { outer: -4, inner: -1, back: -2, front: 2 },
    arm: { inner: 4, outer: 6, back: -1, front: 1 },
  },
};

export function bodyContour(family: BodyFamily): Contour {
  const contour = CONTOURS[family];
  if (!contour) throw new Error(`Unknown body family ${String(family)}.`);
  return contour;
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

/** Face details sit on the front plane: catch-lit eyes and warm cheeks, readable at street distance. */
function paintFace(head: Sculpt): void {
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -3 : 1;
    head.box([x0, 19, 3], [x0 + 2, 21, 4], GARB.eye);
    // The catch-light faces the same way on both eyes, like a single lamp.
    head.set(x0, 20, 3, GARB.catchLight);
    const cheek = side < 0 ? -4 : 3;
    head.set(cheek, 18, 3, GARB.blush);
  }
  head.box([-1, 17, 3], [1, 18, 4], GARB.blush);
}

function torso(c: Contour): { chest: Sculpt; pelvis: Sculpt } {
  const chest = new Sculpt();
  chest.rounded([-c.chest.half, 12, c.chest.back], [c.chest.half, 16, c.chest.front], GARB.linen, 1, [true, true, false, true, true, true]);
  // Hidden tongue into the pelvis keeps the waist closed when the chest bows.
  chest.box([-c.chest.half + 1, 10, c.chest.back + 1], [c.chest.half - 1, 12, c.chest.front - 1], GARB.linen);

  const pelvis = new Sculpt();
  pelvis.rounded([-c.waist.half, 10, c.waist.back], [c.waist.half, 12, c.waist.front], GARB.linen, 1, [true, true, false, false, true, true]);
  pelvis.rounded([-c.hip.half, 8, c.hip.back], [c.hip.half, 10, c.hip.front], GARB.breeches, 1, [true, true, false, false, true, true]);
  // Belt at the waist, with a brass buckle a little off-centre.
  pelvis.paint([-c.waist.half, 10, c.waist.back], [c.waist.half, 11, c.waist.front], GARB.leather);
  pelvis.box([1, 10, c.waist.front - 1], [3, 11, c.waist.front], GARB.clasp);
  return { chest, pelvis };
}

function leftArm(c: Contour, skin: SkinSwatchId): { upper: Sculpt; fore: Sculpt; hand: Sculpt } {
  const [x0, x1] = [-c.arm.outer, -c.arm.inner];
  const upper = new Sculpt().box([x0, 11, c.arm.back], [x1, 16, c.arm.front], GARB.linen);
  // Round the shoulder cap outward.
  upper.set(x0, 15, c.arm.back, 0).set(x0, 15, c.arm.front - 1, 0);
  const fore = new Sculpt().box([x0, 8, c.arm.back], [x1, 11, c.arm.front], GARB.linen);
  const hand = new Sculpt().box([x0, 6, c.arm.back], [x1, 8, c.arm.front + 1], skin);
  hand.set(x0, 6, c.arm.front, 0);
  return { upper, fore, hand };
}

function leftLeg(c: Contour): { thigh: Sculpt; shin: Sculpt; foot: Sculpt } {
  const { outer, inner, back, front } = c.leg;
  const thigh = new Sculpt().box([outer, 4, back], [inner, 8, front], GARB.breeches);
  // Hip cap: a half disc about the hip axis inside the pelvis keeps the seat closed through a stride.
  for (let y = 8; y < 10; y++) for (let z = back; z < front; z++) if ((y + .5 - 8) ** 2 + (z + .5) ** 2 <= 4.5) thigh.box([outer + 1, y, z], [inner, y + 1, z + 1], GARB.breeches);
  const shin = new Sculpt().box([outer, 2, back], [inner, 4, front], GARB.breeches);
  // Knee cap inside the thigh, same reasoning for the walk's bent knee.
  for (let y = 4; y < 6; y++) for (let z = back; z < front; z++) if ((y + .5 - 4) ** 2 + (z + .5) ** 2 <= 3.2) shin.box([outer + 1, y, z], [inner - 1, y + 1, z + 1], GARB.breeches);
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
  const { chest, pelvis } = torso(c);
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
