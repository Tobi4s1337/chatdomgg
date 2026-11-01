// What every page of the site shares once its finished HTML has painted: the kit's sign-in seals brought to life
// with the real session, the notices for each way back from Twitch, the return to the exact place a visitor left
// from, and the header's wood.
import '@chatdom/ui/kit.css';
import '@chatdom/ui/site.css';
import './site.css';
import { announceSignInOutcome, rememberReturnView, startSignInSeals, takeReturnView, type ReturnView, type Session } from '@chatdom/ui/site';

/** Pages of the site a stored view may lead back to (`/how-it-works` returns through `/`). */
const OWN_PAGES = new Set(['/', '/how-it-works', '/imprint', '/privacy', '/terms']);

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

/** Starts the shared parts of a page. Resolves once the seals show the real session (or signed out, if unknown). */
export async function startSite(): Promise<Session> {
  document.documentElement.classList.add('js');
  // The faces for every other script (a signed-in name may need them) come after first paint: their sheet is large,
  // the pages' own words are Latin (kit.css), and no face file is fetched until a character needs it.
  void import('@chatdom/ui/fonts.css');
  announceSignInOutcome();
  // The site's pages take no other query; a stray one is tidied away so a shared link stays clean.
  if (location.search) history.replaceState(history.state, '', `${location.pathname}${location.hash}`);
  restoreView();

  const top = document.querySelector<HTMLElement>('[data-site-top]');
  const onScroll = () => top?.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return startSignInSeals({ view: viewHere });
}

/** Marks the page ready for captures once its fonts and the given pictures are drawn. */
export function markReady(pictures: readonly (HTMLImageElement | null)[], settled: Promise<unknown>): void {
  void Promise.all([document.fonts.ready, settled.catch(() => undefined), ...pictures.map(image => image?.decode().catch(() => undefined))]).then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }));
  });
}
