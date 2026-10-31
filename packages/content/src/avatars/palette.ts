import { AVATAR_PALETTE, MAT, MATERIALS, STYLES } from '../materials';

/** Registered skin material keys: eight human swatches from light to dark, then the two fey swatches. */
export type SkinSwatchId = (typeof AVATAR_PALETTE.skin)[number];
export type HairSwatchId = (typeof AVATAR_PALETTE.hair)[number];
export type FabricSwatchId = (typeof AVATAR_PALETTE.fabric)[number];
export type LapsedFabricSwatchId = (typeof AVATAR_PALETTE.fabricLapsed)[number];
export type WearableStyle = 'hearth' | 'tide';
export type Subscription = 'active' | 'lapsed';

const registered = new Set(MATERIALS.materials.map(m => m.id));
const nameOf = new Map(MATERIALS.materials.map(m => [m.id, m.name]));

/** The registered material's stable name, for labels and reports. */
export function materialName(id: number): string {
  const name = nameOf.get(id);
  if (!name) throw new Error(`Material ${id} is not registered.`);
  return name;
}

export function resolveSkin(id: number): SkinSwatchId {
  if (!(AVATAR_PALETTE.skin as readonly number[]).includes(id)) throw new Error(`${id} is not a registered skin swatch.`);
  return id as SkinSwatchId;
}

export function resolveHair(id: number): HairSwatchId {
  if (!(AVATAR_PALETTE.hair as readonly number[]).includes(id)) throw new Error(`${id} is not a registered hair swatch.`);
  return id as HairSwatchId;
}

/** Lapsed subscription pieces keep their fabric index and quieten to the matching muted key. */
export function subscriptionFabric(fabric: FabricSwatchId, subscription: Subscription): FabricSwatchId | LapsedFabricSwatchId {
  const index = AVATAR_PALETTE.fabric.indexOf(fabric);
  if (index < 0) throw new Error(`${fabric} is not a registered fabric swatch.`);
  return subscription === 'active' ? fabric : AVATAR_PALETTE.fabricLapsed[index]!;
}

/**
 * Undyed everyday materials shared by every body's neutral garb and by face details.
 * Every entry is an existing registered key; none is a new colour.
 */
export const GARB = {
  linen: MAT.cream,
  breeches: MAT.earth,
  leather: MAT.timber,
  /** Eyes read as the darkest registered hair brown-black, lit by a linen catch-light. */
  eye: MAT.hairBlack,
  catchLight: MAT.cream,
  /** The white of the eye beside the pupil. */
  sclera: MAT.cream,
  blush: MAT.petal,
  clasp: MAT.brass,
} as const;

/** A kingdom's accent pair for a shared garment: its wall cloth and its trim, from the frozen kits. */
export const KIT_ACCENTS: Record<WearableStyle, { readonly cloth: number; readonly trim: number; readonly stone: number }> = {
  hearth: { cloth: STYLES.hearth.wall, trim: STYLES.hearth.trim, stone: STYLES.hearth.stone },
  tide: { cloth: STYLES.tide.wall, trim: STYLES.tide.trim, stone: STYLES.tide.stone },
};

/** Every material key an avatar part may carry. The validator rejects anything else. */
export const AVATAR_MATERIALS: ReadonlySet<number> = new Set<number>([
  ...AVATAR_PALETTE.skin, ...AVATAR_PALETTE.hair, ...AVATAR_PALETTE.fabric, ...AVATAR_PALETTE.fabricLapsed,
  ...Object.values(GARB), ...Object.values(KIT_ACCENTS).flatMap(kit => [kit.cloth, kit.trim, kit.stone]),
]);
for (const id of AVATAR_MATERIALS) if (!registered.has(id)) throw new Error(`Avatar material ${id} is not registered.`);
