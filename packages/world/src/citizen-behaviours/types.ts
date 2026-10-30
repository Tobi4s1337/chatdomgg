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
