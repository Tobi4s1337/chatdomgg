import type { EmoteProvider } from '../types';

/**
 * Where emote bytes may come from. Asset addresses are only ever built from checked provider
 * metadata and must land on that provider's own HTTPS image CDN: no credentials, no unusual port,
 * no query, no fragment, and a path in the provider's documented shape. A redirect is checked
 * against the same rules as the address it came from. Hosts and shapes were verified against the
 * providers' live APIs on 2026-10-31 (see the package README).
 */
export const EMOTE_ASSET_POLICY: Readonly<Record<EmoteProvider, { hosts: readonly string[]; path: RegExp }>> = {
  twitch: { hosts: ['static-cdn.jtvnw.net'], path: /^\/emoticons\/v2\/[A-Za-z0-9_]{1,64}\/(?:static|animated)\/(?:light|dark)\/(?:1\.0|2\.0|3\.0)$/ },
  '7tv': { hosts: ['cdn.7tv.app'], path: /^\/emote\/[A-Za-z0-9]{1,40}\/[1-4]x\.(?:png|gif|webp)$/ },
  bttv: { hosts: ['cdn.betterttv.net'], path: /^\/emote\/[a-f0-9]{24}\/[1-3]x\.(?:png|gif|webp)$/ },
  ffz: { hosts: ['cdn.frankerfacez.com'], path: /^\/emote\/[0-9]{1,12}(?:\/animated)?\/[124](?:\.(?:png|gif|webp))?$/ },
};

/** The provider APIs a catalogue may be read from, fixed per provider. */
export const EMOTE_API_HOSTS: Readonly<Record<EmoteProvider, string>> = {
  twitch: 'api.twitch.tv',
  '7tv': '7tv.io',
  bttv: 'api.betterttv.net',
  ffz: 'api.frankerfacez.com',
};

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function checkAssetUrl(provider: EmoteProvider, address: string): UrlCheck {
  const policy = EMOTE_ASSET_POLICY[provider];
  if (!policy) return { ok: false, reason: 'unknown provider' };
  let url: URL;
  try { url = new URL(address); } catch { return { ok: false, reason: 'not a URL' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not HTTPS' };
  if (url.username || url.password) return { ok: false, reason: 'carries credentials' };
  if (url.port) return { ok: false, reason: 'uses an unusual port' };
  if (url.search || url.hash || address.includes('?') || address.includes('#')) return { ok: false, reason: 'carries a query or fragment' };
  if (!policy.hosts.includes(url.hostname)) return { ok: false, reason: `host ${url.hostname} is not the ${provider} image CDN` };
  if (!policy.path.test(url.pathname)) return { ok: false, reason: 'path is not a documented emote rendition' };
  return { ok: true, url };
}

/** A provider-qualified catalogue key that is always a safe token. */
export function emoteKey(provider: EmoteProvider, providerId: string): string {
  return `${provider}.${providerId}`;
}

// --- Resolved addresses -----------------------------------------------------------------------

function ipv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map(p => /^\d{1,3}$/.test(p) ? Number(p) : NaN);
  return bytes.every(b => b >= 0 && b <= 255) ? bytes : null;
}

function publicIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a! >= 224) return false;
  if (a === 100 && b! >= 64 && b! <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b! >= 16 && b! <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6(text: string): number[] | null {
  let address = text.toLowerCase();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  if (address.includes('%')) return null; // zone IDs only exist for link-local scopes
  let tail: number[] = [];
  if (address.includes('.')) {
    const at = address.lastIndexOf(':'), v4 = ipv4(address.slice(at + 1));
    if (!v4) return null;
    tail = [v4[0]! << 8 | v4[1]!, v4[2]! << 8 | v4[3]!];
    address = address.slice(0, at + 1);
    if (!address.endsWith('::')) address = address.slice(0, -1);
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(':');
    return groups.every(g => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map(g => parseInt(g, 16)) : null;
  };
  const head = parse(halves[0]!), rest = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !rest) return null;
  const known = head.length + rest.length + tail.length;
  if (known > 8 || (halves.length === 1 && known !== 8) || (halves.length === 2 && known === 8)) return null;
  return [...head, ...Array<number>(8 - known).fill(0), ...rest, ...tail];
}

/**
 * True only for a globally routable unicast address. Loopback, private, link-local, carrier NAT,
 * documentation, multicast, unique-local and every IPv6 form that embeds an IPv4 address (mapped,
 * NAT64, 6to4, Teredo) are refused, so a DNS answer cannot steer a fetch into the host's network.
 */
export function isPublicAddress(address: string): boolean {
  const v4 = ipv4(address);
  if (v4) return publicIpv4(v4);
  const v6 = ipv6(address);
  if (!v6) return false;
  const first = v6[0]!;
  if ((first & 0xe000) !== 0x2000) return false; // only 2000::/3 is global unicast
  if (first === 0x2001 && v6[1]! < 0x0200) return false; // 2001::/23 IETF protocol space, incl. Teredo
  if (first === 0x2001 && v6[1] === 0x0db8) return false; // documentation
  if (first === 0x2002) return false; // 6to4
  return true;
}
