import type { RealmPrivateState, RealmPublicMessage } from '@chatdom/shared/realm';
import type { RealmOutboxRow } from '../persistence/postgres-repository';

/**
 * The public face of a kingdom as of its last committed outbox row: which homes have been published and the newest
 * presence frame. Each delivered row advances this prefix synchronously. A fresh join sees the homes and attachments at
 * `throughCursor`, even while the private state is ahead, and none of the spectacle that produced them.
 */
export class PublicProjection {
  private readonly bases = new Map<string, Extract<RealmPublicMessage, { type: 'home' }>>();
  private readonly homes = new Map<string, Extract<RealmPublicMessage, { type: 'home' }>>();
  sequence: number;
  private presence: Extract<RealmPublicMessage, { type: 'presence' }> | null;
  /** The newest outbox row folded in. */
  cursor: number;

  constructor(initial: { readonly plots: Iterable<string>; readonly cursor: number; readonly presence: RealmPublicMessage | null; readonly state: RealmPrivateState }) {
    this.sequence = initial.state.sequence;
    this.rememberHomes(initial.state);
    for (const plot of initial.plots) {
      const home = initial.state.homes[plot], base = this.bases.get(plot);
      if (home && base) {
        const restored = { ...base, attachments: Object.values(home.attachments).flatMap(id => initial.state.attachments[id] ? [initial.state.attachments[id].attachment] : []) };
        this.bases.set(plot, restored); this.homes.set(plot, restored);
      }
    }
    this.cursor = initial.cursor;
    this.presence = initial.presence?.type === 'presence' ? initial.presence : null;
  }

  /** Remember an allocated home's base once, before publication. Later private builds never overwrite that prefix. */
  rememberHomes(state: RealmPrivateState) {
    for (const home of Object.values(state.homes)) if (!this.bases.has(home.id)) {
      this.bases.set(home.id, { type: 'home', plotId: home.id, revision: home.revision, assetHash: home.digest, attachments: [] });
    }
  }

  adopt(rows: readonly RealmOutboxRow[]) {
    for (const row of rows) {
      if (row.id <= this.cursor) continue;
      if (row.message.type === 'home') {
        this.bases.set(row.message.plotId, row.message); this.homes.set(row.message.plotId, row.message);
      }
      if (row.message.type === 'forge' && row.message.event.type === 'committed' && row.plotId) {
        const home = this.bases.get(row.plotId);
        if (!home) throw new Error('A published forge attachment has no committed home base');
        const attachment = row.message.event.attachment;
        const published = { ...home, revision: `r${row.sequence}`,
          attachments: [...home.attachments.filter(item => item.socketId !== attachment.socketId), attachment] };
        this.bases.set(row.plotId, published); this.homes.set(row.plotId, published);
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
    for (const plot of [...this.homes.keys()].sort()) current.push(this.homes.get(plot)!);
    return current;
  }
}
