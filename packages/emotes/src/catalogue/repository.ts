import type { KingdomId, PersonId } from '../deps';
import type { EmotePurpose, EmoteReveal } from '../types';
import type { EmoteCatalogueSnapshot, ThirdPartyProvider } from './refresh';

/**
 * What one candidate's approval binds. Changing any field reopens review (Spec 24 R5): the source
 * bytes, the carved geometry, the compiler, the kingdom palette revision, the purpose and the scale.
 */
export interface EmoteApprovalBinding {
  sourceHash: string;
  geometryHash: string;
  compilerVersion: string;
  paletteRevision: number;
  purpose: EmotePurpose;
  targetHeightCells: number;
}

/**
 * - `pending-luna`: carved and stored, waiting for the reviewer.
 * - `held`, `cold`, `refused`: the reviewer's private outcome; never public, never on stream.
 * - `pending-monarch`: the reviewer approved this exact geometry; the monarch has not confirmed it.
 * - `confirmed`: both gates passed; it is unveiled at the next live moment.
 * - `published`: unveiled in a live stream epoch; resolvers serve it.
 * - `retired`: withdrawn quietly (source changed or removed, provider off, replaced, palette moved on).
 */
export type EmoteCandidateState = 'pending-luna' | 'held' | 'cold' | 'refused' | 'pending-monarch' | 'confirmed' | 'published' | 'retired';
export type EmoteRetireReason = 'source-changed' | 'source-removed' | 'provider-withdrawn' | 'replaced' | 'palette-changed' | 'compiler-changed';

export interface EmoteCandidateRecord extends EmoteApprovalBinding {
  id: string;
  /** The compiled revision, e.g. `statue.<24 hex>`. */
  revision: string;
  state: EmoteCandidateState;
  frames: number;
  periodMs: number;
  /** Content address of the serialized compiled geometry in the blob port. */
  blobHash: string;
  createdAt: number;
  luna: {
    requestId: string | null;
    decision: 'approve' | 'hold' | 'refuse' | 'cold' | null;
    receiptId: string | null;
    reviewedGeometryHash: string | null;
    at: number | null;
  };
  monarch: { confirmedBy: PersonId | null; at: number | null };
  published: { epoch: string; at: number; revealId: string } | null;
  retired: { reason: EmoteRetireReason; at: number } | null;
}

/** The monarch picked this source, as it was when they looked at it, for this purpose. */
export interface EmoteSelection {
  id: string;
  purpose: EmotePurpose;
  sourceHash: string;
  selectedBy: PersonId;
  selectedAt: number;
}

export interface EmoteRevealRecord {
  reveal: EmoteReveal;
  createdAt: number;
  acknowledgedAt: number | null;
}

/**
 * Everything the catalogue service persists for one kingdom. Plain JSON: no bytes, no class
 * instances, no functions, so a database row or document stores it as is. Source and compiled bytes
 * live in the separate content-addressed blob port and are referenced here by hash only.
 */
export interface EmoteStoredState {
  version: 1;
  kingdomId: KingdomId;
  /** Compare-and-swap revision; every committed change increments it by one. */
  revision: number;
  /** Monarch's provider opt-ins. Twitch is always on; the others start off. */
  providers: Record<ThirdPartyProvider, boolean>;
  snapshot: EmoteCatalogueSnapshot | null;
  selections: EmoteSelection[];
  candidates: EmoteCandidateRecord[];
  reveals: EmoteRevealRecord[];
  /** The authoritative stream state the host last reported. */
  stream: { live: boolean; epoch: string | null; atMs: number } | null;
  refreshedAt: number | null;
}

/** Persistence port. Main binds the durable implementation; nothing is exposed before its CAS commits. */
export interface EmoteRepository {
  load(kingdomId: KingdomId): Promise<EmoteStoredState | null>;
  /**
   * Atomically stores `next` when the stored revision equals `expectedRevision` (0 when nothing is
   * stored yet). Returns false on a conflict; throws only when storage itself is unavailable.
   */
  compareAndSwap(kingdomId: KingdomId, expectedRevision: number, next: EmoteStoredState): Promise<boolean>;
}

export class EmoteRepositoryError extends Error {
  constructor(message: string) { super(message); this.name = 'EmoteRepositoryError'; }
}

export function emptyEmoteState(kingdomId: KingdomId): EmoteStoredState {
  return {
    version: 1, kingdomId, revision: 0, providers: { '7tv': false, bttv: false, ffz: false },
    snapshot: null, selections: [], candidates: [], reveals: [], stream: null, refreshedAt: null,
  };
}

/**
 * Bounded in-memory repository for tests and the workshop bench. It copies through JSON on the way in
 * and out, which also proves the stored state is serializable. It is never durable production storage.
 */
export function createMemoryEmoteRepository(limits: { maxKingdoms: number; maxStateBytes: number } = { maxKingdoms: 64, maxStateBytes: 8 * 1024 * 1024 }): EmoteRepository & { readonly kingdoms: number } {
  const rows = new Map<string, { revision: number; json: string }>();
  return {
    get kingdoms() { return rows.size; },
    async load(kingdomId) {
      const row = rows.get(kingdomId);
      return row ? JSON.parse(row.json) as EmoteStoredState : null;
    },
    async compareAndSwap(kingdomId, expectedRevision, next) {
      const row = rows.get(kingdomId);
      if ((row?.revision ?? 0) !== expectedRevision) return false;
      if (next.kingdomId !== kingdomId || next.revision !== expectedRevision + 1) throw new EmoteRepositoryError('The next state must belong to this kingdom and follow the expected revision.');
      if (!row && rows.size >= limits.maxKingdoms) throw new EmoteRepositoryError('The memory repository is full.');
      const json = JSON.stringify(next);
      if (json.length > limits.maxStateBytes) throw new EmoteRepositoryError('The kingdom emote state is larger than the store allows.');
      rows.set(kingdomId, { revision: next.revision, json });
      return true;
    },
  };
}
