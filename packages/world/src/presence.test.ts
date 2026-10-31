import { describe, expect, it } from 'vitest';
import {
  KingdomIdSchema, KingdomPresenceFrameSchema, PersonIdSchema, PRESENCE_LEASE_MS, STREAM_LEASE_MS,
  starterCitizenLook,
  type PresenceInput, type PresencePerson, type PresenceSource,
} from '@chatdom/shared';
import {
  advancePresence, applyPresence, createPresenceState, presenceTick, projectPresence,
  PRESENCE_DEDUPE_CAPACITY, type PresenceState,
} from './presence';

const kingdomId = KingdomIdSchema.parse('9001');
const alice = PersonIdSchema.parse('90071992547409921');
const bob = PersonIdSchema.parse('90071992547409922');
const carol = PersonIdSchema.parse('103');
const bindings = [{ personId: alice, slot: 2 }, { personId: bob, slot: 1 }, { personId: carol, slot: 0 }];
const anonymous = (personId = alice): PresencePerson => ({ personId, disclosure: 'anonymous' });
const named = (personId = alice, displayName = 'SIMULATED Alice'): PresencePerson => ({ personId, disclosure: 'named', displayName });
const common = (at: number, id: string) => ({ version: 1 as const, kingdomId, origin: 'simulated' as const, observedAt: at, id });

function stream(at = 0, sessionId: string | null = 'SIMULATED-session'): PresenceInput {
  return { ...common(at, `stream.${at}.${sessionId ?? 'offline'}`), kind: 'stream', live: sessionId !== null, sessionId };
}

function observe(at: number, people: PresencePerson[], source: PresenceSource = 'chat', coverage?: 'complete' | 'partial' | 'activity'): PresenceInput {
  return { ...common(at, `observe.${source}.${at}`), kind: 'observe', source, people, coverage: coverage ?? (source === 'chatters' ? 'partial' : 'activity') };
}

function remove(at: number, reason: 'timeout' | 'moderated' | 'ban' | 'forget', until: number | null = null): PresenceInput {
  return { ...common(at, `remove.${reason}.${at}`), kind: 'remove', personId: alice, reason, until };
}

function restore(at: number): PresenceInput {
  return { ...common(at, `restore.${at}`), kind: 'restore', personId: alice };
}

function awake(): PresenceState {
  return applyPresence(createPresenceState(kingdomId, 'simulated'), stream(), 0);
}

function windowFor(state: PresenceState, at: number, personId = alice) {
  return projectPresence(state, [{ personId, slot: 0 }], at, 1).windows[0]!;
}

