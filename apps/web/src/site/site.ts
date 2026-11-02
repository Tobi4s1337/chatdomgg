// What every page of the site shares once its finished HTML has painted: the kit's sign-in seals brought to life
// with the real session, the notices for each way back from Twitch, the return to the exact place a visitor left
// from, and the header's wood.
import '@chatdom/ui/kit.css';
import '@chatdom/ui/site.css';
import './site.css';
import { announceSignInOutcome, readOutcome, returnDestination, startSignInSeals, takeReturnView,
  type ReturnView, type SealOptions, type Session } from '@chatdom/ui/site';

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

/**
 * Returns to the stored place: on the same page at once, or onward from the front page to where sign-in could not
 * return (How it works, or the walk-in gate of a kingdom), carrying the way back from Twitch along so the place
 * itself says what happened. Returns true when the browser is leaving for that place.
 */
function restoreView(): boolean {
  const view = takeReturnView();
  if (!view) return false;
  const onward = returnDestination(view, location.pathname, readOutcome(location.search));
  if (onward) {
    // Sign-in lands on the front page; only from there does a visitor go on, and only to our own places.
    const walking = onward.startsWith('/?walk=1&');
    if (location.pathname !== '/' || (!walking && !OWN_PAGES.has(view.path))) return false;
    // The front page stays dark for the moment it takes to leave, rather than flashing its story.
    document.documentElement.classList.add('is-leaving');
    location.replace(onward);
    return true;
  }
  if (!OWN_PAGES.has(view.path)) return false;
  const target = view.section ? document.getElementById(view.section) : null;
  if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
  else if (typeof view.scrollY === 'number') window.scrollTo({ top: view.scrollY, behavior: 'instant' });
  return false;
}

/**
 * Starts the shared parts of a page. Resolves once the seals show the real session (or signed out, if unknown).
 * `seals` gives the page's seals their ways onward (the front page offers the Atlas first).
 */
export async function startSite(seals: Pick<SealOptions, 'way' | 'ways'> = {}): Promise<Session> {
  document.documentElement.classList.add('js');
  if (restoreView()) return new Promise<Session>(() => { /* leaving for the stored place */ });
  // The faces for every other script (a signed-in name may need them) come after first paint: their sheet is large,
  // the pages' own words are Latin (kit.css), and no face file is fetched until a character needs it.
  void import('@chatdom/ui/fonts.css');
  announceSignInOutcome();
  // The site's pages take no other query; a stray one is tidied away so a shared link stays clean.
  if (location.search) history.replaceState(history.state, '', `${location.pathname}${location.hash}`);

  const top = document.querySelector<HTMLElement>('[data-site-top]');
  const onScroll = () => top?.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const session = await startSignInSeals({ view: viewHere, ...seals });
  document.body.dataset.session = session.status === 'authenticated' ? 'in' : 'out';
  return session;
}

/** Marks the page ready for captures once its fonts and the given pictures are drawn. */
export function markReady(pictures: readonly (HTMLImageElement | null)[], settled: Promise<unknown>): void {
  void Promise.all([document.fonts.ready, settled.catch(() => undefined), ...pictures.map(image => image?.decode().catch(() => undefined))]).then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }));
  });
}
