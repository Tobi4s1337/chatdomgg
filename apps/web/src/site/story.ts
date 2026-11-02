// The story page: the shared site start, then the hero's slow sequence of real captures of the land at dusk, the
// sections settling in as they are reached, and the live Atlas mounted near the end of the page when it exists.
import { atlasFirstWays } from '@chatdom/ui/site';
import { markReady, startSite } from './site';
import { mapPath, readLogin } from './find';
import { HERO_CHANNEL } from './hero/frame';
import { liveLandAvailable } from './hero/land';
import type { PosterControl } from './hero/live';
import { chooseHeroPlan, readHeroEnvironment } from './hero/policy';
import heroB960 from './img/hero-b-960.webp';
import heroB1440 from './img/hero-b-1440.webp';
import heroB1920 from './img/hero-b-1920.webp';
import heroC960 from './img/hero-c-960.webp';
import heroC1440 from './img/hero-c-1440.webp';
import heroC1920 from './img/hero-c-1920.webp';

// A visitor coming back signed in is offered the Atlas first, then the kingdom they can walk into.
const settled = startSite({ ways: atlasFirstWays });
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const phone = matchMedia('(max-width: 700px) and (orientation: portrait)');

/**
 * The hero: three real captures of the land of tobi4s_ at dusk, each held for a while under a slow drift, then
 * crossfaded. The later frames load only after the first has painted and the page is idle. Phones in portrait keep
 * their own composed frame; reduced motion keeps the first frame still. The sequence can be held on its frame on show
 * (the live land takes over from it) and started again from any frame (the live land hands back to it).
 */
function startHero(): PosterControl | null {
  const frames = document.querySelector<HTMLElement>('[data-hero-frames]');
  if (!frames || reduced.matches || phone.matches) return null;
  const later = [
    { srcset: `${heroB960} 960w, ${heroB1440} 1440w, ${heroB1920} 1920w`, alt: 'The same island from the west, its cliffs lit by the last of the sun.' },
    { srcset: `${heroC960} 960w, ${heroC1440} 1440w, ${heroC1920} 1920w`, alt: 'The island from the south, with its mere and orchards under the peaks.' },
  ];
  const pictures: HTMLElement[] = [frames.querySelector<HTMLElement>('.story-hero-frame')!];
  const load = Promise.all(later.map(frame => {
    const picture = document.createElement('picture');
    picture.className = 'story-hero-frame';
    picture.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    Object.assign(image, { sizes: '100vw', srcset: frame.srcset, alt: '', width: 1920, height: 1008, decoding: 'async' });
    picture.append(image);
    frames.append(picture);
    pictures.push(picture);
    return image.decode().catch(() => undefined);
  }));
  const CROSSFADE_MS = 2_600;
  let at = 0, changedAt = 0, timer = 0, holding = false;
  const image = (index: number) => pictures[index]?.querySelector('img') ?? null;
  const show = (next: number) => {
    pictures[next]!.classList.add('is-shown');
    if (next !== at) pictures[at]!.classList.remove('is-shown');
    at = next;
    changedAt = performance.now();
  };
  const cycle = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      if (document.hidden || !frames.isConnected || holding) return;
      show((at + 1) % pictures.length);
    }, 9_000);
  };
  void load.then(() => { if (!holding) cycle(); });
  return {
    async hold() {
      holding = true;
      window.clearInterval(timer);
      const left = CROSSFADE_MS - (performance.now() - changedAt);
      if (left > 0) await new Promise(resolve => window.setTimeout(resolve, left + 50));
      // The drift stops where it is, so the live land can wear the very same transform.
      const shown = image(at);
      if (shown) { const transform = getComputedStyle(shown).transform; shown.style.animation = 'none'; shown.style.transform = transform; }
      return at;
    },
    release(index) {
      pictures.forEach((_, i) => { const img = image(i); if (img) { img.style.animation = ''; img.style.transform = ''; } });
      show(Math.min(index, pictures.length - 1));
      holding = false;
      void load.then(cycle);
    },
    shown: () => image(at),
  };
}

/**
 * The living hero: on a device that can draw it smoothly, the land itself is raised after the page has painted and
 * fades in over its own picture (./hero/). Everything here waits for the page's load and an idle moment, and for the
 * hero to be in view, so nothing of it competes with the first paint.
 */
const QUIET_AFTER_LOAD_MS = 3_500;
function startLivingHero(posters: PosterControl | null): void {
  const hero = document.querySelector<HTMLElement>('.story-hero');
  const frames = hero?.querySelector<HTMLElement>('[data-hero-frames]');
  if (!hero || !frames || !posters || !liveLandAvailable()) return;
  const caption = hero.querySelector<HTMLElement>('.story-caption-hero');
  const drawn = caption?.textContent ?? '';
  const begin = async () => {
    const plan = chooseHeroPlan(readHeroEnvironment());
    hero.dataset.heroPlan = plan.kind === 'live' ? `live ${plan.tier}` : `still: ${plan.reason}`;
    if (plan.kind !== 'live') return;
    await idle();
    const { startLiveHero } = await import('./hero/live');
    await startLiveHero(hero, frames, posters, {
      tier: plan.tier, watch: plan.reason !== 'asked for the live land', motion: plan.tier !== 'software',
      onState: (state, detail) => {
        if (caption) caption.textContent = state === 'live' ? `The land of ${HERO_CHANNEL} at dusk · drawn live in your browser` : drawn;
        if (state === 'still' && detail) console.info(`The live land stepped back to its pictures: ${detail}.`);
      },
    });
  };
  const whenInView = () => new Promise<void>(resolve => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !document.hidden) { observer.disconnect(); resolve(); }
    });
    observer.observe(hero);
  });
  const idle = () => new Promise<void>(resolve => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 2_000 });
    else globalThis.setTimeout(resolve, 300);
  });
  const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise<void>(resolve => window.addEventListener('load', () => resolve(), { once: true }));
  // The page first settles: its pictures decode and a visitor's first scroll or tap meets no work of ours. Only then
  // does the hero ask the device what it can draw, each step in an idle moment of its own.
  const quiet = () => new Promise<void>(resolve => { globalThis.setTimeout(resolve, QUIET_AFTER_LOAD_MS); });
  void loaded.then(quiet).then(idle).then(whenInView).then(begin).catch(error => console.warn('The live land could not start; its pictures stay.', error));
}

