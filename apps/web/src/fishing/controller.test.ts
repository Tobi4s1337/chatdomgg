import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FishingPierSite } from '@chatdom/shared';
import { createFishingController, type FishingEvent } from './controller';
import { fishingLink } from './link';
import { createStagedPier } from './staged';

const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] };
const lip = () => ({ position: [0, 1, 23.4] as [number, number, number], yaw: 0, grounded: true, collisionRevision: 7 });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }); vi.setSystemTime(Date.UTC(2026, 10, 2, 18, 30)); });
afterEach(() => { vi.useRealTimers(); });

async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
async function advance(ms: number) { for (let left = ms; left > 0; left -= 50) { vi.advanceTimersByTime(Math.min(50, left)); await settle(); } }

function pier(pose = lip, seeds = [7]) {
  let walkerPose: ReturnType<typeof lip> | null = pose();
  const staged = createStagedPier({ kingdomId: '200', site, rack: [0, 1, 1], revision: 7, sample: () => ({ waterY: 0, groundY: -2 }),
    where: 'Willowmere pier', seeds, clock: () => Date.now(),
    people: [{ personId: '100', walkerId: 'juniper-seat', name: 'Juniper', pose: () => walkerPose },
      { personId: '101', walkerId: 'saoirse-seat', name: 'saoirse_k', pose: () => ({ ...lip(), position: [2, 1, 23.4] as [number, number, number] }) }] });
  const own = createFishingController({ link: fishingLink(staged.room('100')), selfWalkerId: 'juniper-seat', now: () => Date.now() });
  const watcher = createFishingController({ link: fishingLink(staged.room('101')), selfWalkerId: 'saoirse-seat', now: () => Date.now() });
  const events: FishingEvent[] = [], seen: FishingEvent[] = [];
  own.subscribe(event => events.push(event)); watcher.subscribe(event => seen.push(event));
  return { staged, own, watcher, events, seen, move(next: ReturnType<typeof lip> | null) { walkerPose = next; } };
}

/** A fair player: reel while the fish rests, ease off when it runs or the line strains. */
async function fight(controller: ReturnType<typeof createFishingController>) {
  for (let step = 0; step < 900 && controller.state().cast?.phase === 'fighting'; step++) {
    const view = controller.state().cast?.fight;
    if (view && (view.phase === 'run' || view.tension > 6500)) controller.release(); else controller.press();
    await advance(50);
  }
}

it('takes a rod, casts, strikes on the dip, reels in and keeps the fish through the real room channel', async () => {
  const p = pier();
  p.own.sync(); p.watcher.sync(); await settle();
  expect(p.own.state()).toMatchObject({ ready: true, rod: null, site: { id: 'pier:lake' } });
  expect(p.own.hint({ lip: true, nearRack: true, onPier: true, touch: false })).toEqual({ label: 'Take a willow rod', key: 'E' });
  p.own.take(); await settle();
  expect(p.own.state().rod).toMatchObject({ defId: 'tool:rod.willow', place: 'hotbar', storied: true });
  expect(p.watcher.state().rods.has('juniper-seat')).toBe(true);

  p.own.press(); await settle();
  expect(p.own.state()).toMatchObject({ input: 'drawing', cast: { phase: 'drawing' } });
  await advance(700); p.own.release(); await settle();
  expect(p.own.state().cast?.phase).toBe('flying');
  await advance(800);
  expect(p.own.state().cast?.phase).toBe('waiting');
  expect(p.events.some(event => event.kind === 'float' && event.self)).toBe(true);
  for (let i = 0; i < 300 && p.own.state().cast?.phase === 'waiting'; i++) await advance(50);
  expect(p.own.state().cast?.phase).toBe('bite');
  expect(p.own.hint({ lip: true, nearRack: false, onPier: true, touch: true })).toEqual({ label: 'Strike!', key: 'Tap', urgent: true });
  p.own.press(); await advance(100);
  expect(p.own.state().cast?.phase).toBe('fighting');
  await fight(p.own);
  for (let i = 0; i < 40 && !p.events.some(event => event.kind === 'kept'); i++) await advance(50);
  const kept = p.events.find(event => event.kind === 'kept');
  expect(kept).toMatchObject({ kind: 'kept', personalFirst: true, kingdomFirst: true, item: { place: 'bag', story: { where: 'Willowmere pier' } } });
  expect(p.own.state()).toMatchObject({ cast: null, input: 'idle', pendingCastId: null });
  expect(p.staged.records().filter(record => record.defId.startsWith('fish:'))).toHaveLength(1);
  // The other walker saw the line out, the bite and the catch, and nothing private.
  expect(p.seen.some(event => event.kind === 'bite' && !event.self)).toBe(true);
  const caught = p.seen.find(event => event.kind === 'caught');
  expect(caught).toMatchObject({ walkerId: 'juniper-seat', self: false, kingdomFirst: true });
  expect(JSON.stringify(p.watcher.state())).not.toContain('Juniper');
  p.own.dispose(); p.watcher.dispose(); p.staged.dispose();
});

