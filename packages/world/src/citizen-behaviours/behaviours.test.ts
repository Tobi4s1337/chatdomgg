import { expect, it } from 'vitest';
import { createCitizenMotion } from '../citizens/motion';
import type { CitizenMotionSample } from '../citizens/types';
import { createNeighbourStreet, NEIGHBOUR_FIXTURE as F } from './fixture';
import { BEHAVIOUR_TUNING as T, createCitizenBehaviours, dueBehaviourSteps, type CitizenBehaviourStep, type CitizenEncounter, type CitizenOverlay } from './index';

interface Scenario {
  /** Render cadence of the caller; it must never change semantic transitions. */
  readonly renderMs: number;
  readonly untilMs: number;
  readonly departures?: ReadonlyMap<number, number>;
  /** Kingdom time from which a slot is under walker control. */
  readonly takeover?: { readonly slot: number; readonly atMs: number };
  /** Render frames at these kingdom times are skipped: the clock jumps across them. */
  readonly freeze?: { readonly fromMs: number; readonly toMs: number };
  readonly onStep?: (step: CitizenBehaviourStep, samples: readonly CitizenMotionSample[]) => void;
  readonly onRender?: (atMs: number, overlays: ReadonlyMap<number, CitizenOverlay>, samples: readonly CitizenMotionSample[]) => void;
}

const street = createNeighbourStreet();
const at = (seconds: number): number => F.startMs + seconds * 1000;
const flat = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

/** The caller loop: apply the public frame, sample actual motion, step policy, present at render time. */
function play(scenario: Scenario) {
  const motion = createCitizenMotion(street.plan), policy = createCitizenBehaviours();
  const started: CitizenEncounter[] = [];
  let last: number | null = null;
  for (let now = F.startMs; now <= scenario.untilMs; now += scenario.renderMs) {
    if (scenario.freeze && now > scenario.freeze.fromMs && now < scenario.freeze.toMs) continue;
    for (const stepMs of dueBehaviourSteps(last, now)) {
      last = stepMs;
      const frame = street.frameAt(stepMs, scenario.departures);
      if (frame) motion.applyFrame(frame);
      const samples = motion.sample(stepMs);
      const ambientSlots = new Set(street.slots.filter(slot => !(scenario.takeover && slot === scenario.takeover.slot && stepMs >= scenario.takeover.atMs)));
      const step = policy.step({ kingdomId: F.kingdomId, epoch: F.epoch, origin: F.origin, atMs: stepMs, samples, ambientSlots });
      // Every visible intention belongs to a present, non-departing person, one encounter each.
      const present = new Map(samples.filter(sample => sample.state !== 'leaving').map(sample => [sample.slot, sample]));
      const busy = step.encounters.flatMap(encounter => [encounter.greeter, encounter.recipient]);
      expect(new Set(busy).size).toBe(busy.length);
      for (const slot of busy) expect(present.has(slot)).toBe(true);
      for (const slot of step.overlays.keys()) { expect(present.has(slot)).toBe(true); expect(ambientSlots.has(slot)).toBe(true); }
      for (const encounter of step.started) {
        const greeter = present.get(encounter.greeter)!, recipient = present.get(encounter.recipient)!;
        // A settled person, or a walker at cruising pace who keeps walking; never a fading arrival.
        expect(greeter.goalReached && greeter.speed === 0 || greeter.state === 'walking' && greeter.speed >= T.greeting.walkingMinSpeed).toBe(true);
        expect(greeter.opacity).toBe(1); expect(recipient.opacity).toBe(1);
        const distance = flat(greeter.position, recipient.position);
        expect(distance).toBeGreaterThanOrEqual(T.greeting.minMetres);
        expect(distance).toBeLessThanOrEqual(greeter.state === 'walking' ? T.greeting.walkingMetres : T.greeting.noticeMetres);
        expect(encounter.poseAtMs - encounter.startMs).toBeGreaterThanOrEqual(T.greeting.lookLeadMs[0]);
        started.push(encounter);
      }
      scenario.onStep?.(step, samples);
    }
    const samples = motion.sample(now);
    scenario.onRender?.(now, policy.present(samples, now), samples);
  }
  return { started, policy, motion };
}

