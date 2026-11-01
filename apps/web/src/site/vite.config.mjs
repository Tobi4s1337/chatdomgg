// chatdom.io's own pages: the story, How it works, the imprint, the privacy policy, the terms and the not-found
// page. A small build of its own, so a first visit paints at once and the kingdom's engine loads only when someone
// walks in. Every page is written as finished HTML (it reads with JavaScript off); one small script per page adds
// the sign-in seal's state, the sign-in notices and the hero's motion. Built into apps/web/dist/site/.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { brandLink, howItWorksSheet, iconSvg, noticeSlip, signInSeal, siteFooter } from '../../../../packages/ui/src/site/pieces.mjs';

const here = fileURLToPath(new URL('./', import.meta.url));
const PAGES = ['index', 'how-it-works', 'imprint', 'privacy', 'terms', 'not-found'];
const partial = name => readFileSync(`${here}partials/${name}.html`, 'utf8').trim();

/** Where sign-in returns from each page. The sign-in service takes plain kingdom-like paths only, so How it works
 * and the not-found page return to the front page, which restores the exact place from the stored view. */
const RETURN = { index: '/', imprint: '/imprint', privacy: '/privacy', terms: '/terms' };

/** The kit's files, as paths from these pages (Vite hashes and copies them like any other picture). */
const KIT = '../../../../packages/ui/src/site/';
const glitch = `${KIT}twitch/glitch_flat_purple.svg`;
const img = (key, width) => `${KIT}img/hiw-${key}-${width}.webp`;
const signIn = page => `/api/realm/auth/start?returnTo=${encodeURIComponent(RETURN[page] ?? '/')}`;

/** The kit's pieces, written into the pages at build time so every page reads with JavaScript off. */
const PIECES = {
  brand: () => brandLink({ class: 'site-brand' }),
  notice: () => noticeSlip(),
  'seal-header': page => signInSeal({ href: signIn(page), glitch, size: 'header' }),
  'seal-large': page => signInSeal({ href: signIn(page), glitch, size: 'large' }),
  footer: page => siteFooter({ current: page }),
  'how-story': () => howItWorksSheet({ img, title: 'A map of all of Twitch', heading: 3, id: 'how' }),
  'how-page': () => howItWorksSheet({ img, title: 'A map of all of Twitch', heading: 2, id: 'how' }),
};

/**
 * `<!--@name-->` in a page is replaced with the kit's piece of that name, or with `partials/name.html` (nested
 * partials too), before Vite reads the page's assets, so the shared header, footer and How it works sheet are
 * written once and their pictures are hashed like any other. The current page's own links gain
 * `aria-current="page"` (once).
 */
const partials = {
  name: 'chatdom-site-partials',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, context) => {
      const page = basename(context.filename, '.html');
      const expand = text => text.replace(/<!--@([a-z-]+)-->/g, (_, name) => PIECES[name] ? PIECES[name](page) : name.startsWith('icon-') ? iconSvg(name.slice(5)) : expand(partial(name)));
      return expand(html).replace(new RegExp(`data-page="${page}"(?! aria-current)`, 'g'), `data-page="${page}" aria-current="page"`);
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