describe('presence evidence and its public boundary', () => {
  it('starts unknown and unlit; public frames contain no private membership or stream identity', () => {
    const state = createPresenceState(kingdomId, 'simulated');
    expect(projectPresence(state, bindings, 0, 0)).toMatchObject({ connection: 'stale', streamLive: false });
    let live = applyPresence(state, stream(), 0);
    live = applyPresence(live, observe(1, [anonymous(alice), anonymous(bob)], 'chatters'), 1);
    const frame = projectPresence(live, bindings, 1, 7);
    expect(KingdomPresenceFrameSchema.parse(frame)).toEqual(frame);
    expect(frame.windows).toEqual([
      { slot: 0, present: false, publicName: null, since: 0, look: starterCitizenLook(carol) },
      { slot: 1, present: true, publicName: null, since: 1, look: starterCitizenLook(bob) },
      { slot: 2, present: true, publicName: null, since: 1, look: starterCitizenLook(alice) },
    ]);
    const wire = JSON.stringify(frame);
    for (const secret of [alice, bob, 'SIMULATED-session', 'personId', 'sourceTimes', 'chatters', 'restriction', 'observe.']) expect(wire).not.toContain(secret);
    // These IDs collapse as JS numbers, but remain separate lights/people.
    expect(Number(alice)).toBe(Number(bob));
    // The same real identity keeps its body/look when it lives in another slot/kingdom; choice beats default.
    expect(projectPresence(live, [{ personId: alice, slot: 40 }], 1, 8).windows[0]!.look).toBe(frame.windows[2]!.look);
    expect(projectPresence(live, [{ personId: alice, slot: 40, look: 'dusk' }], 1, 9).windows[0]!.look).toBe('dusk');
  });

  it('unions all four sources into one person and one minute eligibility entry', () => {
    let state = awake();
    for (const [index, source] of (['chatters', 'chat', 'panel', 'walker'] as const).entries()) {
      state = applyPresence(state, observe(index + 1, [source === 'chatters' ? anonymous() : named()], source), index + 1);
    }
    const result = presenceTick(state, 60_000);
    expect(result.credit).toEqual({ kingdomId, origin: 'simulated', sessionId: 'SIMULATED-session', minuteAt: 60_000, personIds: [alice] });
    expect(windowFor(state, 60_000)).toMatchObject({ present: true, publicName: 'SIMULATED Alice' });
    expect(() => projectPresence(state, [{ personId: alice, slot: 1 }, { personId: alice, slot: 2 }], 60_000, 1)).toThrow('unique');
  });

  it('grants names only through non-roster disclosure and respects a newer anonymous panel choice', () => {
    let state = applyPresence(awake(), observe(10, [named()]), 10);
    state = applyPresence(state, observe(20, [anonymous()], 'panel'), 20);
    state = applyPresence(state, observe(15, [named(alice, 'Older name')], 'walker'), 20);
    state = applyPresence(state, observe(25, [anonymous()], 'chatters'), 25);
    expect(windowFor(state, 25)).toMatchObject({ present: true, publicName: null });
    state = applyPresence(state, observe(30, [named(alice, 'New permission')], 'walker'), 30);
    expect(windowFor(state, 30).publicName).toBe('New permission');
    expect(() => applyPresence(state, observe(31, [named()], 'chatters'), 31)).toThrow();
  });

  it('expires a source at exactly 90 seconds and keeps other fresh sources', () => {
    let state = applyPresence(awake(), observe(0, [named()]), 0);
    state = applyPresence(state, observe(50_000, [named()], 'panel'), 50_000);
    expect(windowFor(state, PRESENCE_LEASE_MS).present).toBe(true);
    const expired = advancePresence(state, 50_000 + PRESENCE_LEASE_MS);
    expect(windowFor(expired, 140_000)).toEqual({ slot: 0, present: false, publicName: null, since: 140_000, look: starterCitizenLook(alice) });
    expect(presenceTick(expired, 180_000).credit).toBeNull();
    expect(bindings).toHaveLength(3);
  });

  it('does not renew on replay, late source input, a future clock or recovered input', () => {
    const event = observe(100, [named()]);
    let state = applyPresence(awake(), event, 100);
    state = applyPresence(state, event, 500);
    state = applyPresence(state, { ...event, id: 'retry.with.new.id', observedAt: 50 }, 500);
    state = applyPresence(state, { ...event, id: 'future', observedAt: 100_000 }, 500);
    state = applyPresence(state, { ...event, id: 'recovery', origin: 'recovered', observedAt: 500 }, 500);
    expect(windowFor(state, 90_099).present).toBe(true);
    expect(windowFor(state, 90_100).present).toBe(false);
    const recoveredLive = { ...stream(), origin: 'recovered' as const };
    expect(projectPresence(applyPresence(createPresenceState(kingdomId, 'live'), recoveredLive, 100), bindings, 100, 1).streamLive).toBe(false);
  });

  it('validates ingress before storing it and rejects mixed kingdoms or origins', () => {
    const state = awake();
    const event = observe(1, [named()]);
    expect(() => applyPresence(state, { ...event, kingdomId: KingdomIdSchema.parse('9002') }, 1)).toThrow('kingdom');
    expect(() => applyPresence(state, { ...event, origin: 'live' }, 1)).toThrow('origin');
    expect(() => applyPresence(state, { ...event, chatText: 'must never be stored' } as unknown as PresenceInput, 1)).toThrow();
    expect(() => applyPresence(state, observe(1, [named(), named()]), 1)).toThrow();
    expect(() => applyPresence(state, event, Number.NaN)).toThrow();
    const later = applyPresence(state, event, 100);
    expect(() => applyPresence(later, observe(2, [named()]), 99)).toThrow('backwards');
    expect(() => advancePresence(later, 99)).toThrow('backwards');
    expect(() => projectPresence(later, bindings, 99, 0)).toThrow('backwards');
    expect(() => projectPresence(later, [{ personId: alice, slot: 0 }, { personId: bob, slot: 0 }], 100, 0)).toThrow('unique');
  });

  it('does not mutate input, bindings, earlier states or earlier frames', () => {
    let state = applyPresence(awake(), observe(0, [anonymous()], 'chatters'), 0);
    const earlier = structuredClone(state);
    const frame = projectPresence(state, bindings, 0, 0);
    const input = observe(10, [named()]);
    const inputBefore = structuredClone(input);
    const newer = applyPresence(state, input, 10);
    expect(state).toEqual(earlier);
    expect(input).toEqual(inputBefore);
    expect(frame.windows.find(w => w.slot === 2)?.publicName).toBeNull();
    state = advancePresence(newer, 100_000);
    expect(windowFor(newer, 10).present).toBe(true);
    expect(windowFor(state, 100_000).present).toBe(false);
    expect(bindings.map(binding => binding.slot)).toEqual([2, 1, 0]);
    expect(newer.people.filter((bucket, i) => bucket !== state.people[i])).toHaveLength(1);
  });
});

