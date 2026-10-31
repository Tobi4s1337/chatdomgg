import { expect, it } from 'vitest';
import { createCitizenMotion } from '../citizens/motion';
import type { CitizenGoalRequest, CitizenGoalResult, CitizenMotionSample } from '../citizens/types';
import { createNeighbourStreet, createSimulatedChat, createTownStreets, NEIGHBOUR_FIXTURE as F, SIMULATED_LINES, TOWN_FIXTURE, type NeighbourStreet, type SimulatedChat } from './fixture';
import {
  BEHAVIOUR_TUNING as T, createCitizenBehaviours, dueBehaviourSteps, type CitizenBehaviourStep, type CitizenChatReaction, type CitizenCueNote, type CitizenEncounter,
  type CitizenGoalAnswer, type CitizenOverlay, type CitizenRoutineTransition, type CitizenRoutineView,
} from './index';

interface Scenario {
  /** Render cadence of the caller; it must never change semantic transitions. */
  readonly renderMs: number;
  readonly untilMs: number;
  readonly street?: NeighbourStreet;
  readonly fixture?: { readonly kingdomId: string; readonly epoch: string; readonly origin: 'simulated'; readonly startMs: number };
  readonly departures?: ReadonlyMap<number, number>;
  /** Kingdom time window in which a slot is under walker control. */
  readonly takeover?: { readonly slot: number; readonly atMs: number; readonly untilMs?: number };
  /** Render frames at these kingdom times are skipped: the clock jumps across them. */
  readonly freeze?: { readonly fromMs: number; readonly toMs: number };
  /** The caller's own refusal in front of motion, e.g. a street closed by main's reserved action. */
  readonly gate?: (request: CitizenGoalRequest) => CitizenGoalResult | null;
  /** The SIMULATED chat script: cues as main's adapter holds them, walker control, a reconnect reset and departures. */
  readonly chat?: SimulatedChat;
  readonly onStep?: (step: CitizenBehaviourStep, samples: readonly CitizenMotionSample[]) => void;
  readonly onRender?: (atMs: number, overlays: ReadonlyMap<number, CitizenOverlay>, samples: readonly CitizenMotionSample[]) => void;
}
interface Asked { readonly request: CitizenGoalRequest; readonly result: CitizenGoalResult; readonly view: CitizenRoutineView }

const street = createNeighbourStreet();
const at = (seconds: number): number => F.startMs + seconds * 1000;
const flat = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);
const fastest = 1.36;

/**
 * The caller loop: apply the public frame, sample actual motion, step policy with main's answers,
 * forward its goals to `motion.requestGoal`, present at render time. Every step also checks the
 * seam: real present actors, approved destinations, no teleport, and pauses only at arrival.
 */
