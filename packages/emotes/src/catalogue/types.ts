import type { KingdomId } from '../deps';
import type { EmoteProvider, EmoteRendition } from '../types';

/**
 * The Spec 24 transport port. The host owns tokens, token renewal, the shared Twitch rate budget
 * and the checked network policy; the browser never holds it. Failures are thrown as
 * `EmoteTransportError` so adapters can tell an outage from a channel with nothing on a provider.
 */
export interface AuthorizedEmoteTransport {
  getHelix(path: 'chat/emotes', query: { broadcaster_id: string }, signal: AbortSignal): Promise<unknown>;
  getProviderCatalogue(provider: Exclude<EmoteProvider, 'twitch'>, channelId: string, signal: AbortSignal): Promise<unknown>;
  getAsset(provider: EmoteProvider, checkedRendition: string, signal: AbortSignal): Promise<Uint8Array>;
}

/**
 * - `not-found`: the provider answered that this channel (or asset) does not exist there.
 * - `auth`: the host's credentials were refused. `rate-limited`: the shared budget is spent.
 * - `timeout`, `network`: no trustworthy answer arrived. `policy`: the address or a redirect broke
 *   the checked network policy. `too-large`: the body passed its byte limit while streaming.
 * - `unavailable`: no transport is bound in this environment at all.
 */
export type EmoteTransportFailure = 'not-found' | 'auth' | 'rate-limited' | 'timeout' | 'network' | 'policy' | 'too-large' | 'unavailable';

export class EmoteTransportError extends Error {
  readonly kind: EmoteTransportFailure;
  constructor(kind: EmoteTransportFailure, message: string) {
    super(message);
    this.name = 'EmoteTransportError';
    this.kind = kind;
  }
}

/** One emote a provider lists for the channel, parsed from checked metadata. Private provenance. */
export interface EmoteCatalogueEntry {
  /** Provider-qualified token-safe key, e.g. `twitch.emotesv2_1a2b` or `7tv.01F6…`. */
  id: string;
  provider: EmoteProvider;
  providerId: string;
  /** The code chat types. Mutable on every provider: never used as identity. */
  name: string;
  animated: boolean;
  /** The image format the provider documents for `asset`, never guessed from an extension swap. */
  rendition: EmoteRendition;
  /** A checked HTTPS address on the provider's image CDN (see `EMOTE_ASSET_POLICY`). */
  asset: string;
  /** Twitch-only facts used for ordering and plaques. */
  twitch?: { emoteType: string; tier: string | null; setId: string };
  /** Third-party credit: the artist or uploader as the provider names them, for private provenance. */
  owner?: { id: string | null; name: string | null };
}

/** An entry the provider listed but this module will not use, with a private explanation. */
export interface SkippedCatalogueEntry {
  providerId: string;
  name: string;
  reason: string;
}

export type ProviderCatalogueResult =
  | { status: 'ok'; provider: EmoteProvider; entries: EmoteCatalogueEntry[]; skipped: SkippedCatalogueEntry[]; truncated: boolean }
  | { status: 'unavailable'; provider: EmoteProvider; reason: EmoteTransportFailure | 'malformed'; message: string };

export interface EmoteCatalogueAdapter {
  readonly provider: EmoteProvider;
  /** `channelId` is the broadcaster's Twitch user ID; every provider keys channels by it. */
  fetchCatalogue(input: { kingdomId: KingdomId; channelId: string }, signal: AbortSignal): Promise<ProviderCatalogueResult>;
}
