import { describe, expect, it, vi } from 'vitest';
import { ForgeLedgerViewSchema, PersonIdSchema, type ForgeLedgerView } from '@chatdom/shared';
import { VOXEL_FIXTURE, WORLD_FIXTURE_KINGDOM as kingdomId } from '@chatdom/shared/world-fixtures';
import type { ForgeAttachment, RealmCapability, RealmDomainCommand, RealmForgeReservation, RealmPrivateState } from '@chatdom/shared/realm';
import { createRealmState, decideRealm } from '@chatdom/world/realm';
import { FoundedUnavailableError } from '../founded/load';
import { forgeLedgerView } from './projection';
import { createForgeLedgerHandler, type ForgeLedgerSource } from './http';

const WORDS = 'PRIVATE WISH WORDS a little fox asleep';

/** A kingdom built through the real reducer: homes, a live night, coal, and wishes that commit, release or wait. */
function kingdom() {
  let state = createRealmState(kingdomId, 'live'), now = 1_000, n = 0;
  const run = (command: RealmDomainCommand, capability: RealmCapability) => {
    const result = decideRealm(state, command, { now, writerEpoch: 'writer:1', commandId: `cmd:${++n}`, capability, current: true, anvilCapacity: 3 });
    if (result.kind !== 'accepted') throw new Error(`Expected ${command.type} accepted, got ${JSON.stringify(result)}`);
    state = result.state;
  };
  const people = ['7001', '7002', '7003'].map(id => PersonIdSchema.parse(id));
  const names = ['Juniper', 'Wren', 'Ash'];
  people.forEach((personId, slot) => {
    const home = { id: `plot:${slot}`, ownerId: personId, slot, allocationReceipt: `allocation:${slot}`, layoutRevision: 'founded:1', revision: `home:${slot}`,
      digest: String(slot).repeat(64), family: 'hearth' as const, blueprint: VOXEL_FIXTURE,
      attribution: { makerName: names[slot]!, kingdomName: 'Emberwick', approvalId: `names:${slot}` }, attachments: {} };
    run({ type: 'home.installAllocated', home }, 'allocation');
    run({ type: 'citizen.rights', personId, rights: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: `safety:${slot}` } }, 'moderation');
  });
  let night = 0;
  /** A qualified night earns each citizen one coal (at most three held). */
  const evening = () => {
    const sessionId = `night:${++night}`, from = now;
    run({ type: 'stream.observe', sessionId, startedAt: from, liveUntil: from + 90_000_000 }, 'presence');
    now = from + 600_000;
    for (const personId of people) {
      run({ type: 'presence.confirmInterval', personId, streamSessionId: sessionId, from, through: now, evidenceReceipt: `interval:${sessionId}:${personId}` }, 'presence');
      run({ type: 'coal.creditQualifiedNight', personId, streamSessionId: sessionId, qualificationReceipt: `qualified:${sessionId}:${personId}` }, 'presence');
    }
  };
  evening();
  const reserve = (slot: number, key: string): RealmForgeReservation => {
    const home = state.homes[`plot:${slot}`]!;
    if ((state.coals[home.ownerId] ?? 0) < 1) evening();
    const record: RealmForgeReservation = { attempt: { key, attemptId: `attempt:${key}` }, homeId: home.id, homeDigest: home.digest, streamSessionId: state.stream.sessionId!, rightsRevision: 1,
      reservation: { reservationId: `reserve:${key}`, kingdomId, personId: home.ownerId, slot, revision: home.revision, family: 'hearth', home: home.blueprint,
        safetyIdentifier: `safety:${slot}`, expiresAt: now + 60_000, attribution: home.attribution } };
    run({ type: 'forge.reserve', record }, 'forge');
    return record;
  };
  const commit = (slot: number, key: string, title: string, at: number, motif: 'sleeping-fox' | 'crescent-moon' = 'sleeping-fox') => {
    now = Math.max(now, at);
    const record = reserve(slot, key), home = state.homes[`plot:${slot}`]!;
    const attachment: ForgeAttachment = { version: 1, id: `piece:${key}`, runId: `run:${key}`, kingdomId, slot, hostId: home.blueprint.id, hostFingerprint: 'fingerprint',
      socketId: `socket:${key}`, origin: [0, 24, 0], kitId: 'hearth-native', kitRevision: 2, family: 'hearth',
      draft: { plan: { version: 2, kind: 'chimney', motif, finish: 'copper', accent: 'none' }, title, plaque: `${title}, kept warm.` },
      provenance: { source: 'live', makerName: home.attribution.makerName, kingdomName: 'Emberwick', designId: `design:${key}` } };
    run({ type: 'forge.commitApproved', attempt: record.attempt, reservationId: record.reservation.reservationId, expectedRevision: home.revision,
      expectedHomeDigest: home.digest, attachment, creation: { words: WORDS }, approvalReceipt: `judges:${key}` }, 'forge');
  };
  return { get state() { return state; }, run, reserve, commit, people, at: (ms: number) => { now = ms; } };
}