it('misses honestly when the strike comes before the dip, and reels in when the walker walks away', async () => {
  const p = pier();
  p.own.sync(); await settle(); p.own.take(); await settle();
  p.own.press(); await advance(600); p.own.release(); await advance(900);
  expect(p.own.state().cast?.phase).toBe('waiting');
  p.own.press(); await settle();
  expect(p.own.state().cast).toBeNull();
  expect(p.events.some(event => event.kind === 'note' && event.message === 'Wait for the float to dip.')).toBe(true);

  p.own.release(); p.own.press(); await advance(600); p.own.release(); await advance(900);
  expect(p.own.state().cast?.phase).toBe('waiting');
  p.move({ ...lip(), position: [0, 1, 18] });
  await advance(200);
  expect(p.own.state().cast).toBeNull();
  expect(p.staged.views()).toEqual([]);
  p.own.dispose(); p.watcher.dispose(); p.staged.dispose();
});

it('holds a quick tap until the server can accept a real cast', async () => {
  const p = pier();
  p.own.sync(); await settle(); p.own.take(); await settle();
  p.own.press(); p.own.release(); await settle();
  expect(p.own.state().cast?.phase).toBe('drawing');
  await advance(300);
  expect(p.own.state().cast?.phase).toBe('flying');
  p.own.dispose(); p.watcher.dispose(); p.staged.dispose();
});

it('takes a rod asked for before the first state answer has come back', async () => {
  const p = pier();
  const notes: string[] = []; p.own.subscribe(e => { if (e.kind === 'note') notes.push(e.message); });
  p.own.sync(); p.own.take(); await settle(); await settle(); await settle();
  expect(notes).toEqual([]);
  expect(p.own.state().rod).toMatchObject({ defId: 'tool:rod.willow' });
});

it("never tells an onlooker another person's identity, session, item or proof", async () => {
  const p = pier();
  const heard: unknown[] = [];
  p.staged.room('101').onMessage('fishing', message => { heard.push(message); });
  p.own.sync(); p.watcher.sync(); await settle();
  p.own.take(); await settle();
  p.own.press(); await advance(700); p.own.release(); await settle();
  for (let i = 0; i < 300 && p.own.state().cast?.phase !== 'bite'; i++) await advance(50);
  p.own.press(); await advance(100);
  await fight(p.own);
  for (let i = 0; i < 40 && !p.events.some(event => event.kind === 'kept'); i++) await advance(50);
  expect(p.events.some(event => event.kind === 'kept')).toBe(true);
  const types = new Set(heard.map(message => (message as { type: string }).type));
  expect(types.has('pier.casts') && types.has('pier.beats')).toBe(true);
  const text = JSON.stringify(heard);
  for (const secret of ['"personId"', '"ownerId"', '"sessionId"', '"itemId"', '"grantKey"', '"proof"', '"castSeed"', '"fightSeed"', '"inputs"', 'Juniper'])
    expect(text, secret).not.toContain(secret);
  p.own.dispose(); p.watcher.dispose(); p.staged.dispose();
});

it('sends one strike per cast: a second press on the dip reels and never throws the fish back', async () => {
  const p = pier();
  const room = p.staged.room('100'), sent: string[] = [];
  const counted = { onMessage: room.onMessage.bind(room), send(type: string, payload: unknown) { sent.push((payload as { type: string }).type); room.send(type, payload); } };
  p.own.dispose();
  const own = createFishingController({ link: fishingLink(counted), selfWalkerId: 'juniper-seat', now: () => Date.now() });
  const events: FishingEvent[] = []; own.subscribe(event => events.push(event));
  own.sync(); await settle(); own.take(); await settle();
  own.press(); await advance(700); own.release(); await settle();
  for (let i = 0; i < 300 && own.state().cast?.phase !== 'bite'; i++) await advance(50);
  expect(own.state().cast?.phase).toBe('bite');
  // A double click: the second press crosses the strike before its answer arrives.
  own.press(); own.release(); own.press(); await advance(100);
  own.press(); await advance(50);
  expect(sent.filter(type => type === 'pier.strike')).toHaveLength(1);
  expect(own.state().cast?.phase).toBe('fighting');
  expect(events.some(event => event.kind === 'ended')).toBe(false);
  await fight(own);
  for (let i = 0; i < 40 && !events.some(event => event.kind === 'kept'); i++) await advance(50);
  expect(events.some(event => event.kind === 'kept')).toBe(true);
  own.dispose(); p.watcher.dispose(); p.staged.dispose();
});
