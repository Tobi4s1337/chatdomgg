import type { AvatarCapeBlueprint, AvatarPartBlueprint } from '@chatdom/shared';
import { AVATAR_PALETTE, MAT } from '../materials';
import { createBodyParts, type BodyFamily } from './body';
import { createCape, isCapeForm } from './capes';
import { validateLook } from './compile';
import { createHairParts, type HairForm } from './hair';
import { materialName, type HairSwatchId, type SkinSwatchId, type Subscription, type WearableStyle } from './palette';
import { WEARABLE_AREA, createWearableParts, isHeadwear, type WearableArea, type WearableId } from './wearables';

/** The contact-sheet folder a review look belongs to. */
export type ReviewGroup = 'bodies' | 'hair' | 'common' | 'story' | 'assembled' | 'pose-fit';

/**
 * A bench fixture: a combination of library parts worn by a SIMULATED review person. It is not a
 * person, account, Twitch identity or ownership record; its label says so wherever it is shown.
 */
export interface ReviewLook {
  readonly id: string;
  readonly group: ReviewGroup;
  /** Plain label, e.g. "Simulated citizen A". Never a handle or a public identity. */
  readonly label: string;
  /** What the look is for, shown under the label on the bench. */
  readonly note: string;
  readonly body: BodyFamily;
  readonly skin: SkinSwatchId;
  readonly hair: { readonly form: HairForm; readonly swatch: HairSwatchId } | null;
  readonly wear: readonly { readonly id: WearableId; readonly style: WearableStyle; readonly subscription?: Subscription }[];
}

export const REVIEW_LOOKS: readonly ReviewLook[] = [
  { id: 'body-balanced', group: 'bodies', label: 'Simulated citizen A', note: 'Balanced body in neutral garb, no hair', body: 'balanced', skin: MAT.skin4, hair: null, wear: [] },
  { id: 'body-slender', group: 'bodies', label: 'Simulated citizen B', note: 'Slender body in neutral garb, no hair', body: 'slender', skin: MAT.skin2, hair: null, wear: [] },
  { id: 'body-broad', group: 'bodies', label: 'Simulated citizen C', note: 'Broad body in neutral garb, no hair', body: 'broad', skin: MAT.skin6, hair: null, wear: [] },
  { id: 'body-round', group: 'bodies', label: 'Simulated citizen D', note: 'Round body in neutral garb, no hair', body: 'round', skin: MAT.skin1, hair: null, wear: [] },
  { id: 'skin-lightest', group: 'bodies', label: 'Simulated citizen E', note: 'Lightest human skin (skin1), gold close crop', body: 'balanced', skin: MAT.skin1, hair: { form: 'closeCrop', swatch: MAT.hairGold }, wear: [] },
  { id: 'skin-darkest', group: 'bodies', label: 'Simulated citizen F', note: 'Darkest human skin (skin8), black close crop', body: 'balanced', skin: MAT.skin8, hair: { form: 'closeCrop', swatch: MAT.hairBlack }, wear: [] },
  { id: 'hair-bare-scalp', group: 'hair', label: 'Simulated citizen G', note: 'Bare scalp, black brows', body: 'broad', skin: MAT.skin7, hair: { form: 'bareScalp', swatch: MAT.hairBlack }, wear: [] },
  { id: 'hair-close-crop', group: 'hair', label: 'Simulated citizen H', note: 'Close crop, silver', body: 'slender', skin: MAT.skin3, hair: { form: 'closeCrop', swatch: MAT.hairSilver }, wear: [] },
  { id: 'hair-rounded-curls', group: 'hair', label: 'Simulated citizen I', note: 'Rounded curls, copper', body: 'round', skin: MAT.skin5, hair: { form: 'roundedCurls', swatch: MAT.hairCopper }, wear: [] },
  { id: 'hair-coiled-high-crown', group: 'hair', label: 'Simulated citizen J', note: 'Coiled high crown, black', body: 'balanced', skin: MAT.skin8, hair: { form: 'coiledHighCrown', swatch: MAT.hairBlack }, wear: [] },
  { id: 'hair-side-part', group: 'hair', label: 'Simulated citizen A', note: 'Side part, chestnut', body: 'balanced', skin: MAT.skin4, hair: { form: 'sidePart', swatch: MAT.hairChestnut }, wear: [] },
  { id: 'hair-bob', group: 'hair', label: 'Simulated citizen K', note: 'Bob, brown, on fey ash skin', body: 'slender', skin: MAT.skinFeyAsh, hair: { form: 'bob', swatch: MAT.hairBrown }, wear: [] },
  { id: 'hair-long-braid', group: 'hair', label: 'Simulated citizen L', note: 'Long braid, gold', body: 'broad', skin: MAT.skin2, hair: { form: 'longBraid', swatch: MAT.hairGold }, wear: [] },
  { id: 'hair-paired-twists', group: 'hair', label: 'Simulated citizen M', note: 'Paired twists, silver, on fey moss skin', body: 'round', skin: MAT.skinFeyMoss, hair: { form: 'pairedTwists', swatch: MAT.hairSilver }, wear: [] },
  { id: 'common-short-cloak-hearth', group: 'common', label: 'Simulated citizen A', note: 'Short cloth cloak, Hearth accents', body: 'balanced', skin: MAT.skin4, hair: { form: 'sidePart', swatch: MAT.hairBrown }, wear: [{ id: 'shortCloak', style: 'hearth' }] },
  { id: 'common-short-cloak-tide', group: 'common', label: 'Simulated citizen B', note: 'Short cloth cloak, Tide accents', body: 'balanced', skin: MAT.skin7, hair: { form: 'sidePart', swatch: MAT.hairBlack }, wear: [{ id: 'shortCloak', style: 'tide' }] },
  { id: 'citizen-a', group: 'assembled', label: 'Simulated citizen A', note: 'Balanced · side part · short cloak (Hearth)', body: 'balanced', skin: MAT.skin4, hair: { form: 'sidePart', swatch: MAT.hairBrown }, wear: [{ id: 'shortCloak', style: 'hearth' }] },
];

