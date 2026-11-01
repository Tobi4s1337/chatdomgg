// The sign-in seal in the browser, on any page: drawn signed out at once, then redrawn from the real session.
// Signed in, it shows a wax seal, who is signed in, a quiet Sign out and one way onward (into your kingdom, or the
// map). Every seal and footer on the page share one reading of the session, so signing out anywhere turns them
// all back together.
import { applyName } from '../names';
import { GLITCH_URL, howItWorksPicture } from './assets';
import { howItWorksSheet, iconSvg, noticeSlip, signInSeal, siteFooter, twitchMark, watchOnTwitch,
  type FooterOptions, type HowItWorksOptions, type PieceSize } from './pieces.mjs';
import { rememberReturnView, type ReturnView } from './return-view';
import { readKingdoms, readSession, signOut, type OpenKingdom, type Session } from './session';
import { SIGNIN_NOTICES, readOutcome, signInHref, type SignInOutcome } from './signin';

type Authenticated = Extract<Session, { status: 'authenticated' }>;

/** The seal's way onward once signed in. `short` is a phone header's label; the full words stay the link's name. */
export interface SealWay { readonly href: string; readonly words: string; readonly short?: string }

export interface SealOptions {
  /** `header` is compact: the wax opens a small card with who is signed in and Sign out. `large` is for a story. */
  readonly size?: PieceSize;
  /** Where sign-in should return to (a plain path). Defaults to this page; refused paths return to `/`. */
  readonly returnPath?: string;
  /** The exact view to keep across the trip to Twitch, read just before leaving. Defaults to this page's path. */
  readonly view?: () => ReturnView | null | undefined;
  /** A sign-in start address of the owner's own (for example the walk-in gate's), instead of the kit's. */
  readonly signInHref?: string;
  /** The way onward once signed in; `null` shows none. Defaults to walking into your kingdom, or the map. */
  readonly way?: (kingdom: OpenKingdom | null) => SealWay | null;
}

/** The default way onward: into the first kingdom you can enter, or to the map to find one. */
export function defaultWay(kingdom: OpenKingdom | null): SealWay {
  return kingdom
    ? { href: `/?walk=1&kingdom=${encodeURIComponent(kingdom.kingdomId)}`, words: `Walk into ${kingdom.name}`, short: 'Walk in' }
    : { href: '/map', words: 'Find a kingdom on the map', short: 'The map' };
}

// ——— Notices ———

let noticeTimer = 0;
function noticeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let notice = document.querySelector<HTMLElement>('[data-cd-notice]');
  if (!notice) {
    notice = fromHtml(noticeSlip());
    document.body.append(notice);
  }
  if (!notice.dataset.cdNoticeReady) {
    notice.dataset.cdNoticeReady = 'true';
    notice.querySelector('[data-cd-notice-close]')?.addEventListener('click', hideNotice);
  }
  return notice;
}

/** Lets down the notice slip with these words for a while; the close button puts it away sooner. */
export function showNotice(text: string, holdMs = 14_000): void {
  const notice = noticeElement();
  const words = notice?.querySelector('[data-cd-notice-words]');
  if (!notice || !words) return;
  words.textContent = text;
  notice.hidden = false;
  requestAnimationFrame(() => notice.classList.add('is-open'));
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(hideNotice, holdMs);
}
export function hideNotice(): void {
  const notice = document.querySelector<HTMLElement>('[data-cd-notice]');
  if (!notice || notice.hidden) return;
  notice.classList.remove('is-open');
  window.setTimeout(() => { notice.hidden = true; }, 260);
}

/**
 * Reads the way back from Twitch (`?signin=declined|expired|refused|unavailable`), takes only that word out of the
 * address (anything else in it stays), and says what happened in a notice. Returns the outcome, or null.
 */
export function announceSignInOutcome(): SignInOutcome | null {
  const outcome = readOutcome(location.search);
  const params = new URLSearchParams(location.search);
  if (!params.has('signin')) return outcome;
  params.delete('signin');
  const rest = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  if (outcome) showNotice(SIGNIN_NOTICES[outcome]);
  return outcome;
}

// ——— The shared reading of who is signed in ———

interface Reading { readonly session: Session; readonly kingdom: OpenKingdom | null }
let reading: Promise<Reading> | null = null;
let current: Reading | null = null;

/** Who this browser is, read once per page (and again after `refreshSeals`). Never rejects: unknown is signed out. */
export function readSealSession(): Promise<Reading> {
  reading ??= (async () => {
    let session: Session = { status: 'anonymous' };
    try { session = await readSession(); } catch { /* signed out until the session can be read */ }
    let kingdom: OpenKingdom | null = null;
    if (session.status === 'authenticated') {
      try { kingdom = (await readKingdoms())[0] ?? null; } catch { /* the seal offers the map instead */ }
    }
    current = { session, kingdom };
    return current;
  })();
  return reading;
}

