import { EMOTE_SOURCE_LIMITS } from '../profiles';
import type { EmoteProvider } from '../types';
import { checkAssetUrl, EMOTE_API_HOSTS, isPublicAddress } from './policy';
import { EmoteTransportError, type AuthorizedEmoteTransport } from './types';
import type { ThirdPartyProvider } from './refresh';

/**
 * A pinned HTTP GET: the host connects to exactly `address` (already checked as public) while
 * using the URL's hostname for TLS SNI, certificate checks and the Host header, and never follows
 * redirects itself. Pinning the connection to the checked answer is what closes the DNS
 * rebinding window between "resolve and check" and "connect". `createNodePinnedGet` in
 * `server/node.ts` is the Node implementation.
 */
export type PinnedGet = (request: { url: URL; address: string; family: 4 | 6; headers: Readonly<Record<string, string>>; signal: AbortSignal }) =>
  Promise<{ status: number; headers: { get(name: string): string | null }; body: AsyncIterable<Uint8Array>; cancel(): Promise<void> | void }>;

export interface CheckedTransportOptions {
  get: PinnedGet;
  /** DNS: every address the hostname resolves to. All must be public, or the request is refused. */
  resolve(hostname: string, signal: AbortSignal): Promise<readonly { address: string; family: 4 | 6 }[]>;
  /**
   * Helix credentials from the host's token store (`Client-Id` and `Authorization: Bearer …`).
   * Never logged, never returned. Omit it where no Twitch credentials are bound: Helix reads then
   * fail as `unavailable`.
   */
  helixHeaders?: (signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
  maxRedirects?: number;
}

/** A large 7TV channel set (about 1,000 emotes with every file listed) is about 2.4 MB of JSON. */
const JSON_LIMIT = 8 * 1024 * 1024;

/** Third-party catalogue reads, keyed by the broadcaster's Twitch user ID (see README for shapes). */
export const PROVIDER_CATALOGUE_URLS: Readonly<Record<ThirdPartyProvider, (channelId: string) => string>> = {
  '7tv': id => `https://${EMOTE_API_HOSTS['7tv']}/v3/users/twitch/${id}`,
  bttv: id => `https://${EMOTE_API_HOSTS.bttv}/3/cached/users/twitch/${id}`,
  ffz: id => `https://${EMOTE_API_HOSTS.ffz}/v1/room/id/${id}`,
};

/**
 * The real Spec 24 transport over a pinned GET: fixed API hosts, checked CDN addresses, public-only
 * resolved addresses on every hop, redirects re-checked against the same provider policy, and
 * streaming byte limits that never trust Content-Length.
 */
export function createCheckedEmoteTransport(options: CheckedTransportOptions): AuthorizedEmoteTransport {
  const maxRedirects = options.maxRedirects ?? 3;

  async function fetchBytes(start: URL, allowed: (url: URL) => boolean, headers: Readonly<Record<string, string>>, limit: number, signal: AbortSignal): Promise<Uint8Array> {
    let url = start;
    for (let hop = 0; ; hop++) {
      if (!allowed(url)) throw new EmoteTransportError('policy', `Refused ${hop ? 'a redirect' : 'an address'} outside the provider’s checked hosts.`);
      const answers = await options.resolve(url.hostname, signal).catch(() => { throw new EmoteTransportError('network', `Could not resolve ${url.hostname}.`); });
      if (!answers.length) throw new EmoteTransportError('network', `${url.hostname} has no address.`);
      if (!answers.every(answer => isPublicAddress(answer.address))) throw new EmoteTransportError('policy', `${url.hostname} resolves to a private or reserved address.`);
      const pinned = answers[0]!;
      let response: Awaited<ReturnType<PinnedGet>>;
      try {
        response = await options.get({ url, address: pinned.address, family: pinned.family, headers, signal });
      } catch (error) {
        if (signal.aborted) throw new EmoteTransportError('timeout', 'The provider did not answer in time.');
        throw new EmoteTransportError('network', error instanceof Error ? `The provider could not be reached (${error.name}).` : 'The provider could not be reached.');
      }
      if (response.status >= 300 && response.status < 400) {
        await response.cancel();
        const location = response.headers.get('location');
        if (!location || hop >= maxRedirects) throw new EmoteTransportError('policy', 'Too many or empty redirects.');
        try { url = new URL(location, url); } catch { throw new EmoteTransportError('policy', 'A redirect has no valid address.'); }
        continue;
      }
      if (response.status !== 200) {
        await response.cancel();
        if (response.status === 404) throw new EmoteTransportError('not-found', 'The provider has no such channel or image.');
        if (response.status === 401 || response.status === 403) throw new EmoteTransportError('auth', `The provider refused the credentials (${response.status}).`);
        if (response.status === 429) throw new EmoteTransportError('rate-limited', 'The provider rate limit is spent.');
        throw new EmoteTransportError('network', `The provider answered ${response.status}.`);
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > limit) { await response.cancel(); throw new EmoteTransportError('too-large', 'The response is larger than allowed.'); }
      // Content-Length can lie or be absent; the stream itself is counted.
      const parts: Uint8Array[] = [];
      let total = 0;
      try {
        for await (const part of response.body) {
          total += part.length;
          if (total > limit) { await response.cancel(); throw new EmoteTransportError('too-large', 'The response is larger than allowed.'); }
          parts.push(part);
        }
      } catch (error) {
        if (error instanceof EmoteTransportError) throw error;
        if (signal.aborted) throw new EmoteTransportError('timeout', 'The provider did not finish in time.');
        throw new EmoteTransportError('network', 'The response was cut off.');
      }
      const out = new Uint8Array(total);
      let at = 0;
      for (const part of parts) { out.set(part, at); at += part.length; }
      return out;
    }
  }

  async function fetchJson(url: URL, headers: Readonly<Record<string, string>>, signal: AbortSignal): Promise<unknown> {
    const host = url.hostname;
    const bytes = await fetchBytes(url, next => next.protocol === 'https:' && next.hostname === host && !next.port && !next.username && !next.password, headers, JSON_LIMIT, signal);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new EmoteTransportError('network', 'The provider answered with something that is not JSON.'); }
  }

  return {
    async getHelix(path, query, signal) {
      if (path !== 'chat/emotes' || !/^[0-9]{1,20}$/.test(query.broadcaster_id)) throw new EmoteTransportError('policy', 'Only Get Channel Emotes for a Twitch user ID is allowed.');
      if (!options.helixHeaders) throw new EmoteTransportError('unavailable', 'No Twitch credentials are bound to the emote reader.');
      const headers = await options.helixHeaders(signal);
      return fetchJson(new URL(`https://${EMOTE_API_HOSTS.twitch}/helix/chat/emotes?broadcaster_id=${query.broadcaster_id}`), headers, signal);
    },
    async getProviderCatalogue(provider, channelId, signal) {
      const build = PROVIDER_CATALOGUE_URLS[provider];
      if (!build || !/^[0-9]{1,20}$/.test(channelId)) throw new EmoteTransportError('policy', 'Unknown provider or channel ID.');
      return fetchJson(new URL(build(channelId)), { accept: 'application/json' }, signal);
    },
    async getAsset(provider: EmoteProvider, checkedRendition, signal) {
      const first = checkAssetUrl(provider, checkedRendition);
      if (!first.ok) throw new EmoteTransportError('policy', `The image address ${first.reason}.`);
      return fetchBytes(first.url, url => checkAssetUrl(provider, url.href).ok, { accept: 'image/png,image/gif,image/webp' }, EMOTE_SOURCE_LIMITS.compressedBytes, signal);
    },
  };
}
