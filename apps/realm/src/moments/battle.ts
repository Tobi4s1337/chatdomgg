import type { KingdomId, PersonId } from '@chatdom/shared';
import type { RealmStrike } from '@chatdom/shared/realm';
import { applyBattle, battleKeyOf, type BattleState } from '../../../herald/src/twitch-moments/battle';
import type { ClaimedSummon } from '../../../herald/src/twitch-moments/normalizer';
import type { MomentRecordTransaction } from '../../../herald/src/twitch-moments/ports';
import { momentRepository, type MomentRepository } from '../../../herald/src/twitch-moments/records';
import { describeStorageFailure, type RealmDatabase } from '../persistence/database';
import type { DurableKingdom, DurableRealmServices } from '../persistence/kingdom';
import { commitFacts } from './commit';
import { DRAGON_FIGHTER_MEMORY, DragonRecordSchema, type DragonRecord } from './dragon-record';
import { createPostgresMomentRecords } from './records';

/** From the summons to the fight: the dragon wakes, rises, roars and climbs to the town's sky (`DRAGON_BEAT.summoning`). */
export const DRAGON_WAKE_MS = 10_000;
/** The fight itself (Twitch.md §7: two to four minutes, won by the crowd's strikes; the dragon may retreat). */
export const DRAGON_FIGHT_MS = 180_000;
/** One person's strikes land at most this often; faster ones are not counted. */
export const STRIKE_CADENCE_MS = 800;
/** Accepted strikes are committed together at most this often, so a crowd never floods the moment log. */
export const STRIKE_FLUSH_MS = 1_000;
/** Strikes waiting for one battle at once; the rest are refused as the crowd's tally, never queued. */
const PENDING_STRIKE_LIMIT = 100_000;
/** Facts are stamped this far behind the authority's clock, so no fact is ever received after it commits. */
const STAMP_LAG_MS = 250;
/** The wake-up for the fight's start waits out the stamp lag, so the pass that starts it really sees it start. */
const START_MARGIN_MS = STAMP_LAG_MS * 2;

/**
 * The dragon's strength grows with the crowd that fights it: a lone fighter needs about fifty strikes, ten fighters
 * about twelve each, a thousand about eight each. The tally is the realm's alone.
 */
export const dragonVitality = (fighters: number) => 40 + 8 * fighters;
export const dragonHealthPermille = (record: Pick<DragonRecord, 'acceptedStrikes' | 'fighters'>) =>
  Math.max(0, Math.min(1000, Math.round(1000 * (1 - record.acceptedStrikes / dragonVitality(record.fighters)))));

const FINISHED = new Set<DragonRecord['phase']>(['victory', 'retreat']);
const dragonKey = (battleKey: string) => `twitch-moments:dragon:${battleKey}`;

export async function readDragon(tx: MomentRecordTransaction, battleKey: string): Promise<DragonRecord | null> {
  const value = await tx.get(dragonKey(battleKey));
  return value === undefined || value === null ? null : DragonRecordSchema.parse(value);
}
const putDragon = (tx: MomentRecordTransaction, record: DragonRecord) => tx.put(dragonKey(record.battleKey), DragonRecordSchema.parse(record));

function stateOf(record: DragonRecord, kingdomId: KingdomId, observedAt: number, origin: 'live' | 'simulated'): BattleState {
  return { kingdomId, battleKey: record.battleKey, source: record.source, trainKey: record.trainKey, phase: record.phase, form: record.form,
    startsAt: record.startsAt, endsAt: record.endsAt, healthPermille: dragonHealthPermille(record), fighters: record.fighters,
    acceptedStrikes: record.acceptedStrikes, sharedSessionKey: record.sharedSessionKey, revision: record.revision, observedAt, origin };
}

/**
 * Inside the Hype Train's own record transaction: a claimed summons wakes the train's one dragon, or changes the form
 * of the dragon already in the sky. A fallen or departed dragon is never woken twice by the same train.
 */
export async function summonDragon(tx: MomentRecordTransaction, repository: MomentRepository, summon: ClaimedSummon, now: number,
  origin: 'live' | 'simulated'): Promise<{ record: DragonRecord; facts: Awaited<ReturnType<typeof applyBattle>> } | null> {
  const battleKey = summon.trainKey, previous = await readDragon(tx, battleKey);
  if (previous && (FINISHED.has(previous.phase) || previous.form === summon.form)) return null;
  const record: DragonRecord = previous ? { ...previous, form: summon.form, revision: previous.revision + 1 } : {
    version: 1, battleKey, source: 'hype', trainKey: summon.trainKey, form: summon.form, phase: 'summoning',
    startsAt: now + DRAGON_WAKE_MS, endsAt: now + DRAGON_WAKE_MS + DRAGON_FIGHT_MS, acceptedStrikes: 0, fighters: 0, fighterIds: [],
    sharedSessionKey: summon.sharedSessionKey, revision: 1,
  };
  await putDragon(tx, record);
  return { record, facts: await applyBattle(repository, stateOf(record, summon.kingdomId, now, origin)) };
}

