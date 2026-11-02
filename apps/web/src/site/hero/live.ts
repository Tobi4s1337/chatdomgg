// The living hero: the land of tobi4s_ at dusk, drawn live behind the front page's plate. It is raised only after the
// page has painted, while the captured frames keep playing; once it is drawn it turns to the camera of the picture on
// show, takes over the picture's drift, fades in over it and starts a slow orbit. If it cannot keep up, it fades back
// to the nearest picture and lets the page go on as before.
import { coverFrame, HERO_CHANNEL, HERO_FRAMES, HERO_HOUR, HERO_ORBIT, HERO_TIME, nearestFrame, orbitYaw, restOrbit, startOrbit, stepOrbit, type OrbitState } from './frame';
import { openLiveLand, type LiveLand } from './land';
import type { LandTier } from './policy';

/** The captured frames' sequence (story.ts), which the live land takes over from and hands back to. */
export interface PosterControl {
  /** Stops the sequence on the frame on show, once any crossfade has finished, holding its drift; returns its index. */
  hold(): Promise<number>;
  /** Shows frame `index` and starts the sequence again. */
  release(index: number): void;
  /** The picture on show. */
  shown(): HTMLImageElement | null;
}

export type HeroState = 'raising' | 'live' | 'still';

export interface LiveHeroOptions {
  readonly tier: LandTier;
  /** Steps back to the pictures when frames are slow. Off for captures. */
  readonly watch: boolean;
  /** The slow orbit. Off for captures on a software renderer, which hold the picture's camera. */
  readonly motion: boolean;
  readonly onState?: (state: HeroState, detail?: string) => void;
}

/** How long the land may take to be raised and drawn before the pictures simply stay. */
const RAISE_LIMIT_MS = 60_000;
const FADE_MS = 1_800;
/** Frames slower than this, at the median of a two-second window, step the hero back to its pictures (~28 fps). */
const SLOW_FRAME_MS = 36;
const WATCH_FRAMES = 120;

const delay = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([promise, delay(ms).then(() => { throw new Error(`${what} took longer than ${Math.round(ms / 1000)} s`); })]);
}

/** Starts the live land in the hero. Resolves when it is live, or when it has stepped back to the pictures. */
export async function startLiveHero(hero: HTMLElement, frames: HTMLElement, posters: PosterControl, options: LiveHeroOptions): Promise<HeroState> {
  const say = (state: HeroState, detail?: string) => { hero.dataset.heroState = state; options.onState?.(state, detail); };
  const layer = document.createElement('div');
  layer.className = 'story-hero-live';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.tabIndex = -1;
  layer.append(canvas);
  frames.append(layer);

  let land: LiveLand | null = null;
  let failure: ((message: string) => void) | null = null;
  const failed = new Promise<never>((_, reject) => { failure = message => reject(new Error(message)); });
  failed.catch(() => undefined);
  const place = () => {
    const box = coverFrame(hero.clientWidth, hero.clientHeight);
    Object.assign(canvas.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  };
  const resize = new ResizeObserver(() => { place(); land?.resize(); });
  let raf = 0, held: number | null = null, gone = false;
  const stop = () => {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    resize.disconnect();
    visibility.disconnect();
    window.removeEventListener('pagehide', stop);
    land?.dispose();
    land = null;
  };
  window.addEventListener('pagehide', stop);

  // Out of view or in a hidden tab the camera rests, so the land draws nothing; it eases back into motion on return.
  let inView = true;
  const visibility = new IntersectionObserver(entries => { inView = entries.some(entry => entry.isIntersecting); });
  visibility.observe(hero);

  say('raising');
  try {
    place();
    const opening = openLiveLand(canvas, { channel: HERO_CHANNEL, hour: HERO_HOUR, time: HERO_TIME, yaw: HERO_FRAMES[0].yaw, tier: options.tier,
      onFailure: message => failure?.(message) });
    // A land that arrives after the hero gave up on it is let go at once.
    opening.then(late => { if (gone) late.dispose(); }, () => undefined);
    land = await within(Promise.race([opening, failed]), RAISE_LIMIT_MS, 'Raising the land');
    if (gone) return 'still';
    resize.observe(hero);
    await within(Promise.race([land.settled(), failed]), RAISE_LIMIT_MS, 'Drawing the land');
    // The live land takes the camera of the picture on show, and appears only once it is drawn from there.
    held = await posters.hold();
    land.setYaw(HERO_FRAMES[held]!.yaw);
    await within(Promise.race([land.settled(), failed]), 15_000, 'Turning to the picture');
    if (gone) return 'still';
  } catch (error) {
    stop();
    layer.remove();
    if (held !== null) posters.release(held);
    say('still', error instanceof Error ? error.message : String(error));
    return 'still';
  }

  // Same picture, same drift: the layer wears the picture's held transform while it fades in, then settles out of it.
  const picture = posters.shown();
  const drift = picture ? getComputedStyle(picture).transform : 'none';
  layer.style.transform = drift === 'none' ? '' : drift;
  await new Promise(requestAnimationFrame);
  layer.classList.add('is-shown');
  say('live');
  await delay(FADE_MS);
  layer.classList.add('is-settling');
  layer.style.transform = '';

  if (!options.motion) return 'live';
  let orbit: OrbitState = startOrbit(HERO_FRAMES[held!]!.yaw, HERO_ORBIT);
  let last = 0, resting = true;
  const times: number[] = [];
  const stepBack = async (reason: string) => {
    const index = nearestFrame(orbitYaw(orbit));
    posters.release(index);
    layer.classList.remove('is-shown');
    say('still', reason);
    await delay(FADE_MS + 100);
    stop();
    layer.remove();
  };
  const frame = (now: number) => {
    if (gone) return;
    raf = requestAnimationFrame(frame);
    if (!inView || document.hidden) {
      if (!resting) { orbit = restOrbit(orbit); resting = true; times.length = 0; }
      last = 0;
      return;
    }
    resting = false;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    orbit = stepOrbit(orbit, dt, HERO_ORBIT);
    land?.setYaw(orbitYaw(orbit));
    if (!options.watch || dt === 0) return;
    times.push(dt * 1000);
    if (times.length < WATCH_FRAMES) return;
    const median = [...times].sort((a, b) => a - b)[times.length >> 1]!;
    times.length = 0;
    if (median > SLOW_FRAME_MS) { cancelAnimationFrame(raf); void stepBack(`frames took ${median.toFixed(0)} ms`); }
  };
  raf = requestAnimationFrame(frame);
  return 'live';
}
