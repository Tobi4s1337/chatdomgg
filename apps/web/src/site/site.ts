// What every page of the site shares once its finished HTML has painted: the sign-in seal's real state, the notices
// for each way back from Twitch, the return to the exact place a visitor left from, and the header's wood.
import '@chatdom/ui/kit.css';
import './site.css';
import glitch from './twitch/glitch_flat_purple.svg';
import { rememberReturnView, takeReturnView, type ReturnView } from './return-view';
import { readKingdoms, readSession, signOut, type OpenKingdom, type Session } from './session';
import { SIGNIN_NOTICES, readOutcome, signInHref } from './signin';

type Authenticated = Extract<Session, { status: 'authenticated' }>;
/** Pages of the site a stored view may lead back to (`/how-it-works` returns through `/`). */
const OWN_PAGES = new Set(['/', '/how-it-works', '/imprint', '/privacy', '/terms']);

let noticeTimer = 0;
export function showNotice(text: string): void {
  const notice = document.querySelector<HTMLElement>('[data-site-notice]');
  const words = notice?.querySelector('[data-site-notice-words]');
  if (!notice || !words) return;
  words.textContent = text;
  notice.hidden = false;
  requestAnimationFrame(() => notice.classList.add('is-open'));
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(hideNotice, 14_000);
}
function hideNotice(): void {
  const notice = document.querySelector<HTMLElement>('[data-site-notice]');
  if (!notice || notice.hidden) return;
  notice.classList.remove('is-open');
  window.setTimeout(() => { notice.hidden = true; }, 260);
}

/** The section most in view: the last one whose top has passed 40% of the viewport. */
function currentSection(): string | undefined {
  let found: string | undefined;
  for (const section of document.querySelectorAll<HTMLElement>('[data-story-section][id]')) {
    if (section.getBoundingClientRect().top <= window.innerHeight * 0.4) found = section.id;
  }
  return found;
}
function viewHere(): ReturnView {
  const section = currentSection();
  return { path: location.pathname, ...(section ? { section } : { scrollY: window.scrollY }) };
}

