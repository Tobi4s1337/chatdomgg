import { z } from 'zod';
import {
  AtlasEditionSchema, AtlasSettlerSchema, EpochMsSchema, KingdomIdSchema, Sha256Schema, TwitchLoginSchema, UIntSchema,
} from '@chatdom/shared';
import { RevisionIdSchema } from '../export/schema';
import { GeometryFields, PREVIEW_ALGORITHM, RegionFields } from '../preview/schema';

/**
 * An official edition of the Atlas (Spec 01 R2–R5): one frozen world and an append-only ledger of who holds which
 * land in it. `editions/<id>/` holds
 *
 *   edition.json     the shared AtlasEdition record (status `frozen`, world hash, realm count)
 *   founding.json    how and from what it was founded: source revision, gates passed, the signed authorization
 *   taxonomy.json    the exact family taxonomy bytes it was drawn with; later settlement uses these, not the repo's
 *   world.json       the frozen geometry; its SHA-256 is the edition's world hash
 *   ledger.ndjson    settlements, tombstones and restorations, hash-chained line by line
 *   heads.ndjson     every acknowledged ledger head, so an earlier address can be proven unchanged
 *
 * Founding and publishing an edition are team decisions: nothing in this service founds one on its own.
 */
export const EDITIONS = {
  '0': { id: 'ed-0', label: 'Edition 0', minObservedMs: 48 * 3_600_000, requiresReviewedTaxonomy: false, landByRaid: false },
  I: { id: 'ed-1', label: 'Edition I', minObservedMs: 7 * 86_400_000, requiresReviewedTaxonomy: true, landByRaid: true },
} as const;
export type EditionNumber = keyof typeof EDITIONS;
export const EditionNumberSchema = z.enum(['0', 'I']);
export const EditionIdSchema = z.enum(['ed-0', 'ed-1']);

export const EDITION_WORLD_KIND = 'chatdom-atlas-edition-world';
export const EditionWorldSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(EDITION_WORLD_KIND),
  edition: EditionIdSchema,
  /** The drawing algorithm; the same one the survey preview uses. */
  algorithm: z.literal(PREVIEW_ALGORITHM),
  revision: RevisionIdSchema,
  asOf: EpochMsSchema,
  ...GeometryFields,
  regions: z.array(z.strictObject(RegionFields)).min(1).max(512),
});
export type EditionWorld = z.infer<typeof EditionWorldSchema>;

/** What a founder signs. Canonical JSON in exactly this key order. */
export const AuthorizationPayloadSchema = z.strictObject({
  kind: z.literal('chatdom-atlas-founding-authorization'),
  edition: EditionNumberSchema,
  revision: RevisionIdSchema,
  taxonomySha256: Sha256Schema,
  issuedAt: EpochMsSchema,
  issuedBy: TwitchLoginSchema,
});
export type AuthorizationPayload = z.infer<typeof AuthorizationPayloadSchema>;

export const AuthorizationSchema = z.strictObject({
  version: z.literal(1),
  payload: AuthorizationPayloadSchema,
  /** Ed25519 over the canonical payload, base64. */
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
export type Authorization = z.infer<typeof AuthorizationSchema>;

export const FoundingSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('chatdom-atlas-founding'),
  edition: EditionIdSchema,
  number: EditionNumberSchema,
  revision: RevisionIdSchema,
  asOf: EpochMsSchema,
  window: z.strictObject({ firstObservationAt: EpochMsSchema, lastObservationAt: EpochMsSchema, observedMs: UIntSchema }),
  taxonomy: z.strictObject({ id: z.string().max(32), status: z.enum(['proposed', 'reviewed']), sha256: Sha256Schema }),
  authorization: AuthorizationSchema,
  /** SHA-256 of the founder public key (SPKI DER) the authorization verified against. */
  founderKey: Sha256Schema,
  settlers: UIntSchema,
  /**
   * The withheld list the founding consulted (`none` when there was no list, else its file stamp) and how many
   * founding holdings it tombstoned as hidden. The founding night carries exactly that many hidden tombstones.
   */
  withheld: z.strictObject({ key: z.string().min(1).max(96), hidden: UIntSchema }),
});
export type Founding = z.infer<typeof FoundingSchema>;

/** Why a holding was granted. Founded kingdoms settle through their own producer (needs main's founded-record seam). */
export const SettleReasonSchema = z.enum(['founding', 'candidate', 'raid', 'founded']);

const Chain = { seq: UIntSchema, prev: Sha256Schema };
export const LedgerLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...Chain,
    kind: z.literal('settle'),
    settler: AtlasSettlerSchema,
    reason: SettleReasonSchema,
    /** `realm` when the holding lies in the channel's own realm, `outer` when that realm was full. */
    path: z.enum(['realm', 'outer']),
    revision: RevisionIdSchema,
  }),
  z.strictObject({
    ...Chain,
    kind: z.literal('tombstone'),
    kingdomId: KingdomIdSchema,
    holdingId: z.string().max(128),
    /**
     * Hidden by the channel or moderation (land waits at the next run), or gone from Twitch (returns after 30 days).
     * Hidden outranks gone: a hidden tombstone may replace a gone one, never the reverse.
     */
    cause: z.enum(['hidden', 'gone']),
    at: EpochMsSchema,
    revision: RevisionIdSchema,
  }),
  z.strictObject({
    ...Chain,
    kind: z.literal('restore'),
    kingdomId: KingdomIdSchema,
    holdingId: z.string().max(128),
    at: EpochMsSchema,
    revision: RevisionIdSchema,
  }),
  z.strictObject({
    ...Chain,
    kind: z.literal('night'),
    revision: RevisionIdSchema,
    asOf: EpochMsSchema,
    settled: UIntSchema,
    byRaid: UIntSchema,
    outer: UIntSchema,
    tombstones: UIntSchema,
    restores: UIntSchema,
    /** Eligible channels left unsettled because their realm and the Outer Isles had no room: never a second owner. */
    deferred: UIntSchema,
  }),
]);
export type LedgerLine = z.infer<typeof LedgerLineSchema>;

export const LedgerHeadSchema = z.strictObject({
  version: z.literal(1),
  lines: UIntSchema,
  settlers: UIntSchema,
  head: Sha256Schema,
  revision: RevisionIdSchema,
  at: EpochMsSchema,
});
export type LedgerHead = z.infer<typeof LedgerHeadSchema>;

export { AtlasEditionSchema };
