// The kit's public pieces as finished markup: the sign-in seal, the Twitch mark in its brass frame, the site
// footer, the How it works sheet, the brand crest, the notice slip and the icon family. Plain strings with no
// imports, so the same words and structure serve two places: chatdom.io's pages write them into their HTML at build
// time (they read with JavaScript off), and the browser pieces in this folder draw them at run time. Asset URLs are
// passed in by the caller, because each side resolves files its own way.

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * One icon family for the door, the Atlas, the card and the panel: drawn on a 20 px grid with a 1.8 px round
 * stroke, so each reads at 16 to 24 px beside the kit's faces. Every icon is decorative; its control carries the
 * words.
 */
export const ICON_PATHS = Object.freeze({
  door: 'M5.5 17.5V8.6a4.5 4.5 0 0 1 9 0v8.9M3.5 17.5h13M12 11.3v1.8',
  atlas: 'M2.8 5.3 7.4 3.5l5.2 1.8 4.6-1.8v11.3l-4.6 1.8-5.2-1.8-4.6 1.8ZM7.4 3.5v11.3M12.6 5.3v11.3',
  card: 'M4.6 4.5h10.8a1.6 1.6 0 0 1 1.6 1.6v7.8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 13.9V6.1a1.6 1.6 0 0 1 1.6-1.6ZM7.2 8.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM4.9 13.1c.5-.9 1.3-1.3 2.3-1.3s1.8.4 2.3 1.3M11.4 8.6h3.4M11.4 11.4h2.4',
  panel: 'M3 3.5h14v8H3ZM3 14h6.2v3H3ZM11.2 14H17v3h-5.8ZM8.6 5.9v3.2L11.4 7.5Z',
  home: 'M3.4 9.6 10 4l6.6 5.6M5.4 8v8.6h9.2V8M8.6 16.6v-4h2.8v4',
  search: 'M8.7 3.6a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2ZM12.5 12.5l4.1 4.1',
  watch: 'M3 4.5h14v9.6H3ZM8.5 7.2v4.2l3.6-2.1ZM7 16.6h6',
  chat: 'M4 4.4h12v8.6H9.8L6.2 16.2V13H4Z',
  live: 'M10 16.6c-3 0-4.5-2-4.5-4.2 0-2.8 2.7-3.9 3-7.4 2.1 1.4 2.5 3.2 2.1 4.7 1.2-.5 1.9-1.4 2.1-2.4 1.4 1.4 1.9 3 1.9 4.9 0 2.4-1.6 4.4-4.6 4.4Z',
  crown: 'M3.5 15.8h13M4.1 13.4 3 6.2l4 3.1L10 4.2l3 5.1 4-3.1-1.1 7.2Z',
  'sign-out': 'M8.2 4H4.4v12h3.8M11.6 6.6 15 10l-3.4 3.4M15 10H7.6',
  external: 'M11.6 4H16v4.4M16 4l-6.6 6.6M14.2 11.6V16H4V5.8h4.4',
  'arrow-right': 'M4 10h11.4M11.2 5.8 15.4 10l-4.2 4.2',
  'arrow-down': 'M10 4v11.4M5.8 11.2l4.2 4.2 4.2-4.2',
  close: 'M5 5l10 10M15 5 5 15',
});

/** An icon as inline SVG markup. It inherits its colour from the text around it (`currentColor`). */
export function iconSvg(name, options = {}) {
  const path = ICON_PATHS[name];
  if (!path) throw new Error(`The kit has no icon called ${name}`);
  const extra = options.class ? ` ${escapeHtml(options.class)}` : '';
  return `<svg class="cd-icon${extra}" data-icon="${escapeHtml(name)}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="${path}" /></svg>`;
}

