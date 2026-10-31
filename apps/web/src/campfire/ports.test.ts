import { describe, expect, it } from 'vitest';
import { CampfireDecodeError } from './decode';
import { SIMULATED_SCENARIOS, createSimulatedCampfireSession, simulatedPublicView } from './fixture';
import { decodeCampfirePublicView, type CampfirePublicView } from './ports';

const START = Date.UTC(2026, 9, 30, 20, 0, 0);
const view = (scenario: (typeof SIMULATED_SCENARIOS)[number] = 'playing', seats = 6) => simulatedPublicView({ scenario, seats, seed: 'test', startMs: START }, START);
const wire = (v: CampfirePublicView): Record<string, unknown> => JSON.parse(JSON.stringify(v));
type Path = readonly (string | number)[];
/** Sets (or, for undefined, deletes) one field of the loose wire JSON. */
const plant = (w: Record<string, unknown>, path: Path, value: unknown): void => {
  let at = w as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
  const last = path.at(-1)!;
  if (value === undefined) delete at[last]; else at[last] = value;
};
const rejects = (changes: readonly (readonly [Path, unknown])[], reason: RegExp) => {
  const w = wire(view());
  for (const [path, value] of changes) plant(w, path, value);
  expect(() => decodeCampfirePublicView(w)).toThrow(CampfireDecodeError);
  expect(() => decodeCampfirePublicView(w)).toThrow(reason);
};

describe('public view decoder', () => {
  it('decodes every simulated scenario at both arrangement sizes', () => {
    for (const scenario of SIMULATED_SCENARIOS) for (const seats of [6, 12]) {
      const v = view(scenario, seats);
      expect(decodeCampfirePublicView(wire(v))).toEqual(v);
      expect(v.origin).toBe('SIMULATED');
      expect(Object.isFrozen(v) && Object.isFrozen(v.seats)).toBe(true);
    }
  });

  it('rejects private or unknown fields anywhere in the view', () => {
    rejects([[['roles'], { 1: 'snuffer' }]], /roles: is not part of this view/);
    rejects([[['seats', 1, 'role'], 'snuffer']], /seats\[1\]\.role/);
    rejects([[['seats', 2, 'ballot'], 3]], /ballot/);
    rejects([[['phase', 'nightActivity'], 2]], /nightActivity/);
    rejects([[['gallery', 'votes'], 4120]], /votes/);
    rejects([[['gallery', 'embers', 0, 'count'], 4]], /count/);
    rejects([[['seed'], 'abc']], /seed/);
    rejects([[['seats', 1, 'personId'], '12345']], /personId/);
  });

  it('rejects a role shown before its public reveal, or on the Magistrate', () => {
    rejects([[['seats', 1, 'revealed'], 'snuffer']], /before its public reveal/);
    rejects([[['seats', 0, 'revealed'], 'fool']], /Magistrate/);
    rejects([[['seats', 0, 'lantern'], 'lit']], /Magistrate/);
    rejects([[['result'], { outcome: 'interrupted', day: 2, reveals: [{ seat: 1, role: 'snuffer' }] }], [['lifecycle'], 'interrupted'], [['phase'], null]], /interrupted night reveals nothing/);
  });

  it('keeps suspicion on living players and bounded', () => {
    rejects([[['gallery', 'embers'], [{ seat: 3, glow: 2 }]]], /living player/);
    rejects([[['gallery', 'embers'], [{ seat: 0, glow: 2 }]]], /living player/);
    rejects([[['gallery', 'embers', 0, 'glow'], 9]], /1\.\.3/);
  });

  it('rejects malformed shapes and labels', () => {
    rejects([[['version'], 2]], /version/);
    rejects([[['kingdom', 'id'], 'hearthmoor']], /kingdom\.id/);
    rejects([[['seats', 1, 'label'], 'a\u0007b']], /control/);
    rejects([[['seats', 1, 'label'], 'x'.repeat(41)]], /label/);
    rejects([[['seats', 1, 'seat'], view().seats[2]!.seat]], /repeats a seat/);
    rejects([[['seats', 1, 'look', 'skin'], 40]], /skin swatch/);
    rejects([[['seats', 1, 'look', 'wear'], [{ id: 'crown', style: 'hearth' }]]], /wear/);
    rejects([[['cues'], undefined]], /cues: is missing/);
    rejects([[['lifecycle'], 'paused']], /paused phase/);
    expect(() => decodeCampfirePublicView(null)).toThrow(CampfireDecodeError);
    expect(() => decodeCampfirePublicView(Object.assign(Object.create({ injected: true }), wire(view())))).toThrow(/plain object/);
  });
});

describe('simulated session', () => {
  it('is deterministic for a seed and instant', () => {
    expect(view('playing', 12)).toEqual(view('playing', 12));
    expect(simulatedPublicView({ scenario: 'playing', seats: 12, seed: 'other', startMs: START }, START).seats.map(s => s.label)).not.toEqual(view('playing', 12).seats.map(s => s.label));
  });

  it('never fills the fire with more people than have accepted, and seats nobody when closed', () => {
    const waiting = view('waiting', 12);
    expect(waiting.seats.filter(s => s.kind === 'player')).toHaveLength(waiting.seating!.accepted);
    expect(view('closed').seats).toHaveLength(0);
  });

  it('holds no private hand and refuses every intent honestly', async () => {
    let ticks: (() => void) | undefined;
    const session = createSimulatedCampfireSession({ scenario: 'playing', seats: 6, seed: 'test', startMs: START }, { now: () => START + 2_000, every: (_ms, tick) => { ticks = tick; return () => { ticks = undefined; }; } });
    const seen: CampfirePublicView[] = [];
    const stop = session.subscribePublic(v => seen.push(v));
    ticks?.();
    expect(seen).toHaveLength(2);
    let reason = '';
    session.subscribeSelf(() => { throw new Error('A simulated fire must not deliver a private hand.'); }, r => { reason = r; });
    expect(reason).toBe('not-bound');
    await expect(session.send({ id: 'i1', matchId: 'sim-match-1', hostEpoch: 'sim-epoch-1', expectedRevision: 3, intent: { kind: 'night', target: 2 } })).resolves.toEqual({ id: 'i1', status: 'rejected', reason: 'unavailable' });
    stop();
    expect(ticks).toBeUndefined();
    session.dispose();
  });
});
