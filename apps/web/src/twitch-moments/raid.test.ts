import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { shieldDesign } from '../atlas/heraldry/design';
import type { CameraPose } from './contracts';
import { createTwitchMoments, type MomentFrame } from './controller';
import { bannerRuns, raiderArms, adornmentsOf } from './raid-art';
import { RAID_BEAT, RAID_DETAIL, RAID_LIMITS, gatePose, raidLine, raidUnits, raidScaleProfile, wagonElapsed, wagonPose } from './raid-beat';
import { createTwitchMomentView, type CameraLease, type GiftRoute, type MomentViewHost, type PlaceAnchor } from './view';

const KINGDOM = KingdomIdSchema.parse('424242');
const RAIDER = KingdomIdSchema.parse('31337');
const START = Date.UTC(2026, 9, 30, 19, 30);

let seq = 0;
function raid(at: number, options: { viewers?: number; raidKey?: string; origin?: 'live' | 'simulated' | 'recovered'; name?: string; founded?: boolean;
  displayUntil?: number; seq?: number } = {}) {
  const n = options.seq ?? ++seq;
  return {
    version: 1, kingdomId: KINGDOM, seq: n, occurredAt: at, receivedAt: at, committedAt: at, origin: options.origin ?? 'simulated', type: 'twitch.moment',
    actor: null, cause: { kind: 'external', source: 'twitch', id: `raid-${n}` },
    body: { kind: 'raid', key: `raid.${options.raidKey ?? `r${n}`}`, displayUntil: options.displayUntil ?? at + 60_000, raidKey: options.raidKey ?? `r${n}`,
      from: { kingdomId: RAIDER, displayName: options.name ?? 'Mossbrook', crestKey: null }, viewers: options.viewers ?? 140, founded: options.founded ?? false },
  };
}

function controller(origin: 'live' | 'simulated' = 'simulated', current: unknown[] = [], throughSeq = 0) {
  let now = START;
  const moments = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: origin, clock: { now: () => now } });
  expect(moments.reset({ epoch: 'e1', asOf: now, throughSeq, current })).toEqual({ accepted: true });
  return { moments, at: (ms: number) => { now = ms; }, now: () => now };
}

