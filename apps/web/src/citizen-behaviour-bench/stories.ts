import { createCitizenMotion } from '@chatdom/world';
import { createSimulatedChat, type NeighbourStreet, type SimulatedChat } from '../../../../packages/world/src/citizen-behaviours/fixture';
import type {
  CitizenChatReaction, CitizenCueNote, CitizenEncounter, CitizenGoalAnswer, CitizenRoutineKind, CitizenRoutineTransition,
} from '../../../../packages/world/src/citizen-behaviours';
import { createBehaviourLoop, type BehaviourLoopSource } from './loop';

/** One stretch of a person's routine, read back from the policy's own transitions. */
export interface RoutineBeat {
  readonly kind: 'rest' | 'walk' | 'pause' | 'wait';
  readonly fromMs: number;
  readonly toMs: number;
  readonly nodeId: string | null;
  readonly routine: CitizenRoutineKind;
}
/** A complete excursion: from the doorstep rest before it to the doorstep rest after it. */
export interface RoutineStory {
  readonly slot: number;
  readonly kind: 'stroll' | 'market' | 'closed';
  readonly beats: readonly RoutineBeat[];
  readonly startMs: number;
  readonly endMs: number;
}
export interface ScoutedStreet {
  readonly encounter: CitizenEncounter | null;
  readonly stroll: RoutineStory | null;
  readonly market: RoutineStory | null;
  readonly closed: RoutineStory | null;
}

const STEP_MS = 100;

/** The labelled simulation of a market square closed by main's reserved action: motion is never asked. */
export function closedMarketGate(marketNodeId: string): NonNullable<BehaviourLoopSource['gate']> {
  return (request: CitizenGoalAnswer['request']) => request.nodeId === marketNodeId ? { accepted: false, reason: 'blocked' } : null;
}

/** Beats of one slot between two times, from its request/refused/arrive transitions. */
function beatsFor(transitions: readonly CitizenRoutineTransition[], slot: number, fromMs: number, toMs: number): RoutineBeat[] {
  const own = transitions.filter(item => item.slot === slot && item.atMs >= fromMs && item.atMs <= toMs);
  const beats: RoutineBeat[] = [];
  let open: { kind: RoutineBeat['kind']; fromMs: number; nodeId: string | null; routine: CitizenRoutineKind } | null = null;
  const close = (atMs: number): void => { if (open && atMs > open.fromMs) beats.push({ ...open, toMs: atMs }); open = null; };
  for (const item of own) {
    if (item.kind === 'arrive') { close(item.atMs); open = { kind: item.routine === 'home' ? 'rest' : 'pause', fromMs: item.atMs, nodeId: item.nodeId, routine: item.routine }; }
    else if (item.kind === 'request') { close(item.atMs); open = { kind: 'walk', fromMs: item.atMs + STEP_MS, nodeId: item.nodeId, routine: item.routine }; }
    else if (item.kind === 'refused') { close(item.atMs); open = { kind: 'wait', fromMs: item.atMs, nodeId: item.nodeId, routine: item.routine }; }
  }
  close(toMs);
  return beats;
}

/** The first complete excursion matching `wanted`, framed by the doorstep rests around it. */
function excursion(transitions: readonly CitizenRoutineTransition[], kind: RoutineStory['kind'], wanted: (item: CitizenRoutineTransition) => boolean): RoutineStory | null {
  for (const start of transitions) {
    if (!wanted(start)) continue;
    const own = transitions.filter(item => item.slot === start.slot);
    const before = own.filter(item => item.kind === 'arrive' && item.routine === 'home' && item.atMs < start.atMs).at(-1);
    const after = own.find(item => item.kind === 'arrive' && item.routine === 'home' && item.atMs > start.atMs
      && own.some(stop => stop.kind === 'arrive' && stop.routine !== 'home' && stop.atMs > start.atMs && stop.atMs < item.atMs));
    if (!before || !after) continue;
    const startMs = Math.max(before.atMs, start.atMs - 6_000), endMs = after.atMs + 7_000;
    const beats = beatsFor(transitions, start.slot, before.atMs, endMs).map(beat => ({ ...beat, fromMs: Math.max(beat.fromMs, startMs) }));
    return { slot: start.slot, kind, beats: beats.filter(beat => beat.toMs > beat.fromMs), startMs, endMs };
  }
  return null;
}

