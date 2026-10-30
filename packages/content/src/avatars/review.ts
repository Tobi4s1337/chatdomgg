import type { AvatarCapeBlueprint, AvatarPartBlueprint } from '@chatdom/shared';
import { MAT } from '../materials';
import { createBodyParts, type BodyFamily } from './body';
import { createCape, isCapeForm } from './capes';
import { validateLook } from './compile';
import { createHairParts, type HairForm } from './hair';
import type { HairSwatchId, SkinSwatchId, Subscription, WearableStyle } from './palette';
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

const hair = (form: HairForm, swatch: HairSwatchId): ReviewLook['hair'] => ({ form, swatch });

/**
 * Bench fixtures in capture order. Bodies wear a close crop so the contour reads as a person; the hair
 * group spreads the eight treatments over every body, all six hair swatches and the skin range.
 */
export const REVIEW_LOOKS: readonly ReviewLook[] = [
  { id: 'body-balanced', group: 'bodies', label: 'Simulated citizen A', note: 'Balanced body, neutral garb', body: 'balanced', skin: MAT.skin4, hair: hair('closeCrop', MAT.hairBrown), wear: [] },
  { id: 'body-slender', group: 'bodies', label: 'Simulated citizen C', note: 'Slender body, neutral garb', body: 'slender', skin: MAT.skin2, hair: hair('closeCrop', MAT.hairGold), wear: [] },
  { id: 'body-broad', group: 'bodies', label: 'Simulated citizen D', note: 'Broad body, neutral garb', body: 'broad', skin: MAT.skin7, hair: hair('closeCrop', MAT.hairBlack), wear: [] },
  { id: 'body-round', group: 'bodies', label: 'Simulated citizen E', note: 'Round body, neutral garb', body: 'round', skin: MAT.skin5, hair: hair('closeCrop', MAT.hairCopper), wear: [] },
  { id: 'skin-lightest', group: 'bodies', label: 'Simulated citizen F', note: 'Lightest human skin (skin1)', body: 'balanced', skin: MAT.skin1, hair: hair('sidePart', MAT.hairBrown), wear: [] },
  { id: 'skin-darkest', group: 'bodies', label: 'Simulated citizen G', note: 'Darkest human skin (skin8)', body: 'balanced', skin: MAT.skin8, hair: hair('sidePart', MAT.hairBlack), wear: [] },
  { id: 'skin-fey-ash', group: 'bodies', label: 'Simulated citizen H', note: 'Fey ash skin', body: 'slender', skin: MAT.skinFeyAsh, hair: hair('bob', MAT.hairSilver), wear: [] },
  { id: 'skin-fey-moss', group: 'bodies', label: 'Simulated citizen I', note: 'Fey moss skin', body: 'round', skin: MAT.skinFeyMoss, hair: hair('roundedCurls', MAT.hairCopper), wear: [] },
  { id: 'hair-bare-scalp', group: 'hair', label: 'Simulated citizen J', note: 'Bare scalp', body: 'broad', skin: MAT.skin6, hair: hair('bareScalp', MAT.hairBlack), wear: [] },
  { id: 'hair-close-crop', group: 'hair', label: 'Simulated citizen K', note: 'Close crop, black', body: 'slender', skin: MAT.skin8, hair: hair('closeCrop', MAT.hairBlack), wear: [] },
  { id: 'hair-rounded-curls', group: 'hair', label: 'Simulated citizen L', note: 'Rounded curls, brown', body: 'round', skin: MAT.skin7, hair: hair('roundedCurls', MAT.hairBrown), wear: [] },
  { id: 'hair-coiled-high-crown', group: 'hair', label: 'Simulated citizen M', note: 'Coiled high crown, black', body: 'balanced', skin: MAT.skin8, hair: hair('coiledHighCrown', MAT.hairBlack), wear: [] },
  { id: 'hair-side-part', group: 'hair', label: 'Simulated citizen A', note: 'Side part, chestnut', body: 'balanced', skin: MAT.skin3, hair: hair('sidePart', MAT.hairChestnut), wear: [] },
  { id: 'hair-bob', group: 'hair', label: 'Simulated citizen N', note: 'Bob, copper', body: 'slender', skin: MAT.skin2, hair: hair('bob', MAT.hairCopper), wear: [] },
  { id: 'hair-long-braid', group: 'hair', label: 'Simulated citizen O', note: 'Long braid, gold', body: 'broad', skin: MAT.skin5, hair: hair('longBraid', MAT.hairGold), wear: [] },
  { id: 'hair-paired-twists', group: 'hair', label: 'Simulated citizen P', note: 'Paired twists, silver', body: 'round', skin: MAT.skin6, hair: hair('pairedTwists', MAT.hairSilver), wear: [] },
  { id: 'common-short-cloak-hearth', group: 'common', label: 'Simulated citizen A', note: 'Short cloth cloak, Hearth accents', body: 'balanced', skin: MAT.skin4, hair: hair('sidePart', MAT.hairBrown), wear: [{ id: 'shortCloak', style: 'hearth' }] },
  { id: 'common-short-cloak-tide', group: 'common', label: 'Simulated citizen B', note: 'Short cloth cloak, Tide accents', body: 'balanced', skin: MAT.skin7, hair: hair('sidePart', MAT.hairBlack), wear: [{ id: 'shortCloak', style: 'tide' }] },
  { id: 'common-short-cloak-slender', group: 'common', label: 'Simulated citizen N', note: 'Short cloak fitted to the slender body', body: 'slender', skin: MAT.skin2, hair: hair('bob', MAT.hairCopper), wear: [{ id: 'shortCloak', style: 'tide' }] },
  { id: 'common-short-cloak-broad', group: 'common', label: 'Simulated citizen O', note: 'Short cloak fitted to the broad body', body: 'broad', skin: MAT.skin5, hair: hair('longBraid', MAT.hairGold), wear: [{ id: 'shortCloak', style: 'hearth' }] },
  { id: 'common-short-cloak-round', group: 'common', label: 'Simulated citizen P', note: 'Short cloak fitted to the round body', body: 'round', skin: MAT.skin6, hair: hair('pairedTwists', MAT.hairSilver), wear: [{ id: 'shortCloak', style: 'tide' }] },
  { id: 'citizen-a', group: 'assembled', label: 'Simulated citizen A', note: 'Balanced · side part · short cloak (Hearth)', body: 'balanced', skin: MAT.skin4, hair: hair('sidePart', MAT.hairBrown), wear: [{ id: 'shortCloak', style: 'hearth' }] },
];

