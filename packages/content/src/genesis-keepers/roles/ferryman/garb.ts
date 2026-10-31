import { MAT } from '../../../materials';
import { Sculpt } from '../../../avatars/sculpt';
import type { KeeperTool } from '../../types';
import { backAt, frontAt, layer, tool, type BodyCells } from '../tailor';

/**
 * The ferryman's garb, authored in root-local rest cells on the citizens' own rig: a heavy knitted gansey, a short pea
 * jacket or a working smock over rolled trousers and tall sea boots, a coil of line slung across the chest, and the
 * landing's tools (a long boathook and a coil of mooring line). Every piece is a layer outside the body, so it meets the
 * body face to face.
 */

/** The torso cells a garment covers, as a body layer one cell out over chest and hips from row `from` to the collar. */
function torso(body: BodyCells, material: number, from: number): Sculpt {
  return layer(body, ['chest', 'pelvis'], 1, material, (_x, y) => y >= from && y < 16);
}

/**
 * A fisherman's gansey: close knit from the hips to the collar with a ribbed welt at the hem, and broad bands of the pale
 * yarn across the chest, the way a jersey reads at a distance. A rolled collar sits one cell proud at the throat.
 */
export function gansey(body: BodyCells, wool: number, band: number, rib: number): Sculpt {
  const g = torso(body, wool, 8);
  for (const y of [11, 13]) g.paint([-20, y, -20], [20, y + 1, 20], band);
  g.paint([-20, 8, -20], [20, 9, 20], rib);
  // The rolled collar: a ring one cell out from the jersey at the collar row.
  const collar = new Sculpt().merge(body.all).merge(g).shell(1, rib);
  collar.forEachCell((x, y, z, m) => { if (y === 15 && !body.all.get(x, y, z) && !g.get(x, y, z) && Math.abs(x) <= 3) g.set(x, y, z, m); });
  return g;
}

/**
 * A short double-breasted pea jacket to the hips: broad lapels and a stand collar, two rows of buttons, and slash pockets
 * at the waist. The shirt shows in a narrow V at the throat.
 */
export function peaJacket(body: BodyCells, cloth: number, shirt: number, buttons: number): Sculpt {
  const j = torso(body, cloth, 7);
  // Extend the skirt one row lower over the hips, all round.
  layer(body, ['pelvis', 'thighLeft', 'thighRight'], 1, cloth, (_x, y) => y === 7).forEachCell((x, y, z, m) => { j.set(x, y, z, m); });
  j.paint([-1, 14, 0], [1, 16, 20], shirt);
  const front = (x: number, y: number): number => frontAt(body, y, x, x + 1);
  // Lapels: a cell proud at the opening, widening toward the shoulder.
  for (let y = 12; y < 16; y++) for (const x of y >= 14 ? [-3, -2, 1, 2] : [-2, 1]) j.set(x, y, front(x, y) + 1, cloth);
  // The stand collar behind the neck.
  for (let x = -3; x < 3; x++) j.set(x, 16, backAt(body, 15, x, x + 1) - 1, cloth);
  // Two rows of buttons and the pocket slits.
  for (const y of [9, 11, 13]) for (const x of [-3, 2]) j.paint([x, y, front(x, y)], [x + 1, y + 1, front(x, y) + 1], buttons);
  return j;
}

/** A working smock to the hips with a gathered yoke (a band of the second cloth) and a neckerchief knotted at the throat. */
export function smock(body: BodyCells, cloth: number, yoke: number, kerchief: number): Sculpt {
  const s = torso(body, cloth, 7);
  layer(body, ['pelvis', 'thighLeft', 'thighRight'], 1, cloth, (_x, y) => y === 7).forEachCell((x, y, z, m) => { s.set(x, y, z, m); });
  s.paint([-20, 14, -20], [20, 15, 20], yoke);
  s.paint([-2, 15, 0], [2, 16, 20], kerchief);
  const z = frontAt(body, 14, -1, 1) + 1;
  s.set(-1, 14, z, kerchief).set(0, 14, z, kerchief).set(-1, 13, z, kerchief);
  return s;
}