/** Chatdom's crest: a brass shield with a lit keep. Decorative; the link around it carries the name. */
export function brandCrest() {
  return '<svg class="cd-brand-crest" viewBox="0 0 40 44" aria-hidden="true" focusable="false"><path class="cd-brand-crest-shield" d="M20 2 36 7v14c0 10-7 17-16 21C11 38 4 31 4 21V7Z" /><path class="cd-brand-crest-keep" d="M12 31V19l3-2.5 3 2.5v-6l2-1.6 2 1.6v6l3-2.5 3 2.5v12M10 31h20M18.4 31v-5a1.6 1.6 0 0 1 3.2 0v5" /><path class="cd-brand-crest-light" d="M15 23.5h1.6M23.4 23.5H25M19.2 20h1.6" /></svg>';
}

/** The crest and the wordmark, as a link to the front page. */
export function brandLink(options = {}) {
  const base = options.base ?? '';
  const extra = options.class ? ` ${escapeHtml(options.class)}` : '';
  const page = options.current === 'index' ? ' aria-current="page"' : '';
  return `<a class="cd-brand${extra}" href="${escapeHtml(base)}/"${page} aria-label="Chatdom, the front page">${brandCrest()}<span class="cd-brand-word">Chatdom</span></a>`;
}

/**
 * The official Twitch Glitch, unaltered, on its flat black clear-space plate inside a painted brass bezel. The mark
 * is an `<img>` of the official file, so nothing on a page can restyle it; the bezel sits outside the clear space.
 * `glitch` is the URL of `twitch/glitch_flat_purple.svg` as the caller's build resolves it.
 */
export function twitchMark(options) {
  if (!options?.glitch) throw new Error('twitchMark needs the Glitch file’s URL');
  const label = options.label ? ` role="img" aria-label="${escapeHtml(options.label)}"` : ' aria-hidden="true"';
  return `<span class="cd-twitch"${label}><img class="cd-twitch-glitch" src="${escapeHtml(options.glitch)}" alt="" width="18" height="21" decoding="async" /></span>`;
}

/**
 * A walnut plaque carrying the Twitch mark and words: the shape of the sign-in seal and of "Watch on Twitch".
 * `external` opens Twitch in a new tab (for links that leave our site), and says so to screen readers.
 */
export function twitchButton(options) {
  const size = options.size ? ` data-size="${escapeHtml(options.size)}"` : '';
  const extra = options.class ? ` ${escapeHtml(options.class)}` : '';
  const attrs = options.attrs ?? '';
  const away = options.external ? ' target="_blank" rel="noopener noreferrer"' : '';
  const note = options.external ? '<span class="cd-visually-hidden"> (opens Twitch in a new tab)</span>' : '';
  return `<a class="cd-twitch-button${extra}" href="${escapeHtml(options.href)}"${size}${away}${attrs}>${twitchMark({ glitch: options.glitch })}<span class="cd-twitch-words">${escapeHtml(options.words)}</span>${note}</a>`;
}

/** "Watch on Twitch" for a channel: the mark in its frame and the words, opening the channel on twitch.tv. */
export function watchOnTwitch(options) {
  const login = String(options.login ?? '');
  if (!/^[a-z0-9_]{1,25}$/.test(login)) throw new Error('watchOnTwitch needs a Twitch login');
  return twitchButton({ href: `https://www.twitch.tv/${login}`, words: options.words ?? 'Watch on Twitch', glitch: options.glitch, size: options.size, class: 'cd-watch', external: true });
}

/**
 * The sign-in seal, signed out: "Sign in with Twitch" on the walnut plaque. `href` is the sign-in start address
 * with its return path (see `signInHref` in `signin.ts`). The browser piece redraws it once the session is known.
 */
export function signInSeal(options) {
  return twitchButton({ href: options.href, words: 'Sign in with Twitch', glitch: options.glitch, size: options.size, class: 'cd-signin', attrs: ' data-seal="out"' });
}

