import type { AvatarPartBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';
import { Sculpt } from '../../../avatars/sculpt';
import type { KeeperAct, KeeperCostume, KeeperCostumeInput, KeeperRoleDefinition } from '../../types';
import { bodyCells, frontAt, handCentre, layer, tool, type BodyCells } from '../tailor';

/**
 * The innkeeper keeps the tavern door. Read from across the street: a long pale apron, rolled sleeves and something in
 * hand (a tankard and its cloth at dusk, a besom on the step in the morning). Hearty is round and proud in the kit's
 * livery waistcoat with a striped cloth over the shoulder; wry is broad, in a flat cap and neckerchief with a short
 * apron; gentle is slight, in a headscarf and a full bib apron.
 */
function waistcoat(body: BodyCells, material: number, buttons: number): Sculpt {
  const coat = layer(body, ['chest', 'pelvis'], 1, material, (_x, y) => y >= 11 && y < 16);
  // An open V at the throat shows the shirt; two buttons below it.
  coat.carveWhere((x, y, z) => z > 0 && ((y >= 14 && x >= -2 && x < 2) || (y === 13 && x >= -1 && x < 1)));
  for (const y of [11, 12]) {
    const z = frontAt(body, y, -1, 1);
    if (coat.get(-1, y, z)) coat.set(-1, y, z, buttons);
  }
  return coat;
}

/** An apron hanging from the belt: straight off the widest front of the hips and belly, down to `hem`. */
function apron(body: BodyCells, material: number, hem: number, tie: number): Sculpt {
  const c = body.contour, w = c.hip.half;
  const s = new Sculpt();
  let drape = -Infinity;
  for (let y = 8; y <= 11; y++) drape = Math.max(drape, frontAt(body, y, -w, w));
  for (let y = hem; y <= 10; y++) {
    const z = y >= 8 ? frontAt(body, y, -w, w) : drape;
    const half = y < 6 ? w : w - (y >= 9 ? 1 : 0);
    s.box([-half, y, z], [half, y + 1, z + 1], material);
  }
  // A darker hem line and the tie's knot at the back of the waist.
  s.paint([-w, hem, -20], [w, hem + 1, 20], tie);
  const back = Math.min(...[10].map(y => backAtRow(body, y)));
  s.box([-1, 10, back - 1], [1, 11, back], material).set(-2, 9, back - 1, material).set(1, 9, back - 1, material);
  return s;
}

function backAtRow(body: BodyCells, y: number): number {
  let back = Infinity;
  body.all.forEachCell((x, cy, z) => { if (cy === y && x >= -2 && x < 2) back = Math.min(back, z); });
  return back;
}

/** A bib over whatever the chest already wears, with straps up over the shoulders. */
function bib(body: BodyCells, worn: Sculpt, material: number): Sculpt {
  const s = new Sculpt();
  for (let y = 11; y <= 14; y++) {
    let z = frontAt(body, y, -2, 2);
    worn.forEachCell((x, cy, cz) => { if (cy === y && x >= -2 && x < 2) z = Math.max(z, cz + 1); });
    s.box([-2, y, z], [2, y + 1, z + 1], material);
  }
  for (const x of [-3, 2]) s.set(x, 15, frontAt(body, 15, x, x + 1), material);
  return s;
}

/** A striped cloth folded over the left shoulder, hanging front and back. */
function shoulderCloth(body: BodyCells, pale: number, stripe: number): Sculpt {
  const c = body.contour, x0 = -c.chest.half + 1, x1 = x0 + 2;
  const s = new Sculpt();
  const front = frontAt(body, 15, x0, x1), back = backAtRow(body, 15);
  s.box([x0, 16, back - 1], [x1, 17, front + 1], pale);
  for (let y = 12; y < 16; y++) s.box([x0, y, frontAt(body, y, x0, x1)], [x1, y + 1, frontAt(body, y, x0, x1) + 1], pale);
  for (let y = 11; y < 16; y++) s.box([x0, y, backAtRow(body, y) - 1], [x1, y + 1, backAtRow(body, y)], pale);
  s.paint([x0, 13, -20], [x1, 14, 20], stripe).paint([x0, 11, -20], [x1, 12, -2], stripe);
  return s;
}

/** A neckerchief knotted at the throat, its point hanging on the chest. */
function neckerchief(body: BodyCells, material: number): Sculpt {
  const ring = layer(body, ['chest'], 1, material, (_x, y) => y === 15);
  const z = frontAt(body, 14, -1, 1);
  ring.box([-1, 13, z], [1, 15, z + 1], material).set(-1, 12, z, material);
  return ring;
}

function head(body: BodyCells): Sculpt {
  return body.bones.get('head')!;
}

/** A flat cap: one cell over the crown from row 22, with a short peak over the brow. */
function flatCap(body: BodyCells, material: number, band: number): Sculpt {
  const cap = head(body).shell(1, material);
  cap.carveWhere((_x, y) => y < 22);
  cap.box([-4, 22, 4], [4, 23, 6], material);
  cap.paint([-6, 22, -6], [6, 23, 4], band);
  return cap;
}

/** A headscarf over the crown, tied at the nape with two short tails. */
function headscarf(body: BodyCells, material: number): Sculpt {
  const scarf = head(body).shell(1, material);
  scarf.carveWhere((_x, y, z) => y < 21 || (z >= 3 && y < 23));
  scarf.box([-1, 18, -6], [1, 21, -5], material).set(-2, 17, -6, material).set(1, 17, -6, material);
  return scarf;
}

function tankardAndCloth(body: BodyCells, p: KeeperCostumeInput['palette'], partId: string) {
  // The left hand holds a tankard by its handle; its axis is the hand's +Z, which stands upright once the forearm
  // is raised level (the act's pose). The right hand carries a cloth folded over the knuckles.
  const [lx, ly] = handCentre(body, 'Left');
  const x0 = Math.ceil(lx) + 1, base = Math.floor(ly) - 2;
  const mug = new Sculpt();
  mug.box([x0, base, -2], [x0 + 4, base + 3, 4], p.leather);
  mug.box([x0, base, 3], [x0 + 4, base + 3, 4], p.pale).box([x0 + 1, base + 1, 3], [x0 + 3, base + 2, 4], p.pale);
  mug.paint([x0, base, -1], [x0 + 4, base + 3, 0], p.metal).paint([x0, base, 1], [x0 + 4, base + 3, 2], p.metal);
  mug.box([x0 - 1, base + 1, -1], [x0, base + 2, 0], p.leather).box([x0 - 1, base + 1, 2], [x0, base + 2, 3], p.leather);
  const [rx, ry] = handCentre(body, 'Right');
  const cloth = new Sculpt();
  const cx = Math.floor(rx), cy = Math.floor(ry);
  cloth.box([cx - 1, cy - 2, 2], [cx + 2, cy + 1, 3], p.pale).box([cx - 1, cy - 3, 0], [cx + 1, cy - 2, 2], p.pale).set(cx + 1, cy - 3, 1, p.accent);
  return tool('tankard-cloth', `${partId}.tankard`, [{ sculpt: mug, grip: 'gripLeft' }, { sculpt: cloth, grip: 'gripRight' }], {
    rim: { attachment: 'gripLeft', at: [x0 + 2, base + 1.5, 4] },
    cloth: { attachment: 'gripRight', at: [cx + .5, cy - 1, 2.5] },
  });
}

function broom(body: BodyCells, p: KeeperCostumeInput['palette'], partId: string) {
  // A besom held like a staff through the right fist: a long ash handle and a bound bundle of straw at the foot.
  const [rx, , rz] = handCentre(body, 'Right');
  const x = Math.floor(rx), z = Math.floor(rz);
  const s = new Sculpt();
  s.box([x, 4, z], [x + 1, 22, z + 1], p.leather);
  s.box([x - 1, 0, z - 1], [x + 2, 4, z + 2], MAT.hairGold);
  s.box([x - 1, 0, z - 2], [x + 2, 2, z + 3], MAT.hairGold).box([x - 2, 0, z - 1], [x + 3, 2, z + 2], MAT.hairGold);
  s.paint([x - 2, 3, z - 2], [x + 3, 4, z + 3], p.metal);
  return tool('broom', `${partId}.broom`, [{ sculpt: s, grip: 'gripRight' }], {
    bristles: { attachment: 'gripRight', at: [x + .5, 0, z + .5] },
    top: { attachment: 'gripRight', at: [x + .5, 22, z + .5] },
  });
}

function costume(input: KeeperCostumeInput): KeeperCostume {
  const body = bodyCells(input.body), p = input.palette;
  const partId = `keeper.innkeeper.${input.temperament}.${p.kit}.${input.body}`;
  const garments: AvatarPartBlueprint[] = [];
  let hat: KeeperCostume['hat'] = null;
  let dye = { shirt: p.pale, breeches: p.quiet };
  if (input.temperament === 'hearty') {
    const coat = waistcoat(body, p.livery, p.metal);
    garments.push(coat.toPart(`${partId}.waistcoat`, 'chest', 'garment'));
    garments.push(apron(body, p.pale, 3, p.pale).toPart(`${partId}.apron`, 'pelvis', 'garment'));
    garments.push(shoulderCloth(body, p.pale, p.accent).toPart(`${partId}.cloth`, 'chest', 'accessory'));
  } else if (input.temperament === 'wry') {
    dye = { shirt: p.pale, breeches: MAT.earth };
    garments.push(neckerchief(body, p.livery).toPart(`${partId}.neckerchief`, 'chest', 'accessory'));
    garments.push(apron(body, p.pale, 5, p.quiet).toPart(`${partId}.apron`, 'pelvis', 'garment'));
    garments.push(flatCap(body, p.leather, p.quiet).toPart(`${partId}.cap`, 'head', 'accessory'));
    hat = { ceiling: 22 };
  } else {
    dye = { shirt: p.quiet, breeches: MAT.earth };
    const skirt = apron(body, p.pale, 2, p.accent);
    garments.push(skirt.toPart(`${partId}.apron`, 'pelvis', 'garment'));
    garments.push(bib(body, new Sculpt(), p.pale).toPart(`${partId}.bib`, 'chest', 'garment'));
    garments.push(headscarf(body, p.accent).toPart(`${partId}.headscarf`, 'head', 'accessory'));
    hat = { ceiling: 21 };
  }
  return {
    dye, rolledSleeves: true, garments, hat, cape: null,
    tools: [tankardAndCloth(body, p, partId), broom(body, p, partId)],
  };
}

const ACTS: readonly KeeperAct[] = [
  {
    id: 'wipe-tankard', label: 'Polishes a tankard on the step, watching the street', at: 'door',
    stand: [1.05, 0.75], face: 'away', cycle: 3.6, repeats: 8, tool: 'tankard-cloth', reach: null, hours: [16, 2],
    keys: [
      { t: 0, pose: { id: 'wipe-a', label: 'Cloth in', rotations: { upperArmLeft: [-32, 22, 0], forearmLeft: [-58, 0, 0], upperArmRight: [-36, -18, 8], forearmRight: [-56, 0, 0], head: [14, 0, 0] } } },
      { t: 0.25, pose: { id: 'wipe-b', label: 'Cloth round', rotations: { upperArmLeft: [-32, 22, 0], forearmLeft: [-58, 0, 0], upperArmRight: [-42, -28, 4], forearmRight: [-50, 0, 0], head: [12, 3, 0] } } },
      { t: 0.5, pose: { id: 'wipe-c', label: 'Cloth out', rotations: { upperArmLeft: [-32, 22, 0], forearmLeft: [-58, 0, 0], upperArmRight: [-30, -12, 14], forearmRight: [-62, 0, 0], head: [14, 0, 0] } } },
      { t: 0.75, pose: { id: 'wipe-d', label: 'Glance up the street', rotations: { upperArmLeft: [-30, 20, 0], forearmLeft: [-56, 0, 0], upperArmRight: [-38, -22, 6], forearmRight: [-54, 0, 0], head: [2, 22, 0] } } },
    ],
  },
  {
    id: 'sweep-step', label: 'Sweeps the step with a besom', at: 'door',
    stand: [0.1, 1.25], face: Math.PI / 2, cycle: 1.8, repeats: 14, tool: 'broom', reach: null, hours: [7, 12],
    keys: [
      { t: 0, pose: { id: 'sweep-a', label: 'Stroke left', rotations: { chest: [10, 16, 0], upperArmRight: [-22, 0, 4], forearmRight: [-18, 0, 0], upperArmLeft: [-58, 34, 0], forearmLeft: [-36, 0, 0], head: [16, 8, 0] } } },
      { t: 0.5, pose: { id: 'sweep-b', label: 'Stroke right', rotations: { chest: [10, -14, 0], upperArmRight: [-30, 0, 2], forearmRight: [-12, 0, 0], upperArmLeft: [-62, 30, 0], forearmLeft: [-32, 0, 0], head: [16, -6, 0] } } },
    ],
  },
  {
    id: 'mind-the-door', label: 'Stands at the door, hands on hips, keeping an eye on the street', at: 'door',
    stand: [-0.95, 0.6], face: 'away', cycle: 8, repeats: 4, tool: null, reach: null, hours: [12, 16],
    keys: [
      { t: 0, pose: { id: 'hips-a', label: 'Hands on hips', rotations: { upperArmRight: [-4, 0, 32], forearmRight: [-10, 0, -72], upperArmLeft: [-4, 0, -32], forearmLeft: [-10, 0, 72], chest: [-2, 0, 0], head: [0, -14, 0] } } },
      { t: 0.5, pose: { id: 'hips-b', label: 'Looks the other way', rotations: { upperArmRight: [-4, 0, 32], forearmRight: [-10, 0, -72], upperArmLeft: [-4, 0, -32], forearmLeft: [-10, 0, 72], chest: [-4, 0, 0], head: [-3, 20, 0] } } },
    ],
  },
];

export const INNKEEPER: KeeperRoleDefinition = {
  role: 'innkeeper',
  silhouette: 'Long pale apron, rolled sleeves, a tankard or a besom in hand, standing square at a door.',
  needs: ['door'],
  bodies: { hearty: 'round', wry: 'broad', gentle: 'balanced' },
  hairForms: ['closeCrop', 'roundedCurls', 'sidePart', 'bob', 'longBraid', 'pairedTwists', 'bareScalp', 'coiledHighCrown'],
  costume,
  acts: ACTS,
  stance: {
    hearty: { id: 'hearty', label: 'Proud, chest out', rotations: { chest: [-4, 0, 0], head: [-3, 0, 0] } },
    wry: { id: 'wry', label: 'Head cocked', rotations: { chest: [0, 0, -3], head: [0, 0, 7] } },
    gentle: { id: 'gentle', label: 'Soft, a little bowed', rotations: { chest: [4, 0, 0], head: [6, 0, -3] } },
  },
};