/**
 * Tall sea boots over the shins to just under the knee, with a turned-down cuff, and the trouser leg rolled above them.
 * Left leg; the right is its mirror.
 */
export function seaBoot(body: BodyCells, side: 'Left' | 'Right', leather: number, cuff: number): Sculpt {
  const boot = layer(body, [`shin${side}`, `thigh${side}`], 1, leather, (_x, y) => y >= 1 && y <= 4);
  boot.paint([-20, 4, -20], [20, 5, 20], cuff);
  return boot;
}

/** The rolled trouser cuff just above the boot: a single ring round the leg at the knee. */
export function rolledCuff(body: BodyCells, side: 'Left' | 'Right', cloth: number): Sculpt {
  return layer(body, [`shin${side}`, `thigh${side}`], 1, cloth, (_x, y) => y === 5);
}

/**
 * A coil of line slung over the left shoulder and across to the right hip, front and back, sitting one cell over
 * whatever the torso wears, with the coil's bundle at the hip.
 */
export function slungLine(body: BodyCells, worn: Sculpt, rope: number, whipping: number): Sculpt {
  const under = new Sculpt().merge(body.all).merge(worn);
  const along = (y: number): number => -4 + (16 - y) * 1.15;
  const s = new Sculpt();
  under.shell(1, rope).forEachCell((x, y, z, m) => {
    if (y < 8 || y > 16 || under.get(x, y, z)) return;
    if (Math.abs(x + .5 - along(y)) <= 1 && !body.bones.get('upperArmRight')?.get(x, y, z)) s.set(x, y, z, m);
  });
  // The coil's bundle on the right hip, bound with a contrasting whipping.
  const half = body.contour.hip.half;
  let z = -Infinity;
  for (let y = 7; y < 10; y++) for (let x = half - 2; x < half + 1; x++) {
    z = Math.max(z, frontAt(body, y, x, x + 1));
    worn.forEachCell((cx, cy, cz) => { if (cy === y && cx === x) z = Math.max(z, cz + 1); });
  }
  s.box([half - 2, 6, z], [half + 1, 10, z + 2], rope);
  s.paint([half - 2, 8, z], [half + 1, 9, z + 2], whipping);
  return s.subtract(body.all).subtract(worn);
}

function head(body: BodyCells): Sculpt { return body.bones.get('head')!; }

export type FerryHat = 'souwester' | 'watchCap' | 'strawBrim';

/**
 * Headwear: an oilskin sou'wester (a rounded crown and a brim that is short over the brow and long down the back of the
 * neck), a knitted watch cap with a turned-up cuff, or a broad, flat straw hat with a cloth band.
 */
export function ferryHat(body: BodyCells, cut: FerryHat, material: number, band: number): Sculpt {
  const h = new Sculpt();
  if (cut === 'souwester') {
    // A domed oilskin crown, then the brim: a lip over the brow, wider at the ears and falling long over the nape.
    h.rounded([-6, 21, -5], [6, 27, 5], material, 2, [true, true, false, true, true, true]);
    h.box([-5, 21, 5], [5, 22, 7], material);
    h.rounded([-7, 20, -7], [7, 21, 3], material, 1, [true, true, false, false, true, false]);
    h.rounded([-6, 19, -8], [6, 20, -3], material, 1, [true, true, false, false, true, false]);
    h.paint([-7, 21, -6], [7, 22, 5], band, (_x, _y, z) => z < 4);
  } else if (cut === 'watchCap') {
    // A snug knitted dome with a deep turned-up cuff in the second yarn.
    h.rounded([-6, 21, -5], [6, 27, 5], material, 2, [true, true, false, true, true, true]);
    h.paint([-6, 21, -5], [6, 23, 5], band);
  } else {
    h.rounded([-5, 23, -5], [5, 26, 5], material, 1, [true, true, false, true, true, true]);
    h.rounded([-7, 23, -7], [7, 24, 7], material, 2, [true, true, false, false, true, true]);
    h.paint([-5, 23, -5], [5, 24, 5], band, (x, _y, z) => x === -5 || x === 4 || z === -5 || z === 4);
  }
  return h.subtract(head(body));
}

