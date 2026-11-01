import { describe, expect, it } from 'vitest';
import { GATHER_RECONNECT_MS, PersonIdSchema } from '@chatdom/shared';
import { GatherTables, TAVERN_TABLES } from './tables';
import { MemoryGatherStore, type GatherStore } from './store';
import { actDice, type DiceState } from './dice';

const a = PersonIdSchema.parse('1'), b = PersonIdSchema.parse('2'), c = PersonIdSchema.parse('3');
async function sit(t: GatherTables, personId: typeof a, table: string, seat: string) {
  const claim = await t.host.admit({ table, seat, personId, signal: new AbortController().signal });
  if (!claim.admitted) throw Error('seat refused');
  claim.seated?.({ targetId: `tavern:${table}:seat:${seat}`, generation: Number(seat) });
}
function release(t: GatherTables, personId: typeof a, table: string, seat: string, why: 'stand' | 'closed' = 'stand') {
  t.host.released?.({ place: { table, seat }, personId, generation: Number(seat), sessionId: 's' }, why);
}
function view(t: GatherTables, id: string) { return t.view(100).tables.find(x => x.table === id)!; }
async function start(t: GatherTables, id: string, person = a) {
  expect(await t.start(person, { table: id, revision: view(t, id).revision, id: `start-${id}` }, 100)).toBe(true);
}

