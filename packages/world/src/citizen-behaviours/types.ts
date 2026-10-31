import type { CitizenChatCue } from '@chatdom/shared';
import type { CitizenDestination, CitizenGoalRequest, CitizenGoalResult, CitizenMotionSample } from '../citizens/types';

/** One fixed policy step. Everything here is public, local presentation input. */
export interface CitizenBehaviourInput {
  readonly kingdomId: string;
  readonly epoch: string;
  readonly origin: 'live' | 'simulated';
  /** Kingdom clock of this step, in milliseconds. Steps must not run backwards without a reset. */
  readonly atMs: number;
  /** Main's actual motion samples at `atMs`: the only people this policy may animate. */
  readonly samples: readonly CitizenMotionSample[];
  /**
   * Slots whose bodies ambient routines may move or pose. Walker input, royal acts and
   * reserved spectacle actions are excluded by the caller; excluded people can still be looked at.
   */
  readonly ambientSlots: ReadonlySet<number>;
  /** Main's approved destinations for a slot (`motion.destinationsForSlot`). Never a list the policy invents. */
  readonly destinationsFor: (slot: number) => readonly CitizenDestination[];
  /** Main's actual answers to the goals this policy returned in the previous step. */
  readonly answers?: readonly CitizenGoalAnswer[];
  /**
   * Main's sanitized chat cues (`CitizenChatCueSchema`-validated). Passing the same cues again on
   * later steps is safe: each ID is decided once. Only identity, source, slot and timing are read.
   */
  readonly cues?: readonly CitizenChatCueSignal[];
}

/**
 * The fields of a `CitizenChatCue` this policy may read. The words (`parts`) are not part of the
 * type, and the policy keeps none of the cue object: only these fields are copied.
 */
export type CitizenChatCueSignal = Pick<CitizenChatCue, 'id' | 'kingdomId' | 'epoch' | 'origin' | 'slot' | 'asOf' | 'expiresAt'>;

/** What became of one cue at a step. Slots and IDs only. */
export interface CitizenCueNote {
  readonly id: string;
  readonly slot: number;
  readonly atMs: number;
  /**
   * `reacted` turned heads; `coalesced` the speaker is already in a reaction or resting from one;
   * `crowded` a reaction is already under way nearby or too many are; `duplicate` this ID was decided;
   * `expired`, `stale` (said before this body was present or first seen too late), `foreign` (another
   * kingdom, epoch or origin) and `absent` (no present body for the slot) are discarded.
   */
  readonly outcome: 'reacted' | 'coalesced' | 'crowded' | 'duplicate' | 'expired' | 'stale' | 'foreign' | 'absent';
}

/** A chat line's reaction: one finite nod for its speaker and a short look from at most two neighbours. */
export interface CitizenChatReaction {
  readonly cueId: string;
  readonly origin: 'live' | 'simulated';
  readonly speaker: number;
  /** False once the speaker is under walker, royal or reserved control: they are looked at, never posed. */
  readonly speakerNods: boolean;
  readonly startMs: number;
  readonly nodAtMs: number;
  readonly nodEndMs: number;
  /** Staggered looks toward the speaker; each eases in at `atMs`, holds, and is back at rest at `endMs`. */
  readonly listeners: readonly { readonly slot: number; readonly atMs: number; readonly outAtMs: number; readonly endMs: number }[];
  readonly endMs: number;
}

/** One goal the caller forwarded to `motion.requestGoal`, and main's actual result. */
export interface CitizenGoalAnswer {
  readonly request: CitizenGoalRequest;
  readonly result: CitizenGoalResult;
}

