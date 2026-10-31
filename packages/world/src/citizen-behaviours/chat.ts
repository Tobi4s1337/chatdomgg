import type { Vec3 } from '@chatdom/shared';
import type { CitizenMotionSample } from '../citizens/types';
import { bearing, between, envelope, gestureAt, neckLimit, relativeYaw } from './pose';
import { BEHAVIOUR_TUNING as T } from './tuning';
import type { CitizenChatCueSignal, CitizenChatReaction, CitizenCueNote, CitizenOverlay } from './types';

const C = T.chat;
type Outcome = CitizenCueNote['outcome'];

interface Listener { readonly slot: number; readonly atMs: number; readonly inEndMs: number; readonly outAtMs: number; readonly endMs: number }
interface Reaction {
  readonly cueId: string;
  readonly origin: 'live' | 'simulated';
  readonly speaker: number;
  speakerNods: boolean;
  readonly startMs: number;
  readonly nodAtMs: number;
  readonly nodEndMs: number;
  listeners: Listener[];
  /** The listener whose look the speaker's head answers, fixed at the start; null once they are gone. */
  answer: Listener | null;
  /** The speaker's last step position, for a listener's look if the speaker sample is briefly missing. */
  speakerAt: Vec3;
}
/** Only the fields the policy may read: the cue object itself, and its words, are never kept. */
interface Heard { readonly id: string; readonly slot: number; readonly asOf: number; readonly expiresAt: number }

export interface ChatStep {
  readonly atMs: number;
  readonly source: { readonly kingdomId: string; readonly epoch: string; readonly origin: 'live' | 'simulated' };
  readonly cues: readonly CitizenChatCueSignal[];
  readonly present: ReadonlyMap<number, CitizenMotionSample>;
  readonly ambient: ReadonlySet<number>;
  /** Neighbours of a slot from the step's one spatial index, closest first. */
  readonly near: (slot: number) => readonly { readonly slot: number; readonly distance: number }[];
  /** When this body became present in the current story, if it is an actor. */
  readonly since: (slot: number) => number | undefined;
  /** Free to turn their head for someone else's line: settled into the story, not greeting, not easing out of anything. */
  readonly free: (slot: number) => boolean;
  /** Take the speaker out of any greeting; returns when a gesture already under way ends (or -Infinity). */
  readonly claim: (slot: number) => number;
  /** Called before a look is cut short, so the person eases back from what they show now. */
  readonly release: (slot: number) => void;
  readonly notes: CitizenCueNote[];
}

const reactionEnd = (reaction: Reaction): number => Math.max(reaction.nodEndMs, ...reaction.listeners.map(listener => listener.endMs));
const flat = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * Chat cue reactions: dedupe by ID, discard foreign, expired, stale and absent cues, coalesce a
 * burst to one reaction per person and a few per street, and time a finite nod for the speaker
 * plus staggered looks from at most two neighbours. Seeded by cue ID; never reads the words.
 */
