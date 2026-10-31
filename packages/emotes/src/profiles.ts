import type { EmotePurpose } from './types';

/** Bumping this invalidates every approval bound to an older compiler. */
export const EMOTE_COMPILER_VERSION = 'chatdom-emote-extrude.1';

/** Spec 24 R3 hard limits per fetched source. Decoders and the compiler both enforce them. */
export const EMOTE_SOURCE_LIMITS = {
  compressedBytes: 4 * 1024 * 1024,
  canvas: 512,
  frames: 120,
  coalescedBytes: 32 * 1024 * 1024,
  playbackMs: 30_000,
  networkMs: 10_000,
  concurrentJobsPerKingdom: 2,
  providerEntries: 256,
} as const;

/**
 * Frame delays: GIF and WebP authors often write 0 or 1 centiseconds and expect the browser default.
 * One rule everywhere (decode, review contact sheet, runtime): any delay that is missing, not finite or
 * under 20 ms plays for 100 ms; anything longer than 10 s is held for 10 s. A single-frame emote is
 * static and carries a duration and period of zero.
 */
export const FRAME_DELAY = { minimumMs: 20, defaultMs: 100, maximumMs: 10_000 } as const;

export function normalizeFrameDuration(durationMs: number | undefined): number {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < FRAME_DELAY.minimumMs) return FRAME_DELAY.defaultMs;
  return Math.min(FRAME_DELAY.maximumMs, Math.round(durationMs));
}

export interface EmoteProfileBounds {
  /** Occupied height in build cells (0.125 m). */
  readonly height: readonly [number, number];
  readonly defaultHeight: number;
  /** Widest occupied grid allowed for this purpose; wider sources fit by width or are refused. */
  readonly maxWidth: number;
  readonly depth: readonly [number, number];
  readonly defaultDepth: number;
  readonly maxBoxesPerFrame: number;
  readonly kind: 'civic' | 'prop';
}

/**
 * Statues stand 4–6 m. Heraldry, Forge motifs and effects use smaller authored resolutions so the
 * same emblem reads at door, window and banner size instead of shrinking a statue.
 */
export const EMOTE_PROFILES: Readonly<Record<EmotePurpose, EmoteProfileBounds>> = {
  statue: { height: [32, 48], defaultHeight: 40, maxWidth: 96, depth: [2, 6], defaultDepth: 6, maxBoxesPerFrame: 8000, kind: 'civic' },
  heraldry: { height: [14, 24], defaultHeight: 20, maxWidth: 40, depth: [2, 3], defaultDepth: 2, maxBoxesPerFrame: 2400, kind: 'prop' },
  motif: { height: [10, 16], defaultHeight: 14, maxWidth: 24, depth: [2, 3], defaultDepth: 2, maxBoxesPerFrame: 1200, kind: 'prop' },
  effect: { height: [12, 24], defaultHeight: 16, maxWidth: 40, depth: [2, 4], defaultDepth: 2, maxBoxesPerFrame: 2400, kind: 'prop' },
};

/** Whole-animation compiled budget, checked before anything is meshed or stored. */
export const EMOTE_COMPILED_BUDGET = {
  maxOccupiedCells: 3_000_000,
  maxBoxes: 240_000,
  /** Seven 16-bit fields per stored box. */
  maxStoredBytes: 240_000 * 14,
  maxAllowedMaterials: 64,
} as const;

/** Sampling policy, documented in the package README. */
export const EMOTE_SAMPLING = {
  /** Source pixels at or below this alpha never widen the crop. */
  cropAlpha: 16,
  /** A cell is solid when at least half its area is covered by alpha. */
  occupancy: .5,
  /** Isolated cells within this redmean distance of their surroundings are snapping speckle. */
  speckleDistance: 90,
  /** A material used by this few cells in a frame is suspect when it sits alone. */
  rareCells: 2,
  /** A lone rare cell within this redmean distance of its surroundings is an anti-aliasing fleck; beyond it, a feature. */
  fleckDistance: 150,
  /** Opposite neighbours at least this far apart mark the pixel between them as an anti-aliasing blend. */
  blendContrast: 120,
} as const;