describe('the forge remembers: projection', () => {
  it('lists committed pieces newest first with title, plaque, piece and maker, and an empty kingdom lists nothing', () => {
    const empty = forgeLedgerView(createRealmState(kingdomId, 'live'), 5);
    expect(ForgeLedgerViewSchema.parse(empty)).toEqual({ version: 1, kingdomId, total: 0, entries: [], at: 5 });

    const k = kingdom();
    k.commit(0, 'a', 'Sleeping keeper', 700_000);
    k.commit(1, 'b', 'Moon over Wren', 800_000, 'crescent-moon');
    k.commit(2, 'c', 'Ash fox', 800_000);
    const view = ForgeLedgerViewSchema.parse(forgeLedgerView(k.state, 900_000));
    expect(view.total).toBe(3);
    expect(view.entries.map(entry => entry.title)).toEqual(['Moon over Wren', 'Ash fox', 'Sleeping keeper']);
    expect(view.entries[2]).toEqual({ id: 'piece:a', title: 'Sleeping keeper', plaque: 'Sleeping keeper, kept warm.',
      plan: { version: 2, kind: 'chimney', motif: 'sleeping-fox', finish: 'copper', accent: 'none' }, family: 'hearth', kitRevision: 2,
      maker: { name: 'Juniper' }, forgedAt: 700_000 });
    // No copies exist yet, so the ledger says nothing about them.
    expect(view.entries.every(entry => !('copies' in entry))).toBe(true);
  });

  it('never carries words, refusals, held or waiting wishes, ownership or private receipts', () => {
    const k = kingdom();
    k.commit(0, 'landed', 'Sleeping keeper', 700_000);
    // A wish reserved and then released (refused, held or cold) and one still at the anvil.
    k.at(710_000);
    const released = k.reserve(1, 'released');
    k.run({ type: 'forge.release', attempt: released.attempt }, 'forge');
    k.reserve(2, 'waiting');
    const view = forgeLedgerView(k.state, 720_000), text = JSON.stringify(view);
    expect(view.entries.map(entry => entry.id)).toEqual(['piece:landed']);
    expect(text).not.toContain('PRIVATE');
    expect(text).not.toContain('fox asleep');
    for (const secret of ['judges:', 'reserve:', 'attempt:', 'safety:', 'plot:', 'run:', 'design:', 'fingerprint', 'socket:', ...k.people])
      expect(text).not.toContain(secret);
    expect(text).not.toMatch(/ownerId|personId|homeId|words|approval|origin|hostId/);
  });

  it('names makers as their card shows them now, and keeps a superseded piece remembered', () => {
    const k = kingdom();
    k.commit(0, 'first', 'Sleeping keeper', 700_000);
    k.commit(0, 'second', 'A second keeper', 750_000);
    // The citizen's approved name changes; the card and the ledger follow it.
    const home = k.state.homes['plot:0']!;
    const renamed: RealmPrivateState = { ...k.state, homes: { ...k.state.homes, [home.id]: { ...home, attribution: { ...home.attribution, makerName: 'Juniper Vale' } } } };
    const view = forgeLedgerView(renamed, 800_000);
    expect(view.entries.map(entry => [entry.title, entry.maker.name])).toEqual([['A second keeper', 'Juniper Vale'], ['Sleeping keeper', 'Juniper Vale']]);
    // Someone who left the kingdom keeps the name the piece was forged under.
    const gone: RealmPrivateState = { ...k.state, homes: {} };
    expect(forgeLedgerView(gone, 800_000).entries.map(entry => entry.maker.name)).toEqual(['Juniper', 'Juniper']);
  });

  it('bounds a long ledger and keeps counting every piece', () => {
    const k = kingdom();
    for (let i = 0; i < 5; i++) { k.commit(i % 3, `p${i}`, `Piece ${i}`, 700_000 + i * 1_000_000); }
    const view = forgeLedgerView(k.state, 9_000_000, 2);
    expect(view.total).toBe(5);
    expect(view.entries.map(entry => entry.title)).toEqual(['Piece 4', 'Piece 3']);
  });
});

