import { EMOTE_SOURCE_LIMITS } from '../profiles';
import type { EmoteRendition } from '../types';
import { checkAssetUrl, emoteKey } from './policy';
import type { ThirdPartyProvider } from './refresh';
import { unavailable } from './twitch';
import { EmoteTransportError, type AuthorizedEmoteTransport, type EmoteCatalogueAdapter, type EmoteCatalogueEntry, type ProviderCatalogueResult, type SkippedCatalogueEntry } from './types';

/**
 * Read adapters for 7TV, BetterTTV and FrankerFaceZ, written against their live public APIs as
 * checked on 2026-10-31 (shapes, hosts and renditions are recorded in the package README). They
 * only run when the monarch has opted the provider in. A 404 for the channel is an observed answer
 * ("this channel has nothing there") and becomes an empty catalogue; every other failure is an
 * outage. Emotes a provider marks as overlays, modifiers, hidden or sensitive are skipped with a
 * private reason rather than offered for a statue.
 */

type Parsed = { entries: EmoteCatalogueEntry[]; skipped: SkippedCatalogueEntry[] };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 64): string | null => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
/** Emote codes are single words in chat; anything else cannot be typed and is not offered. */
const CODE = /^[^\s\p{Cc}]{1,64}$/u;

function finish(provider: ThirdPartyProvider, parsed: Parsed): ProviderCatalogueResult {
  const unique = new Map<string, EmoteCatalogueEntry>();
  for (const entry of parsed.entries) if (!unique.has(entry.providerId)) unique.set(entry.providerId, entry);
  const sorted = [...unique.values()].sort((a, b) => a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0);
  return { status: 'ok', provider, entries: sorted.slice(0, EMOTE_SOURCE_LIMITS.providerEntries), skipped: parsed.skipped.slice(0, 64), truncated: sorted.length > EMOTE_SOURCE_LIMITS.providerEntries };
}

function entry(provider: ThirdPartyProvider, providerId: string, name: string, animated: boolean, rendition: EmoteRendition, asset: string,
  owner: EmoteCatalogueEntry['owner'], skipped: SkippedCatalogueEntry[]): EmoteCatalogueEntry | null {
  const checked = checkAssetUrl(provider, asset);
  if (!checked.ok) { skipped.push({ providerId, name, reason: `the image address ${checked.reason}` }); return null; }
  return { id: emoteKey(provider, providerId), provider, providerId, name, animated, rendition, asset: checked.url.href, ...(owner ? { owner } : {}) };
}

// --- 7TV: GET https://7tv.io/v3/users/twitch/{id} --------------------------------------------

/** Active-emote flag: a zero-width overlay drawn over the previous emote, not an emote of its own. */
const SEVEN_TV_ZERO_WIDTH = 1;
/** Emote flags: private, zero-width, sexual, epilepsy, edgy and Twitch-disallowed never reach the plaza. */
const SEVEN_TV_REFUSED = 1 | 256 | 1 << 16 | 1 << 17 | 1 << 18 | 1 << 24;
const SEVEN_TV_FORMATS: Readonly<Record<string, EmoteRendition>> = { WEBP: 'webp', GIF: 'gif', PNG: 'png' };

