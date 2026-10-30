import { z } from 'zod';
import { KingdomIdSchema, Sha256Schema, TokenSchema, UIntSchema } from '../identity';

/** GET routes. Substitute validated path parameters; neither route accepts a client-authored world. */
export const REALM_FOUNDED_ROUTES = {
  manifest: '/api/realm/founded/:kingdomId',
  scene: '/api/realm/founded/scenes/:sceneHash',
} as const;

/**
 * Current public geometry receipt, served no-store. sceneHash identifies the exact immutable scene response
 * bytes (SHA-256, before HTTP content encoding), not a seed or a private kingdom snapshot. Fetch and verify
 * that asset before joining; its kingdom, origin and both revisions must match this receipt and the room's
 * bootstrap. A mismatch holds walking and requires a current receipt, never a locally regenerated world.
 * This is geometry identity, not ownership, an entry ticket or authority to publish.
 */
export const RealmFoundedManifestSchema = z.strictObject({
  version: z.literal(1),
  kingdomId: KingdomIdSchema,
  origin: z.enum(['live', 'simulated']),
  layoutRevision: TokenSchema,
  collisionRevision: UIntSchema.max(0xffffffff),
  sceneHash: Sha256Schema,
});
export type RealmFoundedManifest = z.infer<typeof RealmFoundedManifestSchema>;