describe('turn table authority and checkpoints', () => {
  it('plays Stones through a win and rejects illegal, stale, duplicate and reused requests', async () => {
    const t = new GatherTables(TAVERN_TABLES, { store: new MemoryGatherStore() });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2'); await start(t, 'west');
    const state = () => view(t, 'west').stones!;
    const req = { table: 'west', match: state().match, revision: 0, id: 'drop-0', action: 'drop' as const, column: 0 };
    const before = structuredClone(view(t, 'west'));
    expect(await t.move(c, req, 101)).toBe(false);
    expect(await t.move(b, { ...req, id: 'out-of-turn' }, 101)).toBe(false);
    expect(await t.move(a, { ...req, id: 'bad-column', column: 7 }, 101)).toBe(false);
    expect(await t.move(a, { ...req, id: 'stale', revision: 1 }, 101)).toBe(false);
    expect(view(t, 'west')).toEqual(before);
    expect(await t.move(a, req, 101)).toBe(true);
    const after = structuredClone(view(t, 'west'));
    expect(await t.move(a, req, 101)).toBe(true);
    expect(await t.move(a, { ...req, column: 2 }, 101)).toBe(false);
    expect(view(t, 'west')).toEqual(after);
    for (const [i, column] of [1, 0, 1, 0, 1, 0].entries()) {
      expect(await t.move(i % 2 ? a : b, { ...req, id: `drop-${i + 1}`, revision: state().revision, column }, 102 + i)).toBe(true);
    }
    expect(state()).toMatchObject({ phase: 'finished', winner: 0, reason: 'four' });
    expect(state().winning).toHaveLength(4);
  });

  it('maps sparse dice chairs to logical players, snapshots names, and copies public state', async () => {
    const t = new GatherTables(TAVERN_TABLES, { store: new MemoryGatherStore() });
    await sit(t, a, 'hearth', '1'); await sit(t, b, 'hearth', '4');
    t.name(a, 'Alice'); t.name(b, 'Bob'); await start(t, 'hearth');
    expect(t.self(b)).toMatchObject({ seatIndex: 3, playerIndex: 1 });
    const game = view(t, 'hearth').dice!;
    expect(game).not.toHaveProperty('seed'); expect(game).not.toHaveProperty('cursor');
    (game.scores as unknown as number[])[0] = 999; expect(view(t, 'hearth').dice!.scores[0]).toBe(0);
    release(t, b, 'hearth', '4'); await t.flush(); await sit(t, c, 'hearth', '4'); t.name(c, 'Carol');
    expect(view(t, 'hearth').players).toEqual(['Alice', 'Bob']);
    expect(t.self(c).playerIndex).toBeNull();
  });

  it('plays Hearth Dice to fifty using legal rolls and holds', async () => {
    const t = new GatherTables(TAVERN_TABLES, { store: new MemoryGatherStore() });
    await sit(t, a, 'hearth', '1'); await sit(t, b, 'hearth', '4'); await start(t, 'hearth');
    for (let i = 0; i < 5000 && view(t, 'hearth').dice!.phase === 'playing'; i++) {
      const d = view(t, 'hearth').dice!;
      expect(await t.move(d.turn === 0 ? a : b, { table: 'hearth', match: d.match, revision: d.revision, id: `dice-${i}`, action: d.pot >= 12 ? 'hold' : 'roll' }, 101 + i)).toBe(true);
    }
    const d = view(t, 'hearth').dice!;
    expect(d.phase).toBe('finished'); expect(d.reason).toBe('fifty'); expect(d.scores[d.winner!]).toBeGreaterThanOrEqual(50);
  });

  it('restores Stones state and deadline, and interrupts Pong without a winner', async () => {
    const store = new MemoryGatherStore(), t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'restore' });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2'); await start(t, 'west');
    const s = view(t, 'west').stones!;
    expect(await t.move(a, { table: 'west', match: s.match, revision: s.revision, id: 'drop', action: 'drop', column: 3 }, 200)).toBe(true);
    const expected = structuredClone(view(t, 'west').stones); await t.close();
    const restored = new GatherTables(TAVERN_TABLES, { store, kingdom: 'restore' }); await restored.restore(201);
    expect(view(restored, 'west').stones).toEqual(expected);
    const p = new GatherTables(TAVERN_TABLES, { store, kingdom: 'pong' });
    await sit(p, a, 'middle', '1'); await sit(p, b, 'middle', '2'); await start(p, 'middle'); await p.close();
    const again = new GatherTables(TAVERN_TABLES, { store, kingdom: 'pong' }); await again.restore(101);
    expect(view(again, 'middle').pong).toMatchObject({ phase: 'interrupted', winner: null, reason: 'restart' });
  });

  it('does not publish failed rolls and retries the same random draw', async () => {
    const memory = new MemoryGatherStore(); let fail = false;
    const store: GatherStore = { load: k => memory.load(k), commit: async (...args) => { if (fail) throw Error('injected'); return memory.commit(...args); } };
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'failure' });
    await sit(t, a, 'hearth', '1'); await sit(t, b, 'hearth', '4'); await start(t, 'hearth');
    const initial = structuredClone(view(t, 'hearth').dice!);
    const checkpoint = (await memory.load('failure'))[0]!;
    fail = true;
    expect(await t.move(a, { table: 'hearth', match: initial.match, revision: initial.revision, id: 'failed', action: 'roll' }, 101)).toBe(false);
    expect(view(t, 'hearth').dice).toEqual(initial); expect((await memory.load('failure'))[0]).toEqual(checkpoint);
    fail = false;
    expect(await t.move(a, { table: 'hearth', match: initial.match, revision: initial.revision, id: 'retry', action: 'roll' }, 101)).toBe(true);
    const actual = structuredClone(view(t, 'hearth').dice);
    const otherStore = new MemoryGatherStore();
    await otherStore.commit('control', null, checkpoint, { id: 'seed', actor: null, payload: '{}', at: 100 });
    const control = new GatherTables(TAVERN_TABLES, { store: otherStore, kingdom: 'control' }); await control.restore(100);
    await sit(control, a, 'hearth', '1'); await sit(control, b, 'hearth', '4');
    expect(await control.move(a, { table: 'hearth', match: initial.match, revision: initial.revision, id: 'control', action: 'roll' }, 101)).toBe(true);
    expect(view(control, 'hearth').dice).toEqual(actual);
  });
  it('serializes concurrent moves at the same revision', async () => {
    const t = new GatherTables(TAVERN_TABLES, { store: new MemoryGatherStore() });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2'); await start(t, 'west');
    const s = view(t, 'west').stones!;
    const common = { table: 'west', match: s.match, revision: s.revision, action: 'drop' as const };
    const result = await Promise.all([t.move(a, { ...common, id: 'one', column: 0 }, 101), t.move(a, { ...common, id: 'two', column: 1 }, 101)]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(view(t, 'west').stones!.board.filter(Boolean)).toHaveLength(1);
  });

  it('restores the private Dice draw sequence after a roll', async () => {
    const store = new MemoryGatherStore(), t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'dice-restart' });
    await sit(t, a, 'hearth', '1'); await sit(t, b, 'hearth', '4'); await start(t, 'hearth');
    const d = view(t, 'hearth').dice!;
    expect(await t.move(a, { table: 'hearth', match: d.match, revision: d.revision, id: 'roll-before', action: 'roll' }, 101)).toBe(true);
    const before = structuredClone(view(t, 'hearth').dice); const checkpoint = (await store.load('dice-restart'))[0]!;
    await t.close(); const restored = new GatherTables(TAVERN_TABLES, { store, kingdom: 'dice-restart' }); await restored.restore(102);
    expect(view(restored, 'hearth').dice).toEqual(before);
    expect((await store.load('dice-restart'))[0]).toEqual(checkpoint);
    await sit(restored, a, 'hearth', '1'); await sit(restored, b, 'hearth', '4');
    const actor = before!.turn === 0 ? a : b;
    expect(await restored.move(actor, { table: 'hearth', match: d.match, revision: before!.revision, id: 'roll-after', action: 'roll' }, 103)).toBe(true);
    const privateState = (await store.load('dice-restart'))[0]!.state as { cursor: number };
    expect(privateState.cursor).toBeGreaterThan((checkpoint.state as { cursor: number }).cursor);
  });

  it('concedes when a player stands while their accepted start is saving', async () => {
    const memory = new MemoryGatherStore(); let unblock!: () => void; let entered!: () => void;
    const enteredCommit = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const store: GatherStore = { load: k => memory.load(k), commit: async (...args) => { entered(); await gate; return memory.commit(...args); } };
    const t = new GatherTables(TAVERN_TABLES, { store });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2');
    const pending = t.start(a, { table: 'west', revision: view(t, 'west').revision, id: 'pending-start' }, 100);
    await enteredCommit; release(t, a, 'west', '1'); unblock();
    expect(await pending).toBe(true); await t.flush();
    expect(view(t, 'west').stones).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded' });
  });

  it('concedes after a saving move when its player stands', async () => {
    const memory = new MemoryGatherStore(); let blocked = false, unblock!: () => void, entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const store: GatherStore = { load: k => memory.load(k), commit: async (...args) => { if (blocked) { entered(); await gate; } return memory.commit(...args); } };
    const t = new GatherTables(TAVERN_TABLES, { store });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2'); await start(t, 'west'); blocked = true;
    const s = view(t, 'west').stones!;
    const pending = t.move(a, { table: 'west', match: s.match, revision: s.revision, id: 'pending-move', action: 'drop', column: 0 }, 101);
    await reached; release(t, a, 'west', '1'); unblock();
    expect(await pending).toBe(true); await t.flush();
    expect(view(t, 'west').stones).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded', last: { column: 0 } });
  });

  it('reserves restored chairs for their owners then persists absent-player concessions', async () => {
    const store = new MemoryGatherStore(), first = new GatherTables(TAVERN_TABLES, { store, kingdom: 'grace' });
    await sit(first, a, 'hearth', '1'); await sit(first, b, 'hearth', '4'); await start(first, 'hearth');
    const original = structuredClone(view(first, 'hearth').dice); await first.close();
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'grace' }); await t.restore(200);
    expect(view(t, 'hearth').dice).toEqual(original);
    expect((await t.host.admit({ table: 'hearth', seat: '1', personId: c, signal: new AbortController().signal })).admitted).toBe(false);
    await sit(t, a, 'hearth', '1');
    t.tick(200 + GATHER_RECONNECT_MS - 1); await t.flush();
    expect(view(t, 'hearth').dice!.phase).toBe('playing');
    t.tick(200 + GATHER_RECONNECT_MS); await t.flush();
    expect(view(t, 'hearth').dice).toMatchObject({ phase: 'finished', winner: 0, reason: 'conceded' });
    const snapshot = (await store.load('grace'))[0]!;
    expect(snapshot.state).toMatchObject({ phase: 'finished', winner: 0, reason: 'conceded' });
    await t.close(); const finished = new GatherTables(TAVERN_TABLES, { store, kingdom: 'grace' }); await finished.restore(200 + GATHER_RECONNECT_MS + 1);
    await sit(finished, c, 'hearth', '4');
  });

  it('reconciles a committed roll when the storage acknowledgement is lost', async () => {
    const memory = new MemoryGatherStore(); let loseAck = false;
    const store: GatherStore = { load: k => memory.load(k), commit: async (...args) => {
      const result = await memory.commit(...args); if (loseAck) { loseAck = false; throw Error('lost acknowledgement'); } return result;
    } };
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'ambiguous' });
    await sit(t, a, 'hearth', '1'); await sit(t, b, 'hearth', '4'); await start(t, 'hearth');
    const d = view(t, 'hearth').dice!;
    const expectedState = structuredClone((await memory.load('ambiguous'))[0]!.state) as DiceState;
    expect(actDice(expectedState, 0, d.revision, 'roll', 101)).toBe(true);
    loseAck = true;
    const command = { table: 'hearth', match: d.match, revision: d.revision, id: 'lost-ack', action: 'roll' as const };
    expect(await t.move(a, command, 101)).toBe(true);
    const saved = (await memory.load('ambiguous'))[0]!;
    expect(saved.state).toEqual(expectedState);
    expect(view(t, 'hearth').dice).toMatchObject({ revision: 1 });
    expect(await t.move(a, command, 101)).toBe(true);
    expect((await memory.load('ambiguous'))[0]).toEqual(saved);
    const after = view(t, 'hearth').dice!, actor = after.turn === 0 ? a : b;
    expect(await t.move(actor, { ...command, id: 'next-roll', revision: after.revision }, 102)).toBe(true);
    const next = (await memory.load('ambiguous'))[0]!;
    expect((next.state as { cursor: number }).cursor).toBeGreaterThan((saved.state as { cursor: number }).cursor);
    expect(view(t, 'hearth').status).toBe('ready');
  });

  it('never drops a stand behind a full user-command queue', async () => {
    const memory = new MemoryGatherStore(); let block = false, unblock!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { unblock = r; }), reached = new Promise<void>(r => { entered = r; });
    const store: GatherStore = { load: k => memory.load(k), commit: async (...args) => { if (block) { block = false; entered(); await gate; } return memory.commit(...args); } };
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'capacity' });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2'); await start(t, 'west');
    const d = view(t, 'west').stones!; block = true;
    const move = { table: 'west', match: d.match, revision: d.revision, action: 'drop' as const, column: 0 };
    const pending = t.move(a, { ...move, id: 'held' }, 101); await reached;
    const queued = Array.from({ length: 15 }, (_, i) => t.move(a, { ...move, id: `queued-${i}` }, 101));
    release(t, a, 'west', '1'); unblock(); await pending; await Promise.all(queued); await t.flush();
    expect(view(t, 'west').stones).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded' });
    expect((await memory.load('capacity'))[0]!.state).toMatchObject({ phase: 'finished', winner: 1 });
  });

  it('retries a failed stand save without publishing an uncommitted concession', async () => {
    const memory = new MemoryGatherStore(); let fail = false;
    const store: GatherStore = { load: k => memory.load(k), commit: async (...args) => { if (fail) { fail = false; throw Error('offline'); } return memory.commit(...args); } };
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'stand-retry' });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2'); await start(t, 'west');
    fail = true; release(t, a, 'west', '1'); await t.flush();
    expect(view(t, 'west').stones!.phase).toBe('playing');
    expect((await memory.load('stand-retry'))[0]!.state).toMatchObject({ phase: 'playing' });
    t.tick(Date.now() + 300); await t.flush();
    expect(view(t, 'west').stones).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded' });
    expect((await memory.load('stand-retry'))[0]!.state).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded' });
  });

  it('persists a Pong points finish and restores its winner and score', async () => {
    const store = new MemoryGatherStore(), t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'pong-finish' });
    await sit(t, a, 'middle', '1'); await sit(t, b, 'middle', '2'); await start(t, 'middle');
    const match = view(t, 'middle').pong!.match;
    expect(t.input(a, { match, sequence: 0, paddle: -1 })).toBe(true);
    expect(t.input(b, { match, sequence: 0, paddle: -1 })).toBe(true);
    for (let i = 0; i < 30000 && view(t, 'middle').pong!.phase !== 'finished'; i++) t.tick(100 + i * 34);
    await t.flush(); const final = structuredClone(view(t, 'middle').pong!);
    expect(final).toMatchObject({ phase: 'finished', reason: 'points' }); expect(final.winner).not.toBeNull();
    await t.close(); const restored = new GatherTables(TAVERN_TABLES, { store, kingdom: 'pong-finish' }); await restored.restore(200000);
    expect(view(restored, 'middle').pong).toMatchObject({ phase: 'finished', reason: 'points', winner: final.winner, score: final.score });
  });

  it('adopts a competing newer checkpoint but rejects the displaced move', async () => {
    const memory = new MemoryGatherStore(); let conflict = false;
    const store: GatherStore = { load: k => memory.load(k), commit: async (k, version, next, command) => {
      if (conflict) {
        conflict = false;
        const state = structuredClone(next.state) as { scores: number[] };
        state.scores[0] = 5;
        await memory.commit(k, version, { ...next, state }, { ...command, id: 'other-server', actor: null });
        return 'conflict';
      }
      return memory.commit(k, version, next, command);
    } };
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'competing' });
    await sit(t, a, 'hearth', '1'); await sit(t, b, 'hearth', '4'); await start(t, 'hearth');
    const d = view(t, 'hearth').dice!; conflict = true;
    expect(await t.move(a, { table: 'hearth', match: d.match, revision: d.revision, id: 'displaced', action: 'roll' }, 101)).toBe(false);
    expect(view(t, 'hearth').dice!.scores[0]).toBe(5);
    expect(view(t, 'hearth').dice!.revision).toBe(1);
  });

  it('retries a failed Pong terminal save before publishing the finish', async () => {
    const memory = new MemoryGatherStore(); let failed = false;
    const store: GatherStore = { load: k => memory.load(k), commit: async (...args) => {
      if (!failed && (args[2].state as { phase: string }).phase === 'finished') { failed = true; throw Error('offline'); }
      return memory.commit(...args);
    } };
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'pong-terminal' });
    await sit(t, a, 'middle', '1'); await sit(t, b, 'middle', '2'); await start(t, 'middle');
    const match = view(t, 'middle').pong!.match;
    expect(t.input(a, { match, sequence: 0, paddle: -1 })).toBe(true);
    expect(t.input(b, { match, sequence: 0, paddle: -1 })).toBe(true);
    for (let i = 0; i < 30000 && !failed; i++) { t.tick(100 + i * 34); if (i % 100 === 0) await t.flush(); }
    await t.flush(); expect(failed).toBe(true);
    expect(view(t, 'middle').pong!.phase).not.toBe('finished');
    expect((await memory.load('pong-terminal'))[0]!.state).not.toMatchObject({ phase: 'finished' });
    t.tick(Date.now() + 300); await t.flush();
    expect(view(t, 'middle').pong).toMatchObject({ phase: 'finished', reason: 'points' });
    expect((await memory.load('pong-terminal'))[0]!.state).toMatchObject({ phase: 'finished', reason: 'points' });
  });

  it.each(['west', 'hearth'] as const)('persists a draw when every restored %s player is absent', async id => {
    const store = new MemoryGatherStore(), kingdom = `abandon-${id}`;
    const first = new GatherTables(TAVERN_TABLES, { store, kingdom });
    await sit(first, a, id, '1'); await sit(first, b, id, id === 'hearth' ? '4' : '2'); await start(first, id);
    await first.close();
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom }); await t.restore(200);
    t.tick(200 + GATHER_RECONNECT_MS); await t.flush();
    const game = id === 'west' ? view(t, id).stones! : view(t, id).dice!;
    expect(game).toMatchObject({ phase: 'finished', winner: null, reason: 'draw' });
    expect((await store.load(kingdom))[0]!.state).toMatchObject({ phase: 'finished', winner: null, reason: 'draw' });
  });

  it('retains a stand across a committed start with lost acknowledgement and unavailable reads', async () => {
    const memory = new MemoryGatherStore(); let failReads = false, loseAck = false;
    let entered!: () => void, unblock!: () => void;
    const reached = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { unblock = r; });
    const store: GatherStore = {
      load: async k => { if (failReads) throw Error('read unavailable'); return memory.load(k); },
      commit: async (...args) => {
        const result = await memory.commit(...args);
        if (loseAck) { loseAck = false; entered(); await gate; throw Error('ack unavailable'); }
        return result;
      },
    };
    const t = new GatherTables(TAVERN_TABLES, { store, kingdom: 'uncertain-start' });
    await sit(t, a, 'west', '1'); await sit(t, b, 'west', '2');
    loseAck = true; failReads = true;
    const pending = t.start(a, { table: 'west', revision: view(t, 'west').revision, id: 'uncertain' }, 100);
    await reached; release(t, a, 'west', '1'); unblock();
    expect(await pending).toBe(false); await t.flush();
    expect(view(t, 'west').stones).toBeNull();
    expect((await memory.load('uncertain-start'))[0]!.state).toMatchObject({ phase: 'playing' });
    failReads = false; t.tick(Date.now() + 1000); await t.flush();
    expect(view(t, 'west').stones).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded' });
    expect((await memory.load('uncertain-start'))[0]!.state).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded' });
  });

});
