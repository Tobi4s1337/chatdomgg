import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DiceViewSchema, StonesViewSchema, PongViewSchema, PersonIdSchema, DisplayNameSchema, TokenSchema, EpochMsSchema, GATHER_RECONNECT_MS, type GatherFrame, type GatherStart, type GatherTableView, type PersonId, type GatherPongInput, type GatherSelf, type GatherMove, type GatherGame } from '@chatdom/shared';
import type { TableSeatHost } from '../interactions/hosts';
import { concedePong, inputPong, interruptPong, pongView, startPong, tickPong, type PongState } from './pong';
import { actStones, concedeStones, startStones, stonesView, tickStones, type StonesState } from './stones';
import { actDice, concedeDice, startDice, diceView, tickDice, HEARTH_DICE, type DiceState } from './dice';
import type { GatherStore, GatherSnapshot, GatherParticipant, GatherCommandRecord } from './store';

export const TAVERN_TABLES = [
  { id: 'west', game: 'stones', chairs: 2 }, { id: 'hearth', game: 'hearth-dice', chairs: 4 },
  { id: 'middle', game: 'pong', chairs: 2 }, { id: 'east', game: 'stones', chairs: 2 }, { id: 'corner', game: 'stones', chairs: 2 },
] as const;
interface Guest { readonly person: PersonId; name: string; generation: number | null }
type GameState = PongState | StonesState | DiceState;
interface Reservation { readonly person: string; readonly name: string; readonly until: number }
interface Departure { readonly person: string; readonly seat: number; readonly match: string; readonly generation: number | null; readonly at: number }
interface Table {
  revision: number; readonly game: GatherGame; readonly seats: (Guest | null)[];
  readonly reservations: (Reservation | null)[]; readonly departures: Map<string, Departure>;
  pong: PongState | null; stones: StonesState | null; dice: DiceState | null;
  players: GatherParticipant[]; version: number | null; status: 'ready' | 'saving' | 'unavailable';
  tail: Promise<unknown>; queued: number; ticking: boolean;
  starting: { readonly match: string; readonly players: readonly GatherParticipant[] } | null;
  terminal: { readonly state: PongState; readonly at: number; readonly version: number | null } | null;
  uncertain: GatherSnapshot | null;
  lifecycleQueued: boolean; retryAt: number;
}
interface Options { readonly kingdom?: string; readonly store?: GatherStore | undefined }
const seatNumber = (raw: string) => /^[1-4]$/.test(raw) ? Number(raw) - 1 : -1;
const copy = <T>(value: T): T => structuredClone(value);
const currentGame = (table: Table) => table.pong ?? table.stones ?? table.dice;
const playing = (table: Table) => { const phase = currentGame(table)?.phase; return phase === 'playing' || phase === 'serve' || phase === 'rally'; };
const RETRY_MS = 250;
const snapshotSchema = z.strictObject({
  table: TokenSchema, version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), kind: z.enum(['pong', 'stones', 'hearth-dice']), match: TokenSchema,
  players: z.array(z.strictObject({ person: PersonIdSchema, name: DisplayNameSchema, seat: z.number().int().min(0).max(3) })).min(2).max(4),
  state: z.unknown(), at: EpochMsSchema,
});