/**
 * Several review looks side by side, for comparing what one look alone cannot show: silhouettes, the
 * skin range, hair at street distance. `close` is an orthographic bench view; `street` uses the
 * kingdom's street-camera distance so a look is judged at the size it is met in town.
 */
export interface ReviewLineup {
  readonly id: string;
  /** The contact-sheet folder its captures belong to. */
  readonly group: ReviewGroup;
  readonly label: string;
  readonly looks: readonly string[];
  readonly distance: 'close' | 'street';
  /** Draw every figure as one flat unlit tone, so only the outline reads. */
  readonly silhouette?: boolean;
  /** Review angles to capture, front first. */
  readonly angles: readonly ('front' | 'side' | 'back')[];
  /** Hours to capture besides dusk (19:00), where light changes the judgement. */
  readonly hours?: readonly number[];
}

const BODY_LOOKS = ['body-balanced', 'body-slender', 'body-broad', 'body-round'];
const HAIR_LOOKS = REVIEW_LOOKS.filter(look => look.group === 'hair').map(look => look.id);

export const REVIEW_LINEUPS: readonly ReviewLineup[] = [
  { id: 'silhouettes', group: 'bodies', label: 'Four bodies, unlit silhouettes', looks: BODY_LOOKS, distance: 'close', silhouette: true, angles: ['front', 'side', 'back'] },
  { id: 'bodies', group: 'bodies', label: 'Four bodies in neutral garb', looks: BODY_LOOKS, distance: 'close', angles: ['front', 'side', 'back'] },
  { id: 'skins', group: 'bodies', label: 'Eight human and two fey skins, light to dark', looks: ['skin-lightest', 'body-slender', 'hair-side-part', 'body-balanced', 'body-round', 'hair-paired-twists', 'body-broad', 'skin-darkest', 'skin-fey-ash', 'skin-fey-moss'], distance: 'close', angles: ['front'], hours: [12, 0] },
  { id: 'hair', group: 'hair', label: 'Eight hair treatments', looks: HAIR_LOOKS, distance: 'close', angles: ['front', 'side', 'back'] },
  { id: 'hair-silhouettes', group: 'hair', label: 'Eight hair treatments, unlit silhouettes', looks: HAIR_LOOKS, distance: 'close', silhouette: true, angles: ['front', 'side', 'back'] },
  { id: 'street', group: 'assembled', label: 'Bodies, skins and hair at street distance', looks: [...BODY_LOOKS, ...HAIR_LOOKS, 'skin-lightest', 'skin-darkest', 'skin-fey-ash', 'skin-fey-moss'], distance: 'street', angles: ['front', 'back'], hours: [12, 0] },
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
