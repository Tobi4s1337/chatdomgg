import { castleHostId, type RealmPrivateState, type RealmPublicMessage } from '@chatdom/shared/realm';
import type { RealmOutboxRow } from '../persistence/postgres-repository';

export type RealmPublicHome = Extract<RealmPublicMessage, { type: 'home' }>;
export type RealmPublicCastle = Extract<RealmPublicMessage, { type: 'castle' }>;
export type RealmPublicPresence = Extract<RealmPublicMessage, { type: 'presence' }>;

/** The delivered public prefix a projection starts from: what rows at or below `cursor` left standing. */
export interface PublicPrefix {
  readonly homes: Iterable<RealmPublicHome>;
  readonly presence: RealmPublicPresence | null;
  readonly castle?: RealmPublicCastle | null;
  readonly castleBase?: RealmPublicCastle | null;
  readonly cursor: number;
  readonly sequence: number;
  /** Original allocated bases, used only when a first Forge row publishes a home. */
  readonly bases?: Iterable<RealmPublicHome>;
}

/**
 * The public face of a kingdom as of its last committed outbox row: which homes have been published and the newest
 * presence frame. Each delivered row advances this prefix synchronously. A fresh join sees the homes and attachments at
 * `throughCursor`, even while the private state is ahead, and none of the spectacle that produced them.
 */
export class PublicProjection {
  private readonly bases = new Map<string, Extract<RealmPublicMessage, { type: 'home' }>>();
  private readonly homes = new Map<string, Extract<RealmPublicMessage, { type: 'home' }>>();
  private castleBase: RealmPublicCastle | null;
  private castle: RealmPublicCastle | null;
  private presence: Extract<RealmPublicMessage, { type: 'presence' }> | null;
  /** The newest outbox row folded in. */
  cursor: number;
  /** The newest domain sequence folded in (`throughSequence`). */
  sequence: number;

  constructor(initial: PublicPrefix) {
    this.sequence = initial.sequence;
    this.castle = initial.castle ?? null;
    this.castleBase = initial.castle ?? initial.castleBase ?? null;
    for (const base of initial.bases ?? []) this.bases.set(base.plotId, base);
    for (const home of initial.homes) { this.bases.set(home.plotId, home); this.homes.set(home.plotId, home); }
    this.cursor = initial.cursor;
    this.presence = initial.presence;
  }

  /** Remember an allocated home's base once, before publication. Later private builds never overwrite that prefix. */
  rememberHomes(state: RealmPrivateState) {
    if (state.castle && !this.castleBase) {
      const castle = state.castle;
      this.castleBase = { type: 'castle', moduleId: castle.moduleId, revision: castle.revision, assetHash: castle.digest, attachments: [] };
    }
    for (const home of Object.values(state.homes)) if (!this.bases.has(home.id)) {
      this.bases.set(home.id, { type: 'home', plotId: home.id, revision: home.revision, assetHash: home.digest, attachments: [] });
    }
  }

  adopt(rows: readonly RealmOutboxRow[]) {
    for (const row of rows) {
      if (row.id <= this.cursor) continue;
      if (row.message.type === 'castle') this.castle = this.castleBase = row.message;
      if (row.message.type === 'home') {
        this.bases.set(row.message.plotId, row.message); this.homes.set(row.message.plotId, row.message);
      }
      if (row.message.type === 'forge' && row.message.event.type === 'committed' && row.plotId) {
        const castle = this.castleBase && castleHostId(this.castleBase.moduleId) === row.plotId ? this.castleBase : null;
        const home = castle ?? this.bases.get(row.plotId);
        if (!home) throw new Error('A published forge attachment has no committed home base');
        const attachment = row.message.event.attachment;
        const published = { ...home, revision: `r${row.sequence}`,
          attachments: [...home.attachments.filter(item => item.socketId !== attachment.socketId), attachment] };
        if (published.type === 'castle') this.castle = this.castleBase = published;
        else { this.bases.set(row.plotId, published); this.homes.set(row.plotId, published); }
      }
      if (row.message.type === 'presence' && (!this.presence || row.message.frame.sequence > this.presence.frame.sequence)) this.presence = row.message;
      this.cursor = row.id;
      this.sequence = Math.max(this.sequence, row.sequence);
    }
  }

  /** Current approved views: the newest crowd, then each published home with its committed attachments. */
  current(): RealmPublicMessage[] {
    const current: RealmPublicMessage[] = [];
    if (this.presence) current.push(this.presence);
    if (this.castle) current.push(this.castle);
    for (const plot of [...this.homes.keys()].sort()) current.push(this.homes.get(plot)!);
    return current;
  }
}