interface Pending { strikes: number; readonly fighters: Set<PersonId> }
interface KingdomBattles {
  readonly records: Map<string, DragonRecord>;
  readonly pending: Map<string, Pending>;
  readonly cadence: Map<PersonId, number>;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  again: boolean;
  lastFlush: number;
}

/**
 * The realm's dragon battles: phases on the authority's clock, chat strikes tallied here, every change committed
 * through the kingdom's own held writer as the public `battle` fact. A battle survives a restart: the open kingdom's
 * current battle facts name what to resume, and the private record carries the tally.
 */
export class RealmDragonBattles {
  private services: DurableRealmServices | null = null;
  private readonly kingdoms = new Map<KingdomId, KingdomBattles>();
  private stopped = false;
  readonly counts = { summoned: 0, strikes: 0, refused: 0, commits: 0, victories: 0, retreats: 0, failures: 0 };

  constructor(private readonly db: RealmDatabase, private readonly origin: 'live' | 'simulated', private readonly log: (line: string) => void = () => {},
    private readonly clock: () => number = Date.now) {}

  use(services: DurableRealmServices) { this.services = services; }

  /** After a committed summons or change: follow it until it ends. */
  track(kingdomId: KingdomId, record: DragonRecord) {
    if (this.stopped) return;
    const battles = this.battles(kingdomId);
    if (FINISHED.has(record.phase)) { battles.records.delete(record.battleKey); battles.pending.delete(record.battleKey); }
    else {
      const known = battles.records.get(record.battleKey);
      if (!known || known.revision <= record.revision) battles.records.set(record.battleKey, record);
      if (record.phase === 'summoning') this.counts.summoned++;
    }
    this.schedule(kingdomId);
  }

  /** A witnessed `!strike`. Lands only while this kingdom's dragon is in the fight, at most once per cadence per person. */
  strike(strike: RealmStrike): 'accepted' | 'absent' {
    const battles = this.kingdoms.get(strike.kingdomId);
    const now = this.clock();
    const target = battles && [...battles.records.values()].find(r => r.phase === 'active' || (r.phase === 'summoning' && now >= r.startsAt));
    if (!battles || !target || strike.origin !== this.origin || strike.observedAt > target.endsAt || now >= target.endsAt) { this.counts.refused++; return 'absent'; }
    const last = battles.cadence.get(strike.personId);
    if (last !== undefined && strike.observedAt - last < STRIKE_CADENCE_MS) { this.counts.refused++; return 'absent'; }
    const pending = battles.pending.get(target.battleKey) ?? { strikes: 0, fighters: new Set<PersonId>() };
    if (pending.strikes >= PENDING_STRIKE_LIMIT) { this.counts.refused++; return 'absent'; }
    battles.cadence.set(strike.personId, strike.observedAt);
    if (battles.cadence.size > DRAGON_FIGHTER_MEMORY * 4) battles.cadence.delete(battles.cadence.keys().next().value!);
    pending.strikes++; pending.fighters.add(strike.personId);
    battles.pending.set(target.battleKey, pending);
    this.counts.strikes++;
    this.schedule(strike.kingdomId);
    return 'accepted';
  }

  /** Registry hook: resume this kingdom's unfinished battles from its current public state. */
  attach(kingdom: DurableKingdom): () => void {
    void kingdom.writeMoments(async (lease, current) => createPostgresMomentRecords(this.db, lease, this.origin, current)
      .transact(kingdom.kingdomId, async tx => {
        const repository = momentRepository(tx), found: DragonRecord[] = [];
        for (const fact of await repository.currentFacts()) {
          if (fact.body.kind !== 'battle') continue;
          const record = await readDragon(tx, fact.body.battleKey);
          if (record && !FINISHED.has(record.phase)) found.push(record);
        }
        return found;
      })).then(found => { for (const record of found) this.track(kingdom.kingdomId, record); },
      error => this.log(`[dragon] kingdom ${kingdom.kingdomId} battles not resumed: ${describeStorageFailure(error)}`));
    return () => {};
  }

  stop() {
    this.stopped = true;
    for (const battles of this.kingdoms.values()) if (battles.timer) clearTimeout(battles.timer);
    this.kingdoms.clear();
  }

  private battles(kingdomId: KingdomId): KingdomBattles {
    let battles = this.kingdoms.get(kingdomId);
    if (!battles) {
      battles = { records: new Map(), pending: new Map(), cadence: new Map(), timer: null, running: null, again: false, lastFlush: 0 };
      this.kingdoms.set(kingdomId, battles);
    }
    return battles;
  }