describe('Incoming raid: the gate wakes and a caravan rolls in', () => {
  it('sizes the caravan on a log curve without airing a viewer count', () => {
    expect([1, 3, 10, 50, 140, 1000, 10_000, 10_000_000].map(raidUnits)).toEqual([1, 1, 2, 3, 4, 6, 9, 12]);
    for (let v = 1; v < 200_000; v = Math.ceil(v * 1.3)) expect(raidUnits(v + 1)).toBeGreaterThanOrEqual(raidUnits(v));
    expect(raidLine(1)).toBe('Colours from the road');
    expect(raidLine(140)).toBe('Colours from the road');
    expect(raidLine(10_000)).toBe('Lanterns fill the road');
  });

  it('admits a raid once, captions it at the gate, takes the shot and lets it go', () => {
    const { moments, at } = controller();
    expect(moments.receiveFact('e1', raid(START, { viewers: 140, raidKey: 'alpha' }))).toEqual({ accepted: true });
    expect(moments.metrics().admitted).toBe(1);

    const early = moments.sample(START + 1000);
    expect(early.label).toBe('SIMULATED');
    expect(early.raids).toHaveLength(1);
    expect(early.raids[0]).toMatchObject({ key: 'alpha', viewers: 140, units: 4, founded: false, from: { kingdomId: RAIDER, name: 'Mossbrook' } });
    expect(early.focus).toMatchObject({ subject: { kind: 'place', place: 'gate' }, cut: true, wide: true });
    expect(early.captions).toEqual([]);

    const titled = moments.sample(START + 6000);
    expect(titled.captions).toEqual([expect.objectContaining({ at: { kind: 'place', place: 'gate' }, title: 'Mossbrook rides in', line: 'Colours from the road',
      detail: RAID_DETAIL, opacity: 1 })]);
    expect(titled.stage).toMatchObject({ subject: { kind: 'place', place: 'gate' } });
    const cues = titled.audio.map(c => c.cue);
    expect(cues.filter(c => c === 'cart-roll')).toHaveLength(4);
    expect(cues).toEqual(expect.arrayContaining(['horn', 'cloth-unfurl']));
    expect(cues).not.toContain('festival-drum');

    // The shot holds until the column is through the gate, then the wagons ride on without it.
    const timing = raidScaleProfile(140);
    const hold = RAID_BEAT.arrive + 3 * timing.pitch + timing.pass + RAID_BEAT.holdAfter;
    expect(moments.sample(START + hold - 10).focus).not.toBeNull();
    const after = moments.sample(START + hold + 1500);
    expect(after.focus).toBeNull();
    expect(after.captions).toEqual([]);
    expect(after.raids).toHaveLength(1);
    // And at the end of the road nothing of it remains.
    const gone = START + RAID_BEAT.arrive + 3 * timing.pitch + timing.travel + 500;
    expect(moments.sample(gone).raids).toEqual([]);
    at(gone);
    expect(moments.currentFacts()).toEqual([]);
  });

  it('ignores a replayed sequence and a second fact for the same raid', () => {
    const { moments } = controller();
    const fact = raid(START, { raidKey: 'alpha', seq: 5 });
    expect(moments.receiveFact('e1', fact)).toEqual({ accepted: true });
    expect(moments.receiveFact('e1', fact)).toEqual({ accepted: false, reason: 'replay' });
    expect(moments.receiveFact('e1', raid(START + 200, { raidKey: 'alpha', seq: 6 }))).toEqual({ accepted: true });
    expect(moments.metrics()).toMatchObject({ admitted: 1, suppressed: { coalesced: 1 }, rejected: { replay: 1 } });
    expect(moments.sample(START + 5000).raids).toHaveLength(1);
  });

  it('restores silently: a raid in a reset snapshot or recovered is never welcomed again', () => {
    const { moments } = controller('simulated', [raid(START - 2000, { seq: 3, raidKey: 'old' })], 3);
    expect(moments.currentFacts()).toEqual([]);
    expect(moments.sample(START + 4000).raids).toEqual([]);
    expect(moments.receiveFact('e1', raid(START, { seq: 4, origin: 'recovered', raidKey: 'later' }))).toEqual({ accepted: true });
    expect(moments.metrics().suppressed.recovered).toBe(1);
    const frame = moments.sample(START + 4000);
    expect(frame.raids).toEqual([]);
    expect(frame.audio).toEqual([]);
    expect(frame.focus).toBeNull();
  });

  it('keeps origins apart and labels the simulated', () => {
    const simulated = controller('simulated');
    expect(simulated.moments.receiveFact('e1', raid(START, { origin: 'live' }))).toEqual({ accepted: false, reason: 'origin' });
    const live = controller('live');
    expect(live.moments.receiveFact('e1', raid(START, { origin: 'simulated' }))).toEqual({ accepted: false, reason: 'origin' });
    expect(live.moments.receiveFact('e1', raid(START, { origin: 'live' }))).toEqual({ accepted: true });
    const frame = live.moments.sample(START + 3000);
    expect(frame.label).toBe('LIVE');
    expect(frame.raids).toHaveLength(1);
  });

  it('does not play a raid past its display window', () => {
    const { moments, at } = controller();
    at(START + 61_000);
    expect(moments.receiveFact('e1', raid(START))).toEqual({ accepted: true });
    expect(moments.metrics().suppressed.expired).toBe(1);
    expect(moments.sample(START + 62_000).raids).toEqual([]);
  });

  it('queues a second raid behind the first gate and never fills the road', () => {
    const { moments, at } = controller();
    moments.receiveFact('e1', raid(START, { viewers: 3, raidKey: 'one', name: 'Wrenfield' }));
    at(START + 2000);
    moments.receiveFact('e1', raid(START + 2000, { viewers: 10_000, raidKey: 'two', name: 'Highmoor' }));
    const first = moments.sample(START + 5000);
    expect(first.raids.map(r => r.key)).toEqual(['one']);
    expect(first.raids[0]!.units).toBe(1);
    expect(first.captions[0]).toMatchObject({ title: 'Wrenfield rides in', line: 'Colours from the road' });
    // The second wakes the gate only after the first gate has gone to sleep.
    const sleepGone = RAID_BEAT.minHold + RAID_BEAT.sleep + RAID_BEAT.sleepFade;
    expect(moments.sample(START + sleepGone - 50).raids.map(r => r.key)).toEqual(['one']);
    const both = moments.sample(START + sleepGone + 6000);
    expect(both.raids.map(r => r.key)).toEqual(['one', 'two']);
    expect(both.raids[1]!.units).toBe(9);
    expect(both.captions[0]).toMatchObject({ title: 'Highmoor rides in', line: 'Lanterns fill the road' });
    expect(both.audio.map(c => c.cue)).toContain('festival-drum');
    expect(both.raids.length).toBeLessThanOrEqual(RAID_LIMITS.caravans);
  });

  it('lets a gift cart wait until the caravan is off the road', () => {
    const { moments } = controller();
    moments.receiveFact('e1', raid(START, { viewers: 3 }));
    const fact = { version: 1, kingdomId: KINGDOM, seq: 999, occurredAt: START, receivedAt: START, committedAt: START, origin: 'simulated', type: 'twitch.moment',
      actor: null, cause: { kind: 'external', source: 'twitch', id: 'gift-1' },
      body: { kind: 'gifts', key: 'gifts.g1', displayUntil: START + 60_000, groupKey: 'g1', giver: null, tier: '1', total: 5, recipients: [], forwardedFrom: null } };
    expect(moments.receiveFact('e1', fact)).toEqual({ accepted: true });
    const roadEnd = START + RAID_BEAT.arrive + RAID_BEAT.travel;
    expect(moments.sample(START + 20_000).carts).toEqual([]);
    expect(moments.sample(roadEnd - 1000).carts).toEqual([]);
    expect(moments.sample(roadEnd + 1500).carts).toHaveLength(1);
  });

  it('wakes the gate in order: gather, flare, hoist, unfurl, sleep', () => {
    const sleep = 20_000;
    expect(gatePose(0, sleep).presence).toBe(0);
    expect(gatePose(RAID_BEAT.gather, sleep).presence).toBe(1);
    expect(gatePose(RAID_BEAT.flame.flare, sleep).flame).toBeCloseTo(1.55);
    expect(gatePose(RAID_BEAT.flame.steady + 10, sleep).flame).toBeCloseTo(1);
    expect(gatePose(RAID_BEAT.hoist[0], sleep).hoist).toBe(0);
    expect(gatePose(RAID_BEAT.unfurl[0], sleep)).toMatchObject({ hoist: 1, unfurl: 0 });
    expect(gatePose(RAID_BEAT.unfurl[1], sleep).unfurl).toBe(1);
    expect(gatePose(sleep + RAID_BEAT.sleepFade, sleep)).toMatchObject({ presence: 0, flame: 0 });
  });

  it('rolls each wagon the whole road and fades it at either end', () => {
    expect(wagonElapsed({ t: RAID_BEAT.arrive - 1 }, 0)).toBeNull();
    expect(wagonElapsed({ t: RAID_BEAT.arrive + RAID_BEAT.pitch + 10 }, 1)).toBe(10);
    expect(wagonElapsed({ t: RAID_BEAT.arrive + RAID_BEAT.travel }, 0)).toBeNull();
    const length = 110;
    expect(wagonPose(0, length).presence).toBe(0);
    const mid = wagonPose(RAID_BEAT.travel / 2, length);
    expect(mid.presence).toBe(1);
    expect(mid.distance).toBeGreaterThan(40);
    const end = wagonPose(RAID_BEAT.travel - 1, length);
    expect(end.distance).toBeGreaterThan(length - 4);
    expect(end.presence).toBeLessThan(0.05);
  });

  it('weaves the raider\'s own arms into cloth, in its two tinctures only', () => {
    const arms = raiderArms(RAIDER)!;
    const design = shieldDesign(RAIDER);
    expect(arms.design).toEqual(design);
    const runs = bannerRuns(design, { width: 13, rows: 22, tail: 3, charges: true });
    expect(runs).toHaveLength(22);
    const tinctures = new Set(runs.flat().map(r => r.tincture));
    expect([...tinctures].every(t => t === arms.colour || t === arms.metal)).toBe(true);
    // Every body row covers the full width without gaps; the swallowtail rows leave a notch in the middle.
    for (const row of runs.slice(0, 19)) {
      expect(row[0]!.x0).toBe(0);
      expect(row.at(-1)!.x1).toBe(13);
      row.slice(1).forEach((run, i) => expect(run.x0).toBe(row[i]!.x1));
    }
    const last = runs.at(-1)!;
    expect(last.reduce((n, r) => n + r.x1 - r.x0, 0)).toBeLessThan(13);
    expect(raiderArms('not-a-channel')).toBeNull();
  });

  it('fits wagons with lanterns and cloth and nobody riding', () => {
    expect(adornmentsOf('covered', 7, 1)).toEqual([]);
    expect(adornmentsOf('lead', 7, 0).length).toBeGreaterThan(0);
    for (let seed = 0; seed < 20; seed++) expect(adornmentsOf('lantern', seed, 2).map(seat => seat.kind)).toEqual(['lantern-rack', 'lantern-rack']);
  });
});

