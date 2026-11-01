import { expect, it } from 'vitest';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { createCitizenMotion, generateSettlementPlan } from '@chatdom/world';
import { createArrivalDirector } from './arrival-director';

it('frames one witnessed arrival through its real window, ignores heartbeats and bounds actual offline chat across source loss', () => {
  const at = 100_000, kingdomId = KingdomIdSchema.parse('129634568');
  const plan = generateSettlementPlan({ seed: 'arrival-attention', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const slot = plan.homes[0]!.slot, otherSlot = plan.homes[1]!.slot;
  const motion = createCitizenMotion(plan, { entryDistance: 12, speed: 1.2 });
  const director = createArrivalDirector();
  let frame: KingdomPresenceFrame = { version: 1, kingdomId, epoch: 'presence-one', origin: 'live', sequence: 1, asOf: at,
    streamLive: true, connection: 'fresh', windows: [{ slot, present: true, publicName: 'Juniper', since: at - 60_000 }] };
  const observe = (next: KingdomPresenceFrame, nowMs = next.asOf) => { frame = next; motion.applyFrame(next); director.observe(next, nowMs); };
  const sample = (nowMs: number) => director.sample(nowMs, selected => motion.sample(nowMs).find(person => person.slot === selected));

  observe(frame);
  expect(sample(at)).toBeUndefined(); // Opening a stream does not replay historical arrivals.
  const since = at + 1_000;
  observe({ ...frame, sequence: 2, asOf: since, windows: [{ slot, present: true, publicName: 'Juniper', since }] });
  expect(sample(since + 1_000)).toBeUndefined(); // The window wave owns the wide view first.
  expect(sample(since + 8_000)).toMatchObject({ slot, phase: 'walking', subject: { homeLit: false } });
  observe({ ...frame, sequence: 3, asOf: since + 2_000, windows: [...frame.windows,
    { slot: otherSlot, present: true, publicName: null, since: since + 2_000 }] });
  director.chat(otherSlot, since + 2_000);
  expect(sample(since + 8_001)?.slot).toBe(slot); // A busy shot neither hops nor queues.
  const home = motion.sample(since + 35_000).find(person => person.slot === slot)!;
  expect(home.homeLit).toBe(true);
  const litAt = home.homeLitAtMs!;
  expect(sample(litAt - 1)?.phase).toBe('walking');
  expect(sample(litAt + 1)?.phase).toBe('window');
  observe({ ...frame, sequence: 4, asOf: Math.ceil(litAt + 1_000) });
  director.chat(slot, litAt + 2_000);
  expect(sample(litAt + 5_999)?.phase).toBe('window');
  expect(sample(litAt + 6_000)).toBeUndefined();
  observe({ ...frame, sequence: 5, asOf: Math.ceil(litAt + 6_001) });
  expect(sample(frame.asOf)).toBeUndefined();

  const offlineAt = since + 60_000;
  observe({ ...frame, sequence: 6, asOf: offlineAt, streamLive: false, connection: 'offline' });
  director.chat(slot, offlineAt);
  expect(sample(offlineAt)?.phase).toBe('window'); // An offline broadcast can still have witnessed chat.
  director.chat(slot, offlineAt + 5_000);
  expect(sample(offlineAt + 6_000)).toBeUndefined();
  director.chat(slot, offlineAt + 7_000);
  observe({ ...frame, epoch: 'presence-two', sequence: 1, asOf: offlineAt + 8_000 });
  expect(sample(frame.asOf)).toBeUndefined(); // No inherited attention across the producer boundary.
  director.chat(slot, frame.asOf);
  expect(sample(frame.asOf)?.slot).toBe(slot);
  director.observe({ ...frame, sequence: 0, windows: [] }, frame.asOf);
  expect(sample(frame.asOf)?.slot).toBe(slot); // An old frame cannot revoke the accepted baseline.
  observe({ ...frame, sequence: 2, asOf: offlineAt + 9_000, connection: 'stale', windows: [] });
  director.chat(slot, frame.asOf);
  expect(sample(frame.asOf)).toBeUndefined();
  director.clear();
  director.chat(slot, frame.asOf);
  expect(sample(frame.asOf)).toBeUndefined();

  const returnedAt = offlineAt + 10_000;
  observe({ ...frame, sequence: 3, asOf: returnedAt, streamLive: true, connection: 'fresh',
    windows: [{ slot, present: true, publicName: 'Juniper', since: returnedAt }] });
  expect(sample(returnedAt)).toBeUndefined();
  expect(sample(returnedAt + 8_000)?.phase).toBe('walking');
  director.cancel();
  observe({ ...frame, sequence: 4, asOf: returnedAt + 1 });
  expect(sample(returnedAt + 1)).toBeUndefined();
  director.chat(slot, returnedAt + 2);
  expect(director.sample(returnedAt + 2, () => undefined)).toBeUndefined();
  director.chat(slot, returnedAt + 3);
  const walking = motion.sample(returnedAt + 1_000).find(person => person.slot === slot)!;
  expect(director.sample(returnedAt + 40_003, () => walking)).toBeUndefined(); // Even a stalled walk has a hard end.
});
