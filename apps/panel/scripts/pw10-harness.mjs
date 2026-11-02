import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { request as proxyRequest } from 'node:http';
import { HELPER_URL, helperSource, laneSecret } from '../harness/helper.mjs';

const secret = laneSecret(process.env.PANEL_HARNESS_SECRET_FILE || '/tmp/chatdom-panel-window-extension-secret');
const upstream = new URL(process.env.PANEL_UPSTREAM || 'http://127.0.0.1:5170');
const port = Number(process.env.PANEL_HARNESS_PORT || 5192);
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/harness/helper.js') {
    try {
      const options = Object.fromEntries(url.searchParams);
      options.visible = options.visible !== 'false'; options.playing = options.playing !== 'false'; options.bits = options.bits === 'true';
      res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
      res.end(helperSource(secret, options));
    } catch { res.writeHead(400); res.end('Invalid harness configuration'); }
    return;
  }
  const path = url.pathname.startsWith('/harness/') ? url.pathname.slice('/harness'.length) : url.pathname;
  const proxied = proxyRequest(new URL(path + url.search, upstream), { method: req.method, headers: { ...req.headers, host: upstream.host, 'accept-encoding': 'identity' } }, response => {
    const html = (response.headers['content-type'] || '').includes('text/html');
    if (!html) { res.writeHead(response.statusCode, response.headers); response.pipe(res); return; }
    const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
      const src = '/harness/helper.js' + url.search;
      let body = Buffer.concat(chunks).toString();
      body = body.includes(HELPER_URL) ? body.replace(HELPER_URL, src) : body.replace('</head>', `<script src="${src.replaceAll('&', '&amp;')}"></script></head>`);
      const headers = { ...response.headers, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' };
      delete headers['content-encoding'];
      res.writeHead(response.statusCode, headers); res.end(body);
    });
  });
  proxied.on('error', () => { res.writeHead(502); res.end('Panel development server unavailable'); });
  req.pipe(proxied);
});
server.listen(port, '127.0.0.1', () => console.log(`Panel harness listening on 127.0.0.1:${port}`));
