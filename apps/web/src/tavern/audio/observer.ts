import type { GatherFrame, GatherTableView, StonesView } from '@chatdom/shared';

export type TavernCue = 'paddle' | 'rail' | 'stone' | 'dice' | 'bank' | 'start' | 'point' | 'finish' | 'sit' | 'stand' | 'wood';
export interface TavernAttack { cue: TavernCue; table: string | null; x?: number; y?: number; at?: number }
// The room sends unchanged public frames every second. Sound can observe transport independently of
// rendering, so continuity includes that heartbeat plus jitter; impact records retain their shorter age limit.
const FRAME_FRESH_MS = 1500;
const CONTACT_FRESH_MS = 500;

/** Only public facts belong here. No predicted ball, inferred collision, identity or private game state. */
export class TavernObserver {
  private previous: GatherFrame | null = null;
  private seenAt = -Infinity;
  private observedAt = -Infinity;
  private seated: string | null = null;
  private contacts = new Map<string, number>();

  reset(): void {
    this.previous = null; this.seenAt = -Infinity; this.observedAt = -Infinity;
    this.seated = null; this.contacts.clear();
  }

  /** `now` is the host's monotonic clock in milliseconds, independent of the server epoch. */
  step(frame: GatherFrame, now: number, seated: string | null): { attacks: TavernAttack[]; fresh: boolean } {
    const attacks: TavernAttack[] = [], previous = this.previous;
    // Out-of-order delivery is not a new observation. Retain both the accepted watermark and its original
    // freshness deadline; rebasing either here could replay a contact or keep a stalled room audible.
    if (!Number.isFinite(now) || !Number.isFinite(frame.at) || now < this.observedAt || previous && frame.at < previous.at) {
      return { attacks, fresh: Number.isFinite(now) && now >= this.observedAt && now - this.seenAt <= FRAME_FRESH_MS };
    }
    const uninterrupted = previous !== null && now >= this.observedAt && now - this.observedAt <= FRAME_FRESH_MS && now - this.seenAt <= FRAME_FRESH_MS;
    this.observedAt = now;
    const newFrame = !previous || frame.at > previous.at || advances(frame, previous);
    if (newFrame) this.seenAt = now;
    const fresh = Number.isFinite(now) && now - this.seenAt <= FRAME_FRESH_MS;
    if (!fresh) return { attacks, fresh };
    const continuous = uninterrupted && previous !== null && frame.at >= previous.at && frame.at - previous.at <= FRAME_FRESH_MS;
    if (continuous && seated !== this.seated) {
      if (this.seated !== null) attacks.push({ cue: 'stand', table: this.seated });
      if (seated !== null) attacks.push({ cue: 'sit', table: seated });
    }
    this.seated = seated;
    if (!newFrame) return { attacks, fresh };
    const nextContacts = new Map<string, number>();
    for (const table of frame.tables) {
      const old = continuous ? previous?.tables.find(item => item.table === table.table) : undefined;
      this.table(table, old, attacks, nextContacts);
    }
    this.contacts = nextContacts;
    // Defensive copies: an in-place host mutation must not rewrite the observation we compare against.
    this.previous = { at: frame.at, tables: frame.tables.map(table => ({ ...table,
      stones: table.stones ? { ...table.stones, board: [...table.stones.board] } : table.stones,
      dice: table.dice ? { ...table.dice, scores: [...table.dice.scores] } : table.dice,
      pong: table.pong ? { ...table.pong, score: [...table.pong.score] as [number, number] } : null,
    })) };
    return { attacks, fresh };
  }

  private table(table: GatherTableView, old: GatherTableView | undefined, attacks: TavernAttack[], next: Map<string, number>): void {
    const emit = (cue: TavernCue) => attacks.push({ cue, table: table.table });
    const pong = table.pong, previousPong = old?.pong;
    if (pong) {
      const key = `${table.table}:${pong.match}`;
      let sequence = previousPong?.match === pong.match ? this.contacts.get(key) ?? 0 : 0;
      for (const contact of pong.contacts ?? []) {
        if (old && previousPong?.match === pong.match && pong.tick >= previousPong.tick && contact.sequence > sequence
          && contact.tick > previousPong.tick && contact.tick <= pong.tick && contact.at <= pong.at && pong.at - contact.at <= CONTACT_FRESH_MS) {
          attacks.push({ cue: contact.kind, table: table.table, x: contact.x, y: contact.y, at: contact.at });
        }
        sequence = Math.max(sequence, contact.sequence);
      }
      next.set(key, sequence);
      if (old && previousPong?.match !== pong.match && pong.phase !== 'finished' && pong.phase !== 'interrupted') emit('start');
      if (previousPong?.match === pong.match && pong.tick > previousPong.tick) {
        const differences = pong.score.map((score, index) => score - previousPong.score[index]!);
        if (differences.filter(difference => difference === 1).length === 1 && differences.every(difference => difference === 0 || difference === 1)) emit('point');
      }
      // Concession is a public phase transition without a physics step; its tick need not advance.
      if (previousPong?.match === pong.match && previousPong.phase !== 'finished' && pong.phase === 'finished') emit('finish');
    }
    for (const kind of ['stones', 'dice'] as const) {
      const game = table[kind], previousGame = old?.[kind];
      if (!game || !old) continue;
      if (game.match !== previousGame?.match) { if (game.phase === 'playing' && game.revision === 0) emit('start'); continue; }
      if (!previousGame || previousGame.phase !== 'playing' || game.revision !== previousGame.revision + 1) continue;
      if (kind === 'stones' && legalStone(old.stones!, table.stones!)) emit('stone');
      if (kind === 'dice') {
        if ((table.dice!.last === 'roll' || table.dice!.last === 'bust') && table.dice!.die !== null) emit('dice');
        if (table.dice!.last === 'hold') emit('bank');
      }
      if (game.phase === 'finished') emit('finish');
    }
  }
}

/** Publications may share an epoch millisecond. Authoritative counters, rather than object identity, disambiguate them. */
function advances(frame: GatherFrame, previous: GatherFrame): boolean {
  return frame.tables.some(table => {
    const old = previous.tables.find(item => item.table === table.table);
    if (!old || table.revision > old.revision) return true;
    if (table.pong && old.pong && table.pong.match === old.pong.match
      && (table.pong.tick > old.pong.tick || old.pong.phase !== 'finished' && table.pong.phase === 'finished')) return true;
    return (table.stones && old.stones && table.stones.match === old.stones.match && table.stones.revision > old.stones.revision)
      || (table.dice && old.dice && table.dice.match === old.dice.match && table.dice.revision > old.dice.revision) || false;
  });
}

function legalStone(before: StonesView, after: StonesView): boolean {
  const last = after.last;
  if (!last || before.board.length !== 42 || after.board.length !== 42 || last.seat !== before.turn
    || !Number.isInteger(last.column) || last.column < 0 || last.column > 6 || !Number.isInteger(last.row) || last.row < 0 || last.row > 5) return false;
  const cell = last.row * 7 + last.column;
  if (before.board[cell] !== 0 || after.board[cell] !== last.seat + 1) return false;
  if (last.row > 0 && before.board[cell - 7] === 0) return false;
  return before.board.every((value, index) => index === cell || value === after.board[index]);
}
