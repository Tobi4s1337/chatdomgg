import { z } from 'zod';
import { FORGE_MOTIFS } from './forge';

/**
 * The Forge's whole vocabulary (FW13): every house slot the homes offer, the things worn on the avatar's sockets,
 * and the motif library. A wish still composes authored parts only: the plan names a slot, a motif, a finish and
 * an accent, never cells, coordinates, colours or code. The older plans (`HousePartPlanSchema` versions 1 and 2)
 * stay valid and keep their kit revisions; this vocabulary is kit revision 3.
 */
export const FORGE_PIECE_KIT_REVISION = 3;

/** Motifs added in kit revision 3. Sculptures, never living creatures: nothing here walks (Tech §11.3). */
export const FORGE_LIBRARY_MOTIFS = [
  // Land animals, sitting or asleep.
  'sleeping-cat', 'rabbit', 'frog', 'bear', 'stag', 'hedgehog', 'snail', 'bee',
  // Water and air.
  'whale', 'fish', 'swan', 'octopus', 'turtle', 'butterfly',
  // Garden and sky.
  'mushroom', 'rose', 'sun', 'cloud', 'rainbow', 'oak-tree', 'pumpkin', 'apple', 'snowflake', 'acorn',
  // Things.
  'heart', 'crown', 'key', 'anchor', 'sailing-ship', 'teacup', 'book', 'candle',
  'bell', 'music-note', 'gem', 'castle-tower', 'skull', 'ghost', 'cake', 'potion',
] as const;
export type ForgeLibraryMotif = (typeof FORGE_LIBRARY_MOTIFS)[number];
/** Every motif a revision-3 plan may name: the seven of kit revisions 1 and 2, then the library. */
export const FORGE_PIECE_MOTIFS = [...FORGE_MOTIFS, ...FORGE_LIBRARY_MOTIFS] as const;
export type ForgePieceMotif = (typeof FORGE_PIECE_MOTIFS)[number];

/** On the roof: whole sculptures standing on the roof's own surface. */
export const FORGE_ROOF_SLOTS = ['chimney', 'weathervane', 'lantern', 'finial', 'roof-guardian', 'banner'] as const;
/** On the street front: carved and hung pieces no deeper than the front's reveal. */
export const FORGE_FACADE_SLOTS = ['gable-crest', 'clock', 'door-crown', 'wall-sign', 'shield', 'wreath', 'window-box', 'frieze'] as const;
/** At the doorstep: the home's things, standing or hung beside the door. */
export const FORGE_DOORSTEP_SLOTS = ['bench', 'planter', 'bell', 'letterbox'] as const;
/** The eighteen house slots (Tech §11.2, World-Tree "Slot"). */
export const FORGE_HOUSE_SLOTS = [...FORGE_ROOF_SLOTS, ...FORGE_FACADE_SLOTS, ...FORGE_DOORSTEP_SLOTS] as const;
export type ForgeHouseSlot = (typeof FORGE_HOUSE_SLOTS)[number];
/** Worn on the avatar's sockets in the accepted character style. */
export const FORGE_WEAR_SLOTS = ['hat', 'pin', 'cape', 'held'] as const;
export type ForgeWearSlot = (typeof FORGE_WEAR_SLOTS)[number];
export const FORGE_PIECE_SLOTS = [...FORGE_HOUSE_SLOTS, ...FORGE_WEAR_SLOTS] as const;
export type ForgePieceSlot = (typeof FORGE_PIECE_SLOTS)[number];
export type ForgeSlotGroup = 'roof' | 'facade' | 'doorstep' | 'wear';
export function forgeSlotGroup(slot: ForgePieceSlot): ForgeSlotGroup {
  if ((FORGE_ROOF_SLOTS as readonly string[]).includes(slot)) return 'roof';
  if ((FORGE_FACADE_SLOTS as readonly string[]).includes(slot)) return 'facade';
  if ((FORGE_DOORSTEP_SLOTS as readonly string[]).includes(slot)) return 'doorstep';
  return 'wear';
}
export const isForgeHouseSlot = (slot: string): slot is ForgeHouseSlot => (FORGE_HOUSE_SLOTS as readonly string[]).includes(slot);
export const isForgeWearSlot = (slot: string): slot is ForgeWearSlot => (FORGE_WEAR_SLOTS as readonly string[]).includes(slot);

export const FORGE_PIECE_FINISHES = ['native', 'copper', 'ceramic'] as const;
export const FORGE_PIECE_ACCENTS = ['none', 'stars', 'leaves', 'scales'] as const;
/** Revision 3: one slot, one motif, a finish and an accent. Shapes come only from the kit. */
export const ForgePiecePlanSchema = z.strictObject({
  version: z.literal(3),
  slot: z.enum(FORGE_PIECE_SLOTS),
  motif: z.enum(FORGE_PIECE_MOTIFS),
  finish: z.enum(FORGE_PIECE_FINISHES),
  accent: z.enum(FORGE_PIECE_ACCENTS),
});
export type ForgePiecePlan = z.infer<typeof ForgePiecePlanSchema>;
export const ForgePieceDraftSchema = z.strictObject({
  plan: ForgePiecePlanSchema,
  title: z.string().min(1).max(64),
  plaque: z.string().min(1).max(120),
});
export type ForgePieceDraft = z.infer<typeof ForgePieceDraftSchema>;

/** At the reveal the maker chooses: place it now on a free slot, or keep it to place later (decision 24). */
export const ForgeRevealChoiceSchema = z.enum(['place', 'keep']);
export type ForgeRevealChoice = z.infer<typeof ForgeRevealChoiceSchema>;