export function parseSevenTv(body: unknown): Parsed | null {
  if (!isObject(body)) return null;
  const set = body.emote_set;
  if (set === null || set === undefined) return { entries: [], skipped: [] };
  if (!isObject(set) || !Array.isArray(set.emotes)) return null;
  const entries: EmoteCatalogueEntry[] = [], skipped: SkippedCatalogueEntry[] = [];
  for (const item of set.emotes.slice(0, 4096)) {
    if (!isObject(item)) continue;
    const providerId = text(item.id, 40) ?? '', name = text(item.name) ?? '', data = item.data;
    if (!/^[A-Za-z0-9]{1,40}$/.test(providerId) || !CODE.test(name)) { skipped.push({ providerId: providerId.slice(0, 40), name: name.slice(0, 64), reason: 'the emote has no usable ID or code' }); continue; }
    if (!isObject(data) || !isObject(data.host) || !Array.isArray(data.host.files)) { skipped.push({ providerId, name, reason: '7TV sent no image files for it' }); continue; }
    const flags = typeof item.flags === 'number' ? item.flags : 0, dataFlags = typeof data.flags === 'number' ? data.flags : 0;
    if (flags & SEVEN_TV_ZERO_WIDTH || dataFlags & SEVEN_TV_REFUSED) { skipped.push({ providerId, name, reason: '7TV marks it as an overlay, private or sensitive emote' }); continue; }
    if (data.listed === false) { skipped.push({ providerId, name, reason: '7TV lists it as unlisted' }); continue; }
    const animated = data.animated === true, host = data.host.url;
    if (typeof host !== 'string' || !host.startsWith('//cdn.7tv.app/emote/')) { skipped.push({ providerId, name, reason: 'the image host is not 7TV’s CDN' }); continue; }
    // Prefer the largest file under the byte limit; animated emotes take WebP then GIF, still ones PNG then WebP.
    const order: readonly EmoteRendition[] = animated ? ['webp', 'gif'] : ['png', 'webp'];
    let best: { name: string; rendition: EmoteRendition; scale: number } | null = null;
    for (const file of data.host.files) {
      if (!isObject(file) || typeof file.name !== 'string' || typeof file.format !== 'string') continue;
      const rendition = SEVEN_TV_FORMATS[file.format], match = /^([1-4])x\.(png|gif|webp)$/.exec(file.name);
      if (!rendition || !match || match[2] !== rendition || !order.includes(rendition)) continue;
      if (typeof file.size === 'number' && file.size > EMOTE_SOURCE_LIMITS.compressedBytes) continue;
      if (animated && typeof file.frame_count === 'number' && file.frame_count > EMOTE_SOURCE_LIMITS.frames) continue;
      const scale = Number(match[1]);
      if (!best || order.indexOf(rendition) < order.indexOf(best.rendition) || (rendition === best.rendition && scale > best.scale)) best = { name: file.name, rendition, scale };
    }
    if (!best) { skipped.push({ providerId, name, reason: animated ? 'no animated WebP or GIF within the limits is offered' : 'no PNG or WebP within the limits is offered' }); continue; }
    const owner = isObject(data.owner) ? { id: text(data.owner.id, 64), name: text(data.owner.display_name) ?? text(data.owner.username) } : undefined;
    const made = entry('7tv', providerId, name, animated, best.rendition, `https:${host}/${best.name}`, owner, skipped);
    if (made) entries.push(made);
  }
  return { entries, skipped };
}

// --- BetterTTV: GET https://api.betterttv.net/3/cached/users/twitch/{id} -----------------------

export function parseBttv(body: unknown): Parsed | null {
  if (!isObject(body) || !Array.isArray(body.channelEmotes) || !Array.isArray(body.sharedEmotes)) return null;
  const entries: EmoteCatalogueEntry[] = [], skipped: SkippedCatalogueEntry[] = [];
  for (const item of [...body.channelEmotes, ...body.sharedEmotes].slice(0, 4096)) {
    if (!isObject(item)) continue;
    const providerId = text(item.id, 24) ?? '', name = text(item.code) ?? '';
    if (!/^[a-f0-9]{24}$/.test(providerId) || !CODE.test(name)) { skipped.push({ providerId: providerId.slice(0, 24), name: name.slice(0, 64), reason: 'the emote has no usable ID or code' }); continue; }
    if (item.modifier === true) { skipped.push({ providerId, name, reason: 'BetterTTV marks it as a modifier, not an emote' }); continue; }
    // `imageType` is deprecated; `animated` decides. Animated emotes are served as animated WebP, still ones as PNG.
    const animated = item.animated === true;
    const user = isObject(item.user) ? item.user : null;
    const owner = user ? { id: text(user.id, 64), name: text(user.displayName) ?? text(user.name) } : { id: text(item.userId, 64), name: null };
    const made = entry('bttv', providerId, name, animated, animated ? 'webp' : 'png', `https://cdn.betterttv.net/emote/${providerId}/3x.${animated ? 'webp' : 'png'}`, owner, skipped);
    if (made) entries.push(made);
  }
  return { entries, skipped };
}