/** Both restart and uncertain-write recovery cross the same strict private-state boundary. */
function checkpoint(rawSnapshot: GatherSnapshot, table: Table): GatherSnapshot & { state: GameState } {
  const snapshot = snapshotSchema.parse(rawSnapshot), players = snapshot.players;
  if (table.game !== snapshot.kind || players.length > table.seats.length
    || new Set(players.map(p => p.person)).size !== players.length || new Set(players.map(p => p.seat)).size !== players.length
    || players.some(p => p.seat >= table.seats.length)
    || snapshot.kind !== 'hearth-dice' && (players.length !== 2 || players[0]!.seat !== 0 || players[1]!.seat !== 1)) throw new Error('The saved table does not match this room.');
  const raw = z.record(z.string(), z.unknown()).parse(snapshot.state);
  let state: GameState;
  if (snapshot.kind === 'stones') state = copy(StonesViewSchema.parse(raw)) as StonesState;
  else if (snapshot.kind === 'hearth-dice') {
    const { seed, cursor, ...view } = raw;
    state = { ...copy(DiceViewSchema.parse(view)), ...z.strictObject({ seed: z.number().int().min(0).max(0xffff_ffff), cursor: z.number().int().min(0).max(0xffff_ffff) }).parse({ seed, cursor }) } as DiceState;
    if (state.scores.length !== players.length || state.active.length !== players.length || state.turn >= players.length
      || state.winner !== null && state.winner >= players.length) throw new Error('The saved players have changed.');
  } else {
    const { seed, cursor, targets, serveTo, ...view } = raw;
    state = { ...copy(PongViewSchema.parse({ ...view, at: Math.round(Number(view.at)), serveAt: Math.round(Number(view.serveAt)) })),
      at: z.number().finite().nonnegative().parse(view.at), serveAt: z.number().finite().nonnegative().parse(view.serveAt),
      ...z.strictObject({ seed: z.number().int().min(0).max(0xffff_ffff), cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), targets: z.tuple([z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1)]), serveTo: z.union([z.literal(0), z.literal(1)]) }).parse({ seed, cursor, targets, serveTo }) } as PongState;
  }
  if (state.match !== snapshot.match) throw new Error('The saved match has changed.');
  return { ...snapshot, state };
}

