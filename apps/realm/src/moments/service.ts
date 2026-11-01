import { type KingdomId, type PersonId } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, type RealmMomentObservation, type RealmStrike, type RealmSupportObservation } from '@chatdom/shared/realm';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import { applyChatNotice } from '../../../herald/src/twitch-moments/notices';
import { momentRepository } from '../../../herald/src/twitch-moments/records';
import type { CitizenDirectory } from '../../../herald/src/twitch-moments/ports';
import { decodeIngressCheckpoint, presencePerson } from '../ingress/codec';
import type { IngressReply } from '../ingress/service';
import type { DurableKingdom, DurableRealmServices } from '../persistence/kingdom';
import { describeStorageFailure, type RealmDatabase } from '../persistence/database';
import { createPostgresMomentRecords } from './records';
import { RealmDragonBattles, summonDragon } from './battle';
import { commitFacts } from './commit';
import type { DragonRecord } from './dragon-record';
import { applySpectacle } from './spectacles';
import { applyHomecoming, applyTown, HOME_REWARDS, rewardOf } from '../town/apply';
import { townRecords } from '../town/records';

/**
 * Settles a real person in the kingdom before an act that names them (a follow, a reward, a shared sub): their public
 * name, then a home chosen from the tenure evidence the act itself is (a follow date, sub months). Someone already
 * settled keeps the home they have. Resolves whether a new home was made, or null when nobody could be settled here
 * (the monarch, a person with three homes, a full kingdom, a name that is not approved).
 */
export interface TownSettler {
  settle(kingdom: DurableKingdom, person: { readonly personId: PersonId; readonly name: string },
    tenure: { readonly followedAt?: number; readonly months?: number }): Promise<{ readonly fresh: boolean } | null>;
}

/** Normalized support evidence shares the realm's held writer, durable records and public outbox. */
export class RealmSupportIngress {
  private services: DurableRealmServices | null = null;
  private settler: TownSettler | null = null;
  private pending = 0;
  /** Per kingdom: the open night as last committed here, and who has come home in it (a cache; the records decide). */
  private readonly nights = new Map<KingdomId, { nightKey: string | null; welcomed: Set<PersonId> }>();
  readonly battles: RealmDragonBattles;
  constructor(private readonly db: RealmDatabase, private readonly origin: 'live' | 'simulated',
    private readonly log: (line: string) => void = () => {}) {
    this.battles = new RealmDragonBattles(db, origin, log);
  }

  use(services: DurableRealmServices) { this.services = services; this.battles.use(services); }
  /** The citizens' settlement, composed after boot: follows, rewards and shared subs settle their people through it. */
  useSettler(settler: TownSettler) { this.settler = settler; }

  /** Settle people before the record transaction; a transient failure leaves delivery unclaimed for retry. */
  private async settle(kingdom: DurableKingdom, observation: RealmMomentObservation | RealmSupportObservation): Promise<Map<PersonId, boolean>> {
    const settled = new Map<PersonId, boolean>(), notice = observation.notice;
    let person: { personId: PersonId; name: string } | null = null, tenure: { followedAt?: number; months?: number } = {};
    if (notice.kind === 'follow') { person = notice.person; tenure = { followedAt: notice.followedAt }; }
    else if (notice.kind === 'redemption' && (notice.status === 'unfulfilled' || notice.status === 'fulfilled') && HOME_REWARDS.has(rewardOf(notice.rewardTitle)!)) person = notice.person;
    else if (notice.kind === 'entitlement' && notice.name && (notice.act.kind === 'start' || notice.act.kind === 'resub')) {
      person = { personId: notice.personId, name: notice.name };
      tenure = { months: notice.act.kind === 'resub' ? Math.max(1, notice.act.months) : 1 };
    }
    if (!person || !this.settler) return settled;
    try {
      const result = await this.settler.settle(kingdom, person, tenure);
      if (result) settled.set(person.personId, result.fresh);
    } catch (error) {
      this.log(`[town] could not settle a citizen: ${describeStorageFailure(error)}`);
      // A transient allocation failure must leave delivery unclaimed, so Herald can retry the whole act.
      throw error;
    }
    return settled;
  }

