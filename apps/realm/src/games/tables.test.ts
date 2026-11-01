import { describe, expect, it } from 'vitest';
import { PersonIdSchema, type PersonId } from '@chatdom/shared';
import { GatherTables } from './tables';

const alice = PersonIdSchema.parse('1');
const bob = PersonIdSchema.parse('2');
const eve = PersonIdSchema.parse('3');

async function reserve(tables: GatherTables, personId: PersonId, seat: '1' | '2', table = 'west') {
  return tables.host.admit({ table, seat, personId, signal: new AbortController().signal });
}
async function sit(tables: GatherTables, personId: PersonId, seat: '1' | '2', generation: number, table = 'west') {
  const result = await reserve(tables, personId, seat, table);
  if (!result.admitted) throw new Error(`Seat ${table}/${seat} was ${result.reason}`);
  result.seated?.({ targetId: `tavern:${table}:seat:${seat}`, generation });
  return result;
}
function release(tables: GatherTables, personId: PersonId, seat: '1' | '2', generation: number, table = 'west') {
  tables.host.released?.({ place: { table, seat }, personId, generation, sessionId: 'session' }, 'stand');
}
function table(tables: GatherTables) { return tables.view(0).tables[0]!; }

describe('tavern table authority', () => {
  it('reserves a chair once, including while the physical claim is pending', async () => {
    const tables = new GatherTables(['west', 'east']);
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([
      tables.host.admit({ table: 'west', seat: '1', personId: alice, signal }),
      tables.host.admit({ table: 'west', seat: '1', personId: bob, signal }),
    ]);
    expect(first.admitted).toBe(true);
    expect(second).toEqual({ admitted: false, reason: 'refused' });
    expect(await reserve(tables, alice, '2', 'east')).toEqual({ admitted: false, reason: 'refused' });
    expect(tables.self(alice)).toEqual({ table: null, seat: null, seatIndex: null, playerIndex: null });
    expect(await tables.start(alice, { table: 'west', revision: table(tables).revision, id: 'pending' }, 0)).toBe(false);
    expect(tables.input(alice, { match: 'unknown', sequence: 0, paddle: 0 })).toBe(false);
    if (first.admitted) first.cancel();
    const replacement = await reserve(tables, bob, '1');
    expect(replacement.admitted).toBe(true);
    if (replacement.admitted) replacement.cancel();
  });

  it('refuses missing chairs and aborted claims without taking a chair', async () => {
    const tables = new GatherTables();
    const controller = new AbortController(); controller.abort();
    expect(await tables.host.admit({ table: 'west', seat: '1', personId: alice, signal: controller.signal }))
      .toEqual({ admitted: false, reason: 'refused' });
    expect(await tables.host.admit({ table: 'absent', seat: '1', personId: alice, signal: new AbortController().signal }))
      .toEqual({ admitted: false, reason: 'unavailable' });
    expect(await tables.host.admit({ table: 'west', seat: '3', personId: alice, signal: new AbortController().signal }))
      .toEqual({ admitted: false, reason: 'unavailable' });
    expect((await reserve(tables, bob, '1')).admitted).toBe(true);
  });

  it('fences cancellation and release to the original claim and seat generation', async () => {
    const tables = new GatherTables();
    const old = await sit(tables, alice, '1', 4);
    release(tables, alice, '1', 4);
    const current = await sit(tables, alice, '1', 5);
    release(tables, alice, '1', 4);
    release(tables, bob, '1', 5);
    old.cancel();
    expect(tables.self(alice)).toEqual({ table: 'west', seat: 0, seatIndex: 0, playerIndex: null });
    expect((await reserve(tables, bob, '1')).admitted).toBe(false);
    current.cancel();
    expect(tables.self(alice)).toEqual({ table: 'west', seat: 0, seatIndex: 0, playerIndex: null });
    release(tables, alice, '1', 5);
    expect(tables.self(alice)).toEqual({ table: null, seat: null, seatIndex: null, playerIndex: null });
    expect((await reserve(tables, bob, '1')).admitted).toBe(true);
  });

  it('interrupts a running match on room closure, after cancel precedes released', async () => {
    const tables = new GatherTables();
    const admission = await sit(tables, alice, '1', 1);
    await sit(tables, bob, '2', 2);
    expect(await tables.start(alice, { table: 'west', revision: table(tables).revision, id: 'start' }, 0)).toBe(true);
    admission.cancel();
    expect(table(tables).pong?.phase).toBe('serve');
    tables.host.released?.({ place: { table: 'west', seat: '1' }, personId: alice, generation: 1, sessionId: 'session' }, 'closed');
    expect(table(tables).pong).toMatchObject({ phase: 'interrupted', winner: null, reason: 'restart' });
    expect(tables.self(alice)).toEqual({ table: null, seat: null, seatIndex: null, playerIndex: null });
  });

  it('accepts starts and paddle inputs only from committed seats, once per revision and sequence', async () => {
    const tables = new GatherTables();
    await sit(tables, alice, '1', 1);
    const pendingBob = await reserve(tables, bob, '2');
    if (!pendingBob.admitted) throw new Error('second chair refused');
    const before = structuredClone(tables.view(100));
    const revision = table(tables).revision;
    expect(await tables.start(alice, { table: 'west', revision, id: 'early' }, 100)).toBe(false);
    expect(await tables.start(bob, { table: 'west', revision, id: 'pending' }, 100)).toBe(false);
    expect(await tables.start(eve, { table: 'west', revision, id: 'intruder' }, 100)).toBe(false);
    expect(tables.view(100)).toEqual(before);
    pendingBob.seated?.({ targetId: 'tavern:west:seat:2', generation: 2 });
    expect(await tables.start(alice, { table: 'west', revision: revision - 1, id: 'stale' }, 100)).toBe(false);
    const request = { table: 'west', revision: table(tables).revision, id: 'start-1' };
    expect(await tables.start(alice, request, 100)).toBe(true);
    const started = structuredClone(tables.view(100));
    expect(await tables.start(alice, request, 100)).toBe(true);
    expect(await tables.start(bob, { table: 'west', revision: table(tables).revision, id: 'second-start' }, 100)).toBe(false);
    expect(tables.view(100)).toEqual(started);
    const match = table(tables).pong!.match;
    expect(tables.input(eve, { match, sequence: 0, paddle: .5 })).toBe(false);
    expect(tables.input(alice, { match: 'wrong-match', sequence: 0, paddle: .5 })).toBe(false);
    expect(tables.view(100)).toEqual(started);
    expect(tables.input(alice, { match, sequence: 3, paddle: .5 })).toBe(true);
    const afterInput = structuredClone(tables.view(100));
    expect(tables.input(alice, { match, sequence: 3, paddle: -.5 })).toBe(false);
    expect(tables.input(alice, { match, sequence: 2, paddle: -.5 })).toBe(false);
    expect(tables.view(100)).toEqual(afterInput);
  });

  it('plays an entire match from two seats and a stand concedes an active match', async () => {
    const tables = new GatherTables();
    await sit(tables, alice, '1', 1);
    await sit(tables, bob, '2', 2);
    tables.name(alice, 'Alice'); tables.name(bob, 'Bob');
    expect(table(tables).seats).toEqual(['Alice', 'Bob']);
    expect(await tables.start(alice, { table: 'west', revision: table(tables).revision, id: 'match-1' }, 100)).toBe(true);
    const match = table(tables).pong!.match;
    expect(tables.input(alice, { match, sequence: 0, paddle: -1 })).toBe(true);
    expect(tables.input(bob, { match, sequence: 0, paddle: -1 })).toBe(true);
    for (let i = 0; i < 30_000 && table(tables).pong?.phase !== 'finished'; i++) tables.tick();
    expect(table(tables).pong).toMatchObject({ phase: 'finished', reason: 'points' });
    const final = table(tables).pong!;
    expect(final.winner).not.toBeNull();
    expect(final.score[final.winner!]).toBe(7);
    expect(await tables.start(bob, { table: 'west', revision: table(tables).revision, id: 'match-2' }, 200_000)).toBe(true);
    release(tables, alice, '1', 1);
    await tables.flush();
    expect(table(tables).pong).toMatchObject({ phase: 'finished', reason: 'conceded', winner: 1 });
    expect(table(tables).seats).toEqual([null, 'Bob']);
  });

  it('does not replay an old accepted start after another request and the match ends', async () => {
    const tables = new GatherTables();
    await sit(tables, alice, '1', 1);
    await sit(tables, bob, '2', 2);
    const first = { table: 'west', revision: table(tables).revision, id: 'once' };
    expect(await tables.start(alice, first, 100)).toBe(true);
    const match = table(tables).pong!.match;
    expect(await tables.start(alice, { table: 'west', revision: table(tables).revision, id: 'while-playing' }, 101)).toBe(false);
    expect(tables.input(alice, { match, sequence: 0, paddle: -1 })).toBe(true);
    expect(tables.input(bob, { match, sequence: 0, paddle: -1 })).toBe(true);
    for (let i = 0; i < 30_000 && table(tables).pong?.phase !== 'finished'; i++) tables.tick();
    expect(table(tables).pong?.phase).toBe('finished');
    const finished = structuredClone(tables.view(0));
    expect(await tables.start(alice, first, 200_000)).toBe(true);
    expect(tables.view(0)).toEqual(finished);
  });
});