/**
 * A row of review looks seen together at street distance. `silhouette` lineups are drawn unlit, flat
 * dark on a pale ground, to prove shapes read before colour does.
 */
export interface ReviewLineup {
  readonly id: string;
  readonly title: string;
  readonly looks: readonly ReviewLook[];
  readonly silhouette: boolean;
}

const byGroup = (group: ReviewGroup, prefix: string): readonly ReviewLook[] => REVIEW_LOOKS.filter(look => look.group === group && look.id.startsWith(prefix));

/** Every skin swatch on the same body and crop, so only the skin changes along the row. The row's title names the crop; each note is only its swatch, short enough to sit under ten citizens. */
const SKIN_ROW: readonly ReviewLook[] = AVATAR_PALETTE.skin.map((skin, i) => ({
  id: `skin-row-${materialName(skin)}`, group: 'bodies' as const, label: `Simulated citizen ${i + 1}`, note: materialName(skin),
  body: 'balanced' as const, skin, hair: { form: 'closeCrop' as const, swatch: MAT.hairBlack }, wear: [],
}));

export const REVIEW_LINEUPS: readonly ReviewLineup[] = [
  { id: 'bodies', title: 'Four body families', looks: byGroup('bodies', 'body-'), silhouette: false },
  { id: 'bodies-silhouette', title: 'Four body families, unlit silhouettes', looks: byGroup('bodies', 'body-'), silhouette: true },
  { id: 'skins', title: 'Eight human and two fey skins, black close crop', looks: SKIN_ROW, silhouette: false },
  { id: 'hair', title: 'Eight hair treatments', looks: byGroup('hair', 'hair-'), silhouette: false },
  { id: 'hair-silhouette', title: 'Eight hair treatments, unlit silhouettes', looks: byGroup('hair', 'hair-'), silhouette: true },
];

export function findReviewLineup(id: string): ReviewLineup {
  const lineup = REVIEW_LINEUPS.find(item => item.id === id);
  if (!lineup) throw new Error(`No review lineup ${id}.`);
  return lineup;
}

/** A look ready for the renderer: rigid voxel parts in a fixed order, plus the cloth cape if one is worn. */
export interface AssembledLook {
  readonly parts: readonly AvatarPartBlueprint[];
  readonly cape: AvatarCapeBlueprint | null;
}

/**
 * Builds a look's parts in a fixed order: body, hair, then wearables (a cape contributes only its rigid
 * fasteners here). Two pieces in one area are an explicit error, never a silent discard of a selected piece.
 */
export function assembleLook(look: ReviewLook): AssembledLook {
  const areas = new Map<WearableArea, WearableId>();
  for (const item of look.wear) {
    const area = WEARABLE_AREA[item.id];
    const taken = areas.get(area);
    if (taken) throw new Error(`${look.id}: ${item.id} and ${taken} both occupy the ${area}.`);
    areas.set(area, item.id);
  }
  const head = look.wear.map(item => item.id).find(isHeadwear) ?? null;
  const fit = (item: ReviewLook['wear'][number]) => item.subscription ? { body: look.body, style: item.style, subscription: item.subscription } : { body: look.body, style: item.style };
  const parts = [
    ...createBodyParts(look.body, look.skin),
    ...(look.hair ? createHairParts(look.hair.form, { body: look.body, hair: look.hair.swatch, headwear: head }) : []),
    ...look.wear.flatMap(item => createWearableParts(item.id, fit(item))),
  ];
  validateLook(parts);
  let cape: AvatarCapeBlueprint | null = null;
  // One piece per area means at most one cape.
  for (const item of look.wear) if (isCapeForm(item.id)) cape = createCape(item.id, fit(item));
  return { parts, cape };
}

export function findReviewLook(id: string): ReviewLook {
  const look = REVIEW_LOOKS.find(item => item.id === id);
  if (!look) throw new Error(`No review look ${id}.`);
  return look;
}