describe('roster reconciliation', () => {
  it('does not infer absence from a partial or empty partial roster', () => {
    let state = applyPresence(awake(), observe(1, [anonymous(alice), anonymous(bob)], 'chatters', 'complete'), 1);
    state = applyPresence(state, observe(2, [], 'chatters', 'partial'), 2);
    expect(windowFor(state, 2, alice).present).toBe(true);
    expect(windowFor(state, 2, bob).present).toBe(true);
    state = applyPresence(state, observe(3, [anonymous(bob)], 'chatters', 'partial'), 3);
    expect(windowFor(state, 3, alice).present).toBe(true);
  });

  it('complete absence removes only the chatters source, preserving independent activity', () => {
    let state = applyPresence(awake(), observe(1, [anonymous(alice), anonymous(bob)], 'chatters', 'complete'), 1);
    state = applyPresence(state, observe(2, [named()], 'panel'), 2);
    state = applyPresence(state, observe(3, [], 'chatters', 'complete'), 3);
    expect(windowFor(state, 3, alice).present).toBe(true);
    expect(windowFor(state, 3, bob).present).toBe(false);
  });

  it('an older completed roster cannot erase a newer partial lease or overwrite newer membership', () => {
    let state = applyPresence(awake(), observe(20, [anonymous(alice)], 'chatters', 'partial'), 20);
    state = applyPresence(state, observe(10, [anonymous(bob)], 'chatters', 'complete'), 20);
    expect(windowFor(state, 20, alice).present).toBe(true);
    expect(windowFor(state, 20, bob).present).toBe(true);
    state = applyPresence(state, observe(30, [], 'chatters', 'complete'), 30);
    state = applyPresence(state, observe(25, [anonymous(alice), anonymous(bob)], 'chatters'), 30);
    state = applyPresence(state, observe(29, [anonymous(carol)], 'chatters', 'complete'), 30);
    expect(projectPresence(state, bindings, 30, 1).windows.every(w => !w.present)).toBe(true);
  });

  it('does not refresh evidence with a delayed roster that has already expired', () => {
    let state = applyPresence(awake(), observe(1, [anonymous()], 'chatters'), 1);
    state = applyPresence(state, observe(2, [anonymous()], 'chatters', 'complete'), 100_000);
    expect(windowFor(state, 100_000).present).toBe(false);
  });
});