// --- FrankerFaceZ: GET https://api.frankerfacez.com/v1/room/id/{id} --------------------------

/** Modifier flag bit for "hidden": never offered. */
const FFZ_HIDDEN = 1;

export function parseFfz(body: unknown): Parsed | null {
  if (!isObject(body) || !isObject(body.room) || !isObject(body.sets)) return null;
  const entries: EmoteCatalogueEntry[] = [], skipped: SkippedCatalogueEntry[] = [];
  for (const set of Object.values(body.sets).slice(0, 16)) {
    if (!isObject(set) || !Array.isArray(set.emoticons)) continue;
    for (const item of set.emoticons.slice(0, 4096)) {
      if (!isObject(item)) continue;
      const providerId = typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id > 0 ? String(item.id) : '', name = text(item.name) ?? '';
      if (!providerId || !CODE.test(name)) { skipped.push({ providerId, name: name.slice(0, 64), reason: 'the emote has no usable ID or code' }); continue; }
      const modifierFlags = typeof item.modifier_flags === 'number' ? item.modifier_flags : 0;
      if (item.modifier === true || item.hidden === true || modifierFlags & FFZ_HIDDEN) { skipped.push({ providerId, name, reason: 'FrankerFaceZ marks it as a modifier or hidden' }); continue; }
      // Only follow the animated map when the API sends it: a static emote's /animated/ path hangs.
      const animatedUrls = isObject(item.animated) ? item.animated : null, stillUrls = isObject(item.urls) ? item.urls : null;
      const pick = (urls: Record<string, unknown> | null): string | null => {
        for (const scale of ['4', '2', '1']) { const url = urls?.[scale]; if (typeof url === 'string') return url; }
        return null;
      };
      const animated = pick(animatedUrls), still = pick(stillUrls);
      if (!animated && !still) { skipped.push({ providerId, name, reason: 'FrankerFaceZ sent no image address' }); continue; }
      const owner = isObject(item.owner) ? { id: typeof item.owner._id === 'number' ? String(item.owner._id) : null, name: text(item.owner.display_name) ?? text(item.owner.name) } : undefined;
      // FFZ documents appending `.webp` to an animated address; the still address serves PNG as it is.
      const made = animated
        ? entry('ffz', providerId, name, true, 'webp', `${animated}.webp`, owner, skipped)
        : entry('ffz', providerId, name, false, 'png', still!, owner, skipped);
      if (made) entries.push(made);
    }
  }
  return { entries, skipped };
}

const PARSERS: Readonly<Record<ThirdPartyProvider, (body: unknown) => Parsed | null>> = { '7tv': parseSevenTv, bttv: parseBttv, ffz: parseFfz };
const LABEL: Readonly<Record<ThirdPartyProvider, string>> = { '7tv': '7TV', bttv: 'BetterTTV', ffz: 'FrankerFaceZ' };

export function createThirdPartyEmoteAdapter(provider: ThirdPartyProvider, transport: AuthorizedEmoteTransport): EmoteCatalogueAdapter {
  const parse = PARSERS[provider];
  if (!parse) throw new Error(`Unknown emote provider ${String(provider)}.`);
  return {
    provider,
    async fetchCatalogue({ channelId }, signal) {
      if (!/^[0-9]{1,20}$/.test(channelId)) return { status: 'unavailable', provider, reason: 'malformed', message: 'The channel ID is not a Twitch user ID.' };
      let body: unknown;
      try {
        body = await transport.getProviderCatalogue(provider, channelId, signal);
      } catch (error) {
        if (error instanceof EmoteTransportError && error.kind === 'not-found') return { status: 'ok', provider, entries: [], skipped: [], truncated: false };
        return unavailable(provider, error);
      }
      const parsed = parse(body);
      if (!parsed) return { status: 'unavailable', provider, reason: 'malformed', message: `${LABEL[provider]} answered in an unexpected shape.` };
      return finish(provider, parsed);
    },
  };
}
