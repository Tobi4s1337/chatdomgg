import { castleHostId, type RealmPrivateState, type RealmPublicMessage } from '@chatdom/shared/realm';
import type { RealmOutboxRow } from '../persistence/postgres-repository';
import { MOMENT_CURRENT_LIMIT, type TwitchMomentFact } from '@chatdom/shared/twitch-moments';

/** Moment kinds with one current slot each (Herald's `CurrentSlot`): the Hype Train, the dragon battle and the running poll. */
const SLOTTED: ReadonlySet<string> = new Set(['hype', 'battle', 'poll']);

export type RealmPublicHome = Extract<RealmPublicMessage, { type: 'home' }>;
export type RealmPublicCastle = Extract<RealmPublicMessage, { type: 'castle' }>;
export type RealmPublicPresence = Extract<RealmPublicMessage, { type: 'presence' }>;
export type RealmPublicGrowth = Extract<RealmPublicMessage, { type: 'growth' }>;

/** The delivered public prefix a projection starts from: what rows at or below `cursor` left standing. */
export interface PublicPrefix {
  readonly homes: Iterable<RealmPublicHome>;
  readonly presence: RealmPublicPresence | null;
  readonly castle?: RealmPublicCastle | null;
  readonly castleBase?: RealmPublicCastle | null;
  readonly growth?: RealmPublicGrowth | null;
  readonly moments?: { readonly throughSeq: number; readonly facts: readonly TwitchMomentFact[] };
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
  private growth: RealmPublicGrowth | null;
  private momentThrough = 0;
  private readonly moments = new Map<string, TwitchMomentFact>();
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
    this.growth = initial.growth ?? null;
    this.momentThrough = initial.moments?.throughSeq ?? 0;
    for (const fact of initial.moments?.facts ?? []) this.rememberMoment(fact);
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
      if (row.message.type === 'growth' && (!this.growth || row.message.frame.sequence > this.growth.frame.sequence)) this.growth = row.message;
      if (row.message.type === 'moment') {
        this.momentThrough = Math.max(this.momentThrough, row.message.fact.seq);
        if (row.message.current) this.rememberMoment(row.message.fact);
        else this.releaseMoment(row.message.fact);
      }
      this.cursor = row.id;
      this.sequence = Math.max(this.sequence, row.sequence);
    }
  }

  /** Current approved views: the newest crowd, then each published home with its committed attachments. */
  current(): RealmPublicMessage[] {
    const current: RealmPublicMessage[] = this.momentThrough > 0
      ? [{ type: 'moments.current', throughSeq: this.momentThrough, facts: [...this.moments.values()] }] : [];
    if (this.presence) current.push(this.presence);
    if (this.growth) current.push({ type: 'growth', frame: { ...this.growth.frame, beats: [] } });
    if (this.castle) current.push(this.castle);
    for (const plot of [...this.homes.keys()].sort()) current.push(this.homes.get(plot)!);
    return current;
  }

  private rememberMoment(fact: TwitchMomentFact) {
    const key = `${fact.body.kind}:${fact.body.key}`, previous = this.moments.get(key);
    if (previous && previous.seq >= fact.seq) return;
    // The one Hype Train, the one battle and the one poll each hold a single slot: a new occupant replaces the last, as in the records.
    if (SLOTTED.has(fact.body.kind)) {
      for (const [other, held] of this.moments) if (held.body.kind === fact.body.kind && other !== key) this.moments.delete(other);
    }
    if (!previous && this.moments.size >= MOMENT_CURRENT_LIMIT) throw new Error('Moment current state exceeds its budget');
    this.moments.set(key, fact);
  }

  /** A finished slot occupant (a train or battle that ended) leaves current state, as `releaseSlot` does in the records. */
  private releaseMoment(fact: TwitchMomentFact) {
    if (!SLOTTED.has(fact.body.kind)) return;
    const key = `${fact.body.kind}:${fact.body.key}`, previous = this.moments.get(key);
    if (previous && previous.seq < fact.seq) this.moments.delete(key);
  }
}
