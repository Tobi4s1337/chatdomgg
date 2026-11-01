import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema } from '../identity';

export const ACTIONS = ['gate-open', 'gate-close', 'fire-light', 'raid-welcome', 'citizen-crown', 'citizen-knight', 'moment-play', 'undo'] as const;
const id = TokenSchema;
const person = z.string().regex(/^[1-9][0-9]{0,31}$/);
const label = z.string().min(1).max(200);
export const DockActionSchema = z.strictObject({ id, kingdomId: person, kind: z.enum(ACTIONS), targetId: id.optional(), expectedRevision: id });
export type DockAction = z.infer<typeof DockActionSchema>;
export const DockStateSchema = z.strictObject({
  kingdom: z.strictObject({ id: person, name: label }),
  principal: z.strictObject({ role: z.enum(['broadcaster', 'moderator']), displayName: label }),
  town: z.strictObject({ gate: z.enum(['open', 'closed']), fire: z.enum(['lit', 'unlit']), presenceLabel: label, growthLabel: label, comingLabel: label }),
  raids: z.array(z.strictObject({ id, name: label })).max(100),
  citizens: z.array(z.strictObject({ id, name: label })).max(1000),
  moments: z.array(z.strictObject({ id, name: label, available: z.boolean(), reason: z.string().max(200) })).max(100),
  capabilities: z.array(z.strictObject({ kind: z.enum(ACTIONS), allowed: z.boolean(), reason: z.string().max(200) })).max(8),
  revision: id,
  undoable: z.array(z.strictObject({ id, kind: z.enum(ACTIONS.filter(kind => kind !== 'undo')), label })).max(20).optional(),
});
export type DockState = z.infer<typeof DockStateSchema>;
export const DockWitnessSchema = z.strictObject({ actionId: id, kingdomId: person, origin: z.enum(['live', 'simulated']), streamEventId: id });
export type DockWitness = z.infer<typeof DockWitnessSchema>;
export const DockOutcomeSchema = z.strictObject({ status: z.enum(['accepted', 'refused', 'unknown', 'unavailable']), message: label,
  receipt: id.optional(), witness: DockWitnessSchema.optional(),
  state: DockStateSchema.optional() }).refine(value => value.status !== 'accepted' || (!!value.receipt && !!value.witness), 'Accepted requires a delivery receipt and stream witness');
export type DockOutcome = z.infer<typeof DockOutcomeSchema>;

/** Status replies are private to the authenticated session and never contain the session handle. */
export type DockStatusReply = {
  version: 1; status: 'ready' | 'anonymous' | 'forbidden' | 'unavailable'; mode: 'LIVE' | 'SIMULATED';
  message: string; signInUrl: string;
} & ( { status: 'ready'; csrfToken: string } & DockState | { status: 'anonymous' | 'forbidden' | 'unavailable' } );
export type DockActionReply = { version: 1 } & DockOutcome;

/** Private API-to-realm identity, independently revalidated by the realm. */
export const RealmDockActorSchema = z.strictObject({ personId: PersonIdSchema, sessionId: z.uuid() });
export const RealmDockStatusRequestSchema = z.strictObject({ version: z.literal(1), origin: z.enum(['live', 'simulated']), principal: RealmDockActorSchema, kingdomId: KingdomIdSchema });
export const RealmDockActionRequestSchema = z.strictObject({ version: z.literal(1), origin: z.enum(['live', 'simulated']), principal: RealmDockActorSchema, action: DockActionSchema });
/** Committed public stage direction; no actor session, submitted words or authority token. */
export const RealmDockPresentationSchema = z.strictObject({
  version: z.literal(1), id, actionId: id, kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  kind: z.enum(ACTIONS), targetId: id.optional(), targetName: label.optional(), targetSlot: z.number().int().min(0).max(65535).optional(),
  occurredAt: EpochMsSchema, expiresAt: EpochMsSchema,
  gate: z.enum(['open', 'closed']), fire: z.enum(['lit', 'unlit']),
  undoOf: id.optional(), moment: z.literal('sky-dusk').optional(),
}).refine(value => value.expiresAt > value.occurredAt && value.expiresAt - value.occurredAt <= 60_000, 'A stage direction has a bounded future lifetime');
/** Proof capability is issued only to a session-verified presenter connection; never a public event field. */
export const RealmDockWitnessRequestSchema = z.strictObject({
  version: z.literal(1), principal: RealmDockActorSchema, kingdomId: KingdomIdSchema,
  origin: z.enum(['live', 'simulated']), streamEventId: id, presenterToken: z.string().min(32).max(192).regex(/^[A-Za-z0-9_-]+$/),
});
export type RealmDockActor = z.infer<typeof RealmDockActorSchema>;
export type RealmDockStatusRequest = z.infer<typeof RealmDockStatusRequestSchema>;
export type RealmDockActionRequest = z.infer<typeof RealmDockActionRequestSchema>;
export type RealmDockPresentation = z.infer<typeof RealmDockPresentationSchema>;
export type RealmDockWitnessRequest = z.infer<typeof RealmDockWitnessRequestSchema>;
export const REALM_DOCK_ROUTES = {
  status: '/internal/dock/status', action: '/internal/dock/action',
  presentations: '/internal/dock/presentations/:kingdomId', witness: '/internal/dock/witness',
} as const;

/** Current lasting royal presentation, never a request to replay a ceremony or issue a witness. */
export const RealmDockStageStateSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  asOf: EpochMsSchema, revision: id, gate: z.enum(['open', 'closed']), fire: z.enum(['lit', 'unlit']), fireUntil: EpochMsSchema,
  honours: z.array(z.strictObject({ id, name: label, slot: z.number().int().min(0).max(65535),
    kind: z.enum(['citizen-crown', 'citizen-knight']), expiresAt: EpochMsSchema })).max(1000),
});
export type RealmDockStageState = z.infer<typeof RealmDockStageStateSchema>;
