import type { KingdomId, VoxelBlueprint } from './deps';

/** Consumer-facing emote contracts from Spec 24. Additional helpers live beside them. */
export type EmoteProvider = 'twitch' | '7tv' | 'bttv' | 'ffz';
export type EmotePurpose = 'statue' | 'heraldry' | 'motif' | 'effect';
export type EmoteOrigin = 'live' | 'simulated';
export type EmoteRendition = 'png' | 'gif' | 'webp';

export interface EmoteSource {
  /** Token-safe provider-qualified key, e.g. `twitch.emotesv2_1a2b`. */
  id: string;
  provider: EmoteProvider;
  providerId: string;
  kingdomId: KingdomId;
  name: string;
  origin: EmoteOrigin;
  /** SHA-256 of the fetched bytes, never of a URL or the mutable provider name. */
  sourceHash: string;
  rendition: EmoteRendition;
}

export interface DecodedEmoteFrame {
  /** Straight (not premultiplied) RGBA, row-major from the top-left source origin. */
  rgba: Uint8Array;
  durationMs: number;
}

export interface DecodedEmote {
  width: number;
  height: number;
  /** Every frame is the full coalesced logical canvas. */
  frames: readonly DecodedEmoteFrame[];
}

export interface EmoteMask {
  width: number;
  height: number;
  /** First frame's front silhouette; x contiguous, Y up, material 0 is air. */
  materialIds: Uint16Array;
}

export interface EmoteVoxelFrame {
  blueprint: VoxelBlueprint;
  durationMs: number;
}

export interface CompiledEmote {
  id: string;
  revision: string;
  origin: EmoteOrigin;
  purpose: EmotePurpose;
  sourceHash: string;
  geometryHash: string;
  compilerVersion: string;
  paletteRevision: number;
  targetHeightCells: number;
  frames: readonly EmoteVoxelFrame[];
  periodMs: number;
  mask: EmoteMask;
}

export interface ApprovedEmoteVisual {
  id: string;
  revision: string;
  origin: EmoteOrigin;
  purpose: EmotePurpose;
  frames: readonly EmoteVoxelFrame[];
  periodMs: number;
  mask: EmoteMask;
}

export type EmoteResolution = ApprovedEmoteVisual | null;

export interface InlineEmoteVisual {
  id: string;
  revision: string;
  origin: EmoteOrigin;
  alt: string;
  mediaType: 'image/png' | 'image/gif' | 'image/webp';
  bytes: Uint8Array;
}

export interface EmoteCatalogueView {
  kingdomId: KingdomId;
  revision: number;
  checkedAt: number;
  health: 'current' | 'stale' | 'unavailable';
  resolveApprovedEmote(id: string, purpose: EmotePurpose): EmoteResolution;
  resolveInlineEmote(id: string): InlineEmoteVisual | null;
}

export interface EmoteImageDecoder {
  decode(bytes: Uint8Array, format: EmoteRendition, signal: AbortSignal): Promise<DecodedEmote>;
}

export type EmoteMotifKind = 'stained-glass' | 'weathervane' | 'door-knocker' | 'chimney-smoke';

export interface EmoteMotifGeometry {
  blueprint: VoxelBlueprint;
  mount: readonly [number, number, number];
  emitter: readonly [number, number, number] | null;
  provenance: { emoteId: string; revision: string; kingdomId: KingdomId; origin: EmoteOrigin };
}

export interface EmoteReveal {
  id: string;
  kingdomId: KingdomId;
  emoteId: string;
  revision: string;
  streamEpoch: string;
  origin: EmoteOrigin;
}

/** What the caller asks of one compilation. Bounds per purpose live in `EMOTE_PROFILES`. */
export interface EmoteCompileProfile {
  purpose: EmotePurpose;
  /** Extrusion depth in build cells, clamped to the purpose's bounds (2–6 at most). */
  depthCells?: number;
  /** Occupied height in build cells, clamped to the purpose's bounds. */
  targetHeightCells?: number;
  /** The kingdom palette revision this allowed-material subset belongs to. */
  paletteRevision: number;
}

export interface EmoteCompileInput {
  source: EmoteSource;
  decoded: DecodedEmote;
}

export type EmoteCompileFailureCode =
  | 'invalid-source' | 'over-budget' | 'empty' | 'unsupported-aspect' | 'invalid-palette' | 'invalid-profile';

export type EmoteCompileResult =
  | { ok: true; emote: CompiledEmote; stats: EmoteCompileStats }
  | { ok: false; code: EmoteCompileFailureCode; message: string };

export interface EmoteCompileStats {
  /** Common grid every frame shares: width, height, depth in build cells. */
  size: readonly [number, number, number];
  /** Source-pixel rectangle the grid samples, shared by every frame: x, y, width, height. */
  crop: readonly [number, number, number, number];
  cellsPerSourcePixel: number;
  occupiedCells: number;
  boxes: number;
  materials: readonly number[];
  speckleCleaned: number;
}