/** The boathook's dimensions along the right fist's +Z (thumb-up, like the lamplighter's pole). */
export const BOATHOOK = { row: 6, butt: -15, head: 27 } as const;

function shaftColumn(body: BodyCells): number {
  const hand = body.bones.get('handRight')!.bounds();
  return Math.max(4, hand.min[0]);
}

/**
 * A long ash boathook through the right fist: an iron ferrule at the butt, an iron head with a straight spike and a
 * hook that curls back down the shaft on the hand's −Y side. It reads as a landing's tool, never a weapon: no blade.
 */
export function boathook(body: BodyCells, ash: number, iron: number, partId: string): KeeperTool {
  const x = shaftColumn(body), y = BOATHOOK.row, h = BOATHOOK.head, b = BOATHOOK.butt;
  const s = new Sculpt();
  s.box([x, y, b], [x + 1, y + 1, h], ash);
  s.paint([x, y, b], [x + 1, y + 1, b + 2], iron);
  s.paint([x, y, h - 3], [x + 1, y + 1, h], iron);
  s.box([x, y, h], [x + 1, y + 1, h + 3], iron);
  s.box([x, y - 3, h - 1], [x + 1, y, h], iron);
  s.box([x, y - 3, h - 3], [x + 1, y - 2, h - 1], iron);
  s.subtract(body.bones.get('handRight')!);
  return tool('boathook', `${partId}.boathook`, [{ sculpt: s, grip: 'gripRight' }], {
    hook: { attachment: 'gripRight', at: [x + .5, y - 2.5, h - 2.5] },
    tip: { attachment: 'gripRight', at: [x + .5, y + .5, h + 3] },
    butt: { attachment: 'gripRight', at: [x + .5, y + .5, b] },
    grip: { attachment: 'gripRight', at: [x + .5, y + .5, .5] },
  });
}

/**
 * A coil of mooring line held in the left fist, its loops standing out of the hand along the fist's −Y, and the running
 * end in the right fist. The loops are three rings with a whipped end hanging from the bundle.
 */
export function mooringLine(body: BodyCells, rope: number, whipping: number, partId: string): KeeperTool {
  const left = body.bones.get('handLeft')!.bounds(), right = body.bones.get('handRight')!.bounds();
  const lx = left.min[0], rx = right.min[0];
  const coil = new Sculpt();
  const cy = left.min[1] - 2, cz = (left.min[2] + left.max[2]) / 2;
  for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
    const r = Math.hypot(dy, dz);
    if (r >= 1.6 && r <= 3.1) coil.box([lx - 1, Math.round(cy + dy), Math.round(cz + dz)], [lx + 2, Math.round(cy + dy) + 1, Math.round(cz + dz) + 1], rope);
  }
  coil.paint([lx - 1, left.min[1] - 1, -20], [lx + 2, left.min[1], 20], whipping);
  coil.subtract(body.bones.get('handLeft')!);
  const end = new Sculpt();
  end.box([rx + 1, right.min[1] - 4, 0], [rx + 2, right.min[1] + 1, 1], rope).set(rx + 1, right.min[1] - 5, 0, whipping);
  end.subtract(body.bones.get('handRight')!);
  return tool('line', `${partId}.line`, [{ sculpt: coil, grip: 'gripLeft' }, { sculpt: end, grip: 'gripRight' }], {
    coil: { attachment: 'gripLeft', at: [lx + .5, cy, cz] },
    end: { attachment: 'gripRight', at: [rx + 1.5, right.min[1] - 5, .5] },
  });
}

/** Rope reads as tarred hemp: the registered gold hair swatch for the hemp, muted gold for the whipping. */
export const ROPE = { hemp: MAT.hairGold, whipping: MAT.fabricMutedGold, iron: MAT.hairBlack, straw: MAT.hairGold } as const;
