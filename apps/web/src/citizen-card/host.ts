import type { CitizenKey } from '@chatdom/shared';
import type { CardAssetRef, CitizenCardDocument } from '../../../api/src/citizen-card/contracts';

export type { CardAssetRef, CitizenCardDocument };

/** What the host's card authority answered for one subject. */
export type CardLoad =
  | { readonly status: 'ready'; readonly document: CitizenCardDocument }
  /** There is no card for this person in this kingdom. */
  | { readonly status: 'missing' }
  /** The card was taken down (privacy, erasure, a veil). Nothing of the old card is kept. */
  | { readonly status: 'withdrawn' }
  /** The authority could not answer just now. */
  | { readonly status: 'unavailable' };

/** Cues for the host's existing sound kit; the card never creates audio of its own. */
export type CardCue = 'open' | 'close' | 'press';

/** The time of day the card is read in: parchment warms at dusk and is candlelit at night. */
export type CardLight = 'day' | 'dusk' | 'night';

/**
 * Everything the card needs from where it is mounted. The card resolves no person itself: the host binds the
 * subject's `CitizenKey` from main's identity service (an avatar, a house, `!card`, a share URL).
 * A public or stream host has no mutation capabilities to give.
 */
export interface CardHost {
  /** Reads the current public document. The card aborts the signal when the subject changes or it closes. */
  load(key: CitizenKey, signal: AbortSignal): Promise<CardLoad>;
  /**
   * The URL of one approved asset at exactly this revision, or null for the designed missing-image state.
   * Never an arbitrary location: the host maps refs to its asset route or to object URLs it owns.
   */
  assetUrl(ref: CardAssetRef, key: CitizenKey): string | null;
  /** Dialog mode: close the card; the host restores camera and world input. */
  close?(): void;
  /** Follows a same-origin path from the document (a home, a kingdom). */
  navigate?(path: string): void;
  cue?(cue: CardCue): void;
}
