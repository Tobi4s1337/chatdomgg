import type { RealmPrivateMessage, RealmTransientMessage } from '@chatdom/shared/realm';

/** Transient room messages one kingdom relays per second; more are dropped and counted, never queued. */
export const TRANSIENT_PER_SECOND = 40;

type Send = (message: RealmTransientMessage) => void;
type Owner = (personId: string, message: RealmPrivateMessage) => void;

/**
 * The room's second channel: witnessed speech, its removal and seat changes go to everyone present, owner replies go
 * to one person. None of it is written to history, snapshots or the outbox, and none of it is replayed to a later join:
 * speech that nobody saw live is simply gone, as it should be.
 */
export class TransientRelay {
  private readonly rooms = new Set<{ readonly send: Send; readonly owner: Owner }>();
  private window = 0;
  private sent = 0;
  dropped = 0;

  bind(send: Send, owner: Owner): () => void {
    const binding = { send, owner };
    this.rooms.add(binding);
    return () => { this.rooms.delete(binding); };
  }

  /** Relays to every bound room now. Returns false when nobody is here or the per-second budget is spent. */
  transient(message: RealmTransientMessage, now = Date.now()): boolean {
    const second = Math.floor(now / 1000);
    if (second !== this.window) { this.window = second; this.sent = 0; }
    if (this.rooms.size === 0) return false;
    if (this.sent >= TRANSIENT_PER_SECOND) { this.dropped++; return false; }
    this.sent++;
    for (const room of this.rooms) room.send(message);
    return true;
  }

  /** A private reply for one person in this kingdom (their receipt, their interaction state). */
  owner(personId: string, message: RealmPrivateMessage): boolean {
    if (this.rooms.size === 0) return false;
    for (const room of this.rooms) room.owner(personId, message);
    return true;
  }

  clear() { this.rooms.clear(); }
}
