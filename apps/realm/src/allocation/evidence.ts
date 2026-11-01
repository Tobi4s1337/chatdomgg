import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, type KingdomId, type PersonId } from '@chatdom/shared';
import { canonicalJson } from '../persistence/codec';

/**
 * Tenure evidence: what the Herald actually observed on Twitch, signed with the realm's evidence key.
 * A follow record carries Helix or EventSub `followed_at`; a subscription record carries cumulative months from badge info or a
 * resub message. There is no record for what was not observed: unknown history stays unknown, and nothing here is
 * ever inferred from a slot, a sign-in or a payment.
 */
const signed = {
  version: z.literal(1), kingdomId: KingdomIdSchema, personId: PersonIdSchema,
  origin: z.enum(['live', 'simulated']), observedAt: EpochMsSchema, signature: z.string().regex(/^[a-f0-9]{64}$/),
};
export const TenureEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...signed, kind: z.literal('follow'), source: z.enum(['helix.channel-followers', 'eventsub.follow']), followedAt: EpochMsSchema }),
  z.strictObject({ ...signed, kind: z.literal('subscription'), source: z.enum(['chat.badge-info', 'eventsub.subscription-message']),
    months: z.number().int().min(1).max(1_200) }),
]);
export type TenureEvidence = z.infer<typeof TenureEvidenceSchema>;
export type UnsignedTenureEvidence = TenureEvidence extends infer E ? E extends TenureEvidence ? Omit<E, 'signature'> : never : never;

/** Verified history for one person in one kingdom. `null` is unknown, never zero. */
export interface VerifiedTenure {
  readonly followedAt: number | null;
  readonly subscribedMonths: number | null;
  readonly records: readonly TenureEvidence[];
}

export class TenureEvidenceError extends Error {
  readonly code = 'realm.tenure-evidence';
  constructor(detail: string) { super(`Tenure evidence refused: ${detail}`); this.name = 'TenureEvidenceError'; }
}

/** Evidence from a clock slightly ahead of the database is accepted; anything further ahead is refused. */
const CLOCK_SKEW_MS = 60_000;
const MIN_KEY_BYTES = 32;

export function signTenureEvidence(key: Uint8Array, evidence: UnsignedTenureEvidence): TenureEvidence {
  return { ...evidence, signature: mac(key, evidence) } as TenureEvidence;
}

/** Reads the evidence key from configuration without echoing it. */
export function tenureEvidenceKey(env: Readonly<Record<string, string | undefined>> = process.env): Uint8Array {
  const raw = env.REALM_EVIDENCE_KEY;
  if (!raw || !/^[a-f0-9]+$/i.test(raw) || raw.length % 2 !== 0 || raw.length / 2 < MIN_KEY_BYTES) {
    throw new TenureEvidenceError(`REALM_EVIDENCE_KEY must be at least ${MIN_KEY_BYTES} bytes of hex`);
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Checks signature, kingdom, person, origin and time for every record. A live verifier never accepts a simulated
 * record and the reverse; one record per kind, so two different follow dates cannot be shopped between.
 */
export class TenureEvidenceVerifier {
  private readonly key: Uint8Array;
  constructor(readonly origin: 'live' | 'simulated', key: Uint8Array) {
    if (key.byteLength < MIN_KEY_BYTES) throw new TenureEvidenceError(`the evidence key must be at least ${MIN_KEY_BYTES} bytes`);
    this.key = Uint8Array.from(key);
  }

  verify(records: readonly unknown[], expected: { readonly kingdomId: KingdomId; readonly personId: PersonId; readonly now: number }): VerifiedTenure {
    if (records.length > 2) throw new TenureEvidenceError('at most one follow and one subscription record');
    let followedAt: number | null = null, subscribedMonths: number | null = null;
    const kept: TenureEvidence[] = [];
    for (const raw of records) {
      const parsed = TenureEvidenceSchema.safeParse(raw);
      if (!parsed.success) throw new TenureEvidenceError('malformed record');
      const record = parsed.data, { signature, ...body } = record;
      const expectedMac = Buffer.from(mac(this.key, body), 'hex'), given = Buffer.from(signature, 'hex');
      if (!timingSafeEqual(expectedMac, given)) throw new TenureEvidenceError('signature does not match');
      if (record.origin !== this.origin) throw new TenureEvidenceError(`${record.origin} evidence in a ${this.origin} realm`);
      if (record.kingdomId !== expected.kingdomId || record.personId !== expected.personId) throw new TenureEvidenceError('record is for another person or kingdom');
      if (record.observedAt > expected.now + CLOCK_SKEW_MS) throw new TenureEvidenceError('record was observed in the future');
      if (record.kind === 'follow') {
        if (followedAt !== null) throw new TenureEvidenceError('more than one follow record');
        if (record.followedAt > record.observedAt) throw new TenureEvidenceError('follow date is after its observation');
        followedAt = record.followedAt;
      } else {
        if (subscribedMonths !== null) throw new TenureEvidenceError('more than one subscription record');
        subscribedMonths = record.months;
      }
      kept.push(record);
    }
    return { followedAt, subscribedMonths, records: kept };
  }
}

function mac(key: Uint8Array, body: unknown): string {
  return createHmac('sha256', key).update('chatdom.tenure.v1\n').update(canonicalJson(body)).digest('hex');
}
