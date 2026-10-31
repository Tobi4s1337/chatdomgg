import { AVATAR_CAPE_LIMITS, AvatarCapeBlueprintSchema, VOXEL_METRES, type AvatarCapeBlueprint, type Vec3 } from '@chatdom/shared';
import { restPosition } from '../../../avatars/index';
import { Sculpt } from '../../../avatars/sculpt';
import type { KeeperTool } from '../../types';
import { frontAt, layer, mirror, tool, type BodyCells } from '../tailor';

/**
 * The lamplighter's garb, authored in root-local rest cells on the citizens' own rig: a long coat (a rigid body over the
 * torso, skirt panels on the thighs, and coat tails as the cloth sheet on the back socket), a tall hat, and the pole.
 */

/** Colours of one coat: outside cloth, the waistcoat that shows in its opening, the shirt and cravat, and brass. */
export interface CoatColours {
  readonly cloth: number;
  readonly vest: number;
  readonly shirt: number;
  readonly buttons: number;
  /** The turned-back lapels and cuffs; the cloth itself for a plain coat. */
  readonly facing: number;
}

/**
 * The coat's body over chest and hips: one cell over the torso, open down the front to show the waistcoat and a pale
 * cravat at the throat, cut away below the belt so the skirt hangs open over the breeches. The lapels stand one cell
 * proud of the chest; a double row of brass buttons closes it at the waist.
 */
export function coatBody(body: BodyCells, colours: CoatColours): Sculpt {
  const coat = layer(body, ['chest', 'pelvis'], 1, colours.cloth, (_x, y) => y >= 8 && y < 16);
  const front = (x: number, y: number): number => frontAt(body, y, x, x + 1);
  // The opening: waistcoat from the belt up, the cravat at the throat, the breeches below the belt.
  coat.paint([-2, 10, 0], [2, 16, 20], colours.vest);
  coat.paint([-1, 13, 0], [1, 16, 20], colours.shirt);
  coat.carveWhere((x, y, z) => y < 10 && z > 0 && x >= -2 && x < 2);
  // Two waistcoat buttons below the cravat.
  for (const y of [11, 12]) coat.paint([-1, y, front(-1, y)], [0, y + 1, front(-1, y) + 1], colours.buttons);
  // Lapels: a cell proud of the coat at the opening's edges, widening to the shoulder.
  for (let y = 12; y < 16; y++) {
    for (const x of [-3, 2]) coat.set(x, y, front(x, y) + 1, colours.facing);
    if (y >= 14) for (const x of [-4, 3]) if (coat.get(x, y, front(x, y))) coat.set(x, y, front(x, y), colours.facing);
  }
  // The double-breasted fastening: a brass button on each front panel at the belt and just above it.
  for (const y of [10, 11]) for (const x of [-3, 2]) coat.paint([x, y, front(x, y)], [x + 1, y + 1, front(x, y) + 1], colours.buttons);
  return coat;
}

/**
 * One skirt panel of the coat on the left thigh (mirror for the right): two cells round the outside of the leg and a
 * one-cell front edge, from the hip down to `hem`. The front stays open between the panels, so the coat reads long.
 */
export function skirtPanel(body: BodyCells, cloth: number, facing: number, hem: number): Sculpt {
  const { outer, back, front } = body.contour.leg;
  const thigh = body.bones.get('thighLeft')!;
  const panel = new Sculpt();
  panel.box([outer - 1, hem, back - 1], [outer + 1, 8, front + 1], cloth);
  panel.subtract(thigh).subtract(body.all);
  // The turned-back facing shows along the front edge.
  panel.paint([outer, hem, front], [outer + 1, 8, front + 1], facing);
  return panel;
}

export function skirtPanels(body: BodyCells, cloth: number, facing: number, hem: number): { left: Sculpt; right: Sculpt } {
  const left = skirtPanel(body, cloth, facing, hem);
  return { left, right: mirror(left) };
}

/** The head volume, for cutting hats around it. */
function head(body: BodyCells): Sculpt { return body.bones.get('head')!; }

export type HatCut = 'stovepipe' | 'tallBrim' | 'sugarloaf';

/**
 * A tall hat over a row-23 brim, so the brows under it stay on the face. Each cut keeps the role's silhouette (a
 * tall crown over a narrow brim) and differs in outline: the stovepipe a straight column, the tall brim a wider brim
 * and a softened crown with a buckle, the sugarloaf a crown that steps in toward its top.
 */