interface Mounted { el: HTMLElement; readonly options: SealOptions }
const mounted = new Set<Mounted>();

function fromHtml(html: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function signedOut(options: SealOptions): HTMLElement {
  const href = options.signInHref ?? signInHref(options.returnPath ?? location.pathname);
  const seal = fromHtml(signInSeal({ href, glitch: GLITCH_URL, size: options.size }));
  // Leaving for Twitch: keep the exact place, read once on the way back.
  seal.addEventListener('click', () => rememberReturnView(options.view?.() ?? { path: location.pathname }));
  return seal;
}

/** The first letter as a reader sees it (a whole grapheme: a Devanagari syllable keeps its vowel sign). */
function firstLetter(text: string): string {
  // Thai and Lao vowels written before their consonant are not the letter a monogram takes.
  const letters = text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^[\u0E40-\u0E44\u0EC0-\u0EC4](?=\p{L})/u, '') || text;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const [first] = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(letters);
    if (first) return first.segment;
  }
  return Array.from(letters)[0] ?? '';
}

let menus = 0;
function signedIn(session: Authenticated, kingdom: OpenKingdom | null, options: SealOptions): HTMLElement {
  const compact = options.size === 'header';
  const seal = el('div', 'cd-signin cd-signin-in');
  seal.dataset.seal = 'in';
  if (options.size) seal.dataset.size = options.size;
  const initial = session.name ? firstLetter(session.name).toLocaleUpperCase() : '';
  const wax = compact ? el('button', 'cd-signin-wax', initial) : el('span', 'cd-signin-wax', initial);
  const who = el('span', 'cd-signin-who');
  if (wax instanceof HTMLButtonElement) {
    who.id = `cd-signin-menu-${++menus}`;
    who.hidden = true;
    wax.type = 'button';
    wax.setAttribute('aria-label', session.name ? `Signed in with Twitch as ${session.name}` : 'Signed in with Twitch');
    wax.setAttribute('aria-expanded', 'false');
    wax.setAttribute('aria-controls', who.id);
    const toggle = (open: boolean) => { who.hidden = !open; wax.setAttribute('aria-expanded', String(open)); };
    wax.addEventListener('click', () => toggle(who.hidden));
    seal.addEventListener('keydown', event => { if (event.key === 'Escape' && !who.hidden) { toggle(false); wax.focus(); } });
    seal.addEventListener('focusout', event => { if (!who.hidden && !seal.contains(event.relatedTarget as Node | null)) toggle(false); });
    document.addEventListener('pointerdown', event => { if (!who.hidden && !seal.contains(event.target as Node)) toggle(false); });
  } else wax.setAttribute('aria-hidden', 'true');
  who.append(el('span', 'cd-signin-who-label cd-label', 'Signed in with Twitch'));
  if (session.name) {
    const name = el('span', 'cd-signin-name cd-name-line');
    applyName(name, session.name);
    name.classList.add('cd-name-line');
    who.append(name);
  }
  who.append(signOutButton('cd-signin-out', session));
  seal.append(wax, who);
  const way = (options.way ?? defaultWay)(kingdom);
  if (way) {
    const walk = el('a', 'cd-signin-walk');
    walk.href = way.href;
    walk.append(el('span', 'cd-signin-walk-words', way.words));
    if (compact && way.short) {
      walk.setAttribute('aria-label', way.words);
      const brief = el('span', 'cd-signin-walk-short', way.short);
      brief.setAttribute('aria-hidden', 'true');
      walk.append(brief);
    }
    walk.insertAdjacentHTML('beforeend', iconSvg('arrow-right'));
    seal.append(walk);
  }
  return seal;
}

function signOutButton(className: string, session: Authenticated): HTMLButtonElement {
  const out = el('button', className, 'Sign out');
  out.type = 'button';
  out.addEventListener('click', () => void leave(out, session));
  return out;
}

async function leave(button: HTMLButtonElement, session: Authenticated): Promise<void> {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Signing out…';
  const done = await signOut(session).catch(() => false);
  if (!done) {
    button.disabled = false;
    button.textContent = 'Sign out';
    showNotice('The kingdom could not sign you out just now. Nothing changed. Try again in a moment.');
    return;
  }
  current = { session: { status: 'anonymous' }, kingdom: null };
  reading = Promise.resolve(current);
  drawAll();
  showNotice(SIGNIN_NOTICES['signed-out']);
}

function draw(entry: Mounted): void {
  const reading = current;
  const next = reading?.session.status === 'authenticated' ? signedIn(reading.session, reading.kingdom, entry.options) : signedOut(entry.options);
  entry.el.replaceWith(next);
  entry.el = next;
}