it('lets nine simulated neighbours notice one another through the actual motion adapter', () => {
  // The same story at three render cadences has identical semantic transitions.
  const baseline = play({ renderMs: 1000 / 60, untilMs: at(150) });
  for (const renderMs of [50, 250, 730]) expect(play({ renderMs, untilMs: at(150) }).started).toEqual(baseline.started);
  expect(baseline.started.length).toBeGreaterThan(0);
  // Greetings are rare, never a crowd-wide wave, and the same pair does not repeat inside the cooldown.
  expect(baseline.started.length).toBeLessThanOrEqual(street.slots.length);
  for (const [i, first] of baseline.started.entries()) for (const later of baseline.started.slice(i + 1)) {
    if (new Set([first.greeter, first.recipient, later.greeter, later.recipient]).size === 2) expect(later.startMs - first.startMs).toBeGreaterThanOrEqual(T.greeting.pairCooldownMs[0]);
  }

  // The first doorstep-street encounter: the head turns before the gesture, holds, and settles.
  const first = baseline.started[0]!;
  expect(first.glanceAtMs).not.toBeNull();
  const greeterTrack: { atMs: number; overlay: CitizenOverlay | undefined }[] = [], recipientTrack: typeof greeterTrack = [];
  play({ renderMs: 1000 / 60, untilMs: first.endMs + 500, onRender(atMs, overlays) {
    if (atMs < first.startMs - 200) return;
    greeterTrack.push({ atMs, overlay: overlays.get(first.greeter) }); recipientTrack.push({ atMs, overlay: overlays.get(first.recipient) });
  } });
  const lead = greeterTrack.filter(({ atMs }) => atMs > first.startMs + 120 && atMs < first.poseAtMs);
  expect(lead.length).toBeGreaterThan(3);
  expect(lead.every(({ overlay }) => overlay?.gesture === 'none' && Math.abs(overlay.lookYaw) > 0)).toBe(true);
  expect(Math.abs(lead.at(-1)!.overlay!.lookYaw)).toBeGreaterThan(Math.abs(lead[0]!.overlay!.lookYaw));
  const pose = greeterTrack.filter(({ atMs }) => atMs >= first.poseAtMs && atMs < first.poseEndMs);
  expect(pose.every(({ overlay }) => overlay?.gesture === first.gesture)).toBe(true);
  expect(pose[0]!.overlay!.time).toBeCloseTo(T.gestures[first.gesture].phaseSeconds + (pose[0]!.atMs - first.poseAtMs) / 1000, 6);
  expect(greeterTrack.filter(({ atMs }) => atMs >= first.poseEndMs).every(({ overlay }) => !overlay || overlay.gesture === 'none')).toBe(true);
  expect(greeterTrack.filter(({ atMs }) => atMs >= first.endMs).every(({ overlay }) => !overlay)).toBe(true);
  // The recipient only glances, after the gesture has begun, and keeps walking: no gesture is forced on them.
  expect(recipientTrack.filter(({ atMs }) => atMs < first.glanceAtMs!).every(({ overlay }) => !overlay)).toBe(true);
  expect(recipientTrack.some(({ overlay }) => overlay && Math.abs(overlay.lookYaw) > .1)).toBe(true);
  expect(recipientTrack.every(({ overlay }) => !overlay || overlay.gesture === 'none')).toBe(true);
  expect(first.glanceAtMs! - first.poseAtMs).toBeGreaterThanOrEqual(T.glance.delayMs[0]);
  expect(first.glanceAtMs! - first.poseAtMs).toBeLessThanOrEqual(T.glance.delayMs[1]);

  // Walker takeover mid-gesture: the greeter is released at once; the recipient's look eases back.
  const cut = first.poseAtMs + 300;
  const recipientAfterTakeover: number[] = [];
  let takenAt: number | null = null;
  play({ renderMs: 1000 / 60, untilMs: cut + 1_000, takeover: { slot: first.greeter, atMs: cut },
    onStep(step) {
      if (step.atMs < cut) return;
      takenAt ??= step.atMs;
      expect(step.overlays.has(first.greeter)).toBe(false);
      expect(step.encounters.some(encounter => encounter.greeter === first.greeter || encounter.recipient === first.greeter)).toBe(false);
      expect(step.started.some(encounter => encounter.greeter === first.greeter)).toBe(false);
    },
    onRender(_, overlays) { if (takenAt !== null) recipientAfterTakeover.push(overlays.get(first.recipient)?.lookYaw ?? 0); } });
  expect(recipientAfterTakeover.at(-1)).toBe(0);
  for (let i = 1; i < recipientAfterTakeover.length; i++) expect(Math.abs(recipientAfterTakeover[i]!)).toBeLessThanOrEqual(Math.abs(recipientAfterTakeover[i - 1]!) + 1e-9);

  // The recipient leaves mid-gesture: same-update removal of their encounter, cooldowns and poses.
  const departures = new Map([[first.recipient, cut]]);
  const removal = play({ renderMs: 1000 / 60, untilMs: cut + 2_000, departures, onStep(step, samples) {
    if (step.atMs < cut) return;
    expect(samples.find(sample => sample.slot === first.recipient)?.state ?? 'leaving').toBe('leaving');
    expect(step.encounters.some(encounter => encounter.recipient === first.recipient || encounter.greeter === first.recipient)).toBe(false);
    expect(step.overlays.has(first.recipient)).toBe(false);
    // A gesture already under way finishes its own cycle; nothing replaces the departed neighbour.
    const greeter = step.overlays.get(first.greeter);
    if (step.atMs >= first.poseEndMs + T.look.releaseMs) expect(greeter).toBeUndefined();
  } });
  const stillHere = removal.motion.sample(cut + 2_000).filter(sample => sample.state !== 'leaving').map(sample => sample.slot);
  expect(stillHere).not.toContain(first.recipient);
  expect(removal.policy.stats.actors).toBe(stillHere.length);

  // A large clock jump past the first encounter drops transient looks; no backlog is replayed.
  const jumped = play({ renderMs: 1000 / 60, untilMs: at(150), freeze: { fromMs: first.startMs - 1_000, toMs: first.endMs + 30_000 } });
  expect(jumped.started.some(encounter => encounter.startMs > first.startMs - 1_000 && encounter.startMs < first.endMs + 30_000)).toBe(false);
  expect(jumped.started.filter(encounter => encounter.startMs < first.startMs - 1_000)).toEqual(baseline.started.filter(encounter => encounter.startMs < first.startMs - 1_000));

  // Reset, an epoch change and a backward clock each start a clean story.
  const policy = baseline.policy;
  expect(policy.stats.actors).toBe(street.slots.length);
  const samples = baseline.motion.sample(at(150));
  policy.step({ kingdomId: F.kingdomId, epoch: 'simulated:another-evening', origin: F.origin, atMs: at(150), samples, ambientSlots: new Set(street.slots) });
  expect(policy.stats).toMatchObject({ actors: street.slots.length, cooldowns: 0, encounters: 0, releases: 0 });
  policy.step({ kingdomId: F.kingdomId, epoch: 'simulated:another-evening', origin: F.origin, atMs: at(150), samples: [], ambientSlots: new Set() });
  expect(policy.stats).toEqual({ actors: 0, contacts: 0, cooldowns: 0, encounters: 0, releases: 0 });
  policy.reset();
  expect(policy.present(samples, at(150)).size).toBe(0);
}, 60_000);
