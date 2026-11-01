import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classify } from './routes';
import { createSite, NEVER_INDEXED, robotsHeaderFor, robotsTxt, sitemapXml, type Indexing } from './site';
import { indexBuild, sendFile, type StaticFile } from './static';

const ORIGIN = 'https://chatdom.io';
const PAGE_HEADERS = { 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' };
const PAGES = { 'site/index.html': 'story', 'site/how-it-works.html': 'how', 'site/imprint.html': 'imprint', 'site/privacy.html': 'privacy',
  'site/terms.html': 'terms', 'site/not-found.html': 'lost', 'index.html': 'app' } as const;

let root: string, files: Map<string, StaticFile>;
const servers = new Map<Indexing, { server: Server; port: number }>();

/** The gateway's own order for these routes: robots header first, then the site, the app page, files, the 404. */
function serve(indexing: Indexing) {
  const site = createSite({ files, indexing, origin: ORIGIN, pageHeaders: PAGE_HEADERS });
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://public.invalid');
    const route = classify(url.pathname, url.search);
    for (const [name, value] of Object.entries(robotsHeaderFor(indexing, route.kind))) response.setHeader(name, value);
    if (route.kind === 'not-found' && route.api) { response.writeHead(404, { 'Content-Type': 'application/json' }).end('{}'); return; }
    if (route.kind === 'auth' || route.kind === 'realm' || route.kind === 'door-data') { response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); return; }
    if (site.handle(request, response, route)) return;
    if (route.kind === 'page') { sendFile(request, response, files.get('/index.html')!, site.appPageHeaders()); return; }
    const file = route.kind === 'file' ? files.get(url.pathname) : undefined;
    if (file && !file.path.endsWith('.html')) { sendFile(request, response, file, { 'X-Content-Type-Options': 'nosniff' }); return; }
    site.notFound(request, response);
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'chatdom-site-'));
  for (const [path, body] of Object.entries({ ...PAGES, 'site/assets/hero-AbCdEf12.webp': 'webp' })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), `<!doctype html><title>${body}</title>`);
  }
  files = await indexBuild(root);
  for (const indexing of ['closed', 'open'] as const) {
    const server = serve(indexing);
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    servers.set(indexing, { server, port: (server.address() as AddressInfo).port });
  }
});

afterAll(async () => {
  for (const { server } of servers.values()) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  await rm(root, { recursive: true, force: true });
});

