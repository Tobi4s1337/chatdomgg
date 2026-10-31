import { EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema } from '@chatdom/shared';
import type { MomentBodyOf } from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import { providerToken } from './credit';
import type { NormalizeResult } from './normalizer';
import { DragonFormSchema, type MomentRepository } from './records';

/** A new battle phase may begin its beat for one minute after authority reports it; later it is state. */
export const BATTLE_BEAT_WINDOW_MS = 60_000;
const FINISHED: ReadonlySet<string> = new Set(['victory', 'retreat']);

/**
 * Authoritative battle state from main's realm gameplay, server-side only. Strikes, fighters, health, timing,
 * victory and retreat are the realm's to decide; nothing here computes or adjusts them. `revision` is monotonic
 * per battle and orders reports; `origin` must match the ingest. A Hype battle names its train, a Wyrm Bell
 * battle none.
 */
export const BattleStateSchema = z.strictObject({
  kingdomId: KingdomIdSchema,
  battleKey: TokenSchema,
  source: z.enum(['hype', 'wyrm-bell']),
  trainKey: TokenSchema.nullable(),
  phase: z.enum(['summoning', 'active', 'victory', 'retreat']),
  form: DragonFormSchema,
  startsAt: EpochMsSchema,
  endsAt: EpochMsSchema,
  healthPermille: UIntSchema.max(1000),
  fighters: UIntSchema.max(1_000_000),
  acceptedStrikes: UIntSchema,
  sharedSessionKey: TokenSchema.nullable(),
  revision: UIntSchema,
  observedAt: EpochMsSchema,
  origin: z.enum(['live', 'simulated']),
}).refine(b => b.endsAt >= b.startsAt, 'A battle cannot end before it starts')
  .refine(b => (b.source === 'hype') === (b.trainKey !== null), 'Only a Hype battle names a train');
export type BattleState = z.infer<typeof BattleStateSchema>;

export const battleKeyOf = (battleKey: string) => providerToken('battle', battleKey);
/** The claim for one authoritative revision of one battle. */
export const battleRevisionId = (state: BattleState) => providerToken('br', `${state.battleKey}.${state.revision}`);

/**
 * Apply one authoritative battle report inside the record transaction. An older or equal revision is stale, and
 * a finished battle (victory or retreat) stays finished. While it lasts the battle is the one current battle
 * fact; its finish is published and leaves current state. A new phase is a beat, an update within one is state.
 */
export async function applyBattle(repository: MomentRepository, state: BattleState): Promise<NormalizeResult> {
  const previous = await repository.battle(state.battleKey);
  if (previous && (previous.revision >= state.revision || FINISHED.has(previous.phase))) return { outcome: 'stale' };
  await repository.putBattle({ version: 1, battleKey: state.battleKey, revision: state.revision, phase: state.phase, observedAt: state.observedAt });
  const beat = !previous || previous.phase !== state.phase;
  const body: MomentBodyOf<'battle'> = {
    kind: 'battle', key: battleKeyOf(state.battleKey), displayUntil: beat ? state.observedAt + BATTLE_BEAT_WINDOW_MS : state.observedAt,
    battleKey: state.battleKey, source: state.source, phase: state.phase, form: state.form, startsAt: state.startsAt, endsAt: state.endsAt,
    healthPermille: state.healthPermille, fighters: state.fighters, acceptedStrikes: state.acceptedStrikes, sharedSessionKey: state.sharedSessionKey,
  };
  return { outcome: 'applied', facts: [{ current: !FINISHED.has(state.phase), slot: { name: 'battle', order: state.startsAt }, body }] };
}
