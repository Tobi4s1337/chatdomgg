import { z } from 'zod';
import { TokenSchema } from './identity';
import { MaterialIdSchema } from './voxel';

/** Cloth is a smooth, double-sided sheet. These are metres, never voxel cells. */
export const AVATAR_CAPE_LIMITS = {
  minWidth: .32, maxWidth: .95, minLength: .25, maxLength: .95,
  columns: 6, rows: 10, vertices: 77, triangles: 120,
} as const;

const SwatchSchema = MaterialIdSchema.refine(id => id !== 0, 'Cape cloth cannot use air');
/**
 * Wardrobe authors the cut and registered swatches; the citizen renderer owns cloth motion.
 * The existing back socket is chest + [0, 2, -2] avatar cells. `mount.height` moves up
 * from that socket and positive `mount.back` moves behind it (-Z). Width is the widest
 * span: flared cuts narrow the shoulders, tapered cuts narrow the hem, both to 72%.
 * Tier gold/rose are trim swatches. Star shimmer uses six ordered rainbow swatches;
 * active/lapsed factories supply their respective palette IDs and strength. No light,
 * emission, ownership or reward eligibility is encoded here.
 */
export const AvatarCapeBlueprintSchema = z.strictObject({
  version: z.literal(1),
  id: TokenSchema,
  kind: z.literal('cape'),
  attachment: z.literal('back'),
  shape: z.enum(['straight', 'flared', 'tapered']),
  width: z.number().min(AVATAR_CAPE_LIMITS.minWidth).max(AVATAR_CAPE_LIMITS.maxWidth),
  length: z.number().min(AVATAR_CAPE_LIMITS.minLength).max(AVATAR_CAPE_LIMITS.maxLength),
  hem: z.enum(['straight', 'rounded', 'notched']),
  trimWidth: z.number().min(.005).max(.04),
  mount: z.strictObject({ height: z.number().min(-.0625).max(.125), back: z.number().min(.04).max(.22) }),
  colours: z.strictObject({ cloth: SwatchSchema, lining: SwatchSchema, trim: SwatchSchema }),
  shimmer: z.strictObject({
    swatches: z.tuple([SwatchSchema, SwatchSchema, SwatchSchema, SwatchSchema, SwatchSchema, SwatchSchema]),
    strength: z.number().min(0).max(1),
  }).optional(),
});
export type AvatarCapeBlueprint = z.infer<typeof AvatarCapeBlueprintSchema>;
