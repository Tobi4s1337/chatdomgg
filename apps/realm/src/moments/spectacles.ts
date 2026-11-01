import type { KingdomId } from '@chatdom/shared';
import type { RealmMomentObservation } from '@chatdom/shared/realm';
import { PublicNameSchema, type MomentBodyOf } from '@chatdom/shared/twitch-moments';
import { BITS_BEAT_WINDOW_MS } from '../../../herald/src/twitch-moments/bits';
import { providerToken, resolveCredit } from '../../../herald/src/twitch-moments/credit';
import { applyHype } from '../../../herald/src/twitch-moments/hype';
import type { ClaimedSummon, NormalizedFact } from '../../../herald/src/twitch-moments/normalizer';
import type { CitizenDirectory } from '../../../herald/src/twitch-moments/ports';
import type { MomentRepository } from '../../../herald/src/twitch-moments/records';

/** A raid's caravan may begin for one minute after Twitch reports it; later it has already passed the gate. */
export const RAID_BEAT_WINDOW_MS = 60_000;

export interface SpectacleContext {
  readonly kingdomId: KingdomId;
  readonly repository: MomentRepository;
  readonly directory: CitizenDirectory;
  /** Whether a channel has a founded kingdom of this realm's origin: the caravan then comes from its gate. */
  readonly founded: (kingdomId: KingdomId) => Promise<boolean>;
}
export type SpectacleResult = { readonly outcome: 'applied'; readonly facts: readonly NormalizedFact[]; readonly summons: readonly ClaimedSummon[] }
  | { readonly outcome: 'stale' };

/**
 * One piece of spectacle evidence inside its record transaction. A cheer or Power-up is one shared beat for the town,
 * credited by person ID only (a quiet citizen stays unnamed); the Hype Train goes through the same train normalizer as
 * every other source, and may claim its dragon; a raid is a visit under the raiding channel's real public name.
 */
export async function applySpectacle(observation: RealmMomentObservation, context: SpectacleContext): Promise<SpectacleResult> {
  const { notice } = observation, at = observation.occurredAt;
  switch (notice.kind) {
    case 'bits': {
      const credit = notice.payer === null ? null : await resolveCredit(context.directory, context.kingdomId, notice.payer.personId, notice.payer.name);
      const displayUntil = at + BITS_BEAT_WINDOW_MS, act = notice.act;
      const body: MomentBodyOf<'cheer' | 'power-up'> = act.kind === 'cheer'
        ? { kind: 'cheer', key: providerToken('cheer', observation.id), displayUntil, credit, bits: act.bits }
        : { kind: 'power-up', key: providerToken('power-up', observation.id), displayUntil, credit, effect: act.effect, emoteId: act.emoteId, mappingKey: act.mappingKey };
      return { outcome: 'applied', facts: [{ current: false, body }], summons: [] };
    }
    case 'hype': {
      const result = await applyHype({ kingdomId: context.kingdomId, repository: context.repository, directory: context.directory, summonable: true },
        notice.update, { occurredAt: at, recovered: false });
      return result.outcome === 'stale' ? result : { outcome: 'applied', facts: result.facts, summons: result.summons ?? [] };
    }
    case 'raid': {
      const name = PublicNameSchema.safeParse(notice.from.name), login = PublicNameSchema.safeParse(notice.from.login);
      const displayName = name.success ? name.data : login.success ? login.data : null;
      if (displayName === null) return { outcome: 'stale' };
      const key = providerToken('raid', observation.id);
      const body: MomentBodyOf<'raid'> = { kind: 'raid', key, displayUntil: at + RAID_BEAT_WINDOW_MS, raidKey: key,
        from: { kingdomId: notice.from.kingdomId, displayName, crestKey: null }, viewers: notice.viewers, founded: await context.founded(notice.from.kingdomId) };
      return { outcome: 'applied', facts: [{ current: false, body }], summons: [] };
    }
    // Follows, the night, rewards and polls shape the town (`../town/apply`), not a spectacle.
    default: return { outcome: 'stale' };
  }
}
