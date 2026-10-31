import type { KingdomId } from '@chatdom/shared';
import type { DragonBattlePort, DragonSummonRequest } from '../../../herald/src/twitch-moments/ports';
import type { BattleState } from '../../../herald/src/twitch-moments/battle';
import { DRAGON_BEAT, type ActionPort, type ActionResult, type Capability, type KingdomMomentIntent } from '../twitch-moments';

/**
 * A SIMULATED realm battle authority for the bench only. It stands in for main's realm gameplay: it accepts the
 * Herald's dragon request (or rings the Wyrm Bell), runs the fight on its own clock and reports every revision
 * through `observe`, which is the ingest's real `observeBattle`. The bench's simulated crowd strikes here, and the
 * bench's Strike button reaches it through the gameplay port. The browser never tallies anything itself.
 */
export type BattleOutcome = 'victory' | 'retreat';

export interface SimulatedBattleOptions {
  readonly kingdomId: KingdomId;
  readonly clock: { now(): number };
  readonly observe: (state: BattleState) => unknown;
  /** How the simulated fight ends; the realm decides, never the client. */
  readonly outcome: () => BattleOutcome;
  /** The fight's length once active. */
  readonly lengthMs?: number;
}

const READY: Capability = { available: true, reason: 'ready', retryAt: null };
const UNAVAILABLE: Capability = { available: false, reason: 'unavailable', retryAt: null };

export function createSimulatedBattleAuthority(options: SimulatedBattleOptions) {
  const length = options.lengthMs ?? 48_000;
  let battle: BattleState | null = null, made = 0, receipts = 0, lastCrowd = 0;

  function report(next: BattleState): void { battle = next; options.observe(next); }
  const revise = (patch: Partial<BattleState>) => {
    if (!battle) return;
    report({ ...battle, ...patch, revision: battle.revision + 1, observedAt: options.clock.now() });
  };

  function begin(source: BattleState['source'], trainKey: string | null, form: BattleState['form'], sharedSessionKey: string | null): void {
    if (battle && battle.phase !== 'victory' && battle.phase !== 'retreat') return;
    const now = options.clock.now();
    report({ kingdomId: options.kingdomId, battleKey: `simbattle${++made}`, source, trainKey, phase: 'summoning', form, startsAt: now + DRAGON_BEAT.summoning.end,
      endsAt: now + DRAGON_BEAT.summoning.end + length, healthPermille: 1000, fighters: 0, acceptedStrikes: 0, sharedSessionKey, revision: 1, observedAt: now,
      origin: 'simulated' });
  }

  const port: DragonBattlePort = {
    async summon(request: DragonSummonRequest) {
      if (request.origin !== 'simulated') return { status: 'refused' };
      // An upgrade request while a battle runs changes its form; the realm keeps one dragon per kingdom.
      if (battle && battle.phase !== 'victory' && battle.phase !== 'retreat') { revise({ form: request.form }); return { status: 'accepted' }; }
      begin('hype', request.trainKey, request.form, request.sharedSessionKey);
      return { status: 'accepted' };
    },
  };

  /** One accepted strike: the realm's count and health move, and the fact returns through the ingest. */
  function strike(fighter: boolean): void {
    if (!battle || battle.phase !== 'active') return;
    const strikes = battle.acceptedStrikes + 1, outcome = options.outcome();
    // The simulated realm wears the dragon down toward its chosen outcome: low for a victory, never below half for a retreat.
    const floor = outcome === 'victory' ? 0 : 520;
    revise({ acceptedStrikes: strikes, fighters: battle.fighters + (fighter ? 1 : 0), healthPermille: Math.max(floor, battle.healthPermille - 34) });
  }

  const gameplay: ActionPort<KingdomMomentIntent> = {
    capabilities: () => new Map([['strike', battle?.phase === 'active' ? READY : UNAVAILABLE], ['haul', UNAVAILABLE], ['fireworks-chant', UNAVAILABLE]]),
    async submit(intent): Promise<ActionResult> {
      if (intent.args.kind !== 'strike' || !battle || battle.phase !== 'active' || intent.args.battleKey !== battle.battleKey) {
        return { status: 'rejected', intentId: intent.id, reason: 'ineligible', retryAt: null };
      }
      strike(true);
      return { status: 'accepted', intentId: intent.id, receiptKey: `simstrike${++receipts}`, acceptedAt: options.clock.now(), providerId: null };
    },
    reconcile: async () => { throw new Error('The simulated realm answers every strike at once; nothing is pending'); },
  };

  return {
    port,
    gameplay,
    /** The free, monarch-rung battle: the same fight with no train behind it. */
    ringWyrmBell(): void { begin('wyrm-bell', null, 'young', null); },
    /** Advance the simulated realm: summoning becomes active, the crowd strikes, the fight ends as chosen. */
    tick(): void {
      if (!battle) return;
      const now = options.clock.now();
      if (battle.phase === 'summoning' && now >= battle.startsAt) { revise({ phase: 'active' }); lastCrowd = now; return; }
      if (battle.phase !== 'active') return;
      if (now >= battle.endsAt || battle.healthPermille <= 0) { revise({ phase: options.outcome(), healthPermille: options.outcome() === 'victory' ? 0 : battle.healthPermille }); return; }
      // The SIMULATED crowd: a strike roughly every 1.3 s, a new fighter every third.
      if (now - lastCrowd >= 1300) { lastCrowd = now; strike(battle.acceptedStrikes % 3 === 0); }
    },
    /** Jump the simulated fight to its end now, for the victory and retreat scenarios. */
    finish(): void { if (battle?.phase === 'active' || battle?.phase === 'summoning') revise({ phase: options.outcome(), healthPermille: options.outcome() === 'victory' ? 0 : battle.healthPermille }); },
    current: () => battle,
  };
}
export type SimulatedBattleAuthority = ReturnType<typeof createSimulatedBattleAuthority>;
