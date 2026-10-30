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

export const REVIEW_LOOKS: readonly ReviewLook[] = [
  { id: 'body-balanced', group: 'bodies', label: 'Simulated citizen A', note: 'Balanced body in neutral garb, no hair', body: 'balanced', skin: MAT.skin4, hair: null, wear: [] },
  { id: 'hair-side-part', group: 'hair', label: 'Simulated citizen A', note: 'Side part, chestnut', body: 'balanced', skin: MAT.skin4, hair: { form: 'sidePart', swatch: MAT.hairChestnut }, wear: [] },
  { id: 'common-short-cloak-hearth', group: 'common', label: 'Simulated citizen A', note: 'Short cloth cloak, Hearth accents', body: 'balanced', skin: MAT.skin4, hair: { form: 'sidePart', swatch: MAT.hairBrown }, wear: [{ id: 'shortCloak', style: 'hearth' }] },
  { id: 'common-short-cloak-tide', group: 'common', label: 'Simulated citizen B', note: 'Short cloth cloak, Tide accents', body: 'balanced', skin: MAT.skin7, hair: { form: 'sidePart', swatch: MAT.hairBlack }, wear: [{ id: 'shortCloak', style: 'tide' }] },
  { id: 'citizen-a', group: 'assembled', label: 'Simulated citizen A', note: 'Balanced · side part · short cloak (Hearth)', body: 'balanced', skin: MAT.skin4, hair: { form: 'sidePart', swatch: MAT.hairBrown }, wear: [{ id: 'shortCloak', style: 'hearth' }] },
];

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