/** A view host with a real gate and road, and recording ports. */
function viewHost() {
  const parent = new THREE.Group(), played: string[] = [], writes: CameraPose[] = [];
  const prior: CameraPose = { eye: [0, 30, 60], target: [0, 0, 0], fov: 52 };
  let current = prior;
  const host: MomentViewHost = {
    parent, material: new THREE.MeshBasicMaterial(), kit: 'hearth',
    mesh: async () => new THREE.BoxGeometry(0.125, 0.125, 0.125),
    homeAnchor: () => null,
    sound: { play(cue) { played.push(cue); return () => {}; } },
    camera: { acquire(): CameraLease { let open = true;
      return { read: () => current, write: pose => { if (!open) return false; current = pose; writes.push(pose); return true; }, release: () => { open = false; } }; } },
    viewport: () => ({ width: 1920, height: 1080 }),
    placeAnchor: (place: 'market' | 'gate'): PlaceAnchor => (place === 'market' ? { position: [20, 0, 20], facing: [0, 0, -1] } : { position: [-30, 0, 20], facing: [1, 0, 0] }),
    giftRoute: (): GiftRoute => ({ inbound: [[-30, 0, 20], [0, 0, 20], [20, 0, 20]], outbound: [[20, 0, 20], [20, 0, 50]] }),
  };
  return { host, parent, played, writes, camera: () => current, prior };
}

