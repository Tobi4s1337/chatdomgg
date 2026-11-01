// chatdom.io's own pages: the story, How it works, the imprint, the privacy policy, the terms and the not-found
// page. A small build of its own, so a first visit paints at once and the kingdom's engine loads only when someone
// walks in. Every page is written as finished HTML (it reads with JavaScript off); one small script per page adds
// the sign-in seal's state, the sign-in notices and the hero's motion. Built into apps/web/dist/site/.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('./', import.meta.url));
const PAGES = ['index', 'how-it-works', 'imprint', 'privacy', 'terms', 'not-found'];
const partial = name => readFileSync(`${here}partials/${name}.html`, 'utf8').trim();

/** Where sign-in returns from each page. The sign-in service takes plain kingdom-like paths only, so How it works
 * and the not-found page return to the front page, which restores the exact place from the stored view. */
const RETURN = { index: '/', imprint: '/imprint', privacy: '/privacy', terms: '/terms' };

/**
 * `<!--@name-->` in a page is replaced with `partials/name.html` (nested partials too) before Vite reads the page's
 * assets, so the shared header, footer and How it works panels are written once and their pictures are hashed like
 * any other. The current page's own links gain `aria-current="page"`, and the seal's no-script link returns to it.
 */
const partials = {
  name: 'chatdom-site-partials',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, context) => {
      const page = basename(context.filename, '.html');
      const expand = text => text.replace(/<!--@([a-z-]+)-->/g, (_, name) => expand(partial(name)));
      return expand(html)
        .replaceAll(`data-page="${page}"`, `data-page="${page}" aria-current="page"`)
        .replaceAll('__RETURN__', encodeURIComponent(RETURN[page] ?? '/'));
    },
  },
};

export default defineConfig({
  root: here,
  base: '/site/',
  logLevel: 'warn',
  plugins: [partials],
  build: {
    outDir: fileURLToPath(new URL('../../dist/site/', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { input: Object.fromEntries(PAGES.map(page => [page, `${here}${page}.html`])) },
  },
});