export function tallHat(body: BodyCells, cut: HatCut, felt: number, band: number, buckle: number): Sculpt {
  const hat = new Sculpt();
  const brim = cut === 'tallBrim' ? 2 : 1;
  hat.rounded([-5 - brim, 23, -4 - brim], [5 + brim, 24, 4 + brim], felt, brim, [true, true, false, false, true, true]);
  if (cut === 'stovepipe') {
    hat.box([-4, 24, -3], [4, 31, 4], felt);
    // A crown that flares a hair at its top edge, as a stovepipe does.
    hat.box([-4, 30, -4], [4, 31, 4], felt).box([-5, 30, -3], [5, 31, 4], felt);
    hat.paint([-6, 24, -6], [6, 26, 6], band);
  } else if (cut === 'tallBrim') {
    hat.rounded([-4, 24, -3], [4, 30, 4], felt, 1, [true, true, false, true, true, true]);
    hat.paint([-6, 24, -6], [6, 25, 6], band);
    hat.paint([-1, 24, 3], [1, 25, 4], buckle);
  } else {
    hat.box([-4, 24, -3], [4, 27, 4], felt);
    hat.box([-3, 27, -2], [3, 30, 3], felt);
    hat.box([-2, 30, -1], [2, 31, 2], felt);
    hat.paint([-6, 24, -6], [6, 25, 6], band);
  }
  return hat.subtract(head(body));
}

/**
 * A knitted scarf wound twice round the collar, its long end hanging down the left breast. Built one cell out from the
 * coat so the two layers meet face to face. `stripe` bands the tail every other row.
 */
export function scarf(body: BodyCells, coat: Sculpt, wool: number, stripe: number, tail: number): Sculpt {
  const under = new Sculpt().merge(body.bones.get('chest')!).merge(coat);
  const s = new Sculpt();
  under.shell(1, wool).forEachCell((x, y, z, m) => { if (y === 15 && !body.all.get(x, y, z)) s.set(x, y, z, m); });
  const x0 = -4;
  for (let y = 15 - tail; y < 15; y++) {
    let z = -Infinity;
    for (const x of [x0, x0 + 1]) {
      z = Math.max(z, frontAt(body, y, x, x + 1));
      coat.forEachCell((cx, cy, cz) => { if (cy === y && cx === x) z = Math.max(z, cz + 1); });
    }
    s.box([x0, y, z], [x0 + 2, y + 1, z + 1], (15 - y) % 2 ? wool : stripe);
  }
  return s;
}

/** Round brass spectacles on the face plate: a rim over and under each eye and a bridge, the eyes left clear. */
export function spectacles(brass: number): Sculpt {
  const s = new Sculpt();
  for (const [a, b] of [[-4, 0], [0, 4]] as const) {
    s.box([a, 21, 4], [b, 22, 5], brass);
    s.box([a + 1, 18, 4], [b - 1, 19, 5], brass);
  }
  s.box([-1, 19, 4], [1, 21, 5], brass);
  return s;
}

/**
 * A little brass oil can on a strap at the left hip: a squat body with a darker band, a cap and a spout. It hangs clear
 * in front of the coat's left skirt panel.
 */
export function oilCan(body: BodyCells, coat: Sculpt, brass: number, band: number, strap: number): Sculpt {
  const half = body.contour.hip.half;
  const x0 = -half - 1, x1 = x0 + 3;
  let z = -Infinity;
  for (let y = 6; y < 10; y++) for (let x = x0; x < x1; x++) {
    z = Math.max(z, frontAt(body, y, x, x + 1));
    coat.forEachCell((cx, cy, cz) => { if (cy === y && cx === x) z = Math.max(z, cz + 1); });
  }
  const can = new Sculpt();
  can.box([x0, 6, z], [x1, 9, z + 2], brass);
  can.paint([x0, 7, z], [x1, 8, z + 2], band);
  can.set(x0 + 1, 9, z, brass).set(x0 + 1, 9, z + 1, brass);
  // The spout leans forward from the shoulder of the can.
  can.set(x1 - 1, 9, z + 1, brass).set(x1 - 1, 10, z + 2, brass);
  // The strap from the belt.
  can.box([x0 + 1, 10, z], [x0 + 2, 11, z + 1], strap);
  return can.subtract(body.all).subtract(coat);
}

/**
 * The pole, through the right fist along the hand's local +Z: thumb-up, so a raised forearm stands it upright and a
 * hanging arm trails it level. An ash shaft with a brass shoe at the butt; at its head a brass collar, a short spike,
 * a hook that reaches forward (the hand's −Y, toward the lamp when raised) and curls back down, and a small snuffer
 * bell on the side away from the hook. No flame, ever: the lamps burn with the kingdom's presence, not the keeper's.
 */
export const POLE = {
  /** Row the shaft runs along (the fist's lower row) and the fist's span along the shaft. */
  row: 6,
  butt: -11,
  /** First cell above the shaft: the collar's top row is `head - 1`. */
  head: 27,
} as const;

export function poleColumn(body: BodyCells): number {
  const hand = body.bones.get('handRight')!.bounds();
  return Math.max(4, hand.min[0]);
}

