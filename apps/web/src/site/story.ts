// The story page: the shared site start, then the hero's slow sequence of real captures of the land at dusk, the
// sections settling in as they are reached, and the live Atlas mounted near the end of the page when it exists.
import { atlasFirstWays } from '@chatdom/ui/site';
import { markReady, startSite } from './site';
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
 * their own composed frame; reduced motion keeps the first frame still.
 */
function startHero(): void {
  const frames = document.querySelector<HTMLElement>('[data-hero-frames]');
  if (!frames || reduced.matches || phone.matches) return;
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
  let at = 0;
  void load.then(() => {
    window.setInterval(() => {
      if (document.hidden || !frames.isConnected) return;
      const next = (at + 1) % pictures.length;
      pictures[next]!.classList.add('is-shown');
      pictures[at]!.classList.remove('is-shown');
      at = next;
    }, 9_000);
  });
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

/** atlas-map's handle (SEAMS.md §1): `ready` settles on 'map', 'still' or 'failed'; `dispose` unmounts. */
interface AtlasHandle { dispose?: () => void; destroy?: () => void; ready?: Promise<unknown> }
type MountAtlas = (element: HTMLElement, options: { mode: 'hero' }) => AtlasHandle | Promise<AtlasHandle>;
// atlas-map's embed, when it exists in the build (see work/lanes/front-door/SEAMS.md §1). Until then the section
// shows its real capture of the Atlas, and the page builds and works the same.
const embeds = import.meta.glob<{ mountAtlas?: MountAtlas }>(['../atlas/embed.ts', '../atlas/embed.tsx', '../atlas/hero.ts', '../atlas/hero.tsx']);

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
      handle = await module.mountAtlas(host, { mode: 'hero' });
      const state = await handle?.ready;
      // Without a live map (no WebGL, a failed survey) our own capture is the better picture than the embed's still.
      if (state === 'failed' || state === 'still') throw new Error(`The Atlas embed settled as ${String(state)}`);
      section!.classList.add('is-live');
    } catch (error) {
      // The capture stays: a real picture of the Atlas with its way in, never a broken map.
      console.warn('The live Atlas could not open on the front page; its picture stays.', error);
      try { (handle?.dispose ?? handle?.destroy)?.call(handle); } catch { /* already gone */ }
      host.remove();
    }
  }
}

startHero();
startReveal();
startAtlas();
markReady([document.querySelector<HTMLImageElement>('.story-hero-frame img')], settled);