/** Physical leases authorize every action; private snapshots are published only after a successful commit. */
export class GatherTables {
  private readonly tables = new Map<string, Table>();
  private readonly receipts = new Map<string, { payload: string; accepted: boolean }>();
  private readonly pending = new Map<string, { payload: string; result: Promise<boolean> }>();
  private readonly kingdom: string;
  private closed = false;
  constructor(ids: readonly (string | { readonly id: string; readonly game: GatherGame; readonly chairs: number })[] = ['west'], private readonly options: Options = {}) {
    this.kingdom = options.kingdom ?? 'test';
    for (const entry of ids) {
      const { id, game, chairs } = typeof entry === 'string' ? { id: entry, game: 'pong' as const, chairs: 2 } : entry;
      this.tables.set(id, { revision: 0, game, seats: Array<Guest | null>(chairs).fill(null), pong: null, stones: null, dice: null,
        reservations: Array<Reservation | null>(chairs).fill(null), departures: new Map(), starting: null, terminal: null, uncertain: null, lifecycleQueued: false, retryAt: 0,
        players: [], version: null, status: 'ready', tail: Promise.resolve(), queued: 0, ticking: false });
    }
  }
  async restore(now: number): Promise<void> {
    for (const snapshot of await this.options.store?.load(this.kingdom) ?? []) {
      const table = this.tables.get(snapshot.table);
      if (!table) throw new Error('The saved table does not match this room.');
      this.adoptCheckpoint(table, checkpoint(snapshot, table), now);
      if (table.pong && playing(table)) {
        const next = copy(table.pong); interruptPong(next);
        if (!await this.persist(snapshot.table, table, next, table.players, { id: `restart:${snapshot.match}`, actor: null, payload: JSON.stringify({ action: 'restart', match: snapshot.match }), at: now })) throw new Error('The interrupted table could not be saved.');
        this.adopt(table, next);
      }
    }
    this.tick(now); await this.flush();
  }
  readonly host: TableSeatHost = {
    admit: async ({ table: id, seat: raw, personId, signal }) => {
      const table = this.tables.get(id), seat = seatNumber(raw);
      if (this.closed || !table || seat < 0 || seat >= table.seats.length) return { admitted: false, reason: 'unavailable' };
      const held = table.reservations[seat];
      if (signal.aborted || table.seats[seat] || held && held.person !== personId
        || [...this.tables.values()].some(t => t.seats.some(guest => guest?.person === personId)
          || t.reservations.some((reservation, index) => reservation?.person === personId && (t !== table || index !== seat)))
        || [...table.departures.values()].some(departure => departure.person === personId)) return { admitted: false, reason: 'refused' };
      const guest: Guest = { person: personId, name: held?.name ?? 'Citizen', generation: null }; table.seats[seat] = guest; table.revision++;
      return { admitted: true,
        cancel: () => { if (table.seats[seat] === guest && guest.generation === null) { table.seats[seat] = null; table.revision++; } },
        seated: ({ generation }) => { if (table.seats[seat] === guest) { guest.generation = generation; table.reservations[seat] = null; } },
      };
    },
    released: ({ place, personId, generation }, why) => {
      const table = this.tables.get(place.table), seat = seatNumber(place.seat);
      if (!table || seat < 0 || table.seats[seat]?.person !== personId || table.seats[seat]?.generation !== generation) return;
      table.seats[seat] = null; table.revision++;
      if (this.closed || why === 'closed') { if (table.pong) interruptPong(table.pong); return; }
      const start = table.starting, match = start?.match ?? table.uncertain?.match ?? currentGame(table)?.match;
      const players = start?.players ?? table.uncertain?.players ?? table.players;
      if (match && players.some(player => player.person === personId && player.seat === seat)) {
        this.depart(table, { person: personId, seat, generation, match, at: Date.now() });
        this.lifecycle(place.table, table, Date.now());
      }
    },
  };
  name(person: PersonId, name: string): void { for (const table of this.tables.values()) for (const guest of table.seats) if (guest?.person === person) guest.name = name; }
  self(person: PersonId): GatherSelf {
    for (const [id, table] of this.tables) for (let seat = 0; seat < table.seats.length; seat++) if (table.seats[seat]?.person === person && table.seats[seat]?.generation !== null) {
      const player = table.players.findIndex(p => p.person === person && p.seat === seat);
      return { table: id, seat: seat < 2 ? seat as 0 | 1 : null, seatIndex: seat as 0 | 1 | 2 | 3, playerIndex: player < 0 ? null : player };
    }
    return { table: null, seat: null, seatIndex: null, playerIndex: null };
  }
  async start(person: PersonId, request: GatherStart, now: number): Promise<boolean> {
    return this.request(person, request.id, request, request.table, async table => {
      const own = this.self(person);
      if (table.departures.size || table.terminal || table.uncertain || own.table !== request.table || own.seatIndex === null || table.revision !== request.revision || playing(table)) return false;
      const participants = table.seats.flatMap((guest, seat): GatherParticipant[] => guest?.generation !== null && guest ? [{ person: guest.person, name: guest.name, seat }] : []);
      if (participants.length < 2 || table.game !== 'hearth-dice' && (participants.length !== 2 || participants[0]!.seat !== 0 || participants[1]!.seat !== 1)) return false;
      const match = randomUUID(), seed = randomBytes(4).readUInt32LE();
      const state = table.game === 'pong' ? startPong(match, seed, now) : table.game === 'stones' ? startStones(match, seed, now) : startDice(match, seed, now, participants.length);
      table.starting = { match, players: participants };
      try {
        if (!await this.persist(request.table, table, state, participants, { id: request.id, actor: person, payload: JSON.stringify(request), at: now })) return false;
        table.players = participants; this.adopt(table, state); return true;
      } finally { table.starting = null; }
    });
  }
  async move(person: PersonId, request: GatherMove, now: number): Promise<boolean> {
    return this.request(person, request.id, request, request.table, async table => {
      const own = this.self(person), current = currentGame(table);
      if (table.departures.size || table.terminal || table.uncertain || own.table !== request.table || own.playerIndex === null || own.playerIndex === undefined || !current || current.match !== request.match || table.pong) return false;
      const state = copy(current), changed = table.stones && request.action === 'drop'
        ? actStones(state as StonesState, own.playerIndex as 0 | 1, request.revision, request.column, now)
        : table.dice && request.action !== 'drop' ? actDice(state as DiceState, own.playerIndex, request.revision, request.action, now) : false;
      if (!changed) return false;
      if (!await this.persist(request.table, table, state, table.players, { id: request.id, actor: person, payload: JSON.stringify(request), at: now })) return false;
      this.adopt(table, state); return true;
    });
  }
  input(person: PersonId, input: GatherPongInput): boolean {
    const own = this.self(person), table = own.table === null ? undefined : this.tables.get(own.table);
    return !this.closed && table && !table.departures.size && !table.terminal && !table.uncertain && table.status !== 'saving' && own.playerIndex !== null && own.playerIndex !== undefined && own.playerIndex < 2 && table.pong?.match === input.match ? inputPong(table.pong, own.playerIndex as 0 | 1, input.sequence, input.paddle) : false;
  }
  tick(now = Date.now()): void {
    if (this.closed) return;
    for (const [id, table] of this.tables) {
      for (let seat = 0; seat < table.reservations.length; seat++) {
        const reservation = table.reservations[seat];
        if (reservation && reservation.until <= now && !table.seats[seat] && currentGame(table)) {
          this.depart(table, { person: reservation.person, seat, generation: null, match: currentGame(table)!.match, at: now });
        }
      }
      if (table.departures.size || table.terminal || table.uncertain) { this.lifecycle(id, table, now); continue; }
      if (table.pong) {
        if (table.queued || !playing(table)) continue;
        const next = copy(table.pong); tickPong(next);
        if (next.phase === 'finished' && this.options.store) {
          table.terminal = { state: next, version: table.version, at: now };
          this.lifecycle(id, table, now);
        } else table.pong = next;
        continue;
      }
      const game = table.stones ?? table.dice;
      if (!game || game.phase !== 'playing' || game.deadline > now || table.ticking || table.queued) continue;
      table.ticking = true;
      void this.enqueue(table, async () => {
        if (table.departures.size || table.terminal || table.uncertain || !playing(table)) return false;
        const state = copy(currentGame(table)!);
        const changed = table.stones ? tickStones(state as StonesState, now) : tickDice(state as DiceState, now);
        if (!changed) return false;
        const deadline = game.deadline;
        if (!await this.persist(id, table, state, table.players, { id: `timeout:${state.match}:${game.revision}`, actor: null, payload: JSON.stringify({ action: 'timeout', match: state.match, revision: game.revision, deadline }), at: now })) return false;
        this.adopt(table, state); return true;
      }).finally(() => { table.ticking = false; });
    }
  }
  view(now: number): GatherFrame {
    return { at: now, tables: [...this.tables].map(([id, table]): GatherTableView => ({ table: id, revision: table.revision, game: table.game, status: table.status,
      seats: [table.seats[0]?.name ?? table.reservations[0]?.name ?? null, table.seats[1]?.name ?? table.reservations[1]?.name ?? null], ...(table.seats.length > 2 ? { extraSeats: [table.seats[2]?.name ?? table.reservations[2]?.name ?? null, table.seats[3]?.name ?? table.reservations[3]?.name ?? null] as const } : {}),
      players: table.players.map(p => p.name), pong: table.pong ? pongView(table.pong) : null,
      stones: table.stones ? stonesView(table.stones) : null, dice: table.dice ? diceView(table.dice) : null })) };
  }
  async flush(): Promise<void> { await Promise.all([...this.tables.values()].map(table => table.tail)); }
  async close(): Promise<void> { this.closed = true; await this.flush(); }
  private adopt(table: Table, state: GameState) {
    if (table.game === 'pong') table.pong = state as PongState;
    else if (table.game === 'stones') table.stones = state as StonesState;
    else table.dice = state as DiceState;
    // A finished game and an already conceded Dice player never reserve physical chairs.
    for (let seat = 0; seat < table.reservations.length; seat++) {
      const player = table.players.findIndex(p => p.seat === seat && p.person === table.reservations[seat]?.person);
      if (!playing(table) || player < 0 || table.dice && !table.dice.active[player]) table.reservations[seat] = null;
    }
    table.revision++;
  }
  private adoptCheckpoint(table: Table, snapshot: GatherSnapshot & { state: GameState }, now: number): void {
    table.players = copy([...snapshot.players]); table.version = snapshot.version;
    this.adopt(table, copy(snapshot.state)); table.revision = Math.max(table.revision, snapshot.version);
    if (playing(table) && !table.pong) {
      for (const [player, participant] of table.players.entries()) {
        if (table.dice && !table.dice.active[player] || table.seats[participant.seat]?.person === participant.person
          || [...table.departures.values()].some(departure => departure.match === snapshot.match && departure.person === participant.person)) continue;
        const previous = table.reservations[participant.seat];
        table.reservations[participant.seat] = { person: participant.person, name: participant.name,
          until: previous?.person === participant.person ? previous.until : now + GATHER_RECONNECT_MS };
      }
    }
    table.status = 'ready';
  }
  private depart(table: Table, departure: Departure): void {
    // Only authenticated leases or persisted participants reach here. One obligation per player,
    // independent of the command flood limit, remains until it is durably resolved.
    const key = `${departure.match}:${departure.seat}:${departure.person}`;
    if (!table.departures.has(key)) table.departures.set(key, departure);
  }
  private lifecycle(id: string, table: Table, now: number): void {
    if (table.lifecycleQueued || now < table.retryAt || this.closed) return;
    table.lifecycleQueued = true; table.status = 'saving';
    void this.enqueue(table, async () => {
      if (table.uncertain) {
        try {
          const saved = (await this.options.store!.load(this.kingdom)).filter(candidate => candidate.table === id);
          if (saved.length > 1 || saved.length === 0 && table.version !== null) throw new Error('The saved table is unavailable.');
          if (saved.length) {
            const durable = checkpoint(saved[0]!, table);
            if (durable.version < (table.version ?? 0)) throw new Error('The saved table is unavailable.');
            if (durable.version > (table.version ?? 0)) this.adoptCheckpoint(table, durable, now);
          }
          table.uncertain = null;
        } catch { table.status = 'unavailable'; table.retryAt = now + RETRY_MS; return false; }
      }
      const terminal = table.terminal;
      if (terminal) {
        if (terminal.version !== table.version || terminal.state.match !== currentGame(table)?.match) table.terminal = null;
        else {
          const state = terminal.state;
          const saved = await this.persist(id, table, state, table.players, { id: `finish:${state.match}`, actor: null,
            payload: JSON.stringify({ action: 'finish', match: state.match, tick: state.tick }), at: terminal.at });
          if (saved) { this.adopt(table, state); table.terminal = null; }
          else {
            if (terminal.version !== table.version) table.terminal = null;
            table.retryAt = now + RETRY_MS; return false;
          }
        }
      }
      // All reconnect holds expire in the same room tick. Resolve that group atomically:
      // nobody wins merely because their empty chair happened to be visited last.
      const game = currentGame(table);
      const abandoned = table.players.filter((_, player) => !table.dice || table.dice.active[player]);
      if (game && !table.pong && playing(table) && abandoned.length && abandoned.every(player =>
        [...table.departures.values()].some(departure => departure.match === game.match && departure.person === player.person && departure.seat === player.seat))) {
        const state = copy(game) as StonesState | DiceState;
        state.phase = 'finished'; state.winner = null; state.reason = 'draw'; state.revision++;
        if ('active' in state) { state.active.fill(false); state.pot = 0; state.last = 'conceded'; }
        const saved = await this.persist(id, table, state, table.players, { id: `abandon:${state.match}`, actor: null,
          payload: JSON.stringify({ action: 'abandon', match: state.match }), at: now });
        if (!saved) { table.retryAt = now + RETRY_MS; return false; }
        this.adopt(table, state);
      }
      for (const [key, departure] of [...table.departures]) {
        const player = table.players.findIndex(p => p.person === departure.person && p.seat === departure.seat);
        if (player < 0 || !playing(table) || currentGame(table)?.match !== departure.match || table.dice && !table.dice.active[player]) {
          table.departures.delete(key); continue;
        }
        const state = copy(currentGame(table)!);
        if (table.pong) concedePong(state as PongState, player as 0 | 1);
        else if (table.stones) concedeStones(state as StonesState, player as 0 | 1);
        else if (!concedeDice(state as DiceState, player, Math.max(departure.at, (state as DiceState).deadline - HEARTH_DICE.turnMs))) {
          table.status = 'unavailable'; table.retryAt = now + RETRY_MS; return false;
        }
        const saved = await this.persist(id, table, state, table.players, { id: `leave:${state.match}:${departure.seat}:${departure.generation ?? 'restart'}`, actor: departure.person,
          payload: JSON.stringify({ action: 'leave', match: state.match, seat: departure.seat, generation: departure.generation }), at: departure.at });
        if (!saved) { table.retryAt = now + RETRY_MS; return false; }
        this.adopt(table, state); table.departures.delete(key);
      }
      table.retryAt = 0; table.status = 'ready'; return true;
    }, true).finally(() => { table.lifecycleQueued = false; });
  }
  private enqueue(table: Table, operation: () => Promise<boolean>, lifecycle = false): Promise<boolean> {
    if (this.closed || !lifecycle && table.queued >= 16) return Promise.resolve(false);
    table.queued++;
    const result = table.tail.then(operation).catch(() => { table.status = 'unavailable'; return false; });
    table.tail = result.finally(() => { table.queued--; }); return result;
  }
  private request(person: PersonId, id: string, request: unknown, tableId: string, operation: (table: Table) => Promise<boolean>): Promise<boolean> {
    const key = `${person}:${id}`, payload = JSON.stringify(request), receipt = this.receipts.get(key), pending = this.pending.get(key), table = this.tables.get(tableId);
    if (receipt) return Promise.resolve(receipt.payload === payload && receipt.accepted);
    if (pending) return pending.payload === payload ? pending.result : Promise.resolve(false);
    if (!table || this.closed || this.pending.size >= 128) return Promise.resolve(false);
    const result = this.enqueue(table, () => operation(table)).then(accepted => {
      this.receipts.set(key, { payload, accepted }); this.pending.delete(key);
      if (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!); return accepted;
    });
    this.pending.set(key, { payload, result }); return result;
  }
  private async persist(id: string, table: Table, state: GameState, players: readonly GatherParticipant[], command: GatherCommandRecord): Promise<boolean> {
    if (!this.options.store) { if (table.game === 'pong') { table.status = 'ready'; return true; } table.status = 'unavailable'; return false; }
    table.status = 'saving';
    const snapshot: GatherSnapshot = { table: id, version: (table.version ?? 0) + 1, kind: table.game, match: state.match, players: copy(players), state: copy(state), at: command.at };
    try {
      const result = await this.options.store.commit(this.kingdom, table.version, snapshot, command);
      if (result === 'committed') { table.version = snapshot.version; table.status = 'ready'; return true; }
    } catch { /* The commit may have succeeded before its acknowledgement was lost. Read durable truth. */ }
    try {
      const saved = (await this.options.store.load(this.kingdom)).filter(candidate => candidate.table === id);
      if (saved.length !== 1) {
        if (saved.length || table.version !== null) table.uncertain = snapshot;
        table.status = 'unavailable'; return false;
      }
      const durable = checkpoint(saved[0]!, table);
      // Compare the persisted JSON value (including JSON's normalization of negative zero).
      if (isDeepStrictEqual(durable, JSON.parse(JSON.stringify(snapshot)))) {
        table.version = durable.version; table.status = 'ready'; return true;
      }
      // A concurrent writer's newer checkpoint must win. Never publish this request's stale candidate.
      if (durable.version > (table.version ?? 0)) this.adoptCheckpoint(table, durable, command.at);
      else table.status = 'unavailable';
      return false;
    } catch { table.uncertain = snapshot; table.retryAt = command.at + RETRY_MS; table.status = 'unavailable'; return false; }
  }
}
