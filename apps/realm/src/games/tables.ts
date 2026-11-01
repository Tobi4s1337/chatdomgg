import { randomBytes, randomUUID } from 'node:crypto';
import type { GatherFrame, GatherStart, GatherTableView, PersonId, GatherPongInput, GatherSelf } from '@chatdom/shared';
import type { TableSeatHost } from '../interactions/hosts';
import { concedePong, inputPong, interruptPong, pongView, startPong, tickPong, type PongSeat, type PongState } from './pong';

interface Guest { readonly person: PersonId; name: string; generation: number | null }
interface Table { revision: number; readonly seats: [Guest | null, Guest | null]; pong: PongState | null }
/** One kingdom's tables. Only the kingdom's physical interaction authority can grant a game seat. */
export class GatherTables {
  private readonly tables = new Map<string, Table>();
  private readonly receipts = new Map<string, { readonly table: string; readonly revision: number; readonly accepted: boolean }>();
  constructor(ids: readonly string[] = ['west']) {
    for (const id of ids) this.tables.set(id, { revision: 0, seats: [null, null], pong: null });
  }
  readonly host: TableSeatHost = {
    admit: async ({ table: id, seat: rawSeat, personId, signal }) => {
      const table = this.tables.get(id), seat = rawSeat === '1' ? 0 : rawSeat === '2' ? 1 : null;
      if (!table || seat === null) return { admitted: false, reason: 'unavailable' };
      const alreadyClaimed = [...this.tables.values()].some(t => t.seats.some(guest => guest?.person === personId));
      if (signal.aborted || table.seats[seat] || alreadyClaimed) return { admitted: false, reason: 'refused' };
      const guest: Guest = { person: personId, name: 'Citizen', generation: null };
      table.seats[seat] = guest; table.revision++;
      // Cancellation is fenced to this admission, never another person's later chair.
      const cancel = () => { if (table.seats[seat] === guest && guest.generation === null) this.release(id, seat); };
      return { admitted: true, cancel, seated: ({ generation }) => { if (table.seats[seat] === guest) guest.generation = generation; } };
    },
    released: ({ place, personId, generation }, why) => {
      const table = this.tables.get(place.table), seat = place.seat === '1' ? 0 : place.seat === '2' ? 1 : null;
      if (table && seat !== null && table.seats[seat]?.person === personId && table.seats[seat]?.generation === generation) {
        if (why === 'closed' && table.pong) interruptPong(table.pong);
        this.release(place.table, seat);
      }
    },
  };
  private release(id: string, seat: PongSeat): void {
    const table = this.tables.get(id)!;
    if (table.pong) concedePong(table.pong, seat);
    table.seats[seat] = null; table.revision++;
  }
  /** Approved entry presentation only; never a name from a game message. */
  name(person: PersonId, name: string): void {
    for (const table of this.tables.values()) for (const guest of table.seats) if (guest?.person === person) guest.name = name;
  }
  self(person: PersonId): GatherSelf {
    for (const [id, table] of this.tables) for (const seat of [0, 1] as const) {
      if (table.seats[seat]?.person === person && table.seats[seat]?.generation !== null) return { table: id, seat };
    }
    return { table: null, seat: null };
  }
  start(person: PersonId, request: GatherStart, now: number): boolean {
    const self = this.self(person), table = this.tables.get(request.table);
    if (self.table !== request.table || self.seat === null || !table) return false;
    const key = `${person}:${request.id}`, receipt = this.receipts.get(key);
    if (receipt) return receipt.table === request.table && receipt.revision === request.revision && receipt.accepted;
    const accepted = table.revision === request.revision && table.seats.every(guest => guest !== null && guest.generation !== null)
      && (!table.pong || table.pong.phase === 'finished' || table.pong.phase === 'interrupted');
    if (accepted) {
      table.pong = startPong(randomUUID(), randomBytes(4).readUInt32LE(), now); table.revision++;
    }
    this.receipts.set(key, { table: request.table, revision: request.revision, accepted });
    // A bounded transport retry window. Revision fencing still rejects an evicted request forever.
    if (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
    return accepted;
  }
  input(person: PersonId, input: GatherPongInput): boolean {
    const self = this.self(person), table = self.table === null ? undefined : this.tables.get(self.table);
    return self.seat !== null && table?.pong?.match === input.match ? inputPong(table.pong, self.seat, input.sequence, input.paddle) : false;
  }
  tick(): void { for (const table of this.tables.values()) if (table.pong) tickPong(table.pong); }
  view(now: number): GatherFrame {
    return { at: now, tables: [...this.tables].map(([id, table]): GatherTableView => ({ table: id, revision: table.revision,
      seats: [table.seats[0]?.name ?? null, table.seats[1]?.name ?? null], pong: table.pong ? pongView(table.pong) : null })) };
  }
}
