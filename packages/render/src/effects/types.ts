import type { Vec3 } from '@chatdom/shared';

/** Device tiers; each bounds counts, sources, reach and screen coverage independently. */
export type EffectsQuality = 'low' | 'balanced' | 'high';

/** A real place that emits: a fire, a hedge at dusk, a chimney mouth. The id names the source, never a person. */
export type EffectSource = { id: string; position: Vec3 };

export type ShaftSource = EffectSource & { direction: Vec3; length: number; radius: number };
export type SparkBurst = EffectSource & { burstId: string; startedAt: number };
export type FlightSample = { time: number; position: Vec3 };
export type FlightCue = { id: string; position: Vec3; startedAt: number; active: boolean; history?: readonly FlightSample[] };

/**
 * One snapshot per rendered frame. Positions, wind and shaft dimensions are world metres; `time` is the caller's
 * effect clock in seconds. Arrays are read during `update` only and never retained.
 */
export type EffectsFrame = {
  time: number;
  wind: Vec3;
  fireflies?: readonly EffectSource[];
  embers?: readonly EffectSource[];
  smoke?: readonly EffectSource[];
  dust?: readonly ShaftSource[];
  sparks?: readonly SparkBurst[];
  flight?: FlightCue | null;
};

export type EffectsDiagnostics = {
  quality: EffectsQuality;
  disposed: boolean;
  /** The frame was rejected (non-finite clock) and nothing is drawn. */
  idle: boolean;
  glow: {
    capacity: number;
    count: number;
    fireflySources: number;
    emberSources: number;
    /** Sources dropped as malformed, duplicate, out of reach or over budget this frame. */
    skipped: number;
    /** Upper bound of covered screen pixels: drawn quads × the largest permitted quad. */
    maxCoveragePixels: number;
  };
};

export interface Effects {
  update(frame: EffectsFrame): void;
  setQuality(quality: EffectsQuality): void;
  reset(): void;
  dispose(): void;
  diagnostics(): EffectsDiagnostics;
}
