// One local host for the panel's lane stack: the Extension views, the painter page, the Helper substitute and the
// panel API, all on a single origin. It serves the panel (under /panel/) and the web app's painter page from two Vite
// servers in middleware mode, and passes /api/panel/* to the lane gateway and /api/realm/* to the lane realm.
//
//   node apps/panel/scripts/pw10-stack.mjs            (PANEL_STACK_PORT, PANEL_GATEWAY_TARGET, PANEL_REALM_TARGET)
//
// /panel/panel.html?identity=shared&channel=…&user=… loads the panel with a Helper that signs real HS256 tokens with
// the lane's test secret. Add share=hold to keep Twitch's identity prompt open until the operator answers it, and
// helper=none to open the panel outside Twitch. The Helper never reaches the Extension zip.
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createServer, request as forward } from 'node:http';
import { join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';
import { HELPER_URL, helperSource, laneSecret } from '../harness/helper.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const OPTIONS = ['identity', 'channel', 'user', 'client', 'visible', 'playing', 'bits', 'role', 'share'];

function helperOptions(search) {
  const options = {};
  for (const name of OPTIONS) { const value = search.get(name); if (value !== null) options[name] = value; }
  options.visible = options.visible !== 'false'; options.playing = options.playing !== 'false'; options.bits = options.bits === 'true';
  return options;
}

function pass(req, res, target) {
  const upstream = forward(new URL(req.url, target), { method: req.method, headers: { ...req.headers, host: new URL(target).host } }, response => {
    res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Lane service unavailable'); });
  req.pipe(upstream);
}

/**
 * `gateway: 'in-process'` mounts the real lane gateway inside this host, so the stack needs one port fewer.
 * @param {{ port?: number, gateway?: string, realm?: string, secretFile?: string }} [options]
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startPanelStack(options = {}) {
  const requested = Number(options.port ?? process.env.PANEL_STACK_PORT ?? 5198);
  // A capture-safe lane port, or the lease port 5192 that the real-GPU tunnel forwards.
  const port = requested === 5192 ? requested : assertCapturePort(requested, { name: 'Panel stack port' });
  const gateway = options.gateway ?? process.env.PANEL_GATEWAY_TARGET ?? 'http://127.0.0.1:5171';
  const realm = options.realm ?? process.env.PANEL_REALM_TARGET ?? 'http://127.0.0.1:5170';
  const inProcess = gateway === 'in-process';
  for (const target of inProcess ? [realm] : [gateway, realm]) if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(target)) throw new Error('Lane services must be loopback origins.');
  const secret = laneSecret(options.secretFile ?? process.env.PANEL_HARNESS_SECRET_FILE ?? '/tmp/chatdom-panel-window-extension-secret');
  const origin = `http://localhost:${port}`;
  // The panel calls its backend on this same origin; the gateway lists it among its local origins.
  process.env.VITE_CHATDOM_ORIGIN = origin;
  const { createServer: createVite } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);
  const panelRoot = join(root, 'apps/panel');
  const panel = await createVite({ root: panelRoot, configFile: join(panelRoot, 'vite.config.ts'), base: '/panel/', appType: 'custom',
    logLevel: 'warn', server: { middlewareMode: true, hmr: false, ws: false } });
  const web = await createVite({ root: join(root, 'apps/web'), configFile: join(root, 'apps/web/vite.config.ts'), appType: 'spa',
    logLevel: 'warn', server: { middlewareMode: true, hmr: false, ws: false, proxy: {} },
    // Only the painter page is served here; scanning every bench page is slow and needless.
    optimizeDeps: { entries: ['src/panel-painter/index.tsx'] } });
  let lane = null;
  if (inProcess) {
    const { createLaneGateway, localOrigins } = await import(pathToFileURL(join(root, 'apps/api/src/panel/serve.mjs')).href);
    lane = await createLaneGateway({ realm, publicOrigin: origin, localOrigins: localOrigins([port]) });
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    try {
      if (url.pathname.startsWith('/api/panel/')) {
        if (!lane) return pass(req, res, gateway);
        return void lane.handler(req, res, url.pathname).catch(() => { if (!res.headersSent) res.writeHead(503).end(); else res.destroy(); });
      }
      if (url.pathname.startsWith('/api/realm/')) return pass(req, res, realm);
      if (url.pathname === '/harness/helper.js') {
        res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
        res.end(helperSource(secret, helperOptions(url.searchParams))); return;
      }
      if (url.pathname.startsWith('/panel/') && url.pathname.endsWith('.html')) {
        const file = normalize(join(panelRoot, url.pathname.slice('/panel/'.length)));
        if (!file.startsWith(panelRoot + '/') || file.includes('/src/')) { res.writeHead(404).end(); return; }
        // Vite resolves page scripts against the URL without its base, as its own HTML middleware does.
        let html = await panel.transformIndexHtml(url.pathname.slice('/panel'.length) + url.search, await readFile(file, 'utf8'));
        const helper = `/harness/helper.js${url.search}`;
        const tag = new RegExp(`<script[^>]*src="${HELPER_URL.replaceAll('.', '\\.')}"[^>]*></script>`);
        if (url.searchParams.get('helper') === 'none') html = html.replace(tag, '');
        else html = tag.test(html) ? html.replace(tag, `<script src="${helper.replaceAll('&', '&amp;')}"></script>`)
          : html.replace('</head>', `<script src="${helper.replaceAll('&', '&amp;')}"></script></head>`);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(html) });
        res.end(html); return;
      }
      const host = url.pathname.startsWith('/panel/') ? panel : web;
      host.middlewares(req, res, () => { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); });
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Panel stack error');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    origin,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await Promise.all([panel.close(), web.close(), lane?.close()]);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stack = await startPanelStack();
  console.info(`Panel stack on ${stack.origin}`);
  const stop = () => { void stack.close().then(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