describe('stream liveness and moderation', () => {
  it('a stream ending clears its old lights and stale evidence never grants minute credits', () => {
    let state = applyPresence(awake(), observe(1, [named()]), 1);
    const offline = applyPresence(state, stream(2, null), 2);
    expect(projectPresence(offline, bindings, 2, 1)).toMatchObject({ connection: 'offline', streamLive: false });
    expect(windowFor(offline, 2)).toMatchObject({ present: false, publicName: null });
    expect(presenceTick(offline, 60_000).credit).toBeNull();
    state = applyPresence(state, observe(170_000, [named()]), 170_000);
    expect(windowFor(state, STREAM_LEASE_MS - 1).present).toBe(true);
    const stale = projectPresence(state, bindings, STREAM_LEASE_MS, 2);
    expect(stale).toMatchObject({ connection: 'stale', streamLive: false });
    expect(stale.windows.every(w => !w.present && w.publicName === null)).toBe(true);
    expect(presenceTick(state, STREAM_LEASE_MS).credit).toBeNull();
  });

  it('old online events cannot undo offline; same-time conflict fails closed', () => {
    let state = applyPresence(awake(), observe(1, [named()]), 1);
    state = applyPresence(state, stream(20, null), 20);
    state = applyPresence(state, stream(10), 20);
    state = applyPresence(state, stream(20, 'other-session'), 20);
    expect(windowFor(state, 20).present).toBe(false);
    expect(projectPresence(state, [], 20, 1).connection).toBe('offline');
  });

  it('new stream sessions require fresh person evidence and preserve no old-session eligibility', () => {
    let state = applyPresence(awake(), observe(1, [named()]), 1);
    state = applyPresence(state, stream(10, null), 10);
    state = applyPresence(state, stream(20, 'SIMULATED-next'), 20);
    expect(windowFor(state, 20).present).toBe(false);
    expect(presenceTick(state, 60_000).credit).toBeNull();
    state = applyPresence(state, observe(21, [named()]), 21);
    expect(presenceTick(state, 60_000).credit?.sessionId).toBe('SIMULATED-next');
  });

  it.each(['timeout', 'moderated'] as const)('%s expiry alone never resurrects removed evidence', reason => {
    let state = applyPresence(awake(), observe(1, [named()]), 1);
    state = applyPresence(state, remove(10, reason, 20), 10);
    state = applyPresence(state, observe(15, [named()]), 15);
    expect(windowFor(state, 19).present).toBe(false);
    state = advancePresence(state, 20);
    expect(windowFor(state, 20)).toMatchObject({ present: false, publicName: null });
    state = applyPresence(state, observe(9, [named()], 'walker'), 20);
    expect(windowFor(state, 20).present).toBe(false);
    state = applyPresence(state, observe(21, [named()], 'panel'), 21);
    expect(windowFor(state, 21).present).toBe(true);
  });

  it('ban remains blocked through fresh activity until an explicit moderation restore', () => {
    let state = applyPresence(awake(), observe(1, [named()]), 1);
    state = applyPresence(state, remove(10, 'ban'), 10);
    state = applyPresence(state, observe(20, [named()]), 20);
    state = applyPresence(state, observe(30, [anonymous()], 'chatters', 'complete'), 30);
    expect(windowFor(state, 40)).toMatchObject({ present: false, publicName: null });
    state = applyPresence(state, restore(40), 40);
    expect(windowFor(state, 40).present).toBe(false);
    state = applyPresence(state, observe(35, [named()], 'walker'), 40);
    expect(windowFor(state, 40).present).toBe(false);
    state = applyPresence(state, observe(41, [anonymous()], 'panel'), 41);
    expect(windowFor(state, 41)).toMatchObject({ present: true, publicName: null });
  });

  it('moderation restore never clears forget consent, in either arrival order', () => {
    const events = [remove(10, 'forget'), restore(20)];
    for (const ordered of [events, [...events].reverse()]) {
      let state = applyPresence(awake(), observe(1, [named()]), 1);
      for (const event of ordered) state = applyPresence(state, event, 20);
      state = applyPresence(state, observe(30, [named()]), 30);
      state = applyPresence(state, observe(40, [anonymous()], 'chatters', 'complete'), 40);
      expect(windowFor(state, 40)).toMatchObject({ present: false, publicName: null });
      expect(presenceTick(state, 60_000).credit).toBeNull();
    }
  });

  it('orders control separately; old removal cannot undo a newer restore, equal removal wins', () => {
    let state = applyPresence(awake(), remove(10, 'ban'), 10);
    state = applyPresence(state, restore(20), 20);
    state = applyPresence(state, observe(21, [named()]), 21);
    state = applyPresence(state, remove(15, 'ban'), 21);
    expect(windowFor(state, 21).present).toBe(true);
    state = applyPresence(state, remove(20, 'ban'), 21);
    expect(windowFor(state, 21).present).toBe(false);
    state = applyPresence(state, { ...restore(20), id: 'equal.restore.retry' }, 21);
    expect(windowFor(state, 21).present).toBe(false);
  });

  it.each(['ban', 'forget'] as const)('never weakens a permanent %s with a newer finite hold', reason => {
    let state = applyPresence(awake(), remove(1100, reason), 1100);
    state = applyPresence(state, remove(1200, 'moderated', 1400), 1200);
    state = applyPresence(state, observe(1500, [named()]), 1500);
    expect(windowFor(state, 1500).present).toBe(false);
    state = applyPresence(state, restore(1600), 1600);
    state = applyPresence(state, observe(1700, [named()]), 1700);
    expect(windowFor(state, 1700).present).toBe(reason !== 'forget');
  });

  it('a same-source same-millisecond anonymous choice wins in either arrival order', () => {
    for (const anonymousFirst of [false, true]) {
      const first = observe(1, [anonymousFirst ? anonymous() : named()], 'panel');
      const second = { ...observe(1, [anonymousFirst ? named() : anonymous()], 'panel'), id: 'second.disclosure' };
      let state = applyPresence(awake(), first, 1);
      state = applyPresence(state, second, 1);
      expect(windowFor(state, 1)).toMatchObject({ present: true, publicName: null });
      expect(windowFor(state, 90_001).present).toBe(false);
    }
  });

  it('merges temporary and permanent removals restrictively regardless of timestamp and arrival order', () => {
    const pairs = [
      [remove(10, 'timeout', 80), remove(20, 'moderated', 40)],
      [remove(10, 'timeout', 80), { ...remove(10, 'timeout', 40), id: 'same.time.shorter' }],
      [remove(10, 'ban'), remove(20, 'moderated', 40)],
      [remove(10, 'forget'), remove(10, 'ban')],
    ];
    for (const pair of pairs) {
      for (const ordered of [pair, [...pair].reverse()]) {
        let state = awake();
        for (const event of ordered) state = applyPresence(state, event!, 20);
        state = applyPresence(state, observe(50, [named()]), 50);
        expect(windowFor(state, 50).present).toBe(false);
        state = applyPresence(state, restore(60), 60);
        state = applyPresence(state, observe(61, [named()]), 61);
        expect(windowFor(state, 61).present).toBe(!pair.some(event => event?.kind === 'remove' && event.reason === 'forget'));
      }
    }
  });

  it('an old repeated timeout never erases fresh valid activity after expiry', () => {
    let state = applyPresence(awake(), remove(10, 'timeout', 20), 10);
    state = applyPresence(state, observe(21, [named()]), 21);
    state = applyPresence(state, { ...remove(10, 'timeout', 20), id: 'duplicate.timeout.new.envelope' }, 22);
    expect(windowFor(state, 22).present).toBe(true);
  });
});