describe('Incoming raid in the view', () => {
  it('raises the gate, rolls the caravan, frames it and cleans up', async () => {
    const { moments } = controller();
    moments.receiveFact('e1', raid(START, { viewers: 1000 }));
    const { host, parent, played, writes, camera, prior } = viewHost();
    const view = createTwitchMomentView(host);
    await view.prepare();
    const frameAt = (ms: number): MomentFrame => { const f = moments.sample(ms); view.apply(f); return f; };

    frameAt(START + 500);
    expect(view.stats()).toMatchObject({ 'raid.caravans': 1, 'raid.gate': 1, 'raid.wagons': 0, leased: true });
    // Played at the frame rate, every cue sounds once near its time.
    for (let t = 600; t <= 3000; t += 100) frameAt(START + t);
    expect(view.stats()['raid.lights']).toBeGreaterThan(4);
    const timing = raidScaleProfile(1000);
    for (let t = 3100; t < RAID_BEAT.arrive + 4 * timing.pitch; t += 100) frameAt(START + t);
    const mid = frameAt(START + RAID_BEAT.arrive + 4 * timing.pitch);
    expect(view.stats()['raid.wagons']).toBeGreaterThanOrEqual(4);
    expect(view.stats()['raid.instances'] as number).toBeGreaterThan(50);
    expect(played).toEqual(expect.arrayContaining(['horn', 'cloth-unfurl', 'cart-roll', 'festival-drum']));
    expect(played.filter(c => c === 'horn')).toHaveLength(1);

    // The shot stands outside the gate, looking down its real road into the town.
    const shot = writes.at(-1)!;
    expect(shot.eye[0]).toBeLessThan(-30);
    expect(shot.eye[1]).toBeGreaterThan(3);
    expect(shot.target[0]).toBeGreaterThan(shot.eye[0]);
    const eye = new THREE.PerspectiveCamera(shot.fov, 1920 / 1080, 0.5, 400);
    eye.position.set(...shot.eye); eye.lookAt(...shot.target); eye.updateMatrixWorld(); eye.updateProjectionMatrix();
    const labels = view.labels(eye);
    expect(labels).toEqual([expect.objectContaining({ title: 'Mossbrook rides in', line: 'Colours from the road' })]);
    expect(labels[0]!.y).toBeGreaterThan(0);
    expect(mid.raids[0]!.units).toBe(6);

    // After the hold the camera goes home; the gate sleeps; at the end of the road the layer is empty.
    const hold = RAID_BEAT.arrive + 5 * timing.pitch + timing.pass + RAID_BEAT.holdAfter;
    frameAt(START + hold + 2000);
    expect(view.stats().leased).toBe(false);
    expect(camera()).toEqual(prior);
    frameAt(START + hold + RAID_BEAT.sleep + RAID_BEAT.sleepFade + 100);
    expect(view.stats()['raid.gate']).toBe(0);
    frameAt(START + RAID_BEAT.arrive + 5 * timing.pitch + timing.travel + 400);
    expect(view.stats()).toMatchObject({ 'raid.caravans': 0, 'raid.wagons': 0, 'raid.instances': 0, 'raid.lights': 0 });

    view.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
