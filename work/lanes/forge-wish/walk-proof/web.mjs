// The served web build for the walk proof: one production build of apps/web, served per lock cycle by `vite preview`
// with the app's own proxies (apps/web/vite.config.ts). Their realm target is pointed at the realm's owned Unix socket,
// so a cycle needs one loopback TCP port; proxies to other host services are removed.
// Only main.tsx is replaced, by a render of the real kingdom entry over the live source labelled SIMULATED
// (main.tsx itself refuses a non-live entry). Sign-in is the real realm-auth HTTP handler with the SIMULATED provider.
import { build, preview } from 'vite';

// The realm routes that apps/web/vite.config.ts proxies to CHATDOM_REALM_TARGET; everything else under /api is answered
// here (sign-in) or refused, so the stock '/api' proxy never forwards anywhere.
const REALM_PREFIXES = ['/api/realm/founded', '/api/realm/entry', '/api/realm/watch', '/api/realm/chronicle', '/api/realm/clock', '/api/realm/forge/chat',
  '/api/realm/forge/queue'];
// Stock proxies to other host services (ports 5187, 5193-5195). Never contacted from this proof.
const FOREIGN = /^\/(?:realm-data|forge-data|map-data|presence-data)(?:\/|$)/;

export const REALM_SENTINEL = 'http://walk-proof-realm.invalid';

const mainSource = `import { render } from 'solid-js/web';
import { createComponent } from 'solid-js';
import './style.css';
import KingdomEntry from './kingdom-entry';
import { createLiveKingdomEntrySource } from './kingdom-entry/live';
const config = await (await fetch('/__walk-proof/config', { cache: 'no-store' })).json();
if (new URLSearchParams(location.search).get('kingdom') !== config.kingdomId) throw new Error('This proof serves one kingdom.');
const source = createLiveKingdomEntrySource({ kingdomId: config.kingdomId, kingdomName: config.kingdomName, origin: 'simulated',
  notice: config.notice, endpoint: location.origin + '/live-realm-data' });
const open = async signal => ({ ...await source(signal), notice: undefined });
render(() => createComponent(KingdomEntry, { open }), document.getElementById('root'));
`;

/** `state` is read per request: { config, socketPath, auth(req, res) => Promise<boolean> }. */
export function walkProofPlugin(repo, state) {
  const main = `${repo}apps/web/src/main.tsx`;
  const middleware = (req, res, next) => {
    const path = new URL(req.url ?? '/', 'http://proof.invalid').pathname;
    const answer = (status, body) => {
      res.statusCode = status; res.setHeader('Cache-Control', 'no-store');
      if (body === undefined) { res.end(); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
    };
    if (path === '/__walk-proof/config') { if (state.config) answer(200, state.config); else answer(503); return; }
    if (FOREIGN.test(path)) { answer(404); return; }
    if (path.startsWith('/api/')) {
      if (REALM_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) { next(); return; }
      if (!state.auth) { answer(503); return; }
      state.auth(req, res).then(handled => { if (!handled) answer(404); },
        () => { if (!res.headersSent) answer(503); else res.destroy(); });
      return;
    }
    next();
  };
  return {
    name: 'forge-wish-walk-proof', enforce: 'pre',
    // apps/web/vite.config.ts builds its proxies from CHATDOM_REALM_TARGET, CHATDOM_API_TARGET and CHATDOM_FORGE_TARGET.
    // `serveWeb` sets the realm target to REALM_SENTINEL; those entries are re-aimed at the realm socket (same rewrite
    // and ws options) and every other entry (the API, the Forge and fixed host service ports) is dropped.
    config(config) {
      for (const proxies of [config.server?.proxy, config.preview?.proxy]) {
        if (!proxies) continue;
        for (const [context, entry] of Object.entries(proxies)) {
          const target = typeof entry === 'string' ? entry : entry?.target;
          // server.proxy and preview.proxy can be the same object: an entry already re-aimed stays.
          if (state.socketPath && target?.socketPath === state.socketPath) continue;
          if (target !== REALM_SENTINEL || !state.socketPath) { delete proxies[context]; continue; }
          proxies[context] = { ...(typeof entry === 'string' ? {} : entry),
            target: { socketPath: state.socketPath, protocol: 'http:', host: 'realm.local' } };
        }
      }
    },
    transform(_code, id) { if (id.split('?')[0] === main) return { code: mainSource, map: null }; },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

const webOptions = (repo, plugin, outDir, cacheDir) => ({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`,
  plugins: [plugin], logLevel: 'error', cacheDir, build: { outDir, emptyOutDir: true } });

export async function buildWeb(repo, plugin, outDir, cacheDir) {
  await build(webOptions(repo, plugin, outDir, cacheDir));
}

/** The app's own preview proxies read these settings when the config is evaluated, so set them first. */
export async function serveWeb(repo, plugin, outDir, cacheDir, port) {
  process.env.CHATDOM_REALM_TARGET = REALM_SENTINEL;
  // Never contacted: the plugin drops these entries (sign-in is answered by the middleware, /forge-data is refused).
  process.env.CHATDOM_API_TARGET = process.env.CHATDOM_FORGE_TARGET = 'http://walk-proof-unused.invalid';
  const server = await preview({ ...webOptions(repo, plugin, outDir, cacheDir), preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
  return { close: async () => { server.httpServer.closeAllConnections?.(); await server.close(); } };
}
