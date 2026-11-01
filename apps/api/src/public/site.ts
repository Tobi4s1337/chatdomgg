import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicRoute, SitePage } from './routes';
import { sendFile, type StaticFile } from './static';

/**
 * chatdom.io's own pages and what search engines are told about them. One setting decides whether the site may be
 * found: `PUBLIC_INDEXING=closed` (the default) sends `X-Robots-Tag: noindex, nofollow` on every answer, a
 * `robots.txt` that disallows everything and an empty sitemap; `open` lets the product pages be indexed, keeps every
 * data and service path out, and lists the pages in the sitemap.
 */
export type Indexing = 'closed' | 'open';

/** Where each site page lives in the web build (`apps/web/dist/site/`). */
export const SITE_FILES: Readonly<Record<SitePage, string>> = {
  index: '/site/index.html', 'how-it-works': '/site/how-it-works.html', imprint: '/site/imprint.html', privacy: '/site/privacy.html', terms: '/site/terms.html',
};
export const NOT_FOUND_FILE = '/site/not-found.html';

/** The pages a search engine may list once indexing is open, in the order the sitemap gives them. */
export const INDEXED_PAGES = ['/', '/map', '/how-it-works', '/imprint', '/privacy', '/terms'] as const;
/** Paths that are never pages: service data, sign-in, internal doors and development benches. */
export const NEVER_INDEXED = ['/api/', '/live-realm-data/', '/map-data/', '/presence-data/', '/forge-data/', '/internal/', '/-/'] as const;
const NOINDEX = 'noindex, nofollow';

export function robotsTxt(indexing: Indexing, origin: string): string {
  if (indexing === 'closed') return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', 'Allow: /', ...NEVER_INDEXED.map(path => `Disallow: ${path}`), '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

/** The sitemap: empty while closed. No lastmod is given, since a start date would claim changes that never happened. */
export function sitemapXml(indexing: Indexing, origin: string): string {
  const urls = indexing === 'open' ? INDEXED_PAGES.map(path => `  <url><loc>${origin}${path}</loc></url>\n`).join('') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
}

/** The robots header for one answer: always while closed; once open, only on answers that are not product pages. */
export function robotsHeader(indexing: Indexing, page: boolean): Record<string, string> {
  return indexing === 'closed' || !page ? { 'X-Robots-Tag': NOINDEX } : {};
}

/** Answers that are product pages or their files: the only ones search engines may index once indexing is open. */
const INDEXABLE = new Set<PublicRoute['kind']>(['site', 'page', 'file', 'robots', 'sitemap', 'redirect']);
/**
 * The robots header the gateway sets first on every answer, by route. While closed: noindex on everything. Once
 * open: nothing on pages and files, noindex on sign-in, the realm, service data, the panel and every 404.
 */
export function robotsHeaderFor(indexing: Indexing, kind: PublicRoute['kind']): Record<string, string> {
  return robotsHeader(indexing, INDEXABLE.has(kind));
}

export interface SiteOptions {
  readonly files: ReadonlyMap<string, StaticFile>;
  readonly indexing: Indexing;
  /** The public origin, `https://chatdom.io`, for the sitemap's absolute addresses. */
  readonly origin: string;
  /** The security headers every page carries (CSP, HSTS, …). */
  readonly pageHeaders: Readonly<Record<string, string>>;
}

/**
 * Answers the routes that belong to the site itself: its pages, robots.txt, the sitemap, moved addresses and the
 * not-found page (for staged-data requests and any unknown page). Returns false for every other route.
 */
export function createSite(options: SiteOptions) {
  const { files, indexing, origin, pageHeaders } = options;
  const pages = new Map<SitePage, StaticFile>();
  for (const [page, path] of Object.entries(SITE_FILES) as [SitePage, string][]) {
    const file = files.get(path);
    if (!file) throw new Error(`The site build has no ${path}; run node scripts/public/build.mjs`);
    pages.set(page, file);
  }
  const notFound = files.get(NOT_FOUND_FILE);
  if (!notFound) throw new Error(`The site build has no ${NOT_FOUND_FILE}; run node scripts/public/build.mjs`);
  const robots = robotsTxt(indexing, origin), sitemap = sitemapXml(indexing, origin);
  const text = (response: ServerResponse, request: IncomingMessage, type: string, body: string) => {
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(Buffer.byteLength(body)), ...robotsHeader(indexing, false) });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  /** The not-found page, with the robots header for an answer that is never a page. */
  const notFoundPage = (request: IncomingMessage, response: ServerResponse) =>
    sendFile(request, response, notFound, { ...pageHeaders, ...robotsHeader(indexing, false) }, 404);
  return {
    notFound: notFoundPage,
    /** Headers for an app page (the kingdom, the Atlas, the stream view), which may be indexed once open. */
    appPageHeaders(): Record<string, string> { return { ...pageHeaders, ...robotsHeader(indexing, true) }; },
    handle(request: IncomingMessage, response: ServerResponse, route: PublicRoute): boolean {
      switch (route.kind) {
        case 'site': sendFile(request, response, pages.get(route.page)!, { ...pageHeaders, ...robotsHeader(indexing, true) }); return true;
        case 'robots': text(response, request, 'text/plain; charset=utf-8', robots); return true;
        case 'sitemap': text(response, request, 'application/xml; charset=utf-8', sitemap); return true;
        case 'redirect':
          response.writeHead(301, { Location: route.location, 'Cache-Control': 'public, max-age=86400', 'Content-Length': '0', ...robotsHeader(indexing, false) }).end();
          return true;
        case 'staged': notFoundPage(request, response); return true;
        default: return false;
      }
    },
  };
}
