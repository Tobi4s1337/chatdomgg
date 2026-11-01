import { z } from 'zod';
import { TokenSchema } from '@chatdom/shared';

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
