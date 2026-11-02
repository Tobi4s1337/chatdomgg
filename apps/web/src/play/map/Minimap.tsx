import { createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { PlayMapView } from '../host';
import { createMapLayers, paintTownMap, type MapLayers } from './paint';

/**
 * The minimap: a round window on the painted map in a carved walnut octagon with a brass ring, north up, centred on
 * you, about 110 metres across. It is a button: pressed, it opens the big map in the ledger (the ledger plays its own
 * shutter). Under it, when you have a home and are outside it, one small slip with the way's length.
 */

export interface MinimapProps {
  readonly map: () => PlayMapView | null;
  readonly reducedMotion: () => boolean;
  readonly onOpen: () => void;
  readonly cue: (surface: 'wood' | 'brass' | 'parchment') => void;
}

/** Metres across the round window. */
const ACROSS = 110;
/** The window's share of the bezel (it sits inside the brass ring). */
const WINDOW = .78;
const FRAME_MS = 1000 / 30;
const IDLE_MS = 250;

const TAU = Math.PI * 2;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Walking metres to your door: by the streets when a route exists, else straight to the door. */
export function homeMetres(view: PlayMapView): number | null {
  if (!view.home || view.inside || !view.people.you) return null;
  if (view.route) return view.route.length + view.route.offStreet;
  const home = view.town.homes.find(candidate => candidate.id === view.home);
  if (!home) return null;
  const metres = Math.hypot(home.door[0] - view.people.you.x, home.door[2] - view.people.you.z);
  return Number.isFinite(metres) ? metres : null;
}

/** "140 m": exact under twenty metres, then to five, then to ten. */
export function shortMetres(metres: number): string {
  const step = metres < 20 ? 1 : metres < 100 ? 5 : 10;
  return `${Math.max(step === 1 ? 0 : step, Math.round(metres / step) * step)} m`;
}

/** Fonts the painter sets on the canvas; the town is painted again once they have arrived. */
export function loadMapFonts(layers: MapLayers, then: () => void): void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const faces = ['16px "IM Fell English"', 'italic 13px "IM Fell English"', '13px "IM Fell English SC"', 'italic 13px Alegreya'];
  void Promise.all(faces.map(face => fonts.load(face).catch(() => []))).then(() => { layers.invalidate(); then(); });
}

/** The carved octagon's grain: a few long wavering lines, the same every time. */
const GRAIN = Array.from({ length: 11 }, (_, i) => {
  const y = -96 + i * 19 + ((i * 37) % 7) - 3;
  const lift = ((i * 53) % 9) - 4;
  return `M-110 ${y} C-60 ${y + lift} -30 ${y - lift * 1.4} 0 ${y + lift * .6} S70 ${y - lift} 110 ${y + lift * .8}`;
});
const OCTAGON = Array.from({ length: 8 }, (_, i) => {
  const a = (i * 45 + 22.5) * Math.PI / 180;
  return `${(Math.cos(a) * 99).toFixed(2)} ${(Math.sin(a) * 99).toFixed(2)}`;
});
const PINS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * 45 + 22.5) * Math.PI / 180;
  return [Math.cos(a) * 93.6, Math.sin(a) * 93.6] as const;
});
const HOLE = `M0 ${-WINDOW * 100}A${WINDOW * 100} ${WINDOW * 100} 0 1 0 0 ${WINDOW * 100}A${WINDOW * 100} ${WINDOW * 100} 0 1 0 0 ${-WINDOW * 100}Z`;