/** Sections settle in (a shutter's swing, a pinned picture's drop) the first time they are reached. */
function startReveal(): void {
  const sections = document.querySelectorAll<HTMLElement>('[data-story-section]');
  if (!('IntersectionObserver' in window)) { sections.forEach(section => section.classList.add('is-seen')); return; }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-seen'); observer.unobserve(entry.target); }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
  sections.forEach(section => {
    // A section already in view (a return from sign-in, a reload mid-page) shows at once.
    if (section.getBoundingClientRect().top < window.innerHeight * 0.9) section.classList.add('is-seen');
    else observer.observe(section);
  });
}

/** atlas-map's handle (SEAMS.md §1): `ready` settles on 'map', 'still' or 'failed'; `flyTo` shows a channel; `dispose` unmounts. */
interface AtlasHandle {
  dispose?: () => void; destroy?: () => void; ready?: Promise<unknown>;
  flyTo?: (target: { login: string }, options?: { openCard?: boolean }) => Promise<boolean>;
}
type MountAtlas = (element: HTMLElement, options: { mode: 'hero'; onExplore?: () => void }) => AtlasHandle | Promise<AtlasHandle>;
// atlas-map's embed, when it exists in the build (see work/lanes/front-door/SEAMS.md §1). Until then the section
// shows its real capture of the Atlas, and the page builds and works the same.
const embeds = import.meta.glob<{ mountAtlas?: MountAtlas }>(['../atlas/embed.ts', '../atlas/embed.tsx', '../atlas/hero.ts', '../atlas/hero.tsx']);

/** The live Atlas on this page, once it shows the map. */
let liveAtlas: AtlasHandle | null = null;

function webgl(): boolean {
  try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl')); }
  catch { return false; }
}

function startAtlas(): void {
  const section = document.querySelector<HTMLElement>('[data-atlas]');
  const stage = section?.querySelector<HTMLElement>('[data-atlas-stage]');
  const load = Object.values(embeds)[0];
  if (!section || !stage || !load || !('IntersectionObserver' in window) || !webgl()) return;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    void mount();
  }, { rootMargin: '600px 0px' });
  observer.observe(section);
  async function mount() {
    const host = document.createElement('div');
    host.className = 'story-atlas-live';
    stage!.append(host);
    let handle: AtlasHandle | null = null;
    try {
      const module = await load!();
      if (typeof module.mountAtlas !== 'function') throw new Error('The Atlas embed has no mountAtlas');
      // A click, tap or Enter on the hero map opens the whole map.
      handle = await module.mountAtlas(host, { mode: 'hero', onExplore: () => { location.assign(exploreLink?.getAttribute('href') ?? '/map'); } });
      const state = await handle?.ready;
      // Without a live map (no WebGL, a failed survey) our own capture is the better picture than the embed's still.
      if (state === 'failed' || state === 'still') throw new Error(`The Atlas embed settled as ${String(state)}`);
      section!.classList.add('is-live');
      liveAtlas = handle;
    } catch (error) {
      // The capture stays: a real picture of the Atlas with its way in, never a broken map.
      console.warn('The live Atlas could not open on the front page; its picture stays.', error);
      try { (handle?.dispose ?? handle?.destroy)?.call(handle); } catch { /* already gone */ }
      host.remove();
    }
  }
}

const exploreLink = document.querySelector<HTMLAnchorElement>('[data-atlas-explore]');

/**
 * Find any channel: on the live map it flies there in place and "Explore the map" then opens the whole map on it;
 * without the live map (or when the hero cannot show that channel) it opens the whole map on it at once.
 */
function startFind(): void {
  const form = document.querySelector<HTMLFormElement>('[data-atlas-find]');
  const said = document.querySelector<HTMLElement>('[data-atlas-said]');
  const input = form?.querySelector<HTMLInputElement>('input');
  if (!form || !input || !said) return;
  input.addEventListener('input', () => { said.textContent = ''; input.removeAttribute('aria-invalid'); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const login = readLogin(input.value);
    if (!login) {
      said.textContent = input.value.trim() ? 'That is not a Twitch name. Names use letters, numbers and _.' : 'Type a channel’s Twitch name.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const handle = liveAtlas;
    if (!handle?.flyTo) { location.assign(mapPath(login)); return; }
    said.textContent = `Looking for ${login}…`;
    void handle.flyTo({ login }, { openCard: true }).then(found => {
      if (!found) { location.assign(mapPath(login)); return; }
      said.textContent = `There is ${login}.`;
      exploreLink?.setAttribute('href', mapPath(login));
    }, () => { location.assign(mapPath(login)); });
  });
}

startLivingHero(startHero());
startReveal();
startAtlas();
startFind();
markReady([document.querySelector<HTMLImageElement>('.story-hero-frame img')], settled);
