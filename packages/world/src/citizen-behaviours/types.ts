import type { CitizenMotionSample } from '../citizens/types';

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
}

export interface CitizenBehaviourStats {
  readonly actors: number;
  readonly contacts: number;
  readonly cooldowns: number;
  readonly encounters: number;
  readonly releases: number;
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