function Bezel(): JSX.Element {
  const id = createUniqueId();
  return <svg class="pl-map-bezel" viewBox="-100 -100 200 200" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-wood`} x1="0" y1="0" x2=".25" y2="1">
        <stop offset="0" stop-color="#8a6040" /><stop offset=".4" stop-color="#5b3b27" /><stop offset="1" stop-color="#36220f" />
      </linearGradient>
      <linearGradient id={`${id}-bevel`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe1b4" stop-opacity=".5" /><stop offset=".5" stop-color="#ffe1b4" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity=".45" />
      </linearGradient>
      <linearGradient id={`${id}-brass`} x1=".2" y1="0" x2=".8" y2="1">
        <stop offset="0" stop-color="#fbe7b0" /><stop offset=".3" stop-color="#d9b46c" /><stop offset=".62" stop-color="#a57a3a" /><stop offset="1" stop-color="#5e4119" />
      </linearGradient>
      <radialGradient id={`${id}-pin`} cx="38%" cy="32%" r="70%">
        <stop offset="0" stop-color="#fff3cf" /><stop offset=".35" stop-color="#e2c07c" /><stop offset="1" stop-color="#6c4b22" />
      </radialGradient>
      <clipPath id={`${id}-oct`}><path d={`M${OCTAGON.join('L')}Z`} /></clipPath>
    </defs>
    <path class="pl-map-bezel-shadow" d={`M${OCTAGON.join('L')}Z`} transform="translate(0 4)" />
    <path d={`M${OCTAGON.join('L')}Z${HOLE}`} fill={`url(#${id}-wood)`} fill-rule="evenodd" />
    <g clip-path={`url(#${id}-oct)`} class="pl-map-bezel-grain">
      <For each={GRAIN}>{(d, i) => <path d={d} data-tone={i() % 3 === 0 ? 'light' : undefined} />}</For>
    </g>
    <path d={`M${OCTAGON.join('L')}Z`} fill="none" stroke={`url(#${id}-bevel)`} stroke-width="3.2" transform="scale(.965)" />
    <path d={`M${OCTAGON.join('L')}Z`} class="pl-map-bezel-edge" />
    <circle r="87.6" class="pl-map-bezel-seat" />
    <circle r={WINDOW * 100 + 4.6} fill="none" stroke={`url(#${id}-brass)`} stroke-width="9.2" />
    <circle r={WINDOW * 100 + 9.2} class="pl-map-bezel-line" />
    <circle r={WINDOW * 100 + .2} class="pl-map-bezel-lip" />
    <For each={Array.from({ length: 24 }, (_, i) => i)}>{i => {
      const a = i / 24 * TAU, inner = WINDOW * 100 + (i % 6 === 0 ? 1.6 : 3.2), outer = WINDOW * 100 + 7.6;
      return <line class="pl-map-bezel-tick" data-major={i % 6 === 0 ? 'true' : undefined}
        x1={Math.sin(a) * inner} y1={-Math.cos(a) * inner} x2={Math.sin(a) * outer} y2={-Math.cos(a) * outer} />;
    }}</For>
    <For each={PINS}>{([x, y]) => <circle cx={x} cy={y} r="2.7" fill={`url(#${id}-pin)`} class="pl-map-bezel-pin" />}</For>
  </svg>;
}

export function Minimap(props: MinimapProps): JSX.Element {
  const lineId = createUniqueId();
  const [present, setPresent] = createSignal(props.map() !== null);
  const [home, setHome] = createSignal<string | null>(null);
  const layers = createMapLayers();
  let canvas: HTMLCanvasElement | undefined;
  let root: HTMLDivElement | undefined;
  let size = { width: 0, height: 0 };
  let onScreen = true, shownHeading: number | null = null, last = 0, lastKey = '', lastSeen = 0, frameId = 0, idleId = 0, disposed = false;
  let visibleChecked = 0, cssVisible = true;
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) size = { width: entry.contentRect.width, height: entry.contentRect.height };
    lastKey = '';
  });
  const seen = new IntersectionObserver(entries => { for (const entry of entries) onScreen = entry.isIntersecting; schedule(); });
  const bindCanvas = (element: HTMLCanvasElement) => {
    canvas = element;
    const rect = element.getBoundingClientRect();
    size = { width: rect.width, height: rect.height };
    resize.observe(element);
  };

  const shown = () => {
    if (document.visibilityState === 'hidden' || !onScreen || !root) return false;
    const now = performance.now();
    if (now - visibleChecked > 500) {
      visibleChecked = now;
      cssVisible = typeof root.checkVisibility === 'function' ? root.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true;
    }
    return cssVisible;
  };

  function draw(now: number) {
    const view = props.map();
    setPresent(view !== null);
    if (!view) return;
    const metres = homeMetres(view);
    setHome(metres === null ? null : `Home · ${shortMetres(metres)}`);
    if (!canvas || !shown() || size.width < 8) return;
    const reduced = props.reducedMotion();
    const you = view.people.you;
    // The needle eases round the short way; with reduced motion it simply points.
    if (you) {
      if (shownHeading === null || reduced) shownHeading = you.heading;
      else shownHeading += wrap(you.heading - shownHeading) * Math.min(1, (now - lastSeen) / 90);
    }
    lastSeen = now;
    const animate = !reduced && !!view.route;
    const key = [view.town.revision, view.home, view.inside, view.route?.length.toFixed(1), view.route?.points.length, you && `${you.x.toFixed(2)},${you.z.toFixed(2)},${(shownHeading ?? 0).toFixed(3)}`,
      view.view?.toFixed(3), view.people.friends.map(friend => `${friend.id}@${friend.x.toFixed(1)},${friend.z.toFixed(1)}`).join(';'), size.width, size.height].join('|');
    if (!animate && key === lastKey) return;
    lastKey = key;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.round(size.width * dpr), height = Math.round(size.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const g = canvas.getContext('2d');
    if (!g) return;
    const market = view.town.places.find(place => place.id === 'market');
    const centre: [number, number] = you ? [you.x, you.z] : market ? [market.at[0], market.at[1]] : [0, 0];
    const painted = you && shownHeading !== null ? { ...view, people: { ...view.people, you: { ...you, heading: shownHeading } } } : view;
    paintTownMap(g, painted, {
      width: size.width, height: size.height, dpr, centre, metresPerPixel: ACROSS / Math.min(size.width, size.height),
      style: 'mini', time: reduced ? 0 : now / 1000,
    }, layers);
  }

  function tick(now: number) {
    frameId = 0;
    if (disposed) return;
    if (now - last >= FRAME_MS - 2) { last = now; try { draw(now); } catch (error) { console.error('The minimap could not be drawn', error); } }
    schedule();
  }
  function schedule() {
    if (disposed || frameId || idleId) return;
    // Hidden (or no map yet): ask again a few times a second, without holding a frame.
    if (!present() || !onScreen || document.visibilityState === 'hidden') {
      idleId = window.setTimeout(() => { idleId = 0; if (!disposed) { try { draw(performance.now()); } catch (error) { console.error('The minimap could not be drawn', error); } schedule(); } }, IDLE_MS);
      return;
    }
    frameId = requestAnimationFrame(tick);
  }

  onMount(() => {
    if (root) seen.observe(root);
    loadMapFonts(layers, () => { lastKey = ''; });
    schedule();
  });
  onCleanup(() => {
    disposed = true;
    cancelAnimationFrame(frameId); clearTimeout(idleId);
    resize.disconnect(); seen.disconnect();
  });

  return <div class="pl-map-mini-host" ref={element => { root = element; }}>
    <Show when={present()}>
      <div class="pl-map-mini" data-reduced={props.reducedMotion() ? 'true' : undefined}>
        <button type="button" class="pl-map-mini-button" aria-label="Open the map" aria-describedby={home() ? lineId : undefined}
          onClick={() => props.onOpen()}>
          <span class="pl-map-mini-window"><canvas class="pl-map-mini-canvas" ref={bindCanvas} aria-hidden="true" /></span>
          <Bezel />
          <span class="pl-map-mini-north" aria-hidden="true">N</span>
        </button>
        <Show when={home()}>{line => <p class="pl-map-mini-home" id={lineId}>{line()}</p>}</Show>
      </div>
    </Show>
  </div>;
}