  /**
   * A citizen's words while a night is open. The first time tonight, a citizen whose home stood before tonight comes
   * home: the relight. Cheap when they already have: an in-memory check, no transaction.
   */
  async homecoming(kingdomId: KingdomId, people: readonly { readonly personId: PersonId; readonly fresh: boolean }[], at: number): Promise<void> {
    const cached = this.nights.get(kingdomId);
    const due = people.filter(p => !(cached && (cached.nightKey === null || cached.welcomed.has(p.personId))));
    if (!this.services || due.length === 0) return;
    const hold = await this.services.retain(kingdomId);
    try {
      const kingdom = hold.kingdom;
      if (kingdom.origin !== this.origin || !kingdom.current) return;
      const directory = await this.directory(kingdom);
      const committed = await kingdom.writeMoments(async (lease, current) => {
        const records = createPostgresMomentRecords(this.db, lease, this.origin, current);
        return records.transact(kingdomId, async tx => {
          const repository = momentRepository(tx), town = townRecords(tx), night = await town.night();
          const state = { nightKey: night?.phase === 'open' ? night.nightKey : null, welcomed: new Set<PersonId>() };
          const previous = this.nights.get(kingdomId);
          if (previous && previous.nightKey === state.nightKey) for (const p of previous.welcomed) state.welcomed.add(p);
          if (state.nightKey === null) return state;
          for (const person of due) {
            if (state.welcomed.has(person.personId)) continue;
            const result = await applyHomecoming({ kingdomId, town, directory, settled: new Map() }, person.personId, person.fresh, at);
            state.welcomed.add(person.personId);
            if (result.outcome === 'applied' && result.facts.length) {
              await commitFacts(tx, repository, result.facts, { occurredAt: at, receivedAt: at }, { kind: 'external', source: 'twitch.eventsub', id: `homecoming:${at}` }, this.origin);
            }
          }
          return state;
        });
      });
      this.nights.set(kingdomId, committed);
    } catch (error) {
      this.nights.delete(kingdomId);
      this.log(`[town] homecoming not recorded: ${describeStorageFailure(error)}`);
    } finally { await hold.release(); }
  }

  /** A witnessed `!strike`: the realm's battle alone decides whether it lands. */
  strike(strike: RealmStrike): 'accepted' | 'absent' { return this.battles.strike(strike); }

  /**
   * Bits, Hype Train and raid evidence. Claimed by its EventSub message ID in the same transaction that appends its
   * facts, so a resend or a Twitch redelivery is a duplicate and never a second beat. A train's claimed dragon wakes
   * in that same transaction; the battle then runs on the realm's clock.
   */
  async acceptMoment(observation: RealmMomentObservation): Promise<IngressReply> {
    if (!this.services || this.pending >= 32) return unavailable();
    this.pending++;
    try {
      const hold = await this.services.retain(observation.kingdomId);
      let woken: DragonRecord[] = [];
      try {
        const kingdom = hold.kingdom;
        if (kingdom.origin !== this.origin || !kingdom.current) return unavailable();
        if (observation.receivedAt > kingdom.databaseNow() + 5_000) {
          return { http: 400, body: { version: 1, status: 'refused', message: 'This evidence has a future receipt time.' } };
        }
        const settled = await this.settle(kingdom, observation);
        const result = await kingdom.writeMoments(async (lease, current) => {
          const directory = await this.directory(kingdom);
          const records = createPostgresMomentRecords(this.db, lease, this.origin, current);
          return records.transact(observation.kingdomId, async tx => {
            const repository = momentRepository(tx);
            if (!await repository.claimDelivery(observation.id)) return { status: 'duplicate' as const, woken: [] };
            const kind = observation.notice.kind;
            const applied = kind === 'bits' || kind === 'hype' || kind === 'raid'
              ? await applySpectacle(observation, { kingdomId: observation.kingdomId, repository, directory,
                founded: async kingdomId => (await this.db.query('SELECT 1 FROM realm_layout_heads WHERE kingdom_id = $1 AND origin = $2', [kingdomId, this.origin])).rowCount === 1 })
              : { ...await applyTown(observation, { kingdomId: observation.kingdomId, town: townRecords(tx), directory, settled }), summons: [] };
            if (applied.outcome === 'stale') return { status: 'accepted' as const, woken: [] };
            if (kind === 'stream') this.nights.delete(observation.kingdomId);
            await commitFacts(tx, repository, applied.facts, observation, { kind: 'external', source: 'twitch.eventsub', id: observation.id }, this.origin);
            const dragons: DragonRecord[] = [];
            for (const summon of applied.summons) {
              const now = Math.floor(kingdom.databaseNow()) - 250;
              const woke = await summonDragon(tx, repository, summon, now, this.origin);
              if (!woke || woke.facts.outcome !== 'applied') continue;
              await commitFacts(tx, repository, woke.facts.facts, { occurredAt: now, receivedAt: now }, { kind: 'external', source: 'twitch.eventsub', id: observation.id }, this.origin);
              dragons.push(woke.record);
            }
            return { status: 'accepted' as const, woken: dragons };
          });
        });
        woken = result.woken;
        return { http: 202, body: { version: 1, status: result.status } };
      } finally {
        await hold.release();
        for (const record of woken) this.battles.track(observation.kingdomId, record);
      }
    } catch (error) {
      this.log(`[moment ingress] ${describeStorageFailure(error)}`);
      return unavailable();
    } finally { this.pending--; }
  }

