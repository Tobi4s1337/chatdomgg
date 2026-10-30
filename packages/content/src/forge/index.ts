import type { ForgePieceDefinition, VoxelBlueprint } from '@chatdom/shared';
import { FORGE_FAMILIES, FORGE_FORMS, FORM_KINDS, type ForgeFamilyId, type ForgeForm, type ForgeProfile } from './grammar';
import { HEARTHFOLD_PIECES, HEARTHFOLD_PROFILES } from './hearthfold';

export { FORGE_FAMILIES, FORGE_FORMS, FORM_KINDS, type ForgeFamilyId, type ForgeForm, type ForgeProfile } from './grammar';
export { HEARTHFOLD } from './hearthfold';
export { FORGE_REVIEW } from './review';
export { composeForgeFixture, fingerprint, findMates, mateConnectors, placeConnector, placeSpace, poseLeafBox, rasterize, solidBoxes, REVIEW_LOT, type ComposedForgeHome, type ForgeReviewFixture, type ForgeReviewInstance, type LeafPose, type PlacedConnector } from './compose';

const FACTORIES: Record<ForgeFamilyId, Partial<Record<ForgeForm, () => ForgePieceDefinition>>> = {
  hearthfold: HEARTHFOLD_PIECES, tidewake: {}, grovebough: {},
};
export const FORGE_PROFILES: Record<ForgeFamilyId, readonly ForgeProfile[]> = { hearthfold: HEARTHFOLD_PROFILES, tidewake: [], grovebough: [] };

/** The finite grammar: a family and form from the published lists, nothing else. Unfinished forms throw. */
export function createForgePiece(family: ForgeFamilyId, form: ForgeForm): ForgePieceDefinition {
  if (!(FORGE_FAMILIES as readonly string[]).includes(family)) throw new Error(`Unknown Forge family ${String(family)}. Choose ${FORGE_FAMILIES.join(', ')}.`);
  if (!(FORGE_FORMS as readonly string[]).includes(form)) throw new Error(`Unknown Forge form ${String(form)}. Choose ${FORGE_FORMS.join(', ')}.`);
  const factory = FACTORIES[family][form];
  if (!factory) throw new Error(`The ${family} ${form} is not finished yet.`);
  const piece = factory();
  if (piece.kind !== FORM_KINDS[form] || piece.id !== `forge-${family}-${form}`) throw new Error(`${piece.id}: wrong kind or ID for ${family}/${form}.`);
  return piece;
}

/** Finished definitions only, family-major then in form order. */
export const FORGE_PIECES: readonly ForgePieceDefinition[] = FORGE_FAMILIES.flatMap(family =>
  FORGE_FORMS.filter(form => FACTORIES[family][form]).map(form => createForgePiece(family, form)));

/** Each definition's main blueprint in order, then the door leaves in family order. */
export const BLUEPRINTS: readonly VoxelBlueprint[] = [
  ...FORGE_PIECES.map(piece => piece.blueprint),
  ...FORGE_PIECES.flatMap(piece => piece.door ? [piece.door.leaf] : []),
];
