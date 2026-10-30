import type { RealmPrivateState, RealmPublicMessage } from '@chatdom/shared/realm';
import type { RealmOutboxRow } from '../persistence/postgres-repository';

/**
 * The public face of a kingdom as of its last committed outbox row: which homes have been published and the newest
 * presence frame. Bootstrap reads this together with the committed private state in one synchronous step, so a fresh
 * join sees every committed public change at or below `throughSequence` and none of the spectacle that produced it.
 */
export class PublicProjection {
  private readonly plots: Set<string>;
  private presence: Extract<RealmPublicMessage, { type: 'presence' }> | null;
  /** The newest outbox row folded in. */
  cursor: number;

  constructor(initial: { readonly plots: Iterable<string>; readonly cursor: number; readonly presence: RealmPublicMessage | null }) {
    this.plots = new Set(initial.plots);
    this.cursor = initial.cursor;
    this.presence = initial.presence?.type === 'presence' ? initial.presence : null;
  }

  adopt(rows: readonly RealmOutboxRow[]) {
    for (const row of rows) {
      if (row.id <= this.cursor) continue;
      if (row.plotId) this.plots.add(row.plotId);
      if (row.message.type === 'presence' && (!this.presence || row.message.frame.sequence > this.presence.frame.sequence)) this.presence = row.message;
      this.cursor = row.id;
    }
  }

  /** Current approved views: the newest crowd, then each published home with its committed attachments. */
  current(state: RealmPrivateState): RealmPublicMessage[] {
    const current: RealmPublicMessage[] = [];
    if (this.presence) current.push(this.presence);
    for (const plot of [...this.plots].sort()) {
      const home = state.homes[plot];
      if (!home) continue;
      current.push({ type: 'home', plotId: home.id, revision: home.revision, assetHash: home.digest,
        attachments: Object.values(home.attachments).flatMap(id => state.attachments[id] ? [state.attachments[id].attachment] : []) });
    }
    return current;
  }
}