  async accept(observation: RealmSupportObservation): Promise<IngressReply> {
    if (!this.services || this.pending >= 32) return unavailable();
    this.pending++;
    try {
      const hold = await this.services.retain(observation.kingdomId);
      try {
        const kingdom = hold.kingdom;
        if (kingdom.origin !== this.origin || !kingdom.current) return unavailable();
        if (observation.receivedAt > kingdom.databaseNow() + 5_000) {
          return { http: 400, body: { version: 1, status: 'refused', message: 'This evidence has a future receipt time.' } };
        }
        // A shared sub from someone with no home yet settles them first, on their tenure street, so the banner has a home.
        const settled = await this.settle(kingdom, observation);
        const result = await kingdom.writeMoments(async (lease, current) => {
          // Capture the writer's own latest disclosure before the record transaction takes its row lock.
          const directory = await this.directory(kingdom);
          const records = createPostgresMomentRecords(this.db, lease, this.origin, current);
          return records.transact(observation.kingdomId, async tx => {
            const repository = momentRepository(tx);
            if (!await repository.claimDelivery(observation.id)) return 'duplicate' as const;
            const result = await applyChatNotice(observation.notice, { kingdomId: observation.kingdomId, repository, directory }, observation.occurredAt);
            // Settled by this sub tonight: home already, so their first words are not a homecoming.
            const subscriber = observation.notice.kind === 'entitlement' ? observation.notice.personId : null;
            if (subscriber !== null && settled.get(subscriber)) {
              await applyHomecoming({ kingdomId: observation.kingdomId, town: townRecords(tx), directory, settled }, subscriber, true, observation.occurredAt);
            }
            if (result.outcome === 'stale') return 'accepted' as const;
            await commitFacts(tx, repository, result.facts, observation, { kind: 'external', source: 'twitch.eventsub', id: observation.id }, this.origin);
            return 'accepted' as const;
          });
        });
        return { http: 202, body: { version: 1, status: result } };
      } finally { await hold.release(); }
    } catch (error) {
      this.log(`[support ingress] ${describeStorageFailure(error)}`);
      return unavailable();
    } finally { this.pending--; }
  }

  private async directory(kingdom: DurableKingdom): Promise<CitizenDirectory> {
    const checkpoint = await kingdom.loadIngress();
    const presence = checkpoint ? decodeIngressCheckpoint(checkpoint, kingdom.kingdomId, kingdom.origin).presence : null;
    const state = kingdom.privateState;
    return { resolve: async (kingdomId: KingdomId, personId) => {
      if (kingdomId !== kingdom.kingdomId) return null;
      const person = presence ? presencePerson(presence, personId) : undefined;
      if ((person && person.publicName === null) || state.rights[personId]?.blocked) return { disclosure: 'anonymous' };
      const home = Object.values(state.homes).find(home => home.ownerId === personId && home.layoutRevision === kingdom.layoutRevision);
      const slot = home?.slot ?? (String(personId) === kingdomId && state.castle ? REALM_CASTLE_SLOT : null);
      if (!home && slot === null && !person) return null;
      const row = (await this.db.query<{ public_name: string; name_approval: string }>(
        'SELECT public_name, name_approval FROM realm_citizen_names WHERE person_id = $1 AND origin = $2', [personId, kingdom.origin])).rows[0];
      const name = row?.name_approval === DISPLAY_NAME_APPROVAL ? approvedPublicName(row.public_name) : null;
      if (!name || name !== row?.public_name) return { disclosure: 'anonymous' };
      return { disclosure: 'named', displayName: name, homeSlot: slot };
    } };
  }
}

const unavailable = (): IngressReply => ({ http: 503, body: { version: 1, status: 'unavailable',
  message: 'The realm could not commit this support act. Send it again; delivery is idempotent.' } });