function play(scenario: Scenario) {
  const world = scenario.street ?? street, fixture = scenario.fixture ?? F;
  const motion = createCitizenMotion(world.plan), policy = createCitizenBehaviours();
  const started: CitizenEncounter[] = [], transitions: CitizenRoutineTransition[] = [], asked: Asked[] = [];
  const reacted: CitizenChatReaction[] = [], notes: CitizenCueNote[] = [];
  const departures = scenario.chat?.departures ?? scenario.departures;
  const destinationsFor = (slot: number) => motion.destinationsForSlot(slot);
  let last: number | null = null, answers: CitizenGoalAnswer[] = [], previous = new Map<number, CitizenMotionSample>();
  for (let now = fixture.startMs; now <= scenario.untilMs; now += scenario.renderMs) {
    if (scenario.freeze && now > scenario.freeze.fromMs && now < scenario.freeze.toMs) continue;
    for (const stepMs of dueBehaviourSteps(last, now)) {
      // A reconnect: the caller resets its policy, as main's consumer does; motion carries on.
      const reset = scenario.chat?.resetsAt(stepMs) ?? false;
      if (reset) { policy.reset(); answers = []; }
      const jumped = reset || last !== null && stepMs - last > T.maxGapMs;
      last = stepMs;
      const frame = world.frameAt(stepMs, departures);
      if (frame) motion.applyFrame(frame);
      const samples = motion.sample(stepMs);
      const controlled = scenario.chat?.controlledAt(stepMs);
      const held = (slot: number): boolean => Boolean(controlled?.has(slot) || scenario.takeover && slot === scenario.takeover.slot && stepMs >= scenario.takeover.atMs && stepMs < (scenario.takeover.untilMs ?? Infinity));
      const ambientSlots = new Set(world.slots.filter(slot => !held(slot)));
      const cues = scenario.chat?.cuesAt(stepMs, samples);
      const step = policy.step({ kingdomId: fixture.kingdomId, epoch: fixture.epoch, origin: fixture.origin, atMs: stepMs, samples, ambientSlots, destinationsFor, answers,
        ...(cues ? { cues } : {}) });
      answers = step.goals.map(request => ({ request, result: scenario.gate?.(request) ?? motion.requestGoal(request) }));
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
      // Goals: bounded, only main's approved places, only for ambient people who are standing at an arrival.
      expect(step.goals.length).toBeLessThanOrEqual(T.routine.maxGoalsPerStep);
      for (const [i, request] of step.goals.entries()) {
        const self = present.get(request.slot)!;
        expect(ambientSlots.has(request.slot)).toBe(true);
        expect(destinationsFor(request.slot).some(destination => destination.nodeId === request.nodeId)).toBe(true);
        expect(self.goalReached && self.speed === 0).toBe(true);
        expect(request.nodeId).not.toBe(self.goalNodeId);
        expect(request.startAtMs).toBeGreaterThan(stepMs);
        asked.push({ request, result: answers[i]!.result, view: step.routines.find(view => view.slot === request.slot)! });
      }
      for (const transition of step.transitions) {
        const self = present.get(transition.slot)!;
        // A pause or rest begins on the first actual arrival sample, never on acceptance or elapsed time.
        if (transition.kind === 'arrive') {
          expect(self.goalNodeId).toBe(transition.nodeId);
          expect(self.goalReached).toBe(true);
          const before = previous.get(transition.slot);
          if (!jumped) expect(before && before.goalNodeId === transition.nodeId && before.goalReached).toBe(false);
        }
        transitions.push(transition);
      }
      // Nobody is moved by the policy: positions and travelled distance stay continuous through every goal change.
      for (const sample of samples) {
        const before = previous.get(sample.slot);
        if (!before || jumped) continue;
        expect(flat(sample.position, before.position)).toBeLessThanOrEqual(fastest * T.stepMs / 1000 + 1e-6);
        expect(sample.distance).toBeGreaterThanOrEqual(before.distance - 1e-9);
      }
      // Two people never pause on one point.
      const stops = step.routines.filter(view => view.activity === 'pausing').map(view => view.nodeId);
      expect(new Set(stops).size).toBe(stops.length);
      expect(policy.stats.pending).toBe(step.goals.length);
      // Chat: real present people only, one current reaction each, at most two listeners, nobody sent anywhere.
      const roles = step.reactions.flatMap(reaction => [reaction.speaker, ...reaction.listeners.map(listener => listener.slot)]);
      expect(new Set(roles).size).toBe(roles.length);
      expect(step.reactions.length).toBeLessThanOrEqual(T.chat.maxActive);
      for (const reaction of step.reactions) {
        expect(present.has(reaction.speaker)).toBe(true);
        expect(reaction.listeners.length).toBeLessThanOrEqual(T.chat.maxListeners);
        for (const listener of reaction.listeners) { expect(present.has(listener.slot)).toBe(true); expect(ambientSlots.has(listener.slot)).toBe(true); }
        if (!ambientSlots.has(reaction.speaker)) expect(reaction.speakerNods).toBe(false);
      }
      for (const slot of roles) {
        expect(busy).not.toContain(slot);
        expect(step.goals.some(goal => goal.slot === slot)).toBe(false);
      }
      // No storm: two lines never start moving heads in one neighbourhood at once.
      for (const [i, a] of step.reactions.entries()) for (const b of step.reactions.slice(i + 1)) {
        if (b.startMs === step.atMs) expect(flat(present.get(a.speaker)!.position, present.get(b.speaker)!.position)).toBeGreaterThanOrEqual(T.chat.localMetres);
      }
      reacted.push(...step.reacted); notes.push(...step.cues);
      // The words never enter policy state or output.
      if (cues?.length) {
        const exported = JSON.stringify([step.reactions, step.cues, step.routines, step.transitions, step.encounters, policy.stats]);
        for (const words of SIMULATED_LINES) expect(exported).not.toContain(words);
      }
      previous = new Map(samples.map(sample => [sample.slot, sample]));
      scenario.onStep?.(step, samples);
    }
    const samples = motion.sample(now);
    scenario.onRender?.(now, policy.present(samples, now), samples);
  }
  return { started, transitions, asked, policy, motion, reacted, notes };
}