describe('bounded replay handling and minute sampling', () => {
  it('keeps exactly one bounded dedupe window and old input still cannot renew after eviction', () => {
    let state = awake();
    const old = observe(1, [named()]);
    state = applyPresence(state, old, 1);
    for (let at = 2; at <= PRESENCE_DEDUPE_CAPACITY + 2; at++) state = applyPresence(state, observe(at, [named()]), at);
    expect(state.recentInputs.size).toBe(PRESENCE_DEDUPE_CAPACITY);
    expect(state.recentInputs.ids.reduce((sum, bucket) => sum + bucket.size, 0)).toBe(PRESENCE_DEDUPE_CAPACITY);
    state = applyPresence(state, old, 50_000);
    expect(windowFor(state, PRESENCE_DEDUPE_CAPACITY + 2 + PRESENCE_LEASE_MS).present).toBe(false);
  });

  it('emits sorted private IDs once per minute across all sources and out-of-order tick retries', () => {
    let state = applyPresence(awake(), observe(1, [anonymous(bob), anonymous(carol), anonymous(alice)], 'chatters'), 1);
    const result = presenceTick(state, 60_000);
    expect(result.credit?.personIds).toEqual([carol, alice, bob]);
    state = result.state;
    expect(presenceTick(state, 60_000).credit).toBeNull();
    expect(presenceTick(state, 0).credit).toBeNull();
    state = applyPresence(state, observe(60_000, [named()]), 60_000);
    expect(presenceTick(state, 60_000).credit).toBeNull();
    expect(() => presenceTick(state, 60_001)).toThrow('minute boundary');
    expect(presenceTick(applyPresence(state, observe(60_001, [named()]), 60_001), 60_000).credit).toBeNull();
  });

  it('skips missing minutes and never backfills after a fresh session or offline tick', () => {
    let state = presenceTick(awake(), 60_000).state;
    state = applyPresence(state, observe(100_000, [named()]), 100_000);
    state = applyPresence(state, stream(170_000), 170_000);
    const result = presenceTick(state, 180_000);
    expect(result.credit?.minuteAt).toBe(180_000);
    expect(result.credit?.personIds).toEqual([alice]);
    expect(presenceTick(result.state, 120_000).credit).toBeNull();
  });

  it('processes a capital roster and a full slot projection with stable identity and sparse activity writes', () => {
    const ids = Array.from({ length: 50_000 }, (_, i) => PersonIdSchema.parse(String(i + 1)));
    const state = applyPresence(awake(), observe(1, ids.map(id => anonymous(id)), 'chatters', 'complete'), 1);
    const next = applyPresence(state, observe(2, [named(ids[0]!)], 'panel'), 2);
    expect(next.people.filter((bucket, index) => bucket !== state.people[index])).toHaveLength(1);
    const frame = projectPresence(next, ids.map((personId, slot) => ({ personId, slot })), 2, 1);
    expect(frame.windows).toHaveLength(50_000);
    expect(frame.windows.every(w => w.present)).toBe(true);
    expect(presenceTick(next, 60_000).credit?.personIds).toHaveLength(50_000);
    expect(KingdomPresenceFrameSchema.safeParse(frame).success).toBe(true);
  });
});

