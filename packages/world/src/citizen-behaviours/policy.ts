import type { Vec3 } from '@chatdom/shared';
import { randomUnit, seedHash } from '../layout';
import type { CitizenMotionSample } from '../citizens/types';
import type { CitizenGoalRequest } from '../citizens/types';
import { createChatReactions } from './chat';
import { neighbourPairs } from './neighbours';
import { between, envelope, ease, gestureAt, NONE, relativeYaw, wrap } from './pose';
import { createRoutines } from './routines';
import { BEHAVIOUR_TUNING as T } from './tuning';
import type {
  CitizenBehaviourInput, CitizenBehaviours, CitizenBehaviourStep, CitizenCueNote, CitizenEncounter, CitizenGoalAnswer, CitizenOverlay,
  CitizenRoutineTransition, CitizenRoutineView,
} from './types';

interface Encounter {
  readonly greeter: number;
  readonly recipient: number;
  readonly gesture: 'nod' | 'wave';
  readonly startMs: number;
  readonly poseAtMs: number;
  readonly poseEndMs: number;
  /** The greeter's head starts back toward rest, and is there at `greeterEndMs`. */
  readonly lookOutAtMs: number;
  readonly greeterEndMs: number;
  /** Null when the recipient is not free to glance or has been taken over. */
  glance: { readonly atMs: number; readonly outAtMs: number; readonly endMs: number } | null;
  /** Last step positions, for a look target if a partner sample is briefly unavailable at render time. */
  greeterAt: Vec3;
  recipientAt: Vec3;
}
interface Release {
  readonly fromYaw: number;
  readonly startMs: number;
  /** A gesture already under way finishes its cycle instead of snapping off. */
  readonly tail: { readonly gesture: 'nod' | 'wave'; readonly poseAtMs: number; readonly poseEndMs: number } | null;
}
interface Actor {
  /** First step this person was fully visible in the current story; nobody greets on appearing. */
  readonly seenSince: number;
  standingSince: number | null;
  readyAtMs: number;
  /** Pair cooldowns by the other slot, mirrored on both actors so removal is local. */
  readonly cooldowns: Map<number, number>;
  release: Release | null;
}
interface Contact { readonly a: number; readonly b: number; readonly since: number; decided: boolean }

const pairKey = (a: number, b: number): number => Math.min(a, b) * 65_536 + Math.max(a, b);

/**
 * Local ambient presentation for main's supplied citizens. It owns no route, body, identity,
 * relationship or record: it walks people through gentle street routines by asking main for
 * approved destinations, notices neighbours, and returns small overlays in the renderer's existing
 * vocabulary. All choices are seeded by kingdom, epoch, slots and step time.
 */