  /** The next moment something changes: the fight begins, strikes are due to land, or time runs out. */
  private schedule(kingdomId: KingdomId) {
    const battles = this.kingdoms.get(kingdomId);
    if (!battles || this.stopped) return;
    if (battles.records.size === 0) { if (battles.timer) clearTimeout(battles.timer); this.kingdoms.delete(kingdomId); return; }
    const now = this.clock();
    let next = Infinity;
    for (const record of battles.records.values()) {
      next = Math.min(next, record.phase === 'summoning' ? record.startsAt + START_MARGIN_MS : record.endsAt);
      if ((battles.pending.get(record.battleKey)?.strikes ?? 0) > 0) next = Math.min(next, battles.lastFlush + STRIKE_FLUSH_MS);
    }
    if (battles.timer) clearTimeout(battles.timer);
    battles.timer = setTimeout(() => { battles.timer = null; this.advance(kingdomId); }, Math.max(0, Math.min(next - now, 2_147_000_000)));
    battles.timer.unref?.();
  }

  private advance(kingdomId: KingdomId) {
    const battles = this.kingdoms.get(kingdomId);
    if (!battles || this.stopped) return;
    if (battles.running) { battles.again = true; return; }
    battles.running = this.commit(kingdomId, battles).catch(error => {
      this.counts.failures++;
      this.log(`[dragon] kingdom ${kingdomId} battle waits: ${describeStorageFailure(error)}`);
      // Try again shortly; nothing pending is lost, nothing committed repeats.
      if (battles.timer) clearTimeout(battles.timer);
      battles.timer = setTimeout(() => { battles.timer = null; this.advance(kingdomId); }, 2_000);
      battles.timer.unref?.();
    }).finally(() => {
      battles.running = null;
      if (battles.again) { battles.again = false; this.advance(kingdomId); } else if (!battles.timer) this.schedule(kingdomId);
    });
  }

  private async commit(kingdomId: KingdomId, battles: KingdomBattles) {
    if (!this.services) throw new Error('The dragon has no realm to fight in yet.');
    // What this pass takes; strikes accepted while it runs wait for the next.
    const taken = new Map([...battles.pending].map(([key, p]) => [key, { strikes: p.strikes, fighters: [...p.fighters] }]));
    const hold = await this.services.retain(kingdomId);
    let changed: DragonRecord[], waiting = new Set<string>();
    try {
      const kingdom = hold.kingdom;
      changed = await kingdom.writeMoments(async (lease, current) => createPostgresMomentRecords(this.db, lease, this.origin, current)
        .transact(kingdomId, async tx => {
          const repository = momentRepository(tx), out: DragonRecord[] = [], notYet = new Set<string>();
          const now = Math.floor(kingdom.databaseNow()) - STAMP_LAG_MS;
          for (const known of battles.records.values()) {
            const stored = await readDragon(tx, known.battleKey);
            if (!stored) continue;
            const next = advanceDragon(stored, taken.get(known.battleKey), now);
            // Strikes taken for a dragon still climbing on this clock land on a later pass, not never.
            if (next.phase === 'summoning') notYet.add(known.battleKey);
            if (next === stored) continue;
            await putDragon(tx, next);
            const result = await applyBattle(repository, stateOf(next, kingdomId, now, this.origin));
            if (result.outcome === 'applied') {
              await commitFacts(tx, repository, result.facts, { occurredAt: now, receivedAt: now },
                { kind: 'scheduled', id: `dragon.${next.battleKey}.${next.revision}` }, this.origin);
            }
            out.push(next);
          }
          return { out, notYet };
        })).then(result => { waiting = result.notYet; return result.out; });
    } finally { await hold.release(); }
    this.counts.commits++;
    battles.lastFlush = this.clock();
    for (const [key, took] of taken) {
      const pending = battles.pending.get(key);
      if (!pending || waiting.has(key)) continue;
      pending.strikes = Math.max(0, pending.strikes - took.strikes);
      for (const person of took.fighters) pending.fighters.delete(person);
      if (pending.strikes === 0 && pending.fighters.size === 0) battles.pending.delete(key);
    }
    for (const record of changed) {
      if (record.phase === 'victory') this.counts.victories++;
      if (record.phase === 'retreat') this.counts.retreats++;
      this.track(kingdomId, record);
    }
  }
}

/** One step of the fight on the authority's clock. Returns the same record when nothing changes. */
export function advanceDragon(record: DragonRecord, took: { strikes: number; fighters: readonly PersonId[] } | undefined, now: number): DragonRecord {
  if (FINISHED.has(record.phase)) return record;
  let next = record;
  if (next.phase === 'summoning' && now >= next.startsAt) next = { ...next, phase: 'active' };
  if (next.phase === 'active' && took && took.strikes > 0) {
    const known = new Set(next.fighterIds), joined = took.fighters.filter(person => !known.has(person));
    next = { ...next, acceptedStrikes: next.acceptedStrikes + took.strikes, fighters: next.fighters + joined.length,
      fighterIds: [...next.fighterIds, ...joined].slice(0, DRAGON_FIGHTER_MEMORY) };
  }
  if (next.phase === 'active' && dragonHealthPermille(next) === 0) next = { ...next, phase: 'victory' };
  else if (now >= next.endsAt) next = { ...next, phase: 'retreat' };
  return next === record ? record : { ...next, revision: record.revision + 1 };
}

export { battleKeyOf };