/** Returns to the stored place: on the same page at once, or onward to the page sign-in could not return to. */
function restoreView(): void {
  const view = takeReturnView();
  if (!view || !OWN_PAGES.has(view.path)) return;
  if (view.path !== location.pathname) {
    if (location.pathname !== '/') return;
    rememberReturnView(view);
    location.replace(view.path);
    return;
  }
  const target = view.section ? document.getElementById(view.section) : null;
  if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
  else if (typeof view.scrollY === 'number') window.scrollTo({ top: view.scrollY, behavior: 'instant' });
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function signedOutSeal(): HTMLAnchorElement {
  const seal = el('a', 'seal');
  seal.dataset.seal = 'out';
  seal.href = signInHref(location.pathname);
  const plate = el('span', 'seal-plate');
  plate.setAttribute('aria-hidden', 'true');
  const mark = el('img', 'seal-glitch');
  Object.assign(mark, { src: glitch, alt: '', width: 18, height: 21, decoding: 'async' });
  plate.append(mark);
  seal.append(plate, el('span', 'seal-words', 'Sign in with Twitch'));
  return seal;
}

let menus = 0;
/**
 * The seal once signed in: a wax mark with the person's initial, who is signed in with a way out, and the way into
 * the kingdom. In the header the seal is compact: the wax opens a small card with the name and Sign out.
 */
function signedInSeal(session: Authenticated, kingdom: OpenKingdom | null, onSignOut: (button: HTMLButtonElement) => void, compact: boolean): HTMLElement {
  const seal = el('div', 'seal seal-in');
  seal.dataset.seal = 'in';
  const initial = session.name ? Array.from(session.name)[0]!.toUpperCase() : '';
  const wax = compact ? el('button', 'seal-wax', initial) : el('span', 'seal-wax', initial);
  const who = el('span', 'seal-who');
  if (wax instanceof HTMLButtonElement) {
    who.id = `seal-menu-${++menus}`;
    who.hidden = true;
    wax.type = 'button';
    wax.setAttribute('aria-label', session.name ? `Signed in with Twitch as ${session.name}` : 'Signed in with Twitch');
    wax.setAttribute('aria-expanded', 'false');
    wax.setAttribute('aria-controls', who.id);
    const toggle = (open: boolean) => { who.hidden = !open; wax.setAttribute('aria-expanded', String(open)); };
    wax.addEventListener('click', () => toggle(who.hidden));
    seal.addEventListener('keydown', event => { if (event.key === 'Escape' && !who.hidden) { toggle(false); wax.focus(); } });
    document.addEventListener('click', event => { if (!who.hidden && !seal.contains(event.target as Node)) toggle(false); });
  } else wax.setAttribute('aria-hidden', 'true');
  who.append(el('span', 'seal-who-label cd-label', 'Signed in with Twitch'));
  if (session.name) { const name = el('span', 'seal-name', session.name); name.dir = 'auto'; who.append(name); }
  const out = el('button', 'seal-out', 'Sign out');
  out.type = 'button';
  out.addEventListener('click', () => onSignOut(out));
  who.append(out);
  const walk = el('a', 'seal-walk');
  // A phone's header has room for a short label; the full one stays the link's name.
  const [href, words, short] = kingdom
    ? [`/?walk=1&kingdom=${kingdom.kingdomId}`, `Walk into ${kingdom.name}`, 'Walk in']
    : ['/map', 'Find a kingdom on the map', 'The map'];
  walk.href = href;
  walk.append(el('span', 'seal-walk-words', words));
  if (compact) {
    walk.setAttribute('aria-label', words);
    const brief = el('span', 'seal-walk-short', short);
    brief.setAttribute('aria-hidden', 'true');
    walk.append(brief);
  }
  walk.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>');
  seal.append(wax, who, walk);
  return seal;
}

/** Draws every seal on the page for one session state. */
function drawSeals(session: Session, kingdom: OpenKingdom | null, onSignOut: (button: HTMLButtonElement) => void): void {
  for (const old of document.querySelectorAll<HTMLElement>('[data-seal]')) {
    const next = session.status === 'authenticated' ? signedInSeal(session, kingdom, onSignOut, Boolean(old.closest('.site-top'))) : signedOutSeal();
    old.replaceWith(next);
  }
}

/** Starts the shared parts of a page. Resolves once the seals show the real session (or signed out, if unknown). */
export async function startSite(): Promise<void> {
  document.documentElement.classList.add('js');
  const outcome = readOutcome(location.search);
  if (outcome || location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`);
  if (outcome) showNotice(SIGNIN_NOTICES[outcome]);
  restoreView();

  document.querySelector('[data-site-notice-close]')?.addEventListener('click', hideNotice);
  const top = document.querySelector<HTMLElement>('[data-site-top]');
  const onScroll = () => top?.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  // Leaving for Twitch: keep the exact place, read once on the way back.
  document.addEventListener('click', event => {
    const seal = (event.target as Element | null)?.closest?.('a[data-seal]');
    if (seal) rememberReturnView(viewHere());
  });

  let session: Session = { status: 'anonymous' };
  try { session = await readSession(); } catch { /* signed out until the session can be read */ }
  if (session.status !== 'authenticated') { drawSeals(session, null, () => undefined); return; }
  let kingdom: OpenKingdom | null = null;
  try { kingdom = (await readKingdoms())[0] ?? null; } catch { /* the seal offers the map instead */ }
  const leave = async (button: HTMLButtonElement) => {
    if (session.status !== 'authenticated' || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Signing out…';
    const done = await signOut(session).catch(() => false);
    if (done) {
      session = { status: 'anonymous' };
      drawSeals(session, null, () => undefined);
      showNotice(SIGNIN_NOTICES['signed-out']);
    } else {
      button.disabled = false;
      button.textContent = 'Sign out';
      showNotice('The kingdom could not sign you out just now. Nothing changed. Try again in a moment.');
    }
  };
  drawSeals(session, kingdom, button => void leave(button));
}

/** Marks the page ready for captures once its fonts and the given pictures are drawn. */
export function markReady(pictures: readonly (HTMLImageElement | null)[], settled: Promise<unknown>): void {
  void Promise.all([document.fonts.ready, settled.catch(() => undefined), ...pictures.map(image => image?.decode().catch(() => undefined))]).then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }));
  });
}