export function createCitizenBehaviours(): CitizenBehaviours {
  let source: string | null = null, lastAtMs: number | null = null;
  let ambient: ReadonlySet<number> = new Set();
  const actors = new Map<number, Actor>();
  /** Active encounters by participating slot; each encounter is reachable from both of its people. */
  const encounters = new Map<number, Encounter>();
  let contacts = new Map<number, Contact>();
  let seedBase = '';
  const unit = (...parts: (string | number)[]): number => randomUnit(seedHash(`${seedBase}:${parts.join(':')}`));
  const routines = createRoutines(unit);
  const chat = createChatReactions(unit);

  const reset = (): void => {
    source = null; lastAtMs = null; ambient = new Set(); seedBase = '';
    actors.clear(); encounters.clear(); contacts = new Map(); routines.clear(); chat.clear();
  };
  const dropTransient = (): void => {
    encounters.clear(); contacts = new Map(); chat.clearTransient();
    for (const actor of actors.values()) { actor.release = null; actor.standingSince = null; }
  };
  const uniqueEncounters = (): Encounter[] => [...new Set(encounters.values())].sort((p, q) => p.greeter - q.greeter);

  /**
   * The look a participant shows at `atMs`, from live samples when available. A greeting turns the
   * head away from whatever routine look it finds (`base`) and hands it back the same way.
   */
  function encounterOverlay(encounter: Encounter, slot: number, self: CitizenMotionSample, partner: CitizenMotionSample | undefined, atMs: number, base: number): CitizenOverlay {
    if (slot === encounter.greeter) {
      const weight = envelope(atMs, encounter.startMs, encounter.poseAtMs, encounter.lookOutAtMs, encounter.greeterEndMs);
      const target = partner?.position ?? encounter.recipientAt;
      return { lookYaw: base + (relativeYaw(self, target) - base) * weight, ...gestureAt(encounter.gesture, encounter.poseAtMs, encounter.poseEndMs, atMs) };
    }
    const glance = encounter.glance;
    if (!glance) return { ...NONE, lookYaw: base };
    const weight = envelope(atMs, glance.atMs, glance.atMs + T.glance.inMs, glance.outAtMs, glance.endMs);
    return { gesture: 'none', time: 0, lookYaw: base + (relativeYaw(self, partner?.position ?? encounter.greeterAt) - base) * weight };
  }
  function releaseOverlay(release: Release, atMs: number, base: number): CitizenOverlay {
    const lookYaw = release.fromYaw + (base - release.fromYaw) * ease((atMs - release.startMs) / T.look.releaseMs);
    return { lookYaw, ...(release.tail ? gestureAt(release.tail.gesture, release.tail.poseAtMs, release.tail.poseEndMs, atMs) : { gesture: 'none' as const, time: 0 }) };
  }
  /** End one encounter early; the surviving people ease back to rest instead of snapping. */
  function interrupt(encounter: Encounter, survivors: ReadonlyMap<number, CitizenMotionSample>, atMs: number): void {
    for (const slot of [encounter.greeter, encounter.recipient]) {
      if (encounters.get(slot) === encounter) encounters.delete(slot);
      const actor = actors.get(slot), self = survivors.get(slot);
      if (!actor || !self || !ambient.has(slot)) continue;
      const partner = survivors.get(slot === encounter.greeter ? encounter.recipient : encounter.greeter);
      const shown = encounterOverlay(encounter, slot, self, partner, atMs, routines.yaw(slot, atMs));
      const tail = slot === encounter.greeter && atMs >= encounter.poseAtMs && atMs < encounter.poseEndMs
        ? { gesture: encounter.gesture, poseAtMs: encounter.poseAtMs, poseEndMs: encounter.poseEndMs } : null;
      if (Math.abs(shown.lookYaw) > 1e-4 || tail) actor.release = { fromYaw: shown.lookYaw, startMs: atMs, tail };
      if (slot === encounter.greeter) actor.readyAtMs = atMs + between(T.greeting.restAfterMs, unit('rest', slot, atMs));
    }
  }

  /** What one ambient person shows: routine look, then a greeting, or an eased release under any chat look. */
  function shownAt(slot: number, actor: Actor, sample: CitizenMotionSample, bySlot: ReadonlyMap<number, CitizenMotionSample>, atMs: number): CitizenOverlay {
    const encounter = encounters.get(slot), base = routines.yaw(slot, atMs);
    if (encounter) return encounterOverlay(encounter, slot, sample, bySlot.get(slot === encounter.greeter ? encounter.recipient : encounter.greeter), atMs, base);
    return chat.overlay(slot, sample, bySlot, atMs, actor.release ? releaseOverlay(actor.release, atMs, base) : { ...NONE, lookYaw: base });
  }
  function present(samples: readonly CitizenMotionSample[], atMs: number): ReadonlyMap<number, CitizenOverlay> {
    const bySlot = new Map(samples.map(sample => [sample.slot, sample]));
    const overlays = new Map<number, CitizenOverlay>();
    for (const sample of samples) {
      const slot = sample.slot, actor = actors.get(slot);
      if (!actor || !ambient.has(slot) || sample.state === 'leaving') continue;
      const overlay = shownAt(slot, actor, sample, bySlot, atMs);
      if (overlay.gesture !== 'none' || Math.abs(overlay.lookYaw) > 1e-4) overlays.set(slot, overlay);
    }
    return overlays;
  }

  function step(input: CitizenBehaviourInput): CitizenBehaviourStep {
    const { atMs } = input;
    if (!Number.isFinite(atMs)) throw new Error('Citizen behaviour needs a finite kingdom clock');
    const key = `${input.kingdomId}\u0000${input.epoch}\u0000${input.origin}`;
    // A new kingdom, epoch or origin, or a backward clock, is a different story: start clean.
    let jumped = false;
    if (key !== source || (lastAtMs !== null && atMs < lastAtMs)) { reset(); source = key; seedBase = `${input.kingdomId}:${input.epoch}:${input.origin}`; }
    else if (lastAtMs !== null && atMs - lastAtMs > T.maxGapMs) { dropTransient(); jumped = true; }
    lastAtMs = atMs; ambient = input.ambientSlots;
    const transitions: CitizenRoutineTransition[] = [], routineStep = { atMs, emit: (transition: CitizenRoutineTransition) => { transitions.push(transition); } };
    const homeOf = (slot: number) => input.destinationsFor(slot).find(destination => destination.kind === 'home');
    const answers = new Map<number, CitizenGoalAnswer[]>();
    for (const item of input.answers ?? []) { const list = answers.get(item.request.slot); if (list) list.push(item); else answers.set(item.request.slot, [item]); }

    // Only present, arriving or resting people take part. A departing body is never kept for a gesture.
    const present_ = new Map<number, CitizenMotionSample>();
    for (const sample of input.samples) if (sample.state !== 'leaving') present_.set(sample.slot, sample);
    /** A look cut short eases back from exactly what the person shows at this step; a gesture under way finishes. */
    const release = (slot: number): void => {
      const actor = actors.get(slot), self = present_.get(slot);
      if (!actor || !self || !ambient.has(slot)) return;
      const shown = shownAt(slot, actor, self, present_, atMs), tail = actor.release?.tail && atMs < actor.release.tail.poseEndMs ? actor.release.tail : null;
      actor.release = { fromYaw: shown.lookYaw, startMs: atMs, tail };
    };
    for (const [slot, actor] of actors) {
      if (present_.has(slot)) continue;
      const encounter = encounters.get(slot);
      if (encounter) interrupt(encounter, present_, atMs);
      chat.drop(slot, release);
      for (const other of actor.cooldowns.keys()) actors.get(other)?.cooldowns.delete(slot);
      actors.delete(slot); routines.drop(slot);
    }
    for (const [slot, sample] of present_) {
      let actor = actors.get(slot);
      if (!actor) {
        actor = { seenSince: atMs, standingSince: null, readyAtMs: -Infinity, cooldowns: new Map(), release: null }; actors.set(slot, actor);
        routines.create(slot, sample, atMs, homeOf(slot));
      }
      const standing = sample.goalReached && sample.speed === 0 && (sample.state === 'home' || sample.state === 'idle');
      actor.standingSince = standing ? actor.standingSince ?? atMs : null;
      for (const [other, until] of actor.cooldowns) if (until <= atMs) actor.cooldowns.delete(other);
      if (actor.release && atMs - actor.release.startMs >= T.look.releaseMs && (!actor.release.tail || atMs >= actor.release.tail.poseEndMs)) actor.release = null;
      // Control takeover: a walker or monarch is never posed or sent anywhere; looking at them remains allowed.
      if (!ambient.has(slot)) { actor.release = null; routines.hold(slot, routineStep); continue; }
      if (routines.held(slot)) routines.resume(slot, sample, homeOf(slot), routineStep);
      else if (jumped) routines.resettle(slot, sample, atMs, homeOf(slot));
      // Main's answers first, then actual arrival: a pause begins only on an arrival sample.
      routines.answer(slot, sample, answers.get(slot), homeOf(slot), input.destinationsFor(slot), routineStep);
      routines.arrival(slot, sample, homeOf(slot), input.destinationsFor(slot), routineStep);
    }
    for (const encounter of uniqueEncounters()) {
      const greeter = present_.get(encounter.greeter), recipient = present_.get(encounter.recipient);
      if (!greeter || !recipient) continue; // Interrupted above.
      if (!ambient.has(encounter.greeter)) { interrupt(encounter, present_, atMs); continue; }
      if (encounter.glance && !ambient.has(encounter.recipient)) encounter.glance = null;
      const end = Math.max(encounter.greeterEndMs, encounter.glance?.endMs ?? 0);
      if (atMs >= end) {
        encounters.delete(encounter.greeter); encounters.delete(encounter.recipient);
        actors.get(encounter.greeter)!.readyAtMs = end + between(T.greeting.restAfterMs, unit('rest', encounter.greeter, encounter.startMs));
        continue;
      }
      encounter.greeterAt = greeter.position; encounter.recipientAt = recipient.position;
    }

    // One spatial index per step, for greetings and chat listeners. Contacts exist only while a pair is within range.
    const points = [...present_.values()].filter(sample => sample.opacity >= .99).map(sample => ({ slot: sample.slot, x: sample.position[0], z: sample.position[2] }));
    const next = new Map<number, Contact>(), near = new Map<number, { slot: number; distance: number }[]>();
    for (const pair of neighbourPairs(points, T.neighbours.rangeMetres, T.neighbours.cellMetres, T.neighbours.maxPerCitizen)) {
      for (const [self, other] of [[pair.a, pair.b], [pair.b, pair.a]] as const) {
        const list = near.get(self); if (list) list.push({ slot: other, distance: pair.distance }); else near.set(self, [{ slot: other, distance: pair.distance }]);
      }
      if (pair.distance > T.greeting.keepMetres) continue;
      const id = pairKey(pair.a, pair.b), known = contacts.get(id);
      if (known) next.set(id, known);
      else if (pair.distance <= T.greeting.noticeMetres) next.set(id, { a: pair.a, b: pair.b, since: atMs, decided: false });
    }
    contacts = next;
    for (const list of near.values()) list.sort((p, q) => p.distance - q.distance || p.slot - q.slot);

    // A witnessed chat line, before greetings: its speaker and listeners are then busy for this step's contacts.
    const cues: CitizenCueNote[] = [];
    const reacted = chat.step({ atMs, source: { kingdomId: input.kingdomId, epoch: input.epoch, origin: input.origin }, cues: input.cues ?? [],
      present: present_, ambient, near: slot => near.get(slot) ?? [], since: slot => actors.get(slot)?.seenSince, notes: cues, release,
      free: slot => {
        const actor = actors.get(slot);
        return Boolean(actor && !encounters.has(slot) && !actor.release && atMs - actor.seenSince >= T.greeting.presentBeforeMs);
      },
      claim: slot => {
        const encounter = encounters.get(slot);
        if (encounter) interrupt(encounter, present_, atMs);
        const tail = actors.get(slot)?.release?.tail;
        return tail && atMs < tail.poseEndMs ? tail.poseEndMs : -Infinity;
      } });

    const started: CitizenEncounter[] = [];
    for (const contact of contacts.values()) {
      if (contact.decided) continue;
      const a = present_.get(contact.a)!, b = present_.get(contact.b)!;
      const distance = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
      const pairCooling = (actors.get(contact.a)!.cooldowns.get(contact.b) ?? -Infinity) > atMs;
      if (pairCooling || atMs - contact.since > T.greeting.decisionWindowMs) { contact.decided = true; continue; }
      if (distance < T.greeting.minMetres || distance > T.greeting.noticeMetres) continue;
      const free = (sample: CitizenMotionSample): boolean => !encounters.has(sample.slot) && !chat.has(sample.slot) && sample.opacity >= .99
        && atMs - actors.get(sample.slot)!.seenSince >= T.greeting.presentBeforeMs;
      // Both people must be able to see each other: nobody greets a back, and the neck limits a glance.
      const sees = (self: CitizenMotionSample, other: CitizenMotionSample, limit: number): boolean =>
        Math.abs(wrap(Math.atan2(other.position[0] - self.position[0], other.position[2] - self.position[2]) - self.heading)) <= limit;
      const neck = (sample: CitizenMotionSample): number => (sample.speed > .05 ? T.look.walkingLimit : T.look.standingLimit) + T.glance.beyondNeck;
      const canGreet = (self: CitizenMotionSample, other: CitizenMotionSample): boolean => {
        const actor = actors.get(self.slot)!;
        if (!ambient.has(self.slot) || !free(self) || !free(other) || actor.release || atMs < actor.readyAtMs) return false;
        // A settled person notices from where they stand; a walker notices someone close ahead without slowing.
        const settled = actor.standingSince !== null && atMs - actor.standingSince >= T.greeting.settleBeforeMs;
        const cruising = self.state === 'walking' && self.speed >= T.greeting.walkingMinSpeed && distance <= T.greeting.walkingMetres;
        if (!settled && !cruising) return false;
        return sees(self, other, settled ? T.greeting.fieldOfView : T.greeting.walkingFieldOfView) && sees(other, self, neck(other));
      };
      const options = [canGreet(a, b) ? a : null, canGreet(b, a) ? b : null].filter((sample): sample is CitizenMotionSample => sample !== null);
      if (!options.length) continue;
      // A settled greeter is preferred: the person at rest is the one who notices the passer.
      // Selected once per contact: whether to greet, who, and how.
      contact.decided = true;
      if (unit('greet', contact.a, contact.b, contact.since) >= T.greeting.chance) continue;
      const settledOptions = options.filter(sample => actors.get(sample.slot)!.standingSince !== null);
      const pool = settledOptions.length ? settledOptions : options;
      const greeter = pool.length === 1 ? pool[0]! : pool[unit('who', contact.a, contact.b, contact.since) < .5 ? 0 : 1]!;
      const recipient = greeter === a ? b : a;
      const waveChance = distance > T.greeting.nodMetres ? T.greeting.farWaveChance : T.greeting.nearWaveChance;
      const gesture = unit('gesture', contact.a, contact.b, contact.since) < waveChance ? 'wave' : 'nod';
      const poseAtMs = atMs + between(T.greeting.lookLeadMs, unit('lead', contact.a, contact.b, contact.since));
      const poseEndMs = poseAtMs + T.gestures[gesture].durationMs;
      const lookOutAtMs = poseEndMs + between(T.greeting.holdMs, unit('hold', contact.a, contact.b, contact.since));
      const greeterEndMs = lookOutAtMs + between(T.greeting.settleMs, unit('settle', contact.a, contact.b, contact.since));
      let glance: Encounter['glance'] = null;
      if (ambient.has(recipient.slot) && !actors.get(recipient.slot)!.release) {
        const glanceAt = poseAtMs + between(T.glance.delayMs, unit('glance', contact.a, contact.b, contact.since));
        const outAtMs = Math.max(poseEndMs + 150, glanceAt + T.glance.inMs);
        glance = { atMs: glanceAt, outAtMs, endMs: outAtMs + T.glance.outMs };
      }
      const encounter: Encounter = { greeter: greeter.slot, recipient: recipient.slot, gesture, startMs: atMs, poseAtMs, poseEndMs, lookOutAtMs, greeterEndMs,
        glance, greeterAt: greeter.position, recipientAt: recipient.position };
      encounters.set(greeter.slot, encounter); encounters.set(recipient.slot, encounter);
      const until = atMs + between(T.greeting.pairCooldownMs, unit('cooldown', contact.a, contact.b, contact.since));
      actors.get(contact.a)!.cooldowns.set(contact.b, until); actors.get(contact.b)!.cooldowns.set(contact.a, until);
      started.push(view(encounter));
    }
    // Departures last, so nobody leaves in the middle of a greeting decided this step.
    const goals: CitizenGoalRequest[] = [];
    for (const [slot, sample] of present_) {
      if (goals.length >= T.routine.maxGoalsPerStep) break;
      if (!ambient.has(slot)) continue;
      const busy = encounters.has(slot) || chat.has(slot) || Boolean(actors.get(slot)!.release?.tail && atMs < actors.get(slot)!.release!.tail!.poseEndMs);
      const goal = routines.due(slot, sample, homeOf(slot), input.destinationsFor(slot), busy, routineStep);
      if (goal) goals.push(goal);
    }
    const routineViews: CitizenRoutineView[] = [];
    for (const slot of present_.keys()) { const item = routines.view(slot); if (item) routineViews.push(item); }
    return { atMs, overlays: present(input.samples, atMs), encounters: uniqueEncounters().map(view), started, goals, transitions, routines: routineViews,
      reactions: chat.views(), reacted, cues };
  }

  const view = (encounter: Encounter): CitizenEncounter => ({ greeter: encounter.greeter, recipient: encounter.recipient, gesture: encounter.gesture,
    startMs: encounter.startMs, poseAtMs: encounter.poseAtMs, poseEndMs: encounter.poseEndMs,
    endMs: Math.max(encounter.greeterEndMs, encounter.glance?.endMs ?? 0), glanceAtMs: encounter.glance?.atMs ?? null });

  return {
    step, present, reset,
    get stats() {
      let cooldowns = 0, releases = 0;
      for (const actor of actors.values()) { cooldowns += actor.cooldowns.size; if (actor.release) releases++; }
      return { actors: actors.size, contacts: contacts.size, cooldowns: cooldowns / 2, encounters: new Set(encounters.values()).size, releases,
        claims: routines.claims, pending: routines.pending, ...chat.stats };
    },
  };
}
