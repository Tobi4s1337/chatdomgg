import { describe, expect, it } from 'vitest';
import { asksForStagedData, classify, isRealmSocket } from './routes';

/** Classifies a URL the way the public server does: through WHATWG URL parsing first. */
const at = (path: string) => {
  const url = new URL(path, 'http://public.invalid');
  return classify(url.pathname, url.search);
};

describe('the public origin route table', () => {
  it('answers health on /healthz only', () => {
    expect(classify('/healthz', '')).toEqual({ kind: 'health' });
    expect(classify('/healthz/', '')).toEqual({ kind: 'file' });
    expect(classify('/api/healthz', '')).toEqual({ kind: 'not-found', api: true });
  });

  it('sends the sign-in routes to auth', () => {
    for (const path of [
      '/api/realm/session', '/api/realm/ticket', '/api/realm/signout', '/api/realm/auth/start', '/api/realm/auth/callback',
      '/api/realm/simulated-oidc/authorize', '/api/realm/simulated-oidc/.well-known/openid-configuration',
    ]) expect(classify(path, ''), path).toEqual({ kind: 'auth' });
    for (const path of ['/api/realm/session/extra', '/api/realm/auth/other', '/api/realm/auth', '/api/realm/sessions']) {
      expect(classify(path, ''), path).toEqual({ kind: 'not-found', api: true });
    }
  });

  it('sends the realm routes and its live data to the realm', () => {
    for (const path of [
      '/api/realm/founded/1001', '/api/realm/entry/1001', '/api/realm/watch/1001', '/api/realm/chronicle/1001', '/api/realm/clock',
      '/live-realm-data/api/realm/chronicle/1001', '/live-realm-data/api/realm/clock',
      `/api/realm/founded/scenes/${'a'.repeat(64)}`,
      '/live-realm-data/healthz', '/live-realm-data/api/realm/entry/1001', '/live-realm-data/api/realm/watch/1001',
      '/live-realm-data/matchmake/joinOrCreate/kingdom', '/live-realm-data/matchmake/reconnect/k:1001',
      '/live-realm-data/matchmake/joinById/k:1001', '/live-realm-data/process_123/k:1001',
    ]) expect(classify(path, ''), path).toEqual({ kind: 'realm' });
    for (const path of ['/api/realm/chronicle', '/api/realm/chronicle/001', '/api/realm/chronicle/1001/private', '/api/realm/clock/private', '/live-realm-data/api/realm/clock/private']) expect(classify(path, '')).toEqual({ kind: 'not-found', api: true });
    // A realm verb with nothing after it names no kingdom.
    expect(classify('/api/realm/founded/', '')).toEqual({ kind: 'not-found', api: true });
    expect(classify('/api/realm/entry', '')).toEqual({ kind: 'not-found', api: true });
    expect(classify('/live-realm-datax', '')).toEqual({ kind: 'file' });
  });

  it('sends the panel backend, the door data and the optional services where they belong', () => {
    expect(classify('/api/panel/v1/reading', '')).toEqual({ kind: 'panel' });
    expect(classify('/api/panel/v1/passport', '')).toEqual({ kind: 'panel' });
    expect(classify('/api/panel', '')).toEqual({ kind: 'not-found', api: true });
    expect(classify('/api/public/door', '')).toEqual({ kind: 'door-data' });
    expect(classify('/api/public/door/x', '')).toEqual({ kind: 'not-found', api: true });
    expect(classify('/presence-data/stream', '')).toEqual({ kind: 'optional', service: 'herald' });
    expect(classify('/map-data/v1/preview', '')).toEqual({ kind: 'optional', service: 'map' });
    expect(classify('/forge-data/run', '')).toEqual({ kind: 'optional', service: 'forge' });
    expect(classify('/forge-data/status', '')).toEqual({ kind: 'optional', service: 'forge' });
  });

  it('exposes the existing authenticated dock handler only through its four product routes', () => {
    for (const verb of ['status', 'actions', 'presentations', 'witness']) {
      expect(classify(`/api/dock/${verb}`, '')).toEqual({ kind: 'dock' });
      expect(classify(`/api/dock/${verb}/extra`, '')).toEqual({ kind: 'not-found', api: true });
    }
    for (const path of ['/api/dock/internal', '/api/dock', '/api/dock/action']) {
      expect(classify(path, '')).toEqual({ kind: 'not-found', api: true });
    }
  });

  it('keeps the Surveyor public projections and event streams reachable', () => {
    const preview = 'pv-20261101T120000Z-aaaaaaaaaaaa', frame = 'lf-20261101T120000Z-bbbbbbbbbbbb';
    for (const path of ['/map-data/v1/health', '/map-data/v1/survey', '/map-data/v1/preview',
      ...['world.json', 'region-42.json', 'names'].map(file => `/map-data/v1/preview/${preview}/${file}`),
      `/map-data/v1/live/${preview}`, `/map-data/v1/live/${preview}/events`,
      ...['live.bin', 'starts.json', 'dabs.bin'].map(file => `/map-data/v1/live/${preview}/${frame}/${file}`),
    ]) expect(classify(path, ''), path).toEqual({ kind: 'optional', service: 'map' });
    for (const path of ['/map-data/v1/sql', '/map-data/current.json', `/map-data/v1/preview/${preview}/private.json`,
      `/map-data/v1/live/${preview}/${frame}/manifest.json`, `/map-data/v1/preview/${preview}/worldXjson`,
    ]) expect(classify(path, ''), path).toEqual({ kind: 'not-found', api: true });
  });

  it('publishes only the exact channel register and road projections', () => {
    const preview = 'pv-20261101T120000Z-aaaaaaaaaaaa', base = `/map-data/v1/preview/${preview}`;
    for (const suffix of ['search', 'card/123', 'card/login/tobi4s_', 'card/dab/abcdef0123456789',
      'road/123/456', 'road/login/tobi4s_/mashad4']) expect(classify(`${base}/${suffix}`, '?q=willow')).toEqual({ kind: 'optional', service: 'map' });
    for (const suffix of ['card/0', 'card/01', 'card/login/Tobi', 'card/login/a%2fb', 'card/dab/abc',
      'road/123', 'road/123/456/private', 'search/private', 'internal']) expect(classify(`${base}/${suffix}`, '')).toEqual({ kind: 'not-found', api: true });
    expect(classify('/map/road/tobi4s_/mashad4', '')).toEqual({ kind: 'page' });
  });

  it('refuses nested service doors and any encoded path before it can reach an upstream decoder', () => {
    for (const prefix of ['/live-realm-data', '/presence-data', '/forge-data', '/map-data']) {
      for (const suffix of ['', '/', '/internal', '/internal/realm/ingress', '/internal/realm/herald',
        '/internal/dock/action', '/live-realm-data/internal/realm/ingress',
        '/%69nternal/realm/ingress', '/%2569nternal/realm/ingress', '/%252569nternal/realm/ingress',
        '/api/realm/watch/1001%2f..%2f..%2f..%2finternal/realm/ingress',
        '/api/realm/watch/1001%252f..%252f..%252f..%252finternal/realm/ingress',
        '/matchmake/reconnect/internal', '/process/internal', '/internal/k:1001', '/reference/session',
      ]) expect(at(`${prefix}${suffix}`), `${prefix}${suffix}`).toEqual({ kind: 'not-found', api: true });
    }
  });

  it('upgrades only actual kingdom room sockets, never a public read or matchmaker endpoint', () => {
    expect(isRealmSocket('/live-realm-data/process_123/k:1001')).toBe(true);
    for (const path of ['/live-realm-data/healthz', '/live-realm-data/api/realm/watch/1001',
      '/live-realm-data/matchmake/reconnect/k:1001', '/live-realm-data/internal/realm/ingress',
      '/live-realm-data/internal/k:1001', '/live-realm-data/process_123/k%3a1001',
    ]) expect(isRealmSocket(path), path).toBe(false);
  });

  it('never publishes the internal service doors', () => {
    for (const path of ['/internal', '/internal/', '/internal/revoke', '/internal/realm/session']) {
      expect(classify(path, ''), path).toEqual({ kind: 'not-found', api: true });
    }
    // Only the exact door is internal; a look-alike name is just a file that will not exist.
    expect(classify('/internals', '')).toEqual({ kind: 'file' });
  });

  it('answers every unknown API path as a 404', () => {
    for (const path of ['/api/', '/api/anything', '/api/realm/', '/api/realm/unknown/1', '/api/internal/revoke']) {
      expect(classify(path, ''), path).toEqual({ kind: 'not-found', api: true });
    }
  });

  it('shows the story page at the bare origin, also when a sign-in outcome returns there', () => {
    for (const search of ['', '?', '?signin=ok', '?signin=denied&signin=again']) expect(classify('/', search), search).toEqual({ kind: 'site', page: 'index' });
  });

  it('serves the site pages at their own addresses, and only there', () => {
    expect(classify('/how-it-works', '')).toEqual({ kind: 'site', page: 'how-it-works' });
    expect(classify('/imprint', '')).toEqual({ kind: 'site', page: 'imprint' });
    expect(classify('/privacy', '?signin=ok')).toEqual({ kind: 'site', page: 'privacy' });
    expect(classify('/terms', '')).toEqual({ kind: 'site', page: 'terms' });
    for (const path of ['/imprint/', '/Privacy', '/terms.html', '/site/index.html', '/how-it-works/x']) expect(classify(path, ''), path).toEqual({ kind: 'file' });
  });

  it('answers robots.txt and the sitemap itself', () => {
    expect(classify('/robots.txt', '')).toEqual({ kind: 'robots' });
    expect(classify('/sitemap.xml', '')).toEqual({ kind: 'sitemap' });
  });

  it('sends the retired showcase to the front page for good', () => {
    expect(classify('/showcase', '')).toEqual({ kind: 'redirect', location: '/' });
    expect(classify('/showcase', '?source=simulated')).toEqual({ kind: 'redirect', location: '/' });
  });

  it('never opens a page on staged data: any fixture or simulated source is a 404', () => {
    for (const search of ['?source=simulated', '?source=SIMULATED', '?fixture=wren', '?fixtures=1', '?simulated=1', '?source=fixture', '?mode=page&fixture=wren&light=dusk']) {
      for (const path of ['/', '/stream', '/panel', '/map', '/kingdom/1001', '/privacy']) expect(classify(path, search), `${path}${search}`).toEqual({ kind: 'staged' });
    }
    for (const search of ['?source=realm&kingdom=1001', '?source=live', '?walk=1&kingdom=1001', '?signin=ok']) expect(asksForStagedData(search), search).toBe(false);
  });

  it('opens the app itself when the bare origin carries any other query', () => {
    expect(classify('/', '?walk=1&kingdom=1001')).toEqual({ kind: 'page' });
    expect(classify('/', '?forge=1')).toEqual({ kind: 'page' });
    expect(classify('/', '?signin=ok&kingdom=1001')).toEqual({ kind: 'page' });
  });

  it('serves the listed product pages and nothing that merely looks like one', () => {
    for (const path of ['/stream', '/panel', '/map', '/map/tobi4s_', '/kingdom/1001', '/-/avatar-builder', '/dock', '/dock/']) {
      expect(classify(path, ''), path).toEqual({ kind: 'page' });
    }
    for (const path of ['/showcase/', '/map/Tobi4s', '/map/a-b', '/map/abcdefghijklmnopqrstuvwxyz', '/kingdom/0', '/kingdom/01', '/kingdom/abc', '/kingdom/1001/x', '/bench', '/-/other', '/dock/bench', '/-/citizen-card', '/-/citizen-card/bench']) {
      expect(classify(path, ''), path).toEqual({ kind: 'file' });
    }
  });

  it('serves the grand view with its channel, hour and camera query', () => {
    expect(at('/-/grand')).toEqual({ kind: 'page' });
    expect(at('/-/grand?channel=tobi4s_&hour=19.5&view=hero')).toEqual({ kind: 'page' });
    expect(at('/-/grand?channel=The_AGGman&hour=17&view=coast')).toEqual({ kind: 'page' });
    for (const path of ['/-/grand/', '/-/grand/bench', '/-/grand-artisans']) {
      expect(at(path), path).toEqual({ kind: 'file' });
    }
  });

  it('leaves everything else to the built files', () => {
    expect(classify('/assets/index-AbCdEf12.js', '')).toEqual({ kind: 'file' });
    expect(classify('/site/assets/site-AbCdEf12.css', '')).toEqual({ kind: 'file' });
    expect(classify('/favicon.ico', '')).toEqual({ kind: 'file' });
  });

  it('resolves traversal attempts before routing, so none reaches past the build or into a service door', () => {
    // URL parsing collapses dot segments (plain and percent-encoded) before the route table sees the path.
    expect(at('/assets/../../../etc/passwd')).toEqual({ kind: 'file' });
    expect(new URL('/assets/../../../etc/passwd', 'http://public.invalid').pathname).toBe('/etc/passwd');
    expect(new URL('/%2e%2e/%2e%2e/etc/passwd', 'http://public.invalid').pathname).toBe('/etc/passwd');
    // Dotting out of a public route into an internal one lands on the internal route, which is refused.
    expect(at('/api/realm/watch/1/../../../../internal/revoke')).toEqual({ kind: 'not-found', api: true });
    expect(at('/live-realm-data/../internal')).toEqual({ kind: 'not-found', api: true });
    // An encoded slash stays one literal segment: still a file lookup that the build index cannot satisfy.
    const encoded = new URL('/assets/..%2f..%2fetc%2fpasswd', 'http://public.invalid');
    expect(encoded.pathname).toBe('/assets/..%2f..%2fetc%2fpasswd');
    expect(classify(encoded.pathname, encoded.search)).toEqual({ kind: 'file' });
    for (const path of ['/assets/../../../etc/passwd', '/%2e%2e/secret', '/a/./b/../../../x']) {
      expect(new URL(path, 'http://public.invalid').pathname.split('/')).not.toContain('..');
    }
  });
});
