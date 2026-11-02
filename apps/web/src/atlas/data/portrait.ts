/** Short-lived presentation, never part of the map's immutable land or bulk names. */
export interface ChannelPortrait { url: string; freshUntil: number }
export const PORTRAIT_MAX_AGE_MS = 86_400_000;
const CLOCK_GRACE_MS = 60_000;
/** The same bounded CDN path accepted by the observation importer. */
export const PORTRAIT_URL = /^https:\/\/static-cdn\.jtvnw\.net\/[A-Za-z0-9_./%-]+$/;

/** Recheck on display: a cached reply cannot keep a picture alive past its source fact's day. */
export function portraitUrl(portrait: ChannelPortrait | null | undefined, now = Date.now()): string | null {
  return portrait && portrait.url.length <= 256 && PORTRAIT_URL.test(portrait.url)
    && Number.isSafeInteger(portrait.freshUntil) && portrait.freshUntil > now
    && portrait.freshUntil <= now + PORTRAIT_MAX_AGE_MS + CLOCK_GRACE_MS ? portrait.url : null;
}
