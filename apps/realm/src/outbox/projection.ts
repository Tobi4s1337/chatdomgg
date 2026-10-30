import type { RealmPublicMessage } from '@chatdom/shared/realm';
import type { RealmOutboxRow } from '../persistence/postgres-repository';

export type RealmPublicHome = Extract<RealmPublicMessage, { type: 'home' }>;
export type RealmPublicPresence = Extract<RealmPublicMessage, { type: 'presence' }>;

/** The delivered public prefix a projection starts from: what rows at or below `cursor` left standing. */
export interface PublicPrefix {
  readonly homes: Iterable<RealmPublicHome>;
  readonly presence: RealmPublicPresence | null;
  readonly cursor: number;
  readonly sequence: number;
}

/**
 * The public face of a kingdom as of the last outbox row handed to the transport: each published home as that row
 * showed it and the newest presence frame. It advances only when a row is delivered (immediately before listeners see
 * it), so a bootstrap is always the delivered prefix: rows above `cursor` will still arrive, rows at or below it are
 * already in `current`. It never reads private state, so it cannot run ahead of its own outbox.
 */
export class PublicProjection {
  private readonly homes = new Map<string, RealmPublicHome>();
  private presence: RealmPublicPresence | null;
  /** The newest outbox row id folded in (`throughCursor`). */
  cursor: number;
  /** The newest domain sequence folded in (`throughSequence`). */
  sequence: number;

  constructor(prefix: PublicPrefix) {
    for (const home of prefix.homes) this.homes.set(home.plotId, home);
    this.presence = prefix.presence;
    this.cursor = prefix.cursor;
    this.sequence = prefix.sequence;
  }

  /** Folds one delivered row in. Redelivered rows at or below the cursor change nothing. */
  adopt(row: RealmOutboxRow) {
    if (row.id <= this.cursor) return;
    const message = row.message;
    if (message.type === 'home') this.homes.set(message.plotId, message);
    if (message.type === 'presence' && (!this.presence || message.frame.sequence > this.presence.frame.sequence)) this.presence = message;
    this.cursor = row.id;
    this.sequence = Math.max(this.sequence, row.sequence);
  }

  /** Current approved views: the newest crowd, then each published home in plot order. */
  current(): RealmPublicMessage[] {
    const current: RealmPublicMessage[] = [];
    if (this.presence) current.push(this.presence);
    for (const plot of [...this.homes.keys()].sort()) current.push(this.homes.get(plot)!);
    return current;
  }
}
