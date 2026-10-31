import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES } from '../materials';
import { AVATAR_MATERIALS, GARB, KIT_ACCENTS } from '../avatars/palette';
import type { ClothCut, CrestCharge, CrestShape } from './arms';
import { GENESIS_CREST, genesisCrest } from './crest';
import { HERALDIC_KITS, NEUTRAL_COLOURS, type HeraldicColours, type HeraldicStyle, type LandscapeCharacter, type LanternAnchor } from './kit';
import { snapTargets, type Snap } from './palette';
import { GENESIS_STANDARD, genesisStandard } from './standard';

export { CHARGES, CLOTH_ROWS, CLOTH_WIDTH, SHIELD_HEIGHT, SHIELD_WIDTH, clothArms, shieldArms, type ClothCut, type CrestCharge, type CrestShape } from './arms';
export { GENESIS_CREST } from './crest';
export { GENESIS_STANDARD } from './standard';
export { MIN_CONTRAST, METALS, TINCTURES, oklab, snapTargets, type Snap, type SnappedColours } from './palette';
export { HERALDIC_KITS, NEUTRAL_COLOURS, contrast, luminance, type HeraldicColours, type HeraldicKit, type HeraldicStyle, type LandscapeCharacter, type LanternAnchor } from './kit';

/**
 * The part of a channel-genesis recipe heraldry reads. It is structurally the frozen `ChannelKingdomRecipe`
 * (`@chatdom/world/genesis`), so the real deep-readonly recipe is passed as it is. Seed keys, evidence, size and
 * soul stay with the recipe; none of them reaches the scene output.
 */
export interface HeraldryRecipe {
  readonly identity: {
    readonly styleFamily: HeraldicStyle;
    readonly profileColourTargets: readonly string[];
    readonly crest: { readonly shape: CrestShape; readonly charge: CrestCharge };
    readonly banner: { readonly cut: ClothCut };
  };
  readonly landscapes: readonly HeraldryLandscape[];
}

export interface HeraldryLandscape {
  readonly id: string;
  readonly character: LandscapeCharacter;
}

/** One heraldic piece as the kingdom places it: the voxel model, the lantern lights it carries and its drawn arms. */
export interface HeraldicPiece {
  readonly blueprint: VoxelBlueprint;
  readonly lanterns: readonly LanternAnchor[];
  /** The arms as carved or woven, rows top to bottom: B border, F field, C charge, '.' outside. */
  readonly arms: readonly string[];
}

/**
 * Where a proposal's colours came from. Neutral: no profile colours were observed, so the arms wear the land's own
 * colours and claim nothing. Snapped: the recipe's profile colour targets were snapped to registered tinctures; it
 * is a proposal for the monarch, never approved channel branding, and says which target each colour honours.
 */
export type HeraldicTreatment =
  | { readonly kind: 'neutral'; readonly reason: 'no-profile-colours' }
  | { readonly kind: 'snapped'; readonly status: 'proposal'; readonly field: Snap; readonly charge: Snap };

/** A kingdom's heraldry proposal: the recipe's crest shape, charge and cloth cut, in honest colours. */
export interface GenesisHeraldry {
  readonly version: 'genesis-heraldry-2';
  readonly landscapeId: string;
  readonly character: LandscapeCharacter;
  readonly style: HeraldicStyle;
  readonly treatment: HeraldicTreatment;
  readonly colours: HeraldicColours;
  readonly device: { readonly shape: CrestShape; readonly charge: CrestCharge; readonly cut: ClothCut };
  readonly standard: HeraldicPiece;
  readonly crest: HeraldicPiece;
  /**
   * The same colours for a citizen's back cloth: `hem` follows the cloth cut (`AvatarCapeBlueprint['hem']`) and
   * every colour is an avatar swatch. A neutral cape is linen lined in the kit's wall or stone with a brass hem
   * band; a snapped cape is the field, lined in the charge, banded in the border.
   */
  readonly cape: { readonly hem: CapeHem; readonly colours: { readonly cloth: number; readonly lining: number; readonly trim: number } };
}

