import type { KingdomPresenceFrame, Vec3 } from '@chatdom/shared';

/** Local presentation only. A slot is neither a person ID nor a deed. */
export interface CitizenMotionSample {
  readonly slot: number;
  readonly publicName: string | null;
  readonly state: 'walking' | 'home' | 'idle' | 'leaving';
  /** Soles on the settlement surface, in metres. */
  readonly position: Vec3;
  /** Radians, zero faces +Z, positive turns toward +X. */
  readonly heading: number;
  readonly speed: number;
  /** Actual travelled metres, including the departure leg. */
  readonly distance: number;
  readonly walkPhase: number;
  readonly homeLit: boolean;
  /** Exact first home arrival in the kingdom clock; retained while present, null while unlit. */
  readonly homeLitAtMs: number | null;
  readonly opacity: number;
  readonly goalNodeId: string;
  readonly goalReached: boolean;
}

export interface CitizenDestination {
  readonly nodeId: string;
  readonly kind: 'home' | 'street' | 'market';
  readonly position: Vec3;
}

export interface CitizenGoalRequest { readonly slot: number; readonly nodeId: string; readonly startAtMs: number }
export type CitizenGoalResult = { readonly accepted: true } | {
  readonly accepted: false;
  readonly reason: 'absent' | 'unknown-destination' | 'out-of-order' | 'blocked';
};

export interface CitizenRoute {
  readonly slot: number;
  readonly streetIds: readonly string[];
  /** Entry-to-door route. Points include terrain triangle crossings. */
  readonly points: readonly Vec3[];
  readonly cumulativeDistances: Readonly<Float64Array>;
  readonly length: number;
  readonly homeHeading: number;
  readonly destinationNodeId: string;
  readonly destinationKind: CitizenDestination['kind'];
}

export interface CitizenMotionOptions {
  /** Default: a seeded 12–30m local arrival, spread throughout the town. */
  readonly entryDistance?: number;
  /** Default: seeded 1.05–1.35 m/s; the renderer uses travelled distance for gait. */
  readonly speed?: number;
  /** Both feet complete one cycle over this many metres. Default .75m. */
  readonly strideLength?: number;
  /** Normal absence can walk out. Authority loss always hides immediately. */
  readonly leaveMode?: 'walk' | 'hide';
}

export interface CitizenMotion {
  /** Full public frames. Duplicate/old sequence is ignored; backward time resets replay. */
  applyFrame(frame: KingdomPresenceFrame): boolean;
  /** Pure clock sampling: neither rendering cadence nor previous samples affect motion. */
  sample(atMs: number): readonly CitizenMotionSample[];
  routeForSlot(slot: number): CitizenRoute | undefined;
  destinationsForSlot(slot: number): readonly CitizenDestination[];
  requestGoal(goal: CitizenGoalRequest): CitizenGoalResult;
  /** Source unavailable, navigation away, or explicit replay reset. */
  clear(): void;
}
