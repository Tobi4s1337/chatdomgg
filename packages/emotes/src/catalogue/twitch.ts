import { EMOTE_SOURCE_LIMITS } from '../profiles';
import { checkAssetUrl, emoteKey } from './policy';
import { EmoteTransportError, type AuthorizedEmoteTransport, type EmoteCatalogueAdapter, type EmoteCatalogueEntry, type ProviderCatalogueResult, type SkippedCatalogueEntry } from './types';

/**
 * Twitch Get Channel Emotes (`GET helix/chat/emotes?broadcaster_id=…`, app or user token).
 * Each item lists the `format`s, `scale`s and `theme_mode`s Twitch serves, and the response carries
 * a URL `template` with `{{id}}`, `{{format}}`, `{{theme_mode}}` and `{{scale}}`. Animated emotes are
 * served as GIF from the `animated` format and still ones as PNG from `static`; this adapter only
 * builds addresses from that metadata. There is no pagination and no popularity in the response,
 * so API order means nothing: entries come back sorted by provider ID.
 */

const ID = /^[A-Za-z0-9_]{1,64}$/;
const TEMPLATE_PREFIX = 'https://static-cdn.jtvnw.net/emoticons/v2/';
const SCALES = ['3.0', '2.0', '1.0'] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] | null => Array.isArray(value) && value.every(v => typeof v === 'string') ? value : null;

export function unavailable(provider: ProviderCatalogueResult['provider'], error: unknown): ProviderCatalogueResult {
  if (error instanceof EmoteTransportError) return { status: 'unavailable', provider, reason: error.kind, message: error.message };
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) return { status: 'unavailable', provider, reason: 'timeout', message: 'The provider did not answer in time.' };
  return { status: 'unavailable', provider, reason: 'network', message: 'The provider could not be reached.' };
}

export function createTwitchEmoteAdapter(transport: AuthorizedEmoteTransport): EmoteCatalogueAdapter {
  return {
    provider: 'twitch',
    async fetchCatalogue({ channelId }, signal) {
      if (!/^[0-9]{1,20}$/.test(channelId)) return { status: 'unavailable', provider: 'twitch', reason: 'malformed', message: 'The broadcaster ID is not a Twitch user ID.' };
      let body: unknown;
      try { body = await transport.getHelix('chat/emotes', { broadcaster_id: channelId }, signal); } catch (error) { return unavailable('twitch', error); }
      return parseTwitchChannelEmotes(body);
    },
  };
}

/** Parses a Get Channel Emotes body. A malformed envelope is an outage, never an empty catalogue. */
export function parseTwitchChannelEmotes(body: unknown): ProviderCatalogueResult {
  const malformed = (message: string): ProviderCatalogueResult => ({ status: 'unavailable', provider: 'twitch', reason: 'malformed', message });
  if (!isObject(body) || !Array.isArray(body.data)) return malformed('Twitch answered without an emote list.');
  const template = body.template;
  if (typeof template !== 'string' || !template.startsWith(TEMPLATE_PREFIX) || !['{{id}}', '{{format}}', '{{theme_mode}}', '{{scale}}'].every(p => template.includes(p))) {
    // An empty list may come without a usable template; anything else needs one to build addresses.
    if (body.data.length === 0) return { status: 'ok', provider: 'twitch', entries: [], skipped: [], truncated: false };
    return malformed('Twitch answered with an unexpected image address template.');
  }
  const entries = new Map<string, EmoteCatalogueEntry>(), skipped: SkippedCatalogueEntry[] = [];
  for (const item of body.data) {
    if (!isObject(item)) { skipped.push({ providerId: '', name: '', reason: 'not an emote object' }); continue; }
    const id = item.id, name = item.name, formats = strings(item.format), scales = strings(item.scale), themes = strings(item.theme_mode);
    const providerId = typeof id === 'string' ? id : '', label = typeof name === 'string' ? name.slice(0, 64) : '';
    if (!ID.test(providerId)) { skipped.push({ providerId: providerId.slice(0, 64), name: label, reason: 'the emote ID is not a safe token' }); continue; }
    if (!label || label.length > 64 || /\s/.test(label)) { skipped.push({ providerId, name: label, reason: 'the emote has no usable name' }); continue; }
    if (!formats || !scales || !themes) { skipped.push({ providerId, name: label, reason: 'the emote lists no renditions' }); continue; }
    const animated = formats.includes('animated');
    if (!animated && !formats.includes('static')) { skipped.push({ providerId, name: label, reason: 'no static or animated rendition is offered' }); continue; }
    const scale = SCALES.find(s => scales.includes(s)), theme = themes.includes('dark') ? 'dark' : themes.includes('light') ? 'light' : undefined;
    if (!scale || !theme) { skipped.push({ providerId, name: label, reason: 'no documented scale or theme is offered' }); continue; }
    const asset = template.replace('{{id}}', providerId).replace('{{format}}', animated ? 'animated' : 'static').replace('{{theme_mode}}', theme).replace('{{scale}}', scale);
    const checked = checkAssetUrl('twitch', asset);
    if (!checked.ok) { skipped.push({ providerId, name: label, reason: `the image address ${checked.reason}` }); continue; }
    if (entries.has(providerId)) continue;
    entries.set(providerId, {
      id: emoteKey('twitch', providerId), provider: 'twitch', providerId, name: label, animated, rendition: animated ? 'gif' : 'png', asset: checked.url.href,
      twitch: { emoteType: typeof item.emote_type === 'string' ? item.emote_type : 'unknown', tier: typeof item.tier === 'string' && item.tier ? item.tier : null, setId: typeof item.emote_set_id === 'string' ? item.emote_set_id : '' },
    });
  }
  const sorted = [...entries.values()].sort((a, b) => a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0);
  return { status: 'ok', provider: 'twitch', entries: sorted.slice(0, EMOTE_SOURCE_LIMITS.providerEntries), skipped, truncated: sorted.length > EMOTE_SOURCE_LIMITS.providerEntries };
}