/** The pages every footer links to, in order. `de` marks the German word so it is read in German. */
export const FOOTER_LINKS = Object.freeze([
  { page: 'imprint', path: '/imprint', words: 'Imprint', de: 'Impressum' },
  { page: 'privacy', path: '/privacy', words: 'Privacy' },
  { page: 'terms', path: '/terms', words: 'Terms' },
  { page: 'how-it-works', path: '/how-it-works', words: 'How it works' },
  { page: 'map', path: '/map', words: 'The Atlas' },
]);
export const TWITCH_LINE = 'Live from Twitch. Chatdom is not affiliated with or endorsed by Twitch.';
export const TRADEMARK_LINE = 'Twitch and the Glitch logo are trademarks of Twitch Interactive, Inc.';
export const OPERATOR_LINE = 'Chatdom is made by saartech Solutions UG (haftungsbeschränkt) in Schiffweiler, Germany.';

/**
 * The site footer: the crest, the legal links, the Twitch line and the operator. `current` marks the page you are
 * on. `base` makes the links absolute (a surface away from chatdom.io), `external` opens them in a new tab, and
 * `twitch: false` leaves out the Twitch line and trademark note (the Twitch panel extension may not carry Twitch
 * branding). The `data-cd-foot-who` slot is filled by the browser piece once someone is signed in.
 */
export function siteFooter(options = {}) {
  const base = options.base ?? '';
  const away = options.external ? ' target="_blank" rel="noopener"' : '';
  const links = (options.links ?? FOOTER_LINKS).map(link => {
    const current = link.page === options.current ? ' aria-current="page"' : '';
    const words = link.de ? `${escapeHtml(link.words)} ·&#160;<span lang="de">${escapeHtml(link.de)}</span>` : escapeHtml(link.words);
    return `<a href="${escapeHtml(base + link.path)}" data-page="${escapeHtml(link.page)}"${current}${away}>${words}</a>`;
  }).join('');
  const twitch = options.twitch === false ? '' : `<p class="cd-foot-twitch">${TWITCH_LINE}</p>`;
  const fine = options.twitch === false ? OPERATOR_LINE : `${TRADEMARK_LINE} ${OPERATOR_LINE}`;
  const compact = options.compact ? ' data-compact' : '';
  return `<footer class="cd-foot"${compact}><div class="cd-foot-beam" aria-hidden="true"></div><div class="cd-foot-inner">${brandLink({ base, class: 'cd-foot-brand', current: options.current })}<nav class="cd-foot-links" aria-label="About Chatdom">${links}</nav><p class="cd-foot-who" data-cd-foot-who hidden></p>${twitch}<p class="cd-foot-fine">${escapeHtml(fine)}</p></div></footer>`;
}

/** The four How it works panels: one picture and at most 40 words each. Picture keys name the files in `img/`. */
export const HOW_IT_WORKS = Object.freeze([
  { step: 'One', key: 'read', title: 'We read public Twitch data',
    words: 'The map is drawn from what Twitch shows everyone: who is live, in which language, playing what. Nothing private: no passwords, no private messages.',
    alt: 'Channel names on their shields, scattered across the English continent of the Atlas.' },
  { step: 'Two', key: 'continents', title: 'Languages become continents',
    words: 'Each big streaming language is a continent; smaller ones share the Isles of Many Tongues. Inside, channels gather into realms by the games they play, and bigger audiences build bigger towns.',
    alt: 'The French-speaking continent on the Atlas, with its towns and channel shields.' },
  { step: 'Three', key: 'glow', title: 'Live streams glow',
    words: 'When a channel goes live, its place on the map lights up. Inside a founded kingdom, everyone in chat lights a window of their own.',
    alt: 'Cottages in Willowmere at dusk, their windows lit.' },
  { step: 'Four', key: 'door', title: 'Every channel is a door',
    words: 'Open any channel on the map. A founded kingdom lets you walk in, signed in with Twitch, and take a home of your own. The rest is land waiting for its streamer.',
    alt: 'Two cottages in Willowmere with warm light in their windows and doors.' },
]);
export const NEVER_COLLECTED = Object.freeze([
  ['Your Twitch password.', 'You sign in on Twitch’s own page.'],
  ['Your email address.', 'Twitch tells us only your public name.'],
  ['An archive of your chat.', 'A message shows in the kingdom for a few seconds, then it is gone. Only the words of a <code>!forge</code> wish stay, on the thing they made.'],
  ['Trackers.', 'No analytics, no advertising, no fonts or scripts from anyone else.'],
]);