function poleSculpt(body: BodyCells, ash: number, brass: number): { sculpt: Sculpt; points: KeeperTool['points'] } {
  const x = poleColumn(body), y = POLE.row, h = POLE.head;
  const s = new Sculpt();
  s.box([x, y, POLE.butt], [x + 1, y + 1, h], ash);
  s.paint([x, y, POLE.butt], [x + 1, y + 1, POLE.butt + 1], brass);
  s.paint([x, y, h - 2], [x + 1, y + 1, h], brass);
  // Spike.
  s.box([x, y, h], [x + 1, y + 1, h + 3], brass);
  // Hook: forward four cells off the spike's shoulder, then down two.
  s.box([x, y - 4, h + 1], [x + 1, y, h + 2], brass);
  s.box([x, y - 4, h - 1], [x + 1, y - 3, h + 1], brass);
  // Snuffer bell on the far side: a short arm and a three-by-three cup with its mouth down the pole.
  s.box([x, y + 1, h - 1], [x + 1, y + 2, h], brass);
  s.box([x - 1, y + 2, h - 2], [x + 2, y + 5, h], brass);
  s.set(x, y + 3, h - 2, 0);
  s.subtract(body.bones.get('handRight')!);
  return {
    sculpt: s,
    points: {
      hook: { attachment: 'gripRight', at: [x + .5, y - 3.5, h - .5] },
      top: { attachment: 'gripRight', at: [x + .5, y + .5, h + 3] },
      butt: { attachment: 'gripRight', at: [x + .5, y + .5, POLE.butt] },
      grip: { attachment: 'gripRight', at: [x + .5, y + .5, .5] },
    },
  };
}

/** The pole as carried and worked with. */
export function pole(body: BodyCells, ash: number, brass: number, partId: string): KeeperTool {
  const { sculpt, points } = poleSculpt(body, ash, brass);
  return tool('pole', `${partId}.pole`, [{ sculpt, grip: 'gripRight' }], points);
}

/**
 * The same pole with a polishing rag knotted over its hook, for buffing the lantern glass from the ground: a pale
 * cloth bunched round the hook with one tail hanging, and a coloured hem.
 */
export function poleWithRag(body: BodyCells, ash: number, brass: number, rag: number, hem: number, partId: string): KeeperTool {
  const { sculpt, points } = poleSculpt(body, ash, brass);
  const x = poleColumn(body), y = POLE.row, h = POLE.head;
  const cloth = new Sculpt();
  cloth.box([x - 1, y - 5, h - 1], [x + 2, y + 1, h + 3], rag);
  cloth.box([x - 1, y - 5, h - 3], [x + 2, y - 3, h - 1], rag);
  cloth.set(x, y - 5, h - 4, rag);
  cloth.paint([x - 1, y - 5, h - 3], [x + 2, y - 4, h - 2], hem);
  cloth.carveWhere((cx, cy, cz) => (cx !== x && cy === y - 5 && cz === h + 2) || (cx !== x && cy === y && cz === h + 2));
  sculpt.merge(cloth);
  sculpt.subtract(body.bones.get('handRight')!);
  return tool('pole-rag', `${partId}.pole-rag`, [{ sculpt, grip: 'gripRight' }], {
    ...points,
    rag: { attachment: 'gripRight', at: [x + .5, y - 5, h + 1] },
  });
}

/** Where a tool point is, relative to its attachment, in cells: for solving and reporting. */
export function attachmentLocal(at: Vec3, attachment: Parameters<typeof restPosition>[0]): Vec3 {
  const rest = restPosition(attachment);
  return [at[0] - rest[0], at[1] - rest[1], at[2] - rest[2]];
}

const M = VOXEL_METRES.avatar;
const round = (metres: number): number => Math.round(metres * 1e4) / 1e4;

/**
 * The coat tails as the cloth sheet on the back socket, fitted to the coat it hangs from: pinned along the top of the
 * coat's back just under the head, as wide as the coat's back, hanging half a cell clear of the deepest cell of the
 * coat, with a notched hem (the back vent) down to `hemRow`.
 */
export function coatTails(id: string, coat: Sculpt, hemRow: number, colours: AvatarCapeBlueprint['colours']): AvatarCapeBlueprint {
  const [, socketY, socketZ] = restPosition('back');
  let deepest = Infinity, left = Infinity, right = -Infinity;
  coat.forEachCell((x, y, z) => {
    if (y >= 8) deepest = Math.min(deepest, z);
    if (y === 15 && z < 0) { left = Math.min(left, x); right = Math.max(right, x + 1); }
  });
  const mountRow = 15;
  const width = Math.min(Math.max(right - left, AVATAR_CAPE_LIMITS.minWidth / M), AVATAR_CAPE_LIMITS.maxWidth / M);
  const cape: AvatarCapeBlueprint = {
    version: 1, id, kind: 'cape', attachment: 'back', shape: 'straight',
    width: round(width * M),
    length: round((mountRow - hemRow) * M),
    hem: 'notched', trimWidth: .018,
    mount: { height: round((mountRow - socketY) * M), back: round(Math.max(socketZ - deepest + .5, .75) * M) },
    colours: { ...colours },
  };
  const parsed = AvatarCapeBlueprintSchema.safeParse(cape);
  if (!parsed.success) throw new Error(`${id} does not fit the cape contract: ${parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}
