import { z } from 'zod';
import { TokenSchema } from '@chatdom/shared';
import { ACTIONS, DockStateSchema as RealmDockStateSchema, DockOutcomeSchema as RealmDockOutcomeSchema } from '@chatdom/shared/realm';

// Main owns the frozen action and witness boundary. These are direct re-exports.
export { ACTIONS, DockActionSchema, DockWitnessSchema, type DockAction, type DockWitness } from '@chatdom/shared/realm';

// Optional API presentation hints remain compatible with the frozen realm status.
// Main may adopt this additive field; older bridges omit it and decide undo atomically.
export const DockStateSchema = RealmDockStateSchema.extend({
  undoable: z.array(z.strictObject({ id: TokenSchema, kind: z.enum(ACTIONS.filter(kind => kind !== 'undo')),
    label: z.string().min(1).max(200) })).max(20).optional(),
});
export type DockState = z.infer<typeof DockStateSchema>;
export const DockOutcomeSchema = RealmDockOutcomeSchema.safeExtend({ state: DockStateSchema.optional() });
export type DockOutcome = z.infer<typeof DockOutcomeSchema>;
export type DockStatusReply = {
  version: 1; status: 'ready' | 'anonymous' | 'forbidden' | 'unavailable'; mode: 'LIVE' | 'SIMULATED';
  message: string; signInUrl: string;
} & ({ status: 'ready'; csrfToken: string } & DockState | { status: 'anonymous' | 'forbidden' | 'unavailable' });
export type DockActionReply = { version: 1 } & DockOutcome;
