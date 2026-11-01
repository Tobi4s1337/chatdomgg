/**
 * The panel's reading from the kingdom (Extension backend → Chatdom panel). Browser-safe: no Node imports, no zod,
 * so the panel zip carries only this small reader. Every reply crosses `readPanelReading` before the panel uses it;
 * anything that does not fit is unavailable, never half-shown.
 *
 * What a reading may contain is exactly what the viewer's own card shows them: their public Twitch name and chat
 * colour, their home here and its street, the date their home was raised, and their other homes (after they have
 * signed in to Chatdom). Never a token, an opaque id, another person or anything Twitch keeps private.
 */
export const PANEL_ROUTES = { reading: '/api/panel/v1/reading', passport: '/api/panel/v1/passport' } as const;

export type PanelHomeTier = 'hut' | 'cottage' | 'house' | 'manor' | 'hall';

export interface PanelCardWire {
  readonly name: string;
  readonly colour: string | null;
  readonly standing: string;
  readonly following: null;
  readonly subscribed: null;
  readonly home: { readonly name: string; readonly tier: PanelHomeTier | null } | null;
  readonly elsewhere: readonly { readonly kingdom: string; readonly home: string }[];
}

export interface PanelHomeWire {
  readonly street: string;
  /** Where on the street and in which quarter, in words. */
  readonly place: string;
  readonly description: string;
  /** The day the kingdom raised this home for them ("1 Nov 2026"). */
  readonly since: string;
}

export type PanelViewerWire =
  /** Logged out of Twitch: nobody to read for. */
  | { readonly kind: 'anonymous' }
  /** Logged in, but they have not shared who they are with Chatdom. */
  | { readonly kind: 'unshared' }
  /** Shared, but Twitch could not tell us their public name just now. */
  | { readonly kind: 'unknown'; readonly reason: string }
  | { readonly kind: 'citizen'; readonly card: PanelCardWire; readonly home: PanelHomeWire }
  /** Three homes kept elsewhere: their light here burns as a guest's. */
  | { readonly kind: 'guest'; readonly card: PanelCardWire }
  /** Known to Twitch, no home here yet. */
  | { readonly kind: 'newcomer'; readonly card: PanelCardWire }
  /** The streamer, whose home is the castle. */
  | { readonly kind: 'monarch'; readonly card: PanelCardWire };

export interface PanelReading {
  readonly version: 1;
  /** Null when this channel has no kingdom yet. */
  readonly kingdom: {
    readonly name: string;
    readonly tier: 'hamlet' | 'town';
    readonly motto: string;
    /** The absolute https address of the kingdom's walk-in gate on Chatdom. */
    readonly walk: string;
  } | null;
  readonly viewer: PanelViewerWire;
}

const TIERS = new Set(['hut', 'cottage', 'house', 'manor', 'hall']);
const CONTROL = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/u;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);

function readCard(value: unknown): PanelCardWire | null {
  if (!object(value) || !exact(value, ['name', 'colour', 'standing', 'following', 'subscribed', 'home', 'elsewhere'])) return null;
  if (!text(value.name, 128) || !text(value.standing, 160) || value.following !== null || value.subscribed !== null) return null;
  if (value.colour !== null && !(typeof value.colour === 'string' && /^#[0-9a-f]{6}$/.test(value.colour))) return null;
  let home: PanelCardWire['home'] = null;
  if (value.home !== null) {
    if (!object(value.home) || !exact(value.home, ['name', 'tier']) || !text(value.home.name, 128)) return null;
    if (value.home.tier !== null && !TIERS.has(value.home.tier as string)) return null;
    home = { name: value.home.name, tier: value.home.tier as PanelHomeTier | null };
  }
  if (!Array.isArray(value.elsewhere) || value.elsewhere.length > 3) return null;
  const elsewhere: { kingdom: string; home: string }[] = [];
  for (const item of value.elsewhere) {
    if (!object(item) || !exact(item, ['kingdom', 'home']) || !text(item.kingdom, 128) || !text(item.home, 160)) return null;
    elsewhere.push({ kingdom: item.kingdom, home: item.home });
  }
  return { name: value.name, colour: value.colour as string | null, standing: value.standing, following: null, subscribed: null, home, elsewhere };
}

function readViewer(value: unknown): PanelViewerWire | null {
  if (!object(value)) return null;
  switch (value.kind) {
    case 'anonymous': case 'unshared': return exact(value, ['kind']) ? { kind: value.kind } : null;
    case 'unknown': return exact(value, ['kind', 'reason']) && text(value.reason, 240) ? { kind: 'unknown', reason: value.reason } : null;
    case 'guest': case 'newcomer': case 'monarch': {
      const card = exact(value, ['kind', 'card']) ? readCard(value.card) : null;
      return card ? { kind: value.kind, card } : null;
    }
    case 'citizen': {
      if (!exact(value, ['kind', 'card', 'home']) || !object(value.home) || !exact(value.home, ['street', 'place', 'description', 'since'])) return null;
      const card = readCard(value.card), home = value.home;
      if (!card || !card.home || !text(home.street, 128) || !text(home.place, 240) || !text(home.description, 400) || !text(home.since, 40)) return null;
      return { kind: 'citizen', card, home: { street: home.street, place: home.place, description: home.description, since: home.since } };
    }
    default: return null;
  }
}

/** The boundary reader. Null means the reply is not a reading the panel may show. */
export function readPanelReading(value: unknown): PanelReading | null {
  if (!object(value) || !exact(value, ['version', 'kingdom', 'viewer']) || value.version !== 1) return null;
  let kingdom: PanelReading['kingdom'] = null;
  if (value.kingdom !== null) {
    const k = value.kingdom;
    if (!object(k) || !exact(k, ['name', 'tier', 'motto', 'walk']) || !text(k.name, 80) || !text(k.motto, 120)) return null;
    if (k.tier !== 'hamlet' && k.tier !== 'town') return null;
    if (typeof k.walk !== 'string' || k.walk.length > 300) return null;
    let walk: URL;
    try { walk = new URL(k.walk); } catch { return null; }
    if (walk.protocol !== 'https:' && !(walk.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(walk.hostname))) return null;
    kingdom = { name: k.name, tier: k.tier, motto: k.motto, walk: walk.toString() };
  }
  const viewer = readViewer(value.viewer);
  return viewer ? { version: 1, kingdom, viewer } : null;
}