/** The footer's quiet line: who is signed in, and Sign out. Hidden when nobody is. */
function fillFooterWho(slot: HTMLElement, session: Session | undefined): void {
  slot.replaceChildren();
  if (session?.status !== 'authenticated') { slot.hidden = true; return; }
  slot.append('Signed in with Twitch');
  if (session.name) {
    slot.append(' as ');
    const name = el('span', 'cd-foot-name');
    applyName(name, session.name);
    slot.append(name);
  }
  slot.append(el('span', 'cd-foot-dot', ' · '), signOutButton('cd-foot-out', session));
  slot.hidden = false;
}
/** Every footer on the page that follows the shared session (not one given its own). */
function drawFooters(): void {
  for (const slot of document.querySelectorAll<HTMLElement>('[data-cd-foot-who]:not([data-cd-foot-own])')) fillFooterWho(slot, current?.session);
}

function drawAll(): void {
  for (const entry of mounted) if (entry.el.isConnected) draw(entry); else mounted.delete(entry);
  drawFooters();
}

export interface SealHandle {
  /** Resolves once the seal shows the real session (or signed out, if it could not be read). */
  readonly ready: Promise<Session>;
  /** The seal's element as drawn now (it is replaced when the session changes). */
  element(): HTMLElement;
  destroy(): void;
}

/**
 * Draws one seal into `host` (appended), signed out at once and then from the session. Use this from a surface
 * that renders itself (the Atlas, the walk-in gate); finished pages use `startSignInSeals` on their written seals.
 */
export function mountSignInSeal(host: HTMLElement, options: SealOptions = {}): SealHandle {
  const entry: Mounted = { el: signedOut(options), options };
  host.append(entry.el);
  mounted.add(entry);
  if (current) draw(entry);
  const ready = readSealSession().then(reading => {
    if (mounted.has(entry) && entry.el.isConnected) draw(entry);
    drawFooters();
    return reading.session;
  });
  return { ready, element: () => entry.el, destroy: () => { mounted.delete(entry); entry.el.remove(); } };
}

/**
 * Brings every written seal on a finished page to life (`[data-seal]`, as `signInSeal` writes them), with the
 * footer's signed-in line. A seal inside `[data-cd-compact]` or with `data-size="header"` is the compact one.
 */
export async function startSignInSeals(options: SealOptions & { root?: ParentNode } = {}): Promise<Session> {
  const root = options.root ?? document;
  for (const written of root.querySelectorAll<HTMLElement>('[data-seal]')) {
    const size = (written.dataset.size as PieceSize | undefined) ?? options.size;
    const entry: Mounted = { el: written, options: { ...options, ...(size ? { size } : {}) } };
    mounted.add(entry);
    written.addEventListener('click', () => rememberReturnView(entry.options.view?.() ?? { path: location.pathname }));
  }
  const { session } = await readSealSession();
  drawAll();
  return session;
}

/** Reads the session again and redraws every seal and footer (after a sign-in finished in another tab, say). */
export async function refreshSeals(): Promise<Session> {
  reading = null;
  const { session } = await readSealSession();
  drawAll();
  return session;
}

// ——— The other pieces, as elements ———

/**
 * A signed-in seal drawn from a session the owner already holds (a surface that reads the session itself). It is
 * not redrawn by `refreshSeals`; its Sign out still signs out and turns the page's shared seals back.
 */
export function createSignedInSeal(session: Authenticated, kingdom: OpenKingdom | null = null, options: SealOptions = {}): HTMLElement {
  return signedIn(session, kingdom, options);
}

/**
 * The site footer as an element. On chatdom.io itself (no `base`), its signed-in line fills in from the shared
 * session; a surface on another origin (the panel) never reads it.
 */
export function createSiteFooter(options: FooterOptions & { session?: Session } = {}): HTMLElement {
  const footer = fromHtml(siteFooter(options));
  const slot = footer.querySelector<HTMLElement>('[data-cd-foot-who]');
  if (options.session && slot) {
    // An owner that already holds the session (and the kit's own bench) draws the line from it.
    slot.dataset.cdFootOwn = 'true';
    fillFooterWho(slot, options.session);
  } else if (!options.base) {
    if (current) queueMicrotask(drawFooters);
    else void readSealSession().then(drawFooters);
  }
  return footer;
}

/** The How it works sheet as an element, with the kit's own pictures. */
export function createHowItWorks(options: Omit<HowItWorksOptions, 'img'> = {}): HTMLElement {
  const sheet = el('div', 'cd-hiw');
  sheet.innerHTML = howItWorksSheet({ ...options, img: howItWorksPicture });
  return sheet;
}

/** The Twitch mark in its brass frame, on its own. `label` makes it an image with that name; otherwise decorative. */
export function createTwitchMark(label?: string): HTMLElement {
  return fromHtml(twitchMark({ glitch: GLITCH_URL, ...(label ? { label } : {}) }));
}

/** "Watch on Twitch" for a channel, opening twitch.tv in a new tab. */
export function createWatchOnTwitch(login: string, options: { words?: string; size?: PieceSize } = {}): HTMLAnchorElement {
  return fromHtml(watchOnTwitch({ login, glitch: GLITCH_URL, ...options })) as HTMLAnchorElement;
}