type CapeHem = 'straight' | 'rounded' | 'notched';
const TARGET = /^#[0-9a-f]{6}$/i;
const CAPE_LINING: Readonly<Record<HeraldicStyle, number>> = {
  hearth: KIT_ACCENTS.hearth.cloth, tide: KIT_ACCENTS.tide.stone, grove: KIT_ACCENTS.hearth.cloth,
};
/** A cape has no point to taper to, so the pennant's long taper becomes a rounded hem. */
const CAPE_HEM: Readonly<Record<ClothCut, CapeHem>> = { square: 'straight', forked: 'notched', pennant: 'rounded' };
const SHAPES: readonly CrestShape[] = ['heater', 'round', 'swallowtail'];
const CHARGES: readonly CrestCharge[] = ['oak', 'star', 'wave', 'mountain'];
const CUTS: readonly ClothCut[] = ['square', 'forked', 'pennant'];

/**
 * Composes the heraldry for a recipe on the landscape the monarch selected. The landscape must be one of the
 * recipe's three candidates; the recommendation is never assumed. Pure and deterministic: no clock, randomness or
 * I/O, and every call returns fresh objects.
 */
export function composeGenesisHeraldry(recipe: HeraldryRecipe, landscape: HeraldryLandscape): GenesisHeraldry {
  const { styleFamily: style, profileColourTargets: targets, crest, banner } = recipe.identity;
  const kit = HERALDIC_KITS[style];
  if (!Object.hasOwn(HERALDIC_KITS, style) || !kit) throw new Error(`No heraldic kit for style family "${String(style)}".`);
  if (!SHAPES.includes(crest.shape) || !CHARGES.includes(crest.charge) || !CUTS.includes(banner.cut)) {
    throw new Error(`Unknown crest or cloth "${String(crest.shape)}/${String(crest.charge)}/${String(banner.cut)}".`);
  }
  const matches = recipe.landscapes.filter(candidate => candidate.id === landscape.id);
  if (matches.length !== 1 || matches[0]!.character !== landscape.character) {
    throw new Error(`Landscape "${landscape.id}" is not one of this recipe's candidates.`);
  }
  for (const target of targets) if (!TARGET.test(target)) throw new Error(`Profile colour target "${target}" is not a #rrggbb colour.`);
  const { character } = landscape;
  const device = { shape: crest.shape, charge: crest.charge, cut: banner.cut };

  const snapped = targets.length ? snapTargets(targets.map(target => target.toLowerCase())) : null;
  const colours: HeraldicColours = snapped ? snapped.colours : NEUTRAL_COLOURS[style];
  const treatment: HeraldicTreatment = snapped
    ? { kind: 'snapped', status: 'proposal', field: { ...snapped.field }, charge: { ...snapped.charge } }
    : { kind: 'neutral', reason: 'no-profile-colours' };

  const standard = genesisStandard(kit, colours, character, device.cut, device.charge);
  const crestPiece = genesisCrest(kit, colours, character, device.shape, device.charge);
  // The id names everything that shapes the model, so two kingdoms share a cached mesh only when they match.
  const variant = `${style}-${character}-${device.shape}-${device.charge}-${device.cut}-${colours.field}.${colours.charge}.${colours.border}`;
  const blueprint = (piece: 'standard' | 'crest', size: readonly number[], boxes: VoxelBlueprint['boxes']): VoxelBlueprint => ({
    version: 1, id: `genesis-${piece}-${variant}`, styleId: STYLES[style].id, kind: 'civic', lattice: 'build',
    size: [size[0]!, size[1]!, size[2]!], boxes, windows: [],
  });
  const cape = snapped
    ? { cloth: colours.field, lining: colours.charge, trim: colours.border }
    : { cloth: GARB.linen, lining: CAPE_LINING[style], trim: GARB.clasp };
  for (const swatch of Object.values(cape)) if (!AVATAR_MATERIALS.has(swatch)) throw new Error(`Cape swatch ${swatch} is not an avatar material.`);
  return {
    version: 'genesis-heraldry-2', landscapeId: landscape.id, character, style, treatment,
    colours: { ...colours },
    device,
    standard: { blueprint: blueprint('standard', GENESIS_STANDARD.size, standard.boxes.list), lanterns: standard.lanterns, arms: standard.arms },
    crest: { blueprint: blueprint('crest', GENESIS_CREST.size, crestPiece.boxes.list), lanterns: crestPiece.lanterns, arms: crestPiece.arms },
    cape: { hem: CAPE_HEM[device.cut], colours: cape },
  };
}