/**
 * Plays the labelled simulated story through the real motion and policy once, and reads back the
 * moments the bench shows: the first greeting, a stroll, a market visit and, with the market
 * closed by a simulated reserved action, a refusal handled at the door.
 */
export function scoutStreet(street: NeighbourStreet, source: Omit<BehaviourLoopSource, 'frameAt' | 'ambientAt' | 'gate'>, startMs: number, untilMs: number): ScoutedStreet {
  const everyone = new Set(street.slots);
  const play = (gate?: BehaviourLoopSource['gate']) => {
    const loop = createBehaviourLoop(createCitizenMotion(street.plan), { ...source, frameAt: atMs => street.frameAt(atMs), ambientAt: () => everyone, ...(gate ? { gate } : {}) });
    const transitions: CitizenRoutineTransition[] = [], started: CitizenEncounter[] = [];
    for (let now = startMs; now <= untilMs; now += STEP_MS) for (const step of loop.advance(now)) { transitions.push(...step.transitions); started.push(...step.started); }
    return { transitions, started };
  };
  const market = street.plan.market.nodeId, plain = play(), closed = play(closedMarketGate(market));
  const refused = closed.transitions.find(item => item.kind === 'refused' && item.nodeId === market);
  return {
    encounter: plain.started[0] ?? null,
    stroll: excursion(plain.transitions, 'stroll', item => item.kind === 'request' && item.routine === 'stroll'
      && plain.transitions.some(stop => stop.slot === item.slot && stop.kind === 'arrive' && stop.routine === 'stroll' && stop.atMs > item.atMs && (stop.pauseMs ?? 0) >= 3_500)),
    market: excursion(plain.transitions, 'market', item => item.kind === 'request' && item.nodeId === market),
    closed: refused ? excursion(closed.transitions, 'closed', item => item === refused) : null,
  };
}

export interface ScoutedChat {
  readonly reactions: readonly CitizenChatReaction[];
  /** Every cue decision except the per-step duplicates of an ID already decided. */
  readonly notes: readonly CitizenCueNote[];
  readonly moments: SimulatedChat['moments'];
  readonly departures: ReadonlyMap<number, number>;
}

/** A loop source that plays the SIMULATED chat script through the real motion and policy, restarting with the loop. */
export function chatSource(street: NeighbourStreet, source: Omit<BehaviourLoopSource, 'frameAt' | 'ambientAt'>) {
  let script = createSimulatedChat(street);
  const everyone = new Set(street.slots);
  const loopSource: BehaviourLoopSource = { ...source,
    frameAt: atMs => street.frameAt(atMs, script.departures),
    ambientAt: atMs => { const held = script.controlledAt(atMs); return held.size ? new Set(street.slots.filter(slot => !held.has(slot))) : everyone; },
    cuesAt: (atMs, samples) => script.cuesAt(atMs, samples),
    resetsAt: atMs => script.resetsAt(atMs),
    restart: () => { script = createSimulatedChat(street); } };
  return { source: loopSource, get script(): SimulatedChat { return script; } };
}

/** Plays the SIMULATED chat story once and reads back each line's reaction and every cue's outcome. */
export function scoutChat(street: NeighbourStreet, source: Omit<BehaviourLoopSource, 'frameAt' | 'ambientAt' | 'gate'>, startMs: number, untilMs: number): ScoutedChat {
  const chat = chatSource(street, source), loop = createBehaviourLoop(createCitizenMotion(street.plan), chat.source);
  const reactions: CitizenChatReaction[] = [], notes: CitizenCueNote[] = [];
  for (let now = startMs; now <= untilMs; now += STEP_MS) for (const step of loop.advance(now)) {
    reactions.push(...step.reacted); notes.push(...step.cues.filter(note => note.outcome !== 'duplicate'));
  }
  return { reactions, notes, moments: chat.script.moments, departures: chat.script.departures };
}
