/**
 * Where each public URL goes. One table, so the origin's surface can be read (and tested) in one place:
 * nothing reaches a service unless it is listed here, and internal service doors are never published.
 */
export type PublicRoute =
  | { readonly kind: 'health' }
  | { readonly kind: 'auth' }
  | { readonly kind: 'realm' }
  | { readonly kind: 'panel' }
  | { readonly kind: 'door-data' }
  | { readonly kind: 'optional'; readonly service: 'herald' | 'map' | 'forge' }
  | { readonly kind: 'door' }
  | { readonly kind: 'page' }
  | { readonly kind: 'file' }
  | { readonly kind: 'not-found'; readonly api: boolean };

const AUTH = /^\/api\/realm\/(?:session|ticket|signout|auth\/(?:start|callback)|simulated-oidc\/.*)$/;
const REALM = /^(?:\/api\/realm\/(?:founded|entry|watch)\/.+|\/live-realm-data(?:\/.*)?)$/;
/**
 * The product's pages. Everything else the web build can draw (lane benches, references) stays off the public
 * origin. A new public page is added here deliberately.
 */
const PAGES = /^\/(?:showcase|stream|panel|map(?:\/[a-z0-9_]{1,25})?|kingdom\/[1-9][0-9]{0,31}|-\/avatar-builder)$/;

export function classify(pathname: string, search: string): PublicRoute {
  if (pathname === '/healthz') return { kind: 'health' };
  if (pathname.startsWith('/internal/') || pathname === '/internal') return { kind: 'not-found', api: true };
  if (AUTH.test(pathname)) return { kind: 'auth' };
  if (REALM.test(pathname)) return { kind: 'realm' };
  if (pathname.startsWith('/api/panel/')) return { kind: 'panel' };
  if (pathname === '/api/public/door') return { kind: 'door-data' };
  if (pathname.startsWith('/presence-data/')) return { kind: 'optional', service: 'herald' };
  if (pathname.startsWith('/map-data/')) return { kind: 'optional', service: 'map' };
  if (pathname.startsWith('/forge-data/')) return { kind: 'optional', service: 'forge' };
  if (pathname.startsWith('/api/')) return { kind: 'not-found', api: true };
  if (pathname === '/') {
    // The bare origin is the front door; a sign-in outcome returning there still lands on it. Any other query
    // (`?walk=1&kingdom=…`, `?forge=1`) is the app itself.
    const params = new URLSearchParams(search);
    params.delete('signin');
    return [...params.keys()].length === 0 ? { kind: 'door' } : { kind: 'page' };
  }
  if (PAGES.test(pathname)) return { kind: 'page' };
  return { kind: 'file' };
}