export function createChatReactions(unit: (...parts: (string | number)[]) => number) {
  const reactions = new Map<string, Reaction>();
  /** Every person in a reaction, speaker or listener: one current reaction each. */
  const roles = new Map<number, Reaction>();
  /** Rest after speaking (lines inside it coalesce) and after listening (not chosen again yet). */
  const spoke = new Map<number, number>(), listened = new Map<number, number>();
  /** Decided IDs until a while after their cue expires, oldest first. */
  const seen = new Map<string, number>();
  /** Cues said a moment ahead of the step, or held one step for the stagger. */
  const waiting = new Map<string, Heard>();
  let lastStartMs = -Infinity;

  const view = (reaction: Reaction): CitizenChatReaction => ({ cueId: reaction.cueId, origin: reaction.origin, speaker: reaction.speaker,
    speakerNods: reaction.speakerNods, startMs: reaction.startMs, nodAtMs: reaction.nodAtMs, nodEndMs: reaction.nodEndMs,
    listeners: reaction.listeners.map(({ slot, atMs, outAtMs, endMs }) => ({ slot, atMs, outAtMs, endMs })), endMs: reactionEnd(reaction) });

  /** Drop one listener; whoever is left showing a look toward them eases back instead of snapping. */
  function dropListener(reaction: Reaction, slot: number, ease: boolean, release: (slot: number) => void): void {
    const index = reaction.listeners.findIndex(listener => listener.slot === slot);
    if (index < 0) return;
    if (ease) release(slot);
    if (reaction.answer?.slot === slot) { release(reaction.speaker); reaction.answer = null; }
    reaction.listeners.splice(index, 1); roles.delete(slot);
  }
  function end(reaction: Reaction): void {
    reactions.delete(reaction.cueId);
    if (roles.get(reaction.speaker) === reaction) roles.delete(reaction.speaker);
    for (const listener of reaction.listeners) if (roles.get(listener.slot) === reaction) roles.delete(listener.slot);
  }
  /** A decided ID is kept a while past its cue's expiry, so a late resend is still a duplicate, not a new judgement. */
  function remember(id: string, expiresAt: number, atMs: number): void {
    seen.delete(id); seen.set(id, Math.max(expiresAt, atMs) + C.rememberMs);
    while (seen.size > C.maxSeen) seen.delete(seen.keys().next().value!);
  }

  function start(cue: Heard, speaker: CitizenMotionSample, input: ChatStep): Reaction {
    const { atMs } = input, seed = (part: string, ...more: (string | number)[]): number => unit('chat', cue.id, part, ...more);
    const settled = input.claim(speaker.slot);
    const nodAtMs = Math.max(atMs + between(C.leadMs, seed('lead')), settled + 120);
    const nodEndMs = nodAtMs + T.gestures.nod.durationMs;
    // Closest first, and only those who can turn to the speaker without looking over their back.
    const candidates = input.near(speaker.slot).filter(({ slot, distance }) => {
      const self = input.present.get(slot);
      return self && distance <= C.listenMetres && input.ambient.has(slot) && !roles.has(slot) && (listened.get(slot) ?? -Infinity) <= atMs
        && self.opacity >= .99 && input.free(slot) && Math.abs(bearing(self, speaker.position)) <= neckLimit(self) + C.beyondNeck;
    }).slice(0, C.maxListeners);
    const listeners: Listener[] = [];
    let turnAt = nodAtMs + between(C.listenDelayMs, seed('delay'));
    for (const { slot } of candidates) {
      if (listeners.length) turnAt += between(C.secondListenerMs, seed('second', slot));
      const inEndMs = turnAt + between(C.listenInMs, seed('in', slot)), outAtMs = inEndMs + between(C.listenHoldMs, seed('hold', slot));
      listeners.push({ slot, atMs: turnAt, inEndMs, outAtMs, endMs: outAtMs + between(C.listenOutMs, seed('out', slot)) });
    }
    const reaction: Reaction = { cueId: cue.id, origin: input.source.origin, speaker: speaker.slot, speakerNods: input.ambient.has(speaker.slot),
      startMs: atMs, nodAtMs, nodEndMs, listeners, answer: listeners[0] ?? null, speakerAt: speaker.position };
    reactions.set(cue.id, reaction); roles.set(speaker.slot, reaction);
    for (const listener of listeners) { roles.set(listener.slot, reaction); listened.set(listener.slot, listener.endMs + between(C.listenerRestMs, seed('listener-rest', listener.slot))); }
    spoke.set(speaker.slot, atMs + between(C.speakerRestMs, seed('speaker-rest')));
    lastStartMs = atMs;
    return reaction;
  }

  /** Decide one heard cue: an outcome, `wait` for a later step, or a started reaction. */
  function decide(cue: Heard, input: ChatStep, started: CitizenChatReaction[]): Outcome | 'wait' {
    const { atMs } = input;
    if (cue.expiresAt <= atMs) return 'expired';
    // A clock that disagrees by more than a cue's whole life is not this moment.
    if (cue.asOf > atMs + 10_000) return 'stale';
    if (cue.asOf > atMs) return 'wait';
    const speaker = input.present.get(cue.slot), since = input.since(cue.slot);
    if (!speaker || since === undefined) return 'absent';
    // Said before this body was present (a reconnect, a reset) or first heard too late: only main's bubble shows it.
    if (cue.asOf < since || atMs - cue.asOf > C.freshMs) return 'stale';
    // One current reaction per person: a line from someone already speaking or listening joins the moment under way.
    if (roles.has(cue.slot) || (spoke.get(cue.slot) ?? -Infinity) > atMs) return 'coalesced';
    if (reactions.size >= Math.min(C.maxActive, Math.ceil(input.present.size / C.peoplePerReaction))) return 'crowded';
    for (const reaction of reactions.values()) {
      const other = input.present.get(reaction.speaker)?.position ?? reaction.speakerAt;
      if (flat(other, speaker.position) < C.localMetres) return 'crowded';
    }
    if (atMs < lastStartMs + C.staggerMs) return 'wait';
    started.push(view(start(cue, speaker, input)));
    return 'reacted';
  }

  return {
    step(input: ChatStep): CitizenChatReaction[] {
      const { atMs } = input, started: CitizenChatReaction[] = [];
      for (const rests of [spoke, listened]) for (const [slot, until] of rests) if (until <= atMs) rests.delete(slot);
      for (const [id, until] of seen) if (until <= atMs) seen.delete(id);
      for (const reaction of [...reactions.values()]) {
        // Control takeover: a walker or monarch is looked at, never posed; a taken listener just stops.
        reaction.speakerNods &&= input.ambient.has(reaction.speaker);
        for (const listener of [...reaction.listeners]) {
          if (listener.endMs <= atMs) { reaction.listeners.splice(reaction.listeners.indexOf(listener), 1); roles.delete(listener.slot); }
          else if (!input.ambient.has(listener.slot)) dropListener(reaction, listener.slot, false, input.release);
        }
        if (atMs >= reactionEnd(reaction)) { end(reaction); continue; }
        reaction.speakerAt = input.present.get(reaction.speaker)?.position ?? reaction.speakerAt;
      }
      // Waiting cues first, then the newly supplied ones, in time order; per-step work is bounded.
      const heard: Heard[] = [...waiting.values()];
      waiting.clear();
      const fresh = input.cues.slice(0, C.maxCuesPerStep);
      for (const cue of input.cues.slice(C.maxCuesPerStep)) input.notes.push({ id: cue.id, slot: cue.slot, atMs, outcome: 'crowded' });
      for (const cue of fresh) {
        if (heard.some(item => item.id === cue.id)) continue;
        if (seen.has(cue.id)) { input.notes.push({ id: cue.id, slot: cue.slot, atMs, outcome: 'duplicate' }); continue; }
        const { kingdomId, epoch, origin } = input.source;
        if (cue.kingdomId !== kingdomId || cue.epoch !== epoch || cue.origin !== origin) {
          remember(cue.id, cue.expiresAt, atMs); input.notes.push({ id: cue.id, slot: cue.slot, atMs, outcome: 'foreign' }); continue;
        }
        heard.push({ id: cue.id, slot: cue.slot, asOf: cue.asOf, expiresAt: cue.expiresAt });
      }
      heard.sort((a, b) => a.asOf - b.asOf || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const cue of heard) {
        const outcome = decide(cue, input, started);
        if (outcome === 'wait') {
          if (waiting.size < C.maxWaiting) { waiting.set(cue.id, cue); continue; }
          remember(cue.id, cue.expiresAt, atMs); input.notes.push({ id: cue.id, slot: cue.slot, atMs, outcome: 'crowded' }); continue;
        }
        remember(cue.id, cue.expiresAt, atMs); input.notes.push({ id: cue.id, slot: cue.slot, atMs, outcome });
      }
      return started;
    },

    /**
     * The chat layer of one person's overlay over what they otherwise show (`under`): the speaker's
     * finite nod and answering glance, or a listener's look toward the speaker's live position.
     */
    overlay(slot: number, self: CitizenMotionSample, bySlot: ReadonlyMap<number, CitizenMotionSample>, atMs: number, under: CitizenOverlay): CitizenOverlay {
      const reaction = roles.get(slot);
      if (!reaction) return under;
      if (reaction.speaker === slot) {
        let lookYaw = under.lookYaw;
        const first = reaction.answer, target = first && bySlot.get(first.slot)?.position;
        if (first && target) {
          const from = first.atMs + C.speakerAfterMs;
          lookYaw += (relativeYaw(self, target) - lookYaw) * C.speakerShare * envelope(atMs, from, from + C.speakerInMs, first.outAtMs, first.endMs);
        }
        const nod = reaction.speakerNods ? gestureAt('nod', reaction.nodAtMs, reaction.nodEndMs, atMs) : null;
        return nod && nod.gesture !== 'none' ? { lookYaw, ...nod } : { ...under, lookYaw };
      }
      const listener = reaction.listeners.find(item => item.slot === slot);
      if (!listener) return under;
      const target = bySlot.get(reaction.speaker)?.position ?? reaction.speakerAt;
      const weight = envelope(atMs, listener.atMs, listener.inEndMs, listener.outAtMs, listener.endMs);
      return { ...under, lookYaw: under.lookYaw + (relativeYaw(self, target) - under.lookYaw) * weight };
    },

    /** A removed body: its reaction ends, and its listeners ease back from looking at nobody. */
    drop(slot: number, release: (slot: number) => void): void {
      spoke.delete(slot); listened.delete(slot);
      const reaction = roles.get(slot);
      if (!reaction) return;
      if (reaction.speaker === slot) {
        roles.delete(slot);
        for (const listener of reaction.listeners) release(listener.slot);
        end(reaction);
      } else dropListener(reaction, slot, false, release);
    },
    has: (slot: number): boolean => roles.has(slot),
    views: (): CitizenChatReaction[] => [...reactions.values()].sort((a, b) => a.startMs - b.startMs || a.speaker - b.speaker).map(view),
    /** After a clock jump: no reaction survives and nothing waits; decided IDs still dedupe. */
    clearTransient(): void { reactions.clear(); roles.clear(); spoke.clear(); listened.clear(); waiting.clear(); lastStartMs = -Infinity; },
    clear(): void { reactions.clear(); roles.clear(); spoke.clear(); listened.clear(); waiting.clear(); seen.clear(); lastStartMs = -Infinity; },
    get stats() { return { reactions: reactions.size, cuesSeen: seen.size, cuesWaiting: waiting.size }; },
  };
}
