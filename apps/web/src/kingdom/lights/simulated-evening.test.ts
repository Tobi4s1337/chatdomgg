import { describe, expect, it, vi } from 'vitest';
import { KingdomPresenceFrameSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { createCitizenMotion, generateSettlementPlan } from '@chatdom/world';
import { createSimulatedEvening } from '.';

const plan = generateSettlementPlan({ seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 });
const firstSlot = plan.homes.find(home => home.quarterYear === 2026 && home.position[0] > 0)!.slot;
const presentSlots = (frame: KingdomPresenceFrame): number[] => frame.windows.filter(window => window.present).map(window => window.slot);

describe('SIMULATED evening already under way', () => {
  it('opens settled through the reducer and motion, keeps arriving and leaving, seeks back and replays the wave', () => {
    const evening = createSimulatedEvening(plan, { firstSlot });
    const frames: KingdomPresenceFrame[] = [];
    evening.feed.subscribe(frame => frames.push(frame), vi.fn());
    const motion = createCitizenMotion(plan);
    const accept = (): KingdomPresenceFrame => {
      const frame = frames.at(-1)!;
      expect(KingdomPresenceFrameSchema.safeParse(frame).success).toBe(true);
      expect(frame).toMatchObject({ origin: 'simulated', streamLive: true, connection: 'fresh' });
      motion.applyFrame(frame);
      return frame;
    };
    expect(evening.feed.label).toBe('SIMULATED');

    // Open: 80-90% of homes already present for 3-45 minutes, the first one named, lit only by walking home.
    const open = accept();
    const settled = presentSlots(open);
    expect(open.asOf).toBe(evening.epochMs);
    expect(settled.length / plan.homes.length).toBeGreaterThanOrEqual(.8);
    expect(settled.length / plan.homes.length).toBeLessThanOrEqual(.9);
    expect(open.windows.find(window => window.slot === firstSlot)).toMatchObject({ present: true, publicName: 'Juniper' });
    for (const window of open.windows.filter(window => window.present)) {
      expect(evening.epochMs - window.since).toBeGreaterThanOrEqual(3 * 60_000);
      expect(evening.epochMs - window.since).toBeLessThanOrEqual(45 * 60_000);
    }
    const named = open.windows.filter(window => window.publicName !== null).length;
    expect(named / settled.length).toBeGreaterThan(.25);
    expect(named / settled.length).toBeLessThan(.42);
    const atOpen = motion.sample(evening.epochMs);
    expect(atOpen.filter(sample => sample.homeLit).map(sample => sample.slot).sort((a, b) => a - b)).toEqual(settled);
    expect(evening.completeAt).toBe(0);

    // Through the evening: witnessed arrivals walk home and light late; departures leave on the street.
    const arrivals: { slot: number; at: number }[] = [];
    const departures: { slot: number; at: number }[] = [];
    const recorded = new Map<number, number[]>();
    let previous = new Set(settled);
    for (let second = 1; second <= 900; second++) {
      evening.advance(second);
      const frame = accept();
      const now = new Set(presentSlots(frame));
      for (const slot of now) if (!previous.has(slot)) arrivals.push({ slot, at: second });
      for (const slot of previous) if (!now.has(slot)) departures.push({ slot, at: second });
      if (second % 150 === 0) recorded.set(second, [...now].sort((a, b) => a - b));
      previous = now;
      const samples = motion.sample(evening.epochMs + second * 1000);
      for (const arrival of arrivals.filter(entry => entry.at === second)) {
        const since = frame.windows.find(window => window.slot === arrival.slot)!.since - evening.epochMs;
        expect(since).toBeGreaterThan((second - 1) * 1000);
        expect(since).toBeLessThanOrEqual(second * 1000);
        expect(samples.find(sample => sample.slot === arrival.slot)).toMatchObject({ state: 'walking', homeLit: false });
      }
      for (const departure of departures.filter(entry => entry.at === second)) {
        expect(samples.find(sample => sample.slot === departure.slot)).toMatchObject({ state: 'leaving', homeLit: false });
      }
      expect(now.size / plan.homes.length).toBeGreaterThanOrEqual(.8);
      expect(now.size / plan.homes.length).toBeLessThanOrEqual(.9);
    }
    expect(arrivals[0]!.at).toBeLessThanOrEqual(12);
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i]!.at - arrivals[i - 1]!.at).toBeGreaterThanOrEqual(20);
    expect(arrivals.length).toBeGreaterThanOrEqual(12);
    for (let i = 1; i < departures.length; i++) {
      expect(departures[i]!.at - departures[i - 1]!.at).toBeGreaterThanOrEqual(45);
      expect(departures[i]!.at - departures[i - 1]!.at).toBeLessThanOrEqual(90);
    }
    expect(departures.length).toBeGreaterThanOrEqual(9);
    expect(departures.some(departure => departure.slot === firstSlot)).toBe(false);
    const late = arrivals.find(arrival => arrival.at < 860)!;
    expect(motion.sample(evening.epochMs + 900_000).find(sample => sample.slot === late.slot)).toMatchObject({ state: 'home', homeLit: true });
    // Leave and rejoin: someone who walked out comes back later as a new stay.
    const rejoin = departures.find(departure => arrivals.some(arrival => arrival.slot === departure.slot && arrival.at > departure.at));
    expect(rejoin).toBeDefined();

    // Reverse seeks settle to the same recorded presence; sequence order never goes backwards.
    evening.advance(150);
    expect(presentSlots(frames.at(-1)!)).toEqual(recorded.get(150));
    evening.advance(0);
    expect(frames.at(-1)!.windows).toEqual(open.windows);
    evening.advance(450);
    expect(presentSlots(frames.at(-1)!)).toEqual(recorded.get(450));
    const twin = createSimulatedEvening(plan, { firstSlot });
    let twinFrame: KingdomPresenceFrame | undefined;
    twin.feed.subscribe(frame => { twinFrame = frame; }, vi.fn());
    twin.advance(450);
    expect(twinFrame!.windows).toEqual(frames.at(-1)!.windows);

    // Explicit replay: a new epoch clears the crowd, then dark -> one named window -> the whole town.
    evening.replayArrival();
    const dark = accept();
    expect(dark.epoch).not.toBe(open.epoch);
    expect(dark.asOf).toBe(evening.epochMs);
    expect(presentSlots(dark)).toEqual([]);
    expect(motion.sample(evening.epochMs)).toEqual([]);
    evening.advance(1);
    expect(accept().windows.filter(window => window.present)).toEqual([
      { slot: firstSlot, present: true, publicName: 'Juniper', since: evening.epochMs + 1000 },
    ]);
    expect(evening.completeAt).toBeLessThanOrEqual(8);
    evening.advance(evening.completeAt);
    expect(presentSlots(accept())).toHaveLength(plan.homes.length);
    evening.replayArrival();
    expect(frames.at(-1)!.epoch).not.toBe(dark.epoch);

    // reset() returns to the evening.
    evening.reset();
    const again = accept();
    expect(again.windows).toEqual(open.windows);
    expect(again.epoch).toBe(open.epoch);
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.sequence).toBeGreaterThan(frames[i - 1]!.sequence);
    expect(frames.every(frame => frame.origin === 'simulated')).toBe(true);
  });

  it('refuses unknown first slots and unbounded seeks without publishing', () => {
    expect(() => createSimulatedEvening(plan, { firstSlot: 65534 })).toThrow();
    expect(() => createSimulatedEvening({ ...plan, homes: [] }, { firstSlot })).toThrow();
    const evening = createSimulatedEvening(plan, { firstSlot });
    const receive = vi.fn();
    evening.feed.subscribe(receive, vi.fn());
    for (const at of [-1, Infinity, Number.NaN, 1_000_000_000]) expect(() => evening.advance(at)).toThrow();
    expect(receive).toHaveBeenCalledOnce();
  });

  it('keeps a hamlet honest: most homes warm, the first named, and nobody invented beyond its homes', () => {
    const hamlet = generateSettlementPlan({ seed: 'willowmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const evening = createSimulatedEvening(hamlet, { firstSlot: hamlet.homes[0]!.slot });
    let frame: KingdomPresenceFrame | undefined;
    evening.feed.subscribe(next => { frame = next; }, vi.fn());
    expect(frame!.windows).toHaveLength(hamlet.homes.length);
    const share = presentSlots(frame!).length / hamlet.homes.length;
    expect(share).toBeGreaterThanOrEqual(.8);
    expect(share).toBeLessThanOrEqual(.9);
  });
});
