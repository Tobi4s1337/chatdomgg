import type { AvatarPartBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';
import { Sculpt } from '../../../avatars/sculpt';
import type { KeeperCostume, KeeperCostumeInput, KeeperRoleDefinition, KeeperTemperament } from '../../types';
import { bodyCells, layer } from '../tailor';
import { coatBody, coatTails, oilCan, pole, poleWithRag, scarf, skirtPanels, spectacles, tallHat, type CoatColours, type HatCut } from './garb';
import { LAMPLIGHTER_ACTS } from './acts';

/**
 * The lamplighter keeps the lamps of Bell Court. Read from across the street: tall and narrow, a tall hat, a long coat
 * whose tails swing behind, and a pole half again their height with a brass hook and snuffer bell at its head. They
 * tend the lamps (trim the wick, open the lantern door, buff the glass, look up at them burning) and never carry a
 * flame: the lamps burn with the kingdom's presence, and warm light is people.
 *
 * Hearty is round and ruddy in the kit's livery coat, a tall brimmed hat with a buckle and a short scarf; wry is slender
 * and dark, in a black stovepipe and a muted coat faced with livery; gentle is even, in a stepped sugarloaf hat, brass
 * spectacles and a long striped scarf, with the longest coat.
 */
interface Cut {
  readonly hat: HatCut;
  /** Lowest row of the coat skirt and its tails. */
  readonly hem: number;
  readonly scarf: number | null;
  readonly spectacles: boolean;
}

const CUTS: Readonly<Record<KeeperTemperament, Cut>> = {
  hearty: { hat: 'tallBrim', hem: 5, scarf: 3, spectacles: false },
  wry: { hat: 'stovepipe', hem: 4, scarf: null, spectacles: false },
  gentle: { hat: 'sugarloaf', hem: 3, scarf: 6, spectacles: true },
};

function colours(input: KeeperCostumeInput): { coat: CoatColours; felt: number; band: number; breeches: number; wool: number; stripe: number } {
  const p = input.palette;
  if (input.temperament === 'hearty') {
    return { coat: { cloth: p.livery, vest: p.accent, shirt: p.pale, buttons: p.metal, facing: p.quiet }, felt: p.leather, band: p.accent, breeches: MAT.earth, wool: p.quiet, stripe: p.accent };
  }
  if (input.temperament === 'wry') {
    return { coat: { cloth: p.quiet, vest: p.livery, shirt: p.pale, buttons: p.metal, facing: p.livery }, felt: MAT.hairBlack, band: p.livery, breeches: MAT.hairBlack, wool: p.livery, stripe: p.pale };
  }
  return { coat: { cloth: p.livery, vest: p.quiet, shirt: p.pale, buttons: p.metal, facing: p.pale }, felt: p.quiet, band: p.accent, breeches: MAT.earth, wool: p.accent, stripe: p.pale };
}

/** Turned-back cuffs at the wrist, in the coat's facing. */
function cuff(body: ReturnType<typeof bodyCells>, side: 'Left' | 'Right', facing: number): Sculpt {
  return layer(body, [`forearm${side}`], 1, facing, (_x, y) => y === 8);
}

function costume(input: KeeperCostumeInput): KeeperCostume {
  const body = bodyCells(input.body), p = input.palette, cut = CUTS[input.temperament], c = colours(input);
  const partId = `keeper.lamplighter.${input.temperament}.${p.kit}.${input.body}`;
  const coat = coatBody(body, c.coat);
  const skirt = skirtPanels(body, c.coat.cloth, c.coat.facing, cut.hem);
  const hat = tallHat(body, cut.hat, c.felt, c.band, p.metal);
  const headwear = new Sculpt().merge(hat);
  if (cut.spectacles) headwear.merge(spectacles(p.metal));
  const garments: AvatarPartBlueprint[] = [
    coat.toPart(`${partId}.coat`, 'chest', 'garment'),
    skirt.left.toPart(`${partId}.skirt.left`, 'thighLeft', 'garment'),
    skirt.right.toPart(`${partId}.skirt.right`, 'thighRight', 'garment'),
    cuff(body, 'Left', c.coat.facing).toPart(`${partId}.cuff.left`, 'forearmLeft', 'garment'),
    cuff(body, 'Right', c.coat.facing).toPart(`${partId}.cuff.right`, 'forearmRight', 'garment'),
    headwear.toPart(`${partId}.hat`, 'head', 'accessory'),
    oilCan(body, coat, p.metal, p.leather, p.leather).toPart(`${partId}.oil-can`, 'pelvis', 'accessory'),
  ];
  if (cut.scarf !== null) garments.push(scarf(body, coat, c.wool, c.stripe, cut.scarf).toPart(`${partId}.scarf`, 'chest', 'accessory'));
  return {
    dye: { shirt: c.coat.cloth, breeches: c.breeches },
    rolledSleeves: false,
    garments,
    hat: { ceiling: 23, exclude: hat },
    cape: coatTails(`cape.${partId}.tails`, coat, cut.hem, { cloth: c.coat.cloth, lining: c.coat.vest, trim: c.coat.facing }),
    tools: [pole(body, p.leather, p.metal, partId), poleWithRag(body, p.leather, p.metal, p.pale, p.accent, partId)],
  };
}

export const LAMPLIGHTER: KeeperRoleDefinition = {
  role: 'lamplighter',
  silhouette: 'Tall hat over a long coat with swinging tails, and a pole half again their height with a brass hook raised to a lamp.',
  needs: ['lamp'],
  bodies: { hearty: 'round', wry: 'slender', gentle: 'balanced' },
  hairForms: ['closeCrop', 'roundedCurls', 'sidePart', 'bob', 'longBraid', 'pairedTwists', 'bareScalp'],
  costume,
  acts: LAMPLIGHTER_ACTS,
  stance: {
    hearty: { id: 'hearty', label: 'Chest out, chin up', rotations: { chest: [-1, 0, 0], head: [-4, 0, 0] } },
    wry: { id: 'wry', label: 'Head cocked', rotations: { head: [0, 0, 7] } },
    gentle: { id: 'gentle', label: 'Soft, a little bowed', rotations: { chest: [1, 0, 0], head: [6, 0, -3] } },
  },
};
