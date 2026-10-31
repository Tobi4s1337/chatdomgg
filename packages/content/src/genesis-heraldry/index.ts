import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES } from '../materials';
import { AVATAR_MATERIALS, GARB, KIT_ACCENTS } from '../avatars/palette';
import { GENESIS_CREST, genesisCrest } from './crest';
import { HERALDIC_KITS, NEUTRAL_COLOURS, type HeraldicColours, type HeraldicStyle, type LandscapeCharacter, type LanternAnchor } from './kit';
import { GENESIS_STANDARD, genesisStandard } from './standard';

export { GENESIS_CREST, CREST_ARMS } from './crest';
export { GENESIS_STANDARD, STANDARD_ARMS } from './standard';
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
    readonly crest: { readonly shape: 'heater' | 'round' | 'swallowtail'; readonly charge: 'oak' | 'star' | 'wave' | 'mountain' };
    readonly banner: { readonly cut: 'square' | 'forked' | 'pennant' };
  };
  readonly landscapes: readonly HeraldryLandscape[];
}

export interface HeraldryLandscape {
  readonly id: string;
  readonly character: LandscapeCharacter;
}

/** One heraldic piece as the kingdom places it: the voxel model and the lantern lights it carries. */
export interface HeraldicPiece {
  readonly blueprint: VoxelBlueprint;
  readonly lanterns: readonly LanternAnchor[];
}

/**
 * A kingdom's heraldry proposal. `treatment` says honestly where the colours came from: a neutral proposal is the
 * land's own colours and the kingdom's base arms, and claims no channel colour or emblem. `requested` carries the
 * recipe's crest and cloth choices; `device` is what is carved.
 */
export interface GenesisHeraldry {
  readonly version: 'genesis-heraldry-1';
  readonly landscapeId: string;
  readonly character: LandscapeCharacter;
  readonly style: HeraldicStyle;
  readonly treatment: {
    readonly kind: 'neutral';
    /** No profile colour targets were observed, or targets exist but have not been snapped to the kit. */
    readonly reason: 'no-profile-colours' | 'targets-not-snapped';
  };
  readonly colours: HeraldicColours;
  readonly device: { readonly shape: 'heater'; readonly charge: 'chevron-lozenge'; readonly cut: 'forked' };
  readonly requested: {
    readonly shape: HeraldryRecipe['identity']['crest']['shape'];
    readonly charge: HeraldryRecipe['identity']['crest']['charge'];
    readonly cut: HeraldryRecipe['identity']['banner']['cut'];
  };
  readonly standard: HeraldicPiece;
  readonly crest: HeraldicPiece;
  /**
   * The same colours for a citizen's back cloth: `hem` matches the cloth cut (`AvatarCapeBlueprint['hem']`) and the
   * colours are avatar swatches (linen field, the kit's wall or stone as lining, a brass hem band like the border).
   */
  readonly cape: { readonly hem: 'notched'; readonly colours: { readonly cloth: number; readonly lining: number; readonly trim: number } };
}

const TARGET = /^#[0-9a-f]{6}$/i;
const CAPE_LINING: Readonly<Record<HeraldicStyle, number>> = {
  hearth: KIT_ACCENTS.hearth.cloth, tide: KIT_ACCENTS.tide.stone, grove: KIT_ACCENTS.hearth.cloth,
};

/**
 * Composes the heraldry for a recipe on the landscape the monarch selected. The landscape must be one of the
 * recipe's three candidates; the recommendation is never assumed. Pure and deterministic: no clock, randomness or
 * I/O, and every call returns fresh objects.
 */
export function composeGenesisHeraldry(recipe: HeraldryRecipe, landscape: HeraldryLandscape): GenesisHeraldry {
  const { styleFamily: style, profileColourTargets: targets, crest, banner } = recipe.identity;
  const kit = HERALDIC_KITS[style];
  if (!Object.hasOwn(HERALDIC_KITS, style) || !kit) throw new Error(`No heraldic kit for style family "${String(style)}".`);
  const matches = recipe.landscapes.filter(candidate => candidate.id === landscape.id);
  if (matches.length !== 1 || matches[0]!.character !== landscape.character) {
    throw new Error(`Landscape "${landscape.id}" is not one of this recipe's candidates.`);
  }
  for (const target of targets) if (!TARGET.test(target)) throw new Error(`Profile colour target "${target}" is not a #rrggbb colour.`);
  const { character } = landscape;
  const colours = NEUTRAL_COLOURS[style];
  const standard = genesisStandard(kit, colours, character);
  const crestPiece = genesisCrest(kit, colours, character);
  const blueprint = (piece: 'standard' | 'crest', size: readonly number[], boxes: VoxelBlueprint['boxes']): VoxelBlueprint => ({
    version: 1, id: `genesis-${piece}-${style}-${character}`, styleId: STYLES[style].id, kind: 'civic', lattice: 'build',
    size: [size[0]!, size[1]!, size[2]!], boxes, windows: [],
  });
  const cape = { cloth: GARB.linen, lining: CAPE_LINING[style], trim: GARB.clasp };
  for (const swatch of Object.values(cape)) if (!AVATAR_MATERIALS.has(swatch)) throw new Error(`Cape swatch ${swatch} is not an avatar material.`);
  return {
    version: 'genesis-heraldry-1', landscapeId: landscape.id, character, style,
    treatment: { kind: 'neutral', reason: targets.length ? 'targets-not-snapped' : 'no-profile-colours' },
    colours: { ...colours },
    device: { shape: 'heater', charge: 'chevron-lozenge', cut: 'forked' },
    requested: { shape: crest.shape, charge: crest.charge, cut: banner.cut },
    standard: { blueprint: blueprint('standard', GENESIS_STANDARD.size, standard.boxes.list), lanterns: standard.lanterns },
    crest: { blueprint: blueprint('crest', GENESIS_CREST.size, crestPiece.boxes.list), lanterns: crestPiece.lanterns },
    cape: { hem: 'notched', colours: cape },
  };
}