describe('the forge remembers: the public route', () => {
  const k = kingdom();
  k.commit(0, 'landed', 'Sleeping keeper', 700_000);
  const resting = (state: RealmPrivateState): ForgeLedgerSource & { retained: number; released: number } => {
    const source = { retained: 0, released: 0, open: () => undefined,
      retain: async () => { source.retained++; return { kingdom: { privateState: state, current: true }, release: async () => { source.released++; } }; } };
    return source;
  };

  it('reads an open kingdom directly and a resting one through a brief hold it always releases', async () => {
    const open = createForgeLedgerHandler({ open: () => ({ privateState: k.state, current: true }), retain: vi.fn() }, { now: () => 1 });
    const reply = await open(`kingdomId=${kingdomId}`);
    expect(reply.http).toBe(200);
    expect((reply.body as ForgeLedgerView).entries.map(entry => entry.title)).toEqual(['Sleeping keeper']);

    const source = resting(k.state), handler = createForgeLedgerHandler(source, { now: () => 1 });
    expect((await handler(`kingdomId=${kingdomId}`)).http).toBe(200);
    expect(source).toMatchObject({ retained: 1, released: 1 });
  });

  it('answers repeated reads from memory for a short while', async () => {
    let at = 1_000;
    const source = resting(k.state), handler = createForgeLedgerHandler(source, { now: () => at, cacheMs: 10_000 });
    await handler(`kingdomId=${kingdomId}`); await handler(`kingdomId=${kingdomId}`);
    expect(source.retained).toBe(1);
    at += 10_001;
    await handler(`kingdomId=${kingdomId}`);
    expect(source.retained).toBe(2);
  });

  it('refuses odd requests, says plainly when a kingdom has no forge, and asks again after a passing failure', async () => {
    const handler = createForgeLedgerHandler(resting(k.state));
    for (const query of ['', 'kingdomId=abc', `kingdomId=${kingdomId}&words=1`, `kingdomId=${kingdomId}&kingdomId=${kingdomId}`])
      expect((await handler(query)).http).toBe(400);
    const unfounded = createForgeLedgerHandler({ open: () => undefined, retain: () => Promise.reject(new FoundedUnavailableError('unfounded', 'none')) });
    expect(await unfounded(`kingdomId=${kingdomId}`)).toEqual({ http: 404, body: { version: 1, status: 'error', message: 'This kingdom has no forge yet.' } });
    let fail = true;
    const flaky = createForgeLedgerHandler({ open: () => undefined,
      retain: async () => { if (fail) throw new Error('lease held elsewhere'); return { kingdom: { privateState: k.state, current: true }, release: async () => {} }; } });
    expect((await flaky(`kingdomId=${kingdomId}`)).http).toBe(503);
    await Promise.resolve();
    fail = false;
    expect((await flaky(`kingdomId=${kingdomId}`)).http).toBe(200);
  });
});
