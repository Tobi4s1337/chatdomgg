import type { AvatarAttachmentId } from '@chatdom/shared';
import { mirrored, type BodyFamily } from '../avatars/body';
import { GARB } from '../avatars/palette';
import { Sculpt } from '../avatars/sculpt';
import { styleRow, torsoTop, type AvatarStyle } from './styles';

/** Everyday garb colours carried over from the wardrobe look: shirt and breeches swatches. */
export interface StyleGarb { readonly skin: number; readonly shirt: number; readonly trousers: number }

/** Workpieces in root-local rest cells, keyed by the attachment each rides. */
export type StyleBodyPieces = Map<AvatarAttachmentId, Sculpt>;

/**
 * The head volume of a style. Sharp styles are a plain box; bevelled ones follow the wardrobe's own head
 * recipe at their size: a rounder skull behind the ears and over the crown, a crisper face plate in front,
 * and a jaw tucked a cell in from the cheeks.
 */
export function styleHead(style: AvatarStyle, material: number): Sculpt {
  const { x: [x0, x1], y: [y0, y1], z: [z0, z1], crown, face } = style.head;
  const head = new Sculpt();
  if (crown === 0 && face === 0) return head.box([x0, y0, z0], [x1, y1, z1], material);
  head.rounded([x0, y0, z0], [x1, y1, z1], material, crown, [true, true, false, true, true, false]);
  head.rounded([x0, y0, 0], [x1, y1 - 1, z1], material, face, [true, true, true, true, false, true]);
  head.rounded([x0 + 1, y0, 0], [x1 - 1, y1, z1], material, face, [true, true, false, true, false, true]);
  head.box([x0, y0, 0], [x0 + 1, y0 + 1, z1], 0).box([x1 - 1, y0, 0], [x1, y0 + 1, z1], 0);
  return head;
}

/** Repaint the front-most occupied cell at (x, y): face details sit on whatever the face plate's depth is. */
function paintFront(head: Sculpt, x: number, y: number, material: number, z1: number): void {
  for (let z = z1 - 1; z > z1 - 4; z--) if (head.get(x, y, z)) { head.set(x, y, z, material); return; }
}

/**
 * Eyes, eye whites, catch-lights, cheeks and mouth on the face plate, mirrored. The white sits on the
 * outer side of each pupil, as on the wardrobe's own face, so dark skins still read eyes.
 */
export function paintStyleFace(style: AvatarStyle, head: Sculpt): void {
  const h = style.head, z1 = h.z[1];
  for (const side of [-1, 1] as const) {
    const flip = (x: number): number => side < 0 ? x : -1 - x;
    for (let y = h.eyeBottom; y < h.eyeTop; y++) {
      for (let x = h.pupil[0]; x < h.pupil[1]; x++) paintFront(head, flip(x), y, GARB.eye, z1);
      paintFront(head, flip(h.white), y, GARB.sclera, z1);
    }
    // One lamp: the catch-light sits in the same corner of both eyes.
    if (h.catchLight) paintFront(head, side < 0 ? h.pupil[0] : -1 - (h.pupil[1] - 1), h.eyeTop - 1, GARB.catchLight, z1);
    for (let x = h.cheek[0]; x < h.cheek[1]; x++) paintFront(head, flip(x), h.cheekRow, GARB.blush, z1);
  }
  for (const x of [-1, 0]) paintFront(head, x, h.mouthRow, GARB.blush, z1);
}

/** A torso row as a ring with softened vertical corners (or a crisp slab when the style has no bevel). */
function slice(s: Sculpt, style: AvatarStyle, family: BodyFamily, y: number, material: number, inset = 0): void {
  const { half, back, front } = styleRow(style, family, y);
  const from: [number, number, number] = [-half + inset, y, back + inset], to: [number, number, number] = [half - inset, y + 1, front - inset];
  if (style.round === 0) s.box(from, to, material);
  else s.rounded(from, to, material, Math.min(style.round, half - inset - 1, front - back - 2 * inset - 1) as 1 | 2, [true, true, false, false, true, true]);
}

