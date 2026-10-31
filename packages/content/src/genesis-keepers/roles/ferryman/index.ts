import type { AvatarPartBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';
import type { KeeperCostume, KeeperCostumeInput, KeeperRoleDefinition, KeeperTemperament } from '../../types';
import { bodyCells, mirror } from '../tailor';
import { FERRYMAN_ACTS } from './acts';
import { ROPE, boathook, ferryHat, gansey, mooringLine, peaJacket, rolledCuff, seaBoot, slungLine, smock, type FerryHat } from './garb';

/**
 * The ferryman minds the landing. Read from across the water: a weather hat, tall sea boots, a coil of line slung across
 * the chest and a boathook taller than they are, held to the water or planted on the planks. They coil the mooring line,
 * sound the water with the hook and lean on it watching the river; they ferry no one, since crossings are main's.
 *
 * Hearty is broad, in a banded gansey and an oilskin sou'wester; wry is slender, in a buttoned pea jacket and a knitted
 * watch cap; gentle is round, in a working smock, a neckerchief and a broad straw hat.
 */
interface Cut { readonly hat: FerryHat; readonly coat: 'gansey' | 'pea' | 'smock' }

const CUTS: Readonly<Record<KeeperTemperament, Cut>> = {
  hearty: { hat: 'souwester', coat: 'gansey' },
  wry: { hat: 'watchCap', coat: 'pea' },
  gentle: { hat: 'strawBrim', coat: 'smock' },
};

function costume(input: KeeperCostumeInput): KeeperCostume {
  const body = bodyCells(input.body), p = input.palette, cut = CUTS[input.temperament];
  const partId = `keeper.ferryman.${input.temperament}.${p.kit}.${input.body}`;
  const coat = cut.coat === 'gansey' ? gansey(body, p.livery, p.pale, p.quiet)
    : cut.coat === 'pea' ? peaJacket(body, p.quiet, p.pale, p.metal)
      : smock(body, p.livery, p.quiet, p.accent);
  const hat = cut.hat === 'souwester' ? ferryHat(body, 'souwester', p.accent, p.quiet)
    : cut.hat === 'watchCap' ? ferryHat(body, 'watchCap', p.livery, p.quiet)
      : ferryHat(body, 'strawBrim', ROPE.straw, p.livery);
  const boot = seaBoot(body, 'Left', p.leather, p.quiet);
  const trouser = cut.coat === 'pea' ? MAT.hairBlack : p.quiet;
  const cuff = rolledCuff(body, 'Left', trouser);
  const garments: AvatarPartBlueprint[] = [
    coat.toPart(`${partId}.coat`, 'chest', 'garment'),
    boot.toPart(`${partId}.boot.left`, 'shinLeft', 'garment'),
    mirror(boot).toPart(`${partId}.boot.right`, 'shinRight', 'garment'),
    cuff.toPart(`${partId}.cuff.left`, 'thighLeft', 'garment'),
    mirror(cuff).toPart(`${partId}.cuff.right`, 'thighRight', 'garment'),
    hat.toPart(`${partId}.hat`, 'head', 'accessory'),
    slungLine(body, coat, ROPE.hemp, ROPE.whipping).toPart(`${partId}.slung-line`, 'chest', 'accessory'),
  ];
  return {
    dye: { shirt: cut.coat === 'pea' ? p.quiet : p.livery, breeches: trouser },
    rolledSleeves: cut.coat === 'smock',
    garments,
    hat: { ceiling: cut.hat === 'strawBrim' ? 23 : 21, exclude: hat },
    cape: null,
    tools: [boathook(body, p.leather, ROPE.iron, partId), mooringLine(body, ROPE.hemp, ROPE.whipping, partId)],
  };
}

export const FERRYMAN: KeeperRoleDefinition = {
  role: 'ferryman',
  silhouette: 'Weather hat, tall sea boots, a coil of line across the chest and a boathook taller than they are.',
  needs: ['mooring', 'water-edge'],
  bodies: { hearty: 'broad', wry: 'slender', gentle: 'round' },
  hairForms: ['closeCrop', 'roundedCurls', 'sidePart', 'bob', 'longBraid', 'pairedTwists', 'bareScalp'],
  costume,
  acts: FERRYMAN_ACTS,
  stance: {
    hearty: { id: 'hearty', label: 'Feet planted, chest out', rotations: { chest: [-3, 0, 0], head: [-2, 0, 0] } },
    wry: { id: 'wry', label: 'Weight off one hip, head cocked', rotations: { chest: [0, 0, 3], head: [0, 0, -6] } },
    gentle: { id: 'gentle', label: 'Soft, a little bowed', rotations: { chest: [3, 0, 0], head: [5, 0, 2] } },
  },
};
