import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema } from './identity';

export const PRESENCE_MINUTE_MS = 60_000;
export const PRESENCE_LEASE_MS = 90_000;
export const STREAM_LEASE_MS = 180_000;
export const PresenceOriginSchema = z.enum(['live', 'recovered', 'simulated']);
export const PresenceSourceSchema = z.enum(['chatters', 'chat', 'panel', 'walker']);
export type PresenceSource = z.infer<typeof PresenceSourceSchema>;
const common = { version: z.literal(1), id: TokenSchema, kingdomId: KingdomIdSchema, observedAt: EpochMsSchema, origin: PresenceOriginSchema };
export const PresencePersonSchema = z.discriminatedUnion('disclosure', [
  z.strictObject({ personId: PersonIdSchema, disclosure: z.literal('anonymous') }),
  z.strictObject({ personId: PersonIdSchema, disclosure: z.literal('named'), displayName: DisplayNameSchema }),
]);
export type PresencePerson = z.infer<typeof PresencePersonSchema>;
/** Trusted private ingress. Never expose this schema on a public browser endpoint. */
export const PresenceInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('stream'), live: z.boolean(), sessionId: TokenSchema.nullable() }),
  z.strictObject({ ...common, kind: z.literal('observe'), source: PresenceSourceSchema,
    coverage: z.enum(['complete', 'partial', 'activity']), people: z.array(PresencePersonSchema).max(100_000),
  }),
  z.strictObject({ ...common, kind: z.literal('remove'), personId: PersonIdSchema,
    reason: z.enum(['timeout', 'moderated', 'ban', 'forget']), until: EpochMsSchema.nullable(),
  }),
  z.strictObject({ ...common, kind: z.literal('restore'), personId: PersonIdSchema }),
]).superRefine((input, ctx) => {
  if (input.kind === 'stream' && input.live !== (input.sessionId !== null)) ctx.addIssue({ code: 'custom', message: 'Live streams need a session; offline streams have none' });
  if (input.kind === 'observe') {
    if (new Set(input.people.map(p => p.personId)).size !== input.people.length) ctx.addIssue({ code: 'custom', message: 'Duplicate person in observation' });
    if (input.source === 'chatters' && (input.coverage === 'activity' || input.people.some(p => p.disclosure !== 'anonymous'))) ctx.addIssue({ code: 'custom', message: 'Chatters observes unnamed connected people, never public identity' });
    if (input.source !== 'chatters' && input.coverage !== 'activity') ctx.addIssue({ code: 'custom', message: 'Only Chatters supplies a roster snapshot' });
  }
  if (input.kind === 'remove' && (input.reason === 'timeout' || input.reason === 'moderated') && (input.until === null || input.until <= input.observedAt)) ctx.addIssue({ code: 'custom', message: 'Temporary hold must end after observation' });
  if (input.kind === 'remove' && (input.reason === 'ban' || input.reason === 'forget') && input.until !== null) ctx.addIssue({ code: 'custom', message: 'Permanent restrictions cannot expire on a timer' });
});
export type PresenceInput = z.infer<typeof PresenceInputSchema>;

/** A local visual slot is not a citizen ID, deed, reward or proof of tenancy. */
export const WindowPresenceSchema = z.strictObject({
  slot: UIntSchema.max(65534), present: z.boolean(), publicName: DisplayNameSchema.nullable(), since: EpochMsSchema,
});
export const KingdomPresenceFrameSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, epoch: TokenSchema, sequence: UIntSchema, asOf: EpochMsSchema,
  origin: z.enum(['live', 'simulated']), streamLive: z.boolean(), connection: z.enum(['fresh', 'stale', 'offline']),
  windows: z.array(WindowPresenceSchema).max(65535),
}).superRefine((frame, ctx) => {
  if (new Set(frame.windows.map(w => w.slot)).size !== frame.windows.length) ctx.addIssue({ code: 'custom', message: 'Duplicate window slot' });
  if (frame.windows.some(w => w.since > frame.asOf || (!w.present && w.publicName !== null))) ctx.addIssue({ code: 'custom', message: 'Invalid window time or absent name' });
  if ((!frame.streamLive || frame.connection !== 'fresh') && frame.windows.some(w => w.present)) ctx.addIssue({ code: 'custom', message: 'Stale/offline frames cannot claim presence' });
});
export type KingdomPresenceFrame = z.infer<typeof KingdomPresenceFrameSchema>;
/** Both simulation and Herald implement this, supplying full public projections.
 * Transport is independent of origin: Herald replay uses `simulated` too.
 * Consumers must explicitly select the expected origin and label simulated sources;
 * opening SSE alone never establishes live evidence. */
export interface PresenceFeed {
  readonly label: 'SIMULATED' | 'LIVE';
  subscribe(receive: (frame: KingdomPresenceFrame) => void, unavailable: () => void): () => void;
}