it('keeps a witnessed offline message warm through stream polls without relighting the castle or minting minutes',()=>{
 let state=applyPresence(awake(),observe(100,[named(alice)]),100);
 state=applyPresence(state,observe(200,[anonymous(bob)],'chatters'),200);
 state=applyPresence(state,stream(1_000,null),1_000);
 expect(projectPresence(state,bindings,1_000,1).windows.every(w=>!w.present)).toBe(true);
 state=applyPresence(state,observe(2_000,[named(alice,'Alice is still here')]),2_000);
 state=applyPresence(state,stream(60_000,null),60_000);
 const frame=projectPresence(state,bindings,60_000,2);
 expect(KingdomPresenceFrameSchema.parse(frame)).toEqual(frame);
 expect(frame).toMatchObject({streamLive:false,connection:'offline'});
 expect(frame.windows.filter(w=>w.present)).toEqual([{slot:2,present:true,publicName:'Alice is still here',since:2_000,look:starterCitizenLook(alice)}]);
 expect(presenceTick(state,60_000).credit).toBeNull();
 expect(windowFor(state,92_000).present).toBe(false);
 const stale=projectPresence(state,bindings,60_000+STREAM_LEASE_MS,3);
 expect(stale).toMatchObject({connection:'stale',streamLive:false});
 expect(stale.windows.every(w=>!w.present)).toBe(true);
});