function torso(style: AvatarStyle, family: BodyFamily, garb: StyleGarb): { chest: Sculpt; pelvis: Sculpt } {
  const top = torsoTop(style, family);
  const colour = (y: number): number => y < style.breechesTop ? garb.trousers : garb.shirt;
  const chest = new Sculpt(), pelvis = new Sculpt();
  for (let y = style.torsoBottom; y <= top; y++) slice(y < style.chestY ? pelvis : chest, style, family, y, colour(y));
  // Hidden tongue into the pelvis keeps the waist closed when the chest bows.
  for (let y = Math.max(style.torsoBottom, style.chestY - 2); y < style.chestY; y++) slice(chest, style, family, y, colour(y), 1);
  // Belt with a brass buckle a little off-centre, on whichever part holds that row.
  const beltPart = style.beltRow < style.chestY ? pelvis : chest;
  const belt = styleRow(style, family, style.beltRow);
  beltPart.paint([-belt.half, style.beltRow, belt.back], [belt.half, style.beltRow + 1, belt.front], GARB.leather);
  beltPart.box([1, style.beltRow, belt.front - 1], [3, style.beltRow + 1, belt.front], GARB.clasp);
  // An open collar shows a little skin under the chin; a neck where the style has one.
  const collar = styleRow(style, family, top);
  chest.box([-1, top, collar.front - 1], [1, top + 1, collar.front], garb.skin);
  if (style.neck) chest.box([-style.neck.half, style.neck.y[0], -1], [style.neck.half, style.neck.y[1], 1], garb.skin);
  return { chest, pelvis };
}

function leftArm(style: AvatarStyle, family: BodyFamily, garb: StyleGarb): { upper: Sculpt; fore: Sculpt; hand: Sculpt } {
  const { inner, outer, back, front, top, cap } = style.families[family].arm;
  const [x0, x1] = [-outer, -inner];
  const upper = new Sculpt().box([x0, style.elbowY, back], [x1, top + 1, front], garb.shirt);
  if (cap) upper.box([x1, top, back], [x1 + cap, top + 1, front], garb.shirt);
  if (style.round) upper.set(x0, top, back, 0).set(x0, top, front - 1, 0);
  const fore = new Sculpt().box([x0, style.wristY, back], [x1, style.elbowY, front], garb.shirt);
  // The hand: a block the width of the cuff (a mitten fist reaches a cell further forward), its lower
  // corners taken off so it reads as a hand rather than a cube. Its top row always meets the cuff.
  const hand = new Sculpt().box([x0, style.handBottom, back], [x1, style.wristY, front + style.mitten], garb.skin);
  if (style.round) for (const x of x1 - x0 > 2 ? [x0, x1 - 1] : [x0]) for (const z of [back, front + style.mitten - 1]) hand.set(x, style.handBottom, z, 0);
  return { upper, fore, hand };
}

function leftLeg(style: AvatarStyle, family: BodyFamily, garb: StyleGarb): { thigh: Sculpt; shin: Sculpt; foot: Sculpt } {
  const { outer, inner, back, front } = style.families[family].leg;
  const thigh = new Sculpt().box([outer, style.kneeY, back], [inner, style.hipY, front], garb.trousers);
  // Hip cap hidden in the pelvis, so a stride closes the seat instead of opening a wedge.
  if (inner - outer > 2) thigh.box([outer + 1, style.hipY, back + 1], [inner - 1, style.hipY + 1, front - 1], garb.trousers);
  const shin = new Sculpt().box([outer, style.ankleY, back], [inner, style.kneeY, front], garb.trousers);
  const foot = new Sculpt();
  const to: [number, number, number] = [inner, style.ankleY, front + style.toe];
  foot.box([outer, 0, back], to, GARB.leather);
  // Soften the toe's top edge (never under the shin, so the shoe always meets the leg); chunky shoes
  // also round their outer toe corner.
  if (style.round && style.toe) {
    for (let x = outer; x < inner; x++) foot.set(x, style.ankleY - 1, front + style.toe - 1, 0);
    if (style.round > 1) foot.set(outer, 0, front + style.toe - 1, 0).set(inner - 1, 0, front + style.toe - 1, 0);
  }
  // A darker welt is the sole line.
  foot.paint([outer, 0, back], [inner, 1, front + style.toe], GARB.breeches);
  return { thigh, shin, foot };
}

/**
 * The body in its everyday garb, in a style's proportions: shirt and breeches in the look's own colours,
 * belt and buckle, open collar, shoes with a sole line. Head and hands carry the look's skin.
 */
export function styleBodyPieces(style: AvatarStyle, family: BodyFamily, garb: StyleGarb): StyleBodyPieces {
  const head = styleHead(style, garb.skin);
  paintStyleFace(style, head);
  const { chest, pelvis } = torso(style, family, garb);
  const pieces: StyleBodyPieces = new Map([['pelvis', pelvis], ['chest', chest], ['head', head]]);
  for (const side of ['Left', 'Right'] as const) {
    const arm = leftArm(style, family, garb), leg = leftLeg(style, family, garb);
    const flip = (s: Sculpt): Sculpt => side === 'Left' ? s : mirrored(s);
    pieces.set(`upperArm${side}`, flip(arm.upper)).set(`forearm${side}`, flip(arm.fore)).set(`hand${side}`, flip(arm.hand));
    pieces.set(`thigh${side}`, flip(leg.thigh)).set(`shin${side}`, flip(leg.shin)).set(`foot${side}`, flip(leg.foot));
  }
  return pieces;
}