function get(indexing: Indexing, path: string, method = 'GET') {
  const { port } = servers.get(indexing)!;
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, method, agent: false }, reply => {
      let body = '';
      reply.setEncoding('utf8');
      reply.on('data', (chunk: string) => { body += chunk; });
      reply.on('end', () => resolve({ status: reply.statusCode ?? 0, headers: reply.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

const SITE = [['/', 'story'], ['/how-it-works', 'how'], ['/imprint', 'imprint'], ['/privacy', 'privacy'], ['/terms', 'terms']] as const;

describe('robots.txt and the sitemap', () => {
  it('closes everything while indexing is closed', () => {
    expect(robotsTxt('closed', ORIGIN)).toBe('User-agent: *\nDisallow: /\n');
    expect(sitemapXml('closed', ORIGIN)).not.toContain('<url>');
    expect(sitemapXml('closed', ORIGIN)).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it('opens the product pages and keeps every service and data path out once open', () => {
    const robots = robotsTxt('open', ORIGIN);
    expect(robots).toContain('Allow: /\n');
    expect(robots).not.toContain('Disallow: /\n');
    for (const path of ['/api/', '/live-realm-data/', '/map-data/', '/presence-data/', '/forge-data/', '/internal/', '/-/']) expect(robots).toContain(`Disallow: ${path}\n`);
    expect(NEVER_INDEXED).toHaveLength(7);
    expect(robots).toContain('Sitemap: https://chatdom.io/sitemap.xml');
    const locations = [...sitemapXml('open', ORIGIN).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    expect(locations).toEqual(['/', '/map', '/how-it-works', '/imprint', '/privacy', '/terms'].map(path => `${ORIGIN}${path}`));
  });
});

describe.each(['closed', 'open'] as const)('the site with indexing %s', indexing => {
  const pageRobots = indexing === 'closed' ? 'noindex, nofollow' : undefined;

  it('serves each site page with the page headers', async () => {
    for (const [path, title] of SITE) {
      const reply = await get(indexing, path);
      expect(reply.status, path).toBe(200);
      expect(reply.body, path).toContain(`<title>${title}</title>`);
      expect(reply.headers['content-security-policy'], path).toBe("default-src 'self'");
      expect(reply.headers['x-robots-tag'], path).toBe(pageRobots);
    }
    // A sign-in outcome returning to the front page is still the front page.
    expect((await get(indexing, '/?signin=ok')).body).toContain('<title>story</title>');
  });

  it('treats the app pages like the site pages', async () => {
    const map = await get(indexing, '/map');
    expect(map.body).toContain('<title>app</title>');
    expect(map.headers['x-robots-tag']).toBe(pageRobots);
  });

  it('answers robots.txt and the sitemap as text, never indexed themselves', async () => {
    const robots = await get(indexing, '/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(robots.body).toBe(robotsTxt(indexing, ORIGIN));
    const sitemap = await get(indexing, '/sitemap.xml');
    expect(sitemap.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(sitemap.body).toBe(sitemapXml(indexing, ORIGIN));
    expect(sitemap.body.includes('<url>')).toBe(indexing === 'open');
    const head = await get(indexing, '/robots.txt', 'HEAD');
    expect(head.body).toBe('');
    expect(Number(head.headers['content-length'])).toBe(Buffer.byteLength(robots.body));
  });

  it('moves /showcase to the front page for good', async () => {
    const reply = await get(indexing, '/showcase?source=simulated');
    expect(reply.status).toBe(301);
    expect(reply.headers.location).toBe('/');
  });

  it('answers staged-data requests with the not-found page', async () => {
    for (const path of ['/?source=simulated', '/stream?source=simulated&tier=town', '/panel?source=simulated', '/privacy?fixture=wren', '/map?simulated=1']) {
      const reply = await get(indexing, path);
      expect(reply.status, path).toBe(404);
      expect(reply.body, path).toContain('<title>lost</title>');
      expect(reply.headers['x-robots-tag'], path).toBe('noindex, nofollow');
      expect(reply.headers['content-security-policy'], path).toBe("default-src 'self'");
    }
  });

  it('gives unknown pages and raw HTML files the not-found page', async () => {
    for (const path of ['/nowhere', '/-/citizen-card', '/site/index.html', '/site/not-found.html']) {
      const reply = await get(indexing, path);
      expect(reply.status, path).toBe(404);
      expect(reply.body, path).toContain('<title>lost</title>');
      expect(reply.headers['x-robots-tag'], path).toBe('noindex, nofollow');
    }
  });

  it('never lets service and sign-in answers be indexed', async () => {
    for (const path of ['/api/realm/session', '/api/public/door', '/api/nothing', '/live-realm-data/api/realm/clock']) {
      expect((await get(indexing, path)).headers['x-robots-tag'], path).toBe('noindex, nofollow');
    }
  });

  it('serves the site’s hashed assets as files that are cached for good', async () => {
    const reply = await get(indexing, '/site/assets/hero-AbCdEf12.webp');
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toContain('immutable');
    expect(reply.headers['x-robots-tag']).toBe(pageRobots);
  });
});

it('refuses to start without the whole site build', async () => {
  const partial = new Map(files);
  partial.delete('/site/privacy.html');
  expect(() => createSite({ files: partial, indexing: 'closed', origin: ORIGIN, pageHeaders: PAGE_HEADERS })).toThrow(/\/site\/privacy\.html/);
  partial.set('/site/privacy.html', files.get('/site/privacy.html')!);
  partial.delete('/site/not-found.html');
  expect(() => createSite({ files: partial, indexing: 'closed', origin: ORIGIN, pageHeaders: PAGE_HEADERS })).toThrow(/not-found/);
});