it('gives nine simulated neighbours a gentle street life through the actual motion adapter', () => {
  // The same story at four render cadences has identical semantic transitions: greetings and routines.
  const story = at(400), baseline = play({ renderMs: 1000 / 60, untilMs: story });
  // Compared up to a second before the end, which every cadence has stepped past.
  const settled = <Item extends { readonly atMs?: number; readonly startMs?: number }>(items: readonly Item[]): Item[] =>
    items.filter(item => (item.atMs ?? item.startMs!) < story - 1_000);
  for (const renderMs of [50, 250, 730]) {
    const replay = play({ renderMs, untilMs: story });
    expect(settled(replay.started)).toEqual(settled(baseline.started));
    expect(settled(replay.transitions)).toEqual(settled(baseline.transitions));
  }
  expect(baseline.started.length).toBeGreaterThan(0);
  // Greetings are never a crowd-wide wave: one person rests between their own greetings, and the same pair waits out its cooldown.
  for (const [i, first] of baseline.started.entries()) for (const later of baseline.started.slice(i + 1)) {
    if (new Set([first.greeter, first.recipient, later.greeter, later.recipient]).size === 2) expect(later.startMs - first.startMs).toBeGreaterThanOrEqual(T.greeting.pairCooldownMs[0]);
    if (later.greeter === first.greeter) expect(later.startMs - first.endMs).toBeGreaterThanOrEqual(T.greeting.restAfterMs[0]);
  }

  // Routines: everyone comes home first; excursions are a small authored set, varied by seed, and each ends at its own door.
  const homeOf = (slot: number): string => baseline.motion.destinationsForSlot(slot).find(destination => destination.kind === 'home')!.nodeId;
  const of = (slot: number): CitizenRoutineTransition[] => baseline.transitions.filter(transition => transition.slot === slot);
  const firstOut: number[] = [];
  for (const slot of street.slots) {
    const own = of(slot), firstArrival = own.find(transition => transition.kind === 'arrive')!;
    expect(firstArrival).toMatchObject({ routine: 'home', nodeId: homeOf(slot) });
    for (const [i, transition] of own.entries()) {
      const next = own.slice(i + 1).find(item => item.kind === 'request' || item.kind === 'arrive');
      if (transition.kind === 'arrive' && transition.routine === 'home') {
        // A doorstep rest of 12–28 s comes before anything else.
        expect(transition.pauseMs).toBeGreaterThanOrEqual(T.routine.homeRestMs[0]);
        expect(transition.pauseMs).toBeLessThanOrEqual(T.routine.homeRestMs[1]);
        if (next) expect(next.atMs - transition.atMs).toBeGreaterThanOrEqual(transition.pauseMs!);
      }
      if (transition.kind === 'arrive' && transition.routine === 'market') {
        // The market has time to breathe: 4–9 s, a look across it, then on.
        expect(transition.pauseMs).toBeGreaterThanOrEqual(T.routine.marketPauseMs[0]);
        expect(transition.pauseMs).toBeLessThanOrEqual(T.routine.marketPauseMs[1]);
        if (next) expect(next).toMatchObject({ kind: 'request', nodeId: homeOf(slot) });
      }
      if (transition.kind === 'arrive' && transition.routine === 'stroll' && next) expect(next.atMs - transition.atMs).toBeGreaterThanOrEqual(transition.pauseMs!);
      // An excursion leaves home and, unless the story ends first, comes back to the same frontage.
      if (transition.kind === 'request' && transition.nodeId !== homeOf(slot) && own.slice(0, i).reverse().find(item => item.kind === 'arrive')?.nodeId === homeOf(slot)) {
        firstOut[slot] ??= transition.atMs;
        const back = own.slice(i + 1).find(item => item.kind === 'arrive' && item.routine === 'home');
        if (transition.atMs < story - 150_000) expect(back?.nodeId).toBe(homeOf(slot));
      }
    }
  }
  const outings = firstOut.filter(value => value !== undefined);
  expect(outings.length).toBeGreaterThanOrEqual(street.slots.length - 1);
  expect(new Set(outings).size).toBe(outings.length);
  const kinds = new Set(baseline.asked.map(item => item.view.routine)), patterns = new Set(baseline.asked.map(item => item.view.pattern).filter(Boolean));
  expect(kinds.has('stroll') && kinds.has('market')).toBe(true);
  expect(patterns.size).toBeGreaterThanOrEqual(2);
  // A delayed arrival: an accepted stop is walked to for seconds, and its pause waits for the actual arrival sample.
  const stroll = baseline.asked.find(item => item.view.routine === 'stroll' && item.request.nodeId !== homeOf(item.request.slot))!;
  expect(stroll.result.accepted).toBe(true);
  const reached = of(stroll.request.slot).find(item => item.kind === 'arrive' && item.atMs > stroll.request.startAtMs)!;
  expect(reached.nodeId).toBe(stroll.request.nodeId);
  expect(reached.atMs - stroll.request.startAtMs).toBeGreaterThan(3_000);

  // A closed market and a briefly unreachable home: refusals leave people resting where they legally stand,
  // retries back off within bounds, and the routine still finishes at home.
  const outward = baseline.asked.find(item => item.view.routine === 'stroll' && item.request.nodeId !== homeOf(item.request.slot))!;
  const stuck = outward.request.slot, stuckStop = of(stuck).find(item => item.kind === 'arrive' && item.atMs > outward.request.startAtMs)!;
  const reopen = stuckStop.atMs + 20_000;
  const closed = play({ renderMs: 100, untilMs: story, gate(request) {
    if (request.nodeId === street.plan.market.nodeId) return { accepted: false, reason: 'blocked' };
    if (request.slot === stuck && request.nodeId === homeOf(stuck) && request.startAtMs < reopen) return { accepted: false, reason: 'blocked' };
    return null;
  }, onStep(step, samples) {
    // While waiting after a refusal, a person stands exactly where motion left them.
    for (const view of step.routines) if (view.activity === 'waiting') {
      const self = samples.find(sample => sample.slot === view.slot)!;
      expect(self.goalReached && self.speed === 0).toBe(true);
    }
  } });
  const refusals = closed.transitions.filter(item => item.kind === 'refused');
  expect(refusals.some(item => item.nodeId === street.plan.market.nodeId)).toBe(true);
  for (const refusal of refusals.filter(item => item.nodeId === street.plan.market.nodeId)) {
    const again = closed.asked.filter(item => item.request.slot === refusal.slot && item.request.nodeId === refusal.nodeId && item.request.startAtMs > refusal.atMs);
    expect(again.every(item => item.request.startAtMs - refusal.atMs >= T.routine.marketRefusalMs)).toBe(true);
    const next = closed.asked.find(item => item.request.slot === refusal.slot && item.request.startAtMs > refusal.atMs);
    if (next) expect(next.request.startAtMs - refusal.atMs).toBeGreaterThanOrEqual(T.routine.retryMs[0]);
  }
  const homeTries = closed.asked.filter(item => item.request.slot === stuck && item.request.nodeId === homeOf(stuck) && item.request.startAtMs <= reopen + T.routine.maxRetryMs);
  expect(homeTries.filter(item => !item.result.accepted).length).toBeGreaterThanOrEqual(2);
  for (let i = 2; i < homeTries.length; i++) {
    const gap = homeTries[i]!.request.startAtMs - homeTries[i - 1]!.request.startAtMs;
    expect(gap).toBeGreaterThanOrEqual(homeTries[i - 1]!.request.startAtMs - homeTries[i - 2]!.request.startAtMs - T.stepMs);
    expect(gap).toBeLessThanOrEqual(T.routine.maxRetryMs + T.stepMs);
  }
  expect(homeTries.at(-1)!.result.accepted).toBe(true);
  expect(closed.transitions.some(item => item.slot === stuck && item.kind === 'arrive' && item.nodeId === homeOf(stuck) && item.atMs > reopen)).toBe(true);

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

  // Walker takeover mid-gesture: the greeter is released at once and sent nowhere; the recipient's look eases back.
  // When the walker lets go, the routine resumes from wherever motion shows them.
  const cut = first.poseAtMs + 300, handBack = cut + 30_000;
  const recipientAfterTakeover: number[] = [];
  let takenAt: number | null = null;
  const takeover = play({ renderMs: 50, untilMs: handBack + 90_000, takeover: { slot: first.greeter, atMs: cut, untilMs: handBack },
    onStep(step) {
      if (step.atMs < cut || step.atMs >= handBack) return;
      takenAt ??= step.atMs;
      expect(step.overlays.has(first.greeter)).toBe(false);
      expect(step.goals.some(goal => goal.slot === first.greeter)).toBe(false);
      expect(step.routines.find(view => view.slot === first.greeter)?.routine).toBe('held');
      // A walker may be looked at and greeted, but never greets or glances back through this policy.
      expect(step.encounters.some(encounter => encounter.greeter === first.greeter || encounter.recipient === first.greeter && encounter.glanceAtMs !== null)).toBe(false);
      if (step.atMs < cut + 1_000) expect(step.encounters.some(encounter => encounter.recipient === first.greeter)).toBe(false);
    },
    onRender(atMs, overlays) { if (takenAt !== null && atMs < cut + 1_000) recipientAfterTakeover.push(overlays.get(first.recipient)?.lookYaw ?? 0); } });
  expect(recipientAfterTakeover.at(-1)).toBe(0);
  for (let i = 1; i < recipientAfterTakeover.length; i++) expect(Math.abs(recipientAfterTakeover[i]!)).toBeLessThanOrEqual(Math.abs(recipientAfterTakeover[i - 1]!) + 1e-9);
  const handed = takeover.transitions.filter(item => item.slot === first.greeter && item.atMs >= cut);
  expect(handed[0]).toMatchObject({ kind: 'held', atMs: Math.ceil(cut / T.stepMs) * T.stepMs });
  expect(handed.find(item => item.kind === 'resume')?.atMs).toBe(Math.ceil(handBack / T.stepMs) * T.stepMs);
  expect(handed.some(item => item.kind === 'request' && item.atMs > handBack)).toBe(true);

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
  expect(removal.transitions.some(item => item.slot === first.recipient && item.atMs >= cut)).toBe(false);

  // A large clock jump drops transient looks and restarts routine timers from what motion shows: no backlog,
  // and no crowd leaving their doors together the moment the clock lands.
  const freeze = { fromMs: first.startMs - 1_000, toMs: at(220) };
  const jumped = play({ renderMs: 50, untilMs: at(300), freeze });
  expect(jumped.started.some(encounter => encounter.startMs > freeze.fromMs && encounter.startMs < freeze.toMs)).toBe(false);
  expect(jumped.started.filter(encounter => encounter.startMs < freeze.fromMs)).toEqual(baseline.started.filter(encounter => encounter.startMs < freeze.fromMs));
  const landed = jumped.transitions.filter(item => item.atMs >= freeze.toMs && item.atMs < freeze.toMs + T.routine.homeRestMs[0]);
  expect(landed.filter(item => item.kind === 'request').length).toBeLessThanOrEqual(2);

  // The 240-slot town: the same seam stays bounded, nobody shares a stop, and the street keeps breathing.
  const town = createTownStreets(), crowd = play({ renderMs: 250, untilMs: TOWN_FIXTURE.startMs + 135_000, street: town, fixture: TOWN_FIXTURE });
  expect(crowd.policy.stats.actors).toBe(town.slots.length);
  // Goals per second of kingdom time stay within the per-step cap however many people share the town.
  const perSecond = new Map<number, number>();
  for (const item of crowd.asked) { const second = Math.floor(item.request.startAtMs / 1000); perSecond.set(second, (perSecond.get(second) ?? 0) + 1); }
  expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(T.routine.maxGoalsPerStep * 1000 / T.stepMs);
  expect(crowd.asked.length).toBeGreaterThan(town.slots.length / 2);
  expect(crowd.asked.filter(item => !item.result.accepted)).toEqual([]);

  // A witnessed chat line turns a few heads. The SIMULATED script supplies cues the way main's adapter holds
  // them (every unexpired cue, again on every step), choosing each moment from the actual samples of this story.
  const chat = createSimulatedChat(street), frames: { atMs: number; overlays: ReadonlyMap<number, CitizenOverlay>; samples: readonly CitizenMotionSample[] }[] = [];
  const talk = play({ renderMs: 50, untilMs: at(230), chat, onRender(atMs, overlays, samples) { if (atMs >= at(65)) frames.push({ atMs, overlays, samples }); } });
  expect([...chat.moments.keys()]).toEqual(['line', 'burst', 'walker', 'reconnect', 'departure']);
  const decided = talk.notes.filter(note => note.outcome !== 'duplicate');
  // Each ID is decided exactly once per story, however often main supplies it again; repeats can never restart
  // a reaction. Only the reconnect line is judged again, by the reset policy, and found stale.
  const once = decided.filter(note => !(note.id === 'simulated-reconnect' && note.outcome === 'stale'));
  expect(new Set(once.map(note => note.id)).size).toBe(once.length);
  expect(talk.notes.some(note => note.outcome === 'duplicate')).toBe(true);
  expect(new Set(talk.reacted.map(reaction => reaction.cueId)).size).toBe(talk.reacted.length);
  const outcome = (id: string): CitizenCueNote['outcome'] | undefined => decided.find(note => note.id === id)?.outcome;
  const reaction = (id: string): CitizenChatReaction => talk.reacted.find(item => item.cueId === id)!;
  const yawOf = (slot: number, atMs: number): number => frames.find(frame => frame.atMs >= atMs)?.overlays.get(slot)?.lookYaw ?? 0;
  const frameAt = (atMs: number) => frames.find(frame => frame.atMs >= atMs)!;
  const bearingTo = (from: CitizenMotionSample, to: CitizenMotionSample): number =>
    Math.atan2(Math.sin(Math.atan2(to.position[0] - from.position[0], to.position[2] - from.position[2]) - from.heading), Math.cos(Math.atan2(to.position[0] - from.position[0], to.position[2] - from.position[2]) - from.heading));

  // An ordinary line: one finite nod after a small lead, then two neighbours turn, staggered, toward the speaker.
  const line = reaction('simulated-line');
  expect(line).toMatchObject({ speaker: chat.moments.get('line')!.slots[0], speakerNods: true, origin: 'simulated' });
  expect(line.nodAtMs - line.startMs).toBeGreaterThanOrEqual(T.chat.leadMs[0]);
  expect(line.nodEndMs - line.nodAtMs).toBe(T.gestures.nod.durationMs);
  expect(line.listeners.length).toBe(2);
  expect(line.listeners[0]!.atMs - line.nodAtMs).toBeGreaterThanOrEqual(T.chat.listenDelayMs[0]);
  expect(line.listeners[0]!.atMs - line.nodAtMs).toBeLessThanOrEqual(T.chat.listenDelayMs[1]);
  expect(line.listeners[1]!.atMs - line.listeners[0]!.atMs).toBeGreaterThanOrEqual(T.chat.secondListenerMs[0]);
  const during = frames.filter(frame => frame.atMs >= line.startMs - 500 && frame.atMs <= line.endMs + 500);
  for (const frame of during) {
    const nod = frame.overlays.get(line.speaker);
    // The nod is one cycle: it exists only inside its own window, then the speaker returns to their life.
    expect(nod?.gesture === 'nod').toBe(frame.atMs >= line.nodAtMs && frame.atMs < line.nodEndMs);
    // Nobody else in the street gestures because of the line.
    for (const [slot, overlay] of frame.overlays) if (slot !== line.speaker) expect(overlay.gesture).toBe('none');
  }
  // No pops: every head in the moment turns smoothly from the lift to the settle. The fastest authored ease
  // (a full neck turn over the shortest look-in) moves ~0.21 rad per 50 ms frame; a snap would move more.
  for (const slot of [line.speaker, ...line.listeners.map(listener => listener.slot)]) {
    const yaws = during.map(frame => frame.overlays.get(slot)?.lookYaw ?? 0);
    for (let i = 1; i < yaws.length; i++) expect(Math.abs(yaws[i]! - yaws[i - 1]!)).toBeLessThan(.3);
  }
  for (const listener of line.listeners) {
    const held = frameAt((listener.atMs + listener.outAtMs) / 2), self = held.samples.find(sample => sample.slot === listener.slot)!;
    const speaker = held.samples.find(sample => sample.slot === line.speaker)!, toward = bearingTo(self, speaker);
    expect(Math.abs(held.overlays.get(listener.slot)!.lookYaw)).toBeGreaterThan(.15);
    expect(Math.sign(held.overlays.get(listener.slot)!.lookYaw)).toBe(Math.sign(toward));
    // Before their turn the listener shows nothing of the line; after it, they are back where they were.
    expect(Math.abs(yawOf(listener.slot, listener.atMs - 60))).toBeLessThan(Math.abs(held.overlays.get(listener.slot)!.lookYaw));
  }

  // A burst: six lines in a second, one speaker three times, plus an expired, a foreign and an absent cue.
  const burst = chat.moments.get('burst')!;
  expect(outcome('simulated-burst-0')).toBe('reacted');
  expect(outcome('simulated-burst-again-1')).toBe('coalesced');
  expect(outcome('simulated-burst-again-2')).toBe('coalesced');
  expect(outcome('simulated-burst-expired')).toBe('expired');
  expect(outcome('simulated-burst-foreign')).toBe('foreign');
  expect(outcome('simulated-burst-absent')).toBe('absent');
  const burstReactions = talk.reacted.filter(item => item.cueId.startsWith('simulated-burst'));
  expect(burstReactions.length).toBeLessThanOrEqual(Math.ceil(street.slots.length / T.chat.peoplePerReaction));
  for (let i = 1; i < 6; i++) expect(['reacted', 'coalesced', 'crowded', 'stale']).toContain(outcome(`simulated-burst-${i}`));
  // No storm frame: at most one nod per reaction, and only the chosen few turn their heads for the lines.
  const burstFrames = frames.filter(frame => frame.atMs >= burst.atMs && frame.atMs < burst.atMs + 6_000);
  const nodding = Math.max(...burstFrames.map(frame => [...frame.overlays.values()].filter(overlay => overlay.gesture !== 'none').length));
  expect(nodding).toBeLessThanOrEqual(burstReactions.length);
  const turned = new Set(burstReactions.flatMap(item => [item.speaker, ...item.listeners.map(listener => listener.slot)]));
  expect(turned.size).toBeLessThanOrEqual(burstReactions.length * 3);

  // Walker takeover mid-nod: the speaker is released at once and never posed, but neighbours may still look at them.
  const walker = reaction('simulated-walker'), walkerSlot = walker.speaker, takenFrom = walker.startMs + 700;
  expect(walker.listeners.length).toBeGreaterThanOrEqual(1);
  const controlled = frames.filter(frame => frame.atMs >= Math.ceil(takenFrom / T.stepMs) * T.stepMs && frame.atMs < walker.endMs);
  expect(controlled.length).toBeGreaterThan(10);
  for (const frame of controlled) expect(frame.overlays.has(walkerSlot)).toBe(false);
  const watcher = walker.listeners[0]!;
  expect(Math.abs(yawOf(watcher.slot, (watcher.atMs + watcher.outAtMs) / 2))).toBeGreaterThan(.15);

  // A reconnect mid-look: the caller resets, the same cue is still held by main, and nothing replays.
  const reconnect = reaction('simulated-reconnect'), resetAt = Math.ceil((reconnect.startMs + 1_200) / T.stepMs) * T.stepMs;
  expect(talk.notes.filter(note => note.id === 'simulated-reconnect').map(note => note.outcome).slice(0, 2)).toEqual(['reacted', 'duplicate']);
  const afterReset = talk.notes.filter(note => note.id === 'simulated-reconnect' && note.atMs >= resetAt);
  expect(afterReset[0]).toMatchObject({ atMs: resetAt, outcome: 'stale' });
  expect(afterReset.slice(1).every(note => note.outcome === 'duplicate')).toBe(true);
  expect(talk.reacted.filter(item => item.startMs >= resetAt && item.startMs < resetAt + 10_000)).toEqual([]);

  // The speaker leaves mid-reaction: their reaction ends in the same step, and listeners ease back from looking at nobody.
  const leaving = reaction('simulated-departure'), leftAt = chat.departures.get(leaving.speaker)!;
  expect(leaving.listeners.length).toBeGreaterThanOrEqual(1);
  const gone = frames.filter(frame => frame.atMs >= Math.ceil(leftAt / T.stepMs) * T.stepMs && frame.atMs <= leftAt + T.look.releaseMs + 200);
  const easing = gone.map(frame => Math.abs(frame.overlays.get(leaving.listeners[0]!.slot)?.lookYaw ?? 0));
  expect(Math.abs(yawOf(leaving.listeners[0]!.slot, leftAt - 60))).toBeGreaterThan(.1);
  for (let i = 1; i < easing.length; i++) expect(easing[i]!).toBeLessThanOrEqual(easing[i - 1]! + 1e-9);
  expect(easing.at(-1)).toBeLessThan(.02);
  expect(gone.every(frame => !frame.overlays.has(leaving.speaker))).toBe(true);

  // Render cadence never changes which lines turn heads, who turns, or when.
  const slow = play({ renderMs: 250, untilMs: at(230), chat: createSimulatedChat(street) });
  expect(slow.reacted).toEqual(talk.reacted);
  expect(slow.notes.filter(note => note.outcome !== 'duplicate')).toEqual(decided);

  // Reset, an epoch change and a backward clock each start a clean story.
  const policy = baseline.policy;
  expect(policy.stats.actors).toBe(street.slots.length);
  const samples = baseline.motion.sample(story), destinationsFor = (slot: number) => baseline.motion.destinationsForSlot(slot);
  policy.step({ kingdomId: F.kingdomId, epoch: 'simulated:another-evening', origin: F.origin, atMs: story, samples, ambientSlots: new Set(street.slots), destinationsFor });
  expect(policy.stats).toMatchObject({ actors: street.slots.length, cooldowns: 0, encounters: 0, releases: 0, pending: 0 });
  policy.step({ kingdomId: F.kingdomId, epoch: 'simulated:another-evening', origin: F.origin, atMs: story, samples: [], ambientSlots: new Set(), destinationsFor });
  expect(policy.stats).toEqual({ actors: 0, contacts: 0, cooldowns: 0, encounters: 0, releases: 0, claims: 0, pending: 0, reactions: 0, cuesSeen: 0, cuesWaiting: 0 });
  policy.reset();
  expect(policy.present(samples, story).size).toBe(0);
}, 300_000);