export type CitizenRoutineKind = 'arriving' | 'home' | 'stroll' | 'market' | 'held';
/** Where a person is in their routine. Slot-only presentation state, never a record. */
export interface CitizenRoutineView {
  readonly slot: number;
  readonly routine: CitizenRoutineKind;
  /** `walking` toward `nodeId`; `pausing` at a stop; `resting` at home; `waiting` after a refusal. */
  readonly activity: 'walking' | 'pausing' | 'resting' | 'waiting' | 'held';
  readonly nodeId: string | null;
  /** The authored stroll pattern, when the routine is a stroll. */
  readonly pattern: string | null;
  readonly sinceMs: number;
  /** When the pause or rest may end; null while walking or held. */
  readonly untilMs: number | null;
}
/** A routine transition at a step: requested, refused, arrived, taken over or resumed. */
export interface CitizenRoutineTransition {
  readonly slot: number;
  readonly atMs: number;
  readonly kind: 'request' | 'refused' | 'arrive' | 'held' | 'resume';
  readonly routine: CitizenRoutineKind;
  readonly nodeId: string | null;
  /** For `refused`: main's reason, or `unanswered` when no result came back. */
  readonly reason?: Exclude<CitizenGoalResult, { accepted: true }>['reason'] | 'unanswered';
  /** For `arrive`: how long the pause or rest that begins here may last before the next step of the routine. */
  readonly pauseMs?: number;
}

/** Only the existing renderer vocabulary: no speech pose, timed pose queue or skeleton access. */
export interface CitizenOverlay {
  readonly gesture: 'none' | 'nod' | 'wave';
  /** Head yaw relative to the body heading, radians, already clamped and eased. */
  readonly lookYaw: number;
  /** Renderer gesture clock in seconds from the gesture's start (plus the authored phase). */
  readonly time: number;
}

/** A semantic transition for tests and the bench: who noticed whom, and when. Slots only. */
export interface CitizenEncounter {
  readonly greeter: number;
  readonly recipient: number;
  readonly gesture: 'nod' | 'wave';
  /** The greeter's head starts to turn. */
  readonly startMs: number;
  /** The nod or wave begins. */
  readonly poseAtMs: number;
  readonly poseEndMs: number;
  /** The head has settled back to rest. */
  readonly endMs: number;
  /** The recipient's glance, when the recipient is free and ambient. */
  readonly glanceAtMs: number | null;
}

export interface CitizenBehaviourStep {
  readonly atMs: number;
  /** Per-slot overlays at `atMs`; slots without an entry render their normal idle or gait. */
  readonly overlays: ReadonlyMap<number, CitizenOverlay>;
  /** Encounters active after this step. */
  readonly encounters: readonly CitizenEncounter[];
  /** Encounters that began in this step. */
  readonly started: readonly CitizenEncounter[];
  /** Goals for the caller to forward to `motion.requestGoal`, in order; at most `maxGoalsPerStep`. */
  readonly goals: readonly CitizenGoalRequest[];
  /** Routine transitions in this step. */
  readonly transitions: readonly CitizenRoutineTransition[];
  /** Every supplied person's routine after this step, by slot. */
  readonly routines: readonly CitizenRoutineView[];
  /** Chat reactions active after this step, and those that began in it. */
  readonly reactions: readonly CitizenChatReaction[];
  readonly reacted: readonly CitizenChatReaction[];
  /** The outcome of every cue decided in this step. */
  readonly cues: readonly CitizenCueNote[];
}

export interface CitizenBehaviourStats {
  readonly actors: number;
  readonly contacts: number;
  readonly cooldowns: number;
  readonly encounters: number;
  readonly releases: number;
  /** Stops currently claimed so two people never stand on one point. */
  readonly claims: number;
  /** Goals awaiting main's answer. */
  readonly pending: number;
  /** Active chat reactions; cue IDs retained until they expire; cues waiting for their time or a stagger. */
  readonly reactions: number;
  readonly cuesSeen: number;
  readonly cuesWaiting: number;
}

export interface CitizenBehaviours {
  /** Advance one fixed policy step from main's actual motion samples. Deterministic, no listeners. */
  step(input: CitizenBehaviourInput): CitizenBehaviourStep;
  /**
   * Overlays at a render time on or after the latest step, from the same encounter timelines
   * and the render-time samples. Rendering cadence never changes who greets or when.
   */
  present(samples: readonly CitizenMotionSample[], atMs: number): ReadonlyMap<number, CitizenOverlay>;
  /** Drop every transient actor, contact, cooldown and pose. */
  reset(): void;
  readonly stats: CitizenBehaviourStats;
}
