import type { CitizenChatCue } from '@chatdom/shared';

/**
 * How long a bubble stays up once it is first seen: long enough to read at an unhurried pace. About two and a half
 * seconds to notice it, sixty milliseconds per character to read it, and never more than twelve seconds, so a busy
 * street keeps moving. An emote reads like a short word.
 */
export const SPEECH_NOTICE_MS = 2_500;
export const SPEECH_MS_PER_CHARACTER = 60;
export const SPEECH_MAX_HOLD_MS = 12_000;
const EMOTE_CHARACTERS = 4;

export function speechCharacters(parts: CitizenChatCue['parts']): number {
  let count = 0;
  for (const part of parts) count += part.kind === 'text' ? [...part.text].length : EMOTE_CHARACTERS;
  return count;
}

export function speechReadingMs(parts: CitizenChatCue['parts']): number {
  return Math.min(SPEECH_MAX_HOLD_MS, SPEECH_NOTICE_MS + SPEECH_MS_PER_CHARACTER * speechCharacters(parts));
}

/** The moment a bubble may go: its reading time from when it was first seen, and never before the server's expiry. */
export function speechHoldUntil(cue: Pick<CitizenChatCue, 'parts' | 'expiresAt'>, firstSeenMs: number): number {
  return Math.max(cue.expiresAt, firstSeenMs + speechReadingMs(cue.parts));
}

/** Fade times for the label layer. Reduced motion keeps the fades (they are not movement) but drops every drift. */
export const LABEL_FADE_IN_MS = 220;
export const LABEL_FADE_OUT_MS = 280;
/** A bubble rises this far into place as it appears; zero under reduced motion. */
export const BUBBLE_RISE_PX = 10;
