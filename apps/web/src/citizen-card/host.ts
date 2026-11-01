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

/**
 * One earned piece the citizen wears, as the host's look authority names it (`EarnedOffer.name` and `.story` for a
 * piece their verified records unlock). Not part of the public card document: a host supplies it beside the card
 * only for pieces the saved look really wears, and the card never infers one.
 */
export interface CardWorn {
  readonly name: string;
  /** What it remembers ("Rode the raid to Emberfold, 30 Oct 2026"), or null when the record tells no story. */
  readonly story: string | null;
  /**
   * It remembers a journey (a keepsake from the road, a raid's scarf), so its name and story are travel. Whenever the
   * card keeps its travels private the piece is left off the card and its picture altogether.
   */
  readonly travel: boolean;
}

/** The worn pieces a card may name: travel pieces only while its passport is disclosed. */
export function disclosedWorn(pieces: readonly CardWorn[], passport: { readonly hidden: boolean }): readonly CardWorn[] {
  return passport.hidden ? pieces.filter(piece => !piece.travel) : pieces;
}

/** Cues for the host's existing sound kit; the card never creates audio of its own. */
export type CardCue = 'open' | 'close' | 'press';

/** The time of day the card is read in: parchment warms at dusk and is candlelit at night. */
export type CardLight = 'day' | 'dusk' | 'night';

/**
 * Where one card is shared from, supplied by the host after authorization: its canonical public page (whose Open
 * Graph image is the picture) and the picture's current route. Never the identity payload or a session in a query.
 */
export interface CardShareLinks {
  readonly pageUrl: string;
  readonly imageUrl: string;
}

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
  /**
   * Page mode: the share links for the card actually shown, or null when it is not shared (a withdrawn image, a
   * stream or public host without the capability). Without it there is no share shelf.
   */
  share?(document: CitizenCardDocument): CardShareLinks | null;
}