/**
 * The How it works sheet: the four panels, then what we never collect and the way to the privacy policy.
 * `img(key, width)` returns each picture's URL (widths 400 and 640). `heading` is the level of the panel titles
 * (3 under a page's h2, the default). `title` adds the sheet's own heading; `base` makes the privacy link absolute.
 */
export function howItWorksSheet(options) {
  const h = options.heading ?? 3, base = options.base ?? '';
  const away = options.external ? ' target="_blank" rel="noopener"' : '';
  const id = options.id ?? 'cd-hiw';
  const panels = HOW_IT_WORKS.map(panel => `<li class="cd-hiw-panel"><figure class="cd-hiw-picture"><img src="${escapeHtml(options.img(panel.key, 640))}" srcset="${escapeHtml(options.img(panel.key, 400))} 400w, ${escapeHtml(options.img(panel.key, 640))} 640w" sizes="${escapeHtml(options.sizes ?? '(max-width: 700px) 92vw, 320px')}" width="640" height="400" loading="lazy" decoding="async" alt="${escapeHtml(panel.alt)}" /></figure><p class="cd-hiw-step cd-label">${panel.step}</p><h${h}>${escapeHtml(panel.title)}</h${h}><p>${escapeHtml(panel.words)}</p></li>`).join('');
  const never = NEVER_COLLECTED.map(([lead, rest]) => `<li><strong>${escapeHtml(lead)}</strong> ${rest}</li>`).join('');
  const title = options.title ? `<p class="cd-hiw-kicker cd-label">How it works</p><h${h - 1} id="${id}-title" class="cd-hiw-title">${escapeHtml(options.title)}</h${h - 1}>` : '';
  return `${title}<ol class="cd-hiw-panels">${panels}</ol><section class="cd-hiw-never" aria-labelledby="${id}-never"><h${h} id="${id}-never">What we never collect</h${h}><ul>${never}</ul><p class="cd-hiw-more"><a href="${escapeHtml(base)}/privacy"${away}>Read the privacy policy</a></p></section>`;
}

/** The notice slip: parchment with a wax mark, let down from under a header. Filled by `showNotice`. */
export function noticeSlip() {
  return '<div class="cd-notice" data-cd-notice hidden><div class="cd-notice-slip" role="status"><svg class="cd-notice-wax" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.6c2 .2 2.4 1.5 4.1 1.9 1.8.4 3.2-.3 4.2 1.1 1 1.4.1 2.7.6 4.4.5 1.7 1.9 2.4 1.6 4.2-.3 1.8-1.8 2-2.6 3.6-.8 1.6-.4 3.1-1.9 4-1.5.9-2.7-.1-4.5.2-1.8.3-2.6 1.6-4.3 1.2-1.7-.4-1.9-1.9-3.2-3-1.3-1.1-2.9-1.1-3.4-2.8-.5-1.7.7-2.6.6-4.4C3.1 10.2 1.9 9.4 2.4 7.7 2.9 6 4.5 6 5.7 4.8 6.9 3.6 7 2.2 8.6 1.8c1.2-.3 2-.3 3.4-.2Z" /><path class="cd-notice-wax-mark" d="M8 12.5 11 15l5-6" /></svg><p class="cd-notice-words" data-cd-notice-words></p><button class="cd-notice-close" type="button" data-cd-notice-close aria-label="Put the notice away">' + iconSvg('close') + '</button></div></div>';
}
