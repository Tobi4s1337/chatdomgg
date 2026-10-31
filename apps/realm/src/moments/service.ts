import { type KingdomId } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, type RealmSupportObservation } from '@chatdom/shared/realm';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import { applyChatNotice } from '../../../herald/src/twitch-moments/notices';
import { momentRepository } from '../../../herald/src/twitch-moments/records';
import type { CitizenDirectory } from '../../../herald/src/twitch-moments/ports';
import { decodeIngressCheckpoint, presencePerson } from '../ingress/codec';
import type { IngressReply } from '../ingress/service';
import type { DurableKingdom, DurableRealmServices } from '../persistence/kingdom';
import { describeStorageFailure, type RealmDatabase } from '../persistence/database';
import { createPostgresMomentRecords } from './records';

/** Normalized support evidence shares the realm's held writer, durable records and public outbox. */
export class RealmSupportIngress {
  private services: DurableRealmServices | null = null;
  private pending = 0;
  constructor(private readonly db: RealmDatabase, private readonly origin: 'live' | 'simulated',
    private readonly log: (line: string) => void = () => {}) {}

  use(services: DurableRealmServices) { this.services = services; }

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
        const result = await kingdom.writeMoments(async (lease, current) => {
          // Capture the writer's own latest disclosure before the record transaction takes its row lock.
          const directory = await this.directory(kingdom);
          const records = createPostgresMomentRecords(this.db, lease, this.origin, current);
          return records.transact(observation.kingdomId, async tx => {
            const repository = momentRepository(tx);
            if (!await repository.claimDelivery(observation.id)) return 'duplicate' as const;
            const result = await applyChatNotice(observation.notice, { kingdomId: observation.kingdomId, repository, directory }, observation.occurredAt);
            if (result.outcome === 'stale') return 'accepted' as const;
            for (const { body, current: persistent } of result.facts) {
              const fact = await tx.appendFact(body, observation, { kind: 'external', source: 'twitch.eventsub', id: observation.id }, this.origin);
              if (persistent && !await repository.setCurrent(fact)) throw new Error('Moment current state exceeds its budget');
            }
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
