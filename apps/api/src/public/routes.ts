/**
 * Where each public URL goes. One table, so the origin's surface can be read (and tested) in one place:
 * nothing reaches a service unless it is listed here, and internal service doors are never published.
 */
export type PublicRoute =
  | { readonly kind: 'health' }
  | { readonly kind: 'auth' }
  | { readonly kind: 'realm' }
  | { readonly kind: 'panel' }
  | { readonly kind: 'dock' }
  | { readonly kind: 'door-data' }
  | { readonly kind: 'optional'; readonly service: 'herald' | 'map' | 'forge' }
  | { readonly kind: 'door' }
  | { readonly kind: 'page' }
  | { readonly kind: 'file' }
  | { readonly kind: 'not-found'; readonly api: boolean };

const AUTH = /^\/api\/realm\/(?:session|ticket|signout|auth\/(?:start|callback)|simulated-oidc\/.*)$/;
const REALM_READ = /^\/api\/realm\/(?:clock|(?:founded|entry|watch|chronicle)\/[1-9][0-9]{0,31}|founded\/scenes\/[a-f0-9]{64})$/;
const MATCHMAKE = /^\/matchmake\/(?:(?:joinOrCreate|create|join)\/kingdom|(?:joinById|reconnect)\/k:[1-9][0-9]{0,31})$/;
const ROOM_SOCKET = /^\/[A-Za-z0-9_-]{1,128}\/k:[1-9][0-9]{0,31}$/;
const REALM_PREFIX = '/live-realm-data';
// These match Surveyor's immutable public projections, not arbitrary files under its data directory.
const PREVIEW_ID = 'pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}';
const FRAME_ID = 'lf-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}';
const MAP_READ = new RegExp(`^/map-data/v1/(?:health|survey|preview(?:/${PREVIEW_ID}/(?:world\\.json|region-[0-9]{1,5}\\.json|names))?|live/${PREVIEW_ID}(?:/events|/${FRAME_ID}/(?:live\\.bin|starts\\.json|dabs\\.bin))?)$`);
const CHANNEL_ID = '[1-9][0-9]{0,31}', LOGIN = '[a-z0-9_]{1,25}';
const MAP_DIRECTORY = new RegExp(`^/map-data/v1/preview/${PREVIEW_ID}/(?:search|card/(?:${CHANNEL_ID}|login/${LOGIN}|dab/[a-f0-9]{16})|road/(?:${CHANNEL_ID}/${CHANNEL_ID}|login/${LOGIN}/${LOGIN}))$`);

/** Only actual Colyseus room paths may upgrade; public HTTP reads never become raw socket tunnels. */
export function isRealmSocket(pathname: string): boolean {
  const upstream = pathname.startsWith(`${REALM_PREFIX}/`) ? pathname.slice(REALM_PREFIX.length) : '';
  return ROOM_SOCKET.test(upstream) && upstream.split('/')[1] !== 'internal';
}
/**
 * The product's pages. Everything else the web build can draw (lane benches, references) stays off the public
 * origin. A new public page is added here deliberately.
 */
const PAGES = /^\/(?:showcase|stream|panel|dock\/?|map(?:\/(?:[a-z0-9_]{1,25}|road\/[a-z0-9_]{1,25}\/[a-z0-9_]{1,25}))?|kingdom\/[1-9][0-9]{0,31}|-\/(?:avatar-builder|citizen-card|grand))$/;

export function classify(pathname: string, search: string): PublicRoute {
  if (pathname === '/healthz') return { kind: 'health' };
  if (pathname.startsWith('/internal/') || pathname === '/internal') return { kind: 'not-found', api: true };
  if (AUTH.test(pathname)) return { kind: 'auth' };
  if (/^\/api\/raid-gate\/crier\/[1-9][0-9]{0,31}$/.test(pathname)) return { kind: 'auth' };
  if (/^\/api\/raid-gate\/guest\/[1-9][0-9]{0,31}$/.test(pathname)) return { kind: 'auth' };
  if (/^\/api\/realm\/forge\/chat\/(?:status|authorize|callback|wish|revoke)$/.test(pathname)) return { kind: 'realm' };
  if (/^\/api\/dock\/(?:status|actions|presentations|witness)$/.test(pathname)) return { kind: 'dock' };
  if (REALM_READ.test(pathname)) return { kind: 'realm' };
  if (/^\/(?:live-realm-data\/)?realm\/(?:raid-roads|raid-pennants\/[1-9][0-9]{0,31})$/.test(pathname)) return { kind: 'realm' };
  if (/^\/(?:live-realm-data\/)?realm\/raid-chat\/[1-9][0-9]{0,31}$/.test(pathname)) return { kind: 'realm' };
  if (pathname === REALM_PREFIX || pathname.startsWith(`${REALM_PREFIX}/`)) {
    const upstream = pathname.slice(REALM_PREFIX.length);
    // Literal route grammar deliberately accepts no percent escapes, repeated prefixes or arbitrary tails:
    // one or several upstream decoders cannot turn an accepted path into an internal service door.
    return REALM_READ.test(upstream) || MATCHMAKE.test(upstream) || upstream === '/healthz' || isRealmSocket(pathname)
      ? { kind: 'realm' } : { kind: 'not-found', api: true };
  }
  if (pathname.startsWith('/api/panel/')) return { kind: 'panel' };
  if (pathname === '/api/public/door') return { kind: 'door-data' };
  if (pathname === '/presence-data/stream') return { kind: 'optional', service: 'herald' };
  if (MAP_READ.test(pathname) || MAP_DIRECTORY.test(pathname)) return { kind: 'optional', service: 'map' };
  if (pathname === '/forge-data/run' || pathname === '/forge-data/status') return { kind: 'optional', service: 'forge' };
  if (/^\/(?:presence-data|map-data|forge-data)(?:\/|$)/.test(pathname)) return { kind: 'not-found', api: true };
  if (pathname.startsWith('/api/')) return { kind: 'not-found', api: true };
  if (pathname === '/') {
    // The bare origin is the front door; a sign-in outcome returning there still lands on it. Any other query
    // (`?walk=1&kingdom=…`, `?forge=1`) is the app itself.
    const params = new URLSearchParams(search);
    params.delete('signin');
    return [...params.keys()].length === 0 ? { kind: 'door' } : { kind: 'page' };
  }
  if (PAGES.test(pathname)) return { kind: 'page' };
  if (/^\/raid\/[1-9][0-9]{0,31}\/[a-f0-9]{32}\/[a-f0-9]{32}$/.test(pathname)) return { kind: 'page' };
  return { kind: 'file' };
}
