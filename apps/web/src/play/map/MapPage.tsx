import { createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { PlayMapView, PlayWayHomeLights } from '../host';
import { loadMapFonts } from './Minimap';
import { createMapLayers, fitTown, paintTownMap } from './paint';

/**
 * The ledger's Map page: the whole town painted on the leaf, to drag and zoom; a key to its marks; the way home in
 * words, and the lanterns to light it. Only you and your friends are ever on it.
 */

export interface MapPageProps {
  readonly map: () => PlayMapView | null;
  readonly lights?: PlayWayHomeLights;
  readonly cue: (surface: 'wood' | 'brass' | 'parchment') => void;
  readonly reducedMotion: () => boolean;
}

const FRAME_MS = 1000 / 30;
/** Closest zoom, as a share of the fitted scale, and the farthest. */
const ZOOM_IN = 1 / 8, ZOOM_OUT = 1.15;
const GLIDE_MS = 480;

/** "Crown Road, then Hearthward Lane": the streets in the order you walk them. */
export function streetWords(streets: readonly string[]): string {
  const names = streets.filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `Along ${names[0]}`;
  return `${names.slice(0, -1).join(', ')}, then ${names[names.length - 1]}`;
}

/** "About 140 metres by the streets". */
export function routeMetres(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  if (metres < 3) return 'A few steps';
  if (metres < 20) return `${Math.round(metres)} metres by the streets`;
  const step = metres < 100 ? 5 : 10;
  return `About ${Math.round(metres / step) * step} metres by the streets`;
}

interface Facts {
  readonly ready: boolean;
  readonly home: boolean;
  readonly inside: boolean;
  readonly you: boolean;
  readonly friends: number;
  readonly streets: readonly string[];
  readonly metres: number | null;
  readonly route: boolean;
}
const NO_FACTS: Facts = { ready: false, home: false, inside: false, you: false, friends: 0, streets: [], metres: null, route: false };
const sameFacts = (a: Facts, b: Facts) => a.ready === b.ready && a.home === b.home && a.inside === b.inside && a.you === b.you && a.friends === b.friends &&
  a.route === b.route && a.metres === b.metres && a.streets.join('|') === b.streets.join('|');

function factsOf(view: PlayMapView | null): Facts {
  if (!view) return NO_FACTS;
  const route = view.route;
  return {
    ready: true, home: !!view.home && view.town.homes.some(home => home.id === view.home), inside: view.inside, you: !!view.people.you,
    friends: view.people.friends.length, streets: route?.streets ?? [], route: !!route,
    metres: route ? Math.round(route.length + route.offStreet) : null,
  };
}

/* ------------------------------------------------------------------ the key's marks: the painter's glyphs, small */

const keyMark = (name: string, body: JSX.Element) => <svg class="pl-map-key-mark" data-mark={name} viewBox="0 0 32 32" aria-hidden="true">{body}</svg>;
const castleMark = () => keyMark('castle', <>
  <rect x="6" y="11" width="20" height="15" class="pl-map-km-wall" />
  <circle cx="7" cy="12" r="3.4" class="pl-map-km-stone" /><circle cx="25" cy="12" r="3.4" class="pl-map-km-stone" />
  <circle cx="7" cy="25" r="3.4" class="pl-map-km-stone" /><circle cx="25" cy="25" r="3.4" class="pl-map-km-stone" />
  <rect x="12" y="13" width="8" height="8" class="pl-map-km-keep" /><path d="M16 13V4.5" class="pl-map-km-line" />
  <path d="M16.3 4.6q3 .3 4.6 1.4-2 .9-4.6 1.6Z" class="pl-map-km-flag" />
</>);
const marketMark = () => keyMark('market', <>
  <path d="M5.5 8.5 26 8l.5 16-21 .6Z" class="pl-map-km-stone" />
  {[[9, 12], [14, 11.6], [19, 12.2], [23, 11.8], [11, 16.4], [16.5, 16], [21.5, 16.6], [9, 20.6], [14, 21], [19, 20.4], [23.4, 20.8]].map(([x, y]) =>
    <circle cx={x} cy={y} r=".9" class="pl-map-km-dot" />)}
</>);
const forgeMark = () => keyMark('forge', <>
  <ellipse cx="16" cy="19" rx="11" ry="6.5" class="pl-map-km-soot" />
  <path d="M6 12.5h16.5q-1 2.4-4.4 2.6-2.2.8-2.6 2.2v2l2.6 2.4H8.4l2.6-2.4v-2q-.9-2-5-2.6Z" class="pl-map-km-anvil" />
  <circle cx="13.6" cy="11.4" r="1.4" class="pl-map-km-ember" /><path d="M10.4 8.6 10 6.6M14 7.4V5M17.4 8.8l.5-1.9" class="pl-map-km-spark" />
</>);
const homeMark = () => keyMark('home', <>
  <circle cx="16" cy="16" r="13" class="pl-map-km-halo" />
  <rect x="9" y="11" width="14" height="10" class="pl-map-km-gold" /><rect x="9" y="16" width="14" height="5" class="pl-map-km-gold-shade" />
  <rect x="9" y="11" width="14" height="10" class="pl-map-km-gold-edge" /><path d="M10.4 16h11.2" class="pl-map-km-gold-edge" />
</>);
const youMark = () => keyMark('you', <>
  <path d="M16 5.5l6.2 16.4L16 19l-6.2 2.9Z" class="pl-map-km-brass" /><circle cx="16" cy="15.4" r="1.6" class="pl-map-km-pin" />
</>);
const friendMark = () => keyMark('friend', <>
  <path d="M16 27c-1.8-3.6-6.4-6.6-6.4-11.6a6.4 6.4 0 0 1 12.8 0c0 5-4.6 8-6.4 11.6Z" class="pl-map-km-friend" /><circle cx="16" cy="15.4" r="2.3" class="pl-map-km-friend-eye" />
</>);
const lanternMark = () => keyMark('route', <>
  {[4, 9, 14, 19, 24, 28.5].map(x => <circle cx={x} cy="16" r="1.25" class="pl-map-km-route" />)}
  <circle cx="16.5" cy="16" r="3.4" class="pl-map-km-lantern" /><circle cx="15.7" cy="15" r="1.2" class="pl-map-km-flame" />
</>);
/** The compass rose in the sheet's corner: an inked eight-point star, north blacked in. */
const rose = () => <svg class="pl-map-rose" viewBox="-50 -50 100 100" aria-hidden="true">
  <circle r="30" class="pl-map-rose-ring" /><circle r="26.5" class="pl-map-rose-ring pl-map-rose-thin" />
  <path d="M0-24 4-4 24 0 4 4 0 24-4 4-24 0-4-4Z" transform="rotate(45) scale(.66)" class="pl-map-rose-minor" />
  <path d="M0-38 5.5-5.5 0 0Z M0 38-5.5 5.5 0 0Z M38 0 5.5 5.5 0 0Z M-38 0-5.5-5.5 0 0Z" class="pl-map-rose-dark" />
  <path d="M0-38-5.5-5.5 0 0Z M0 38 5.5 5.5 0 0Z M38 0 5.5-5.5 0 0Z M-38 0-5.5 5.5 0 0Z" class="pl-map-rose-light" />
  <circle r="2.6" class="pl-map-rose-dark" />
  <text y="-40.5" class="pl-map-rose-n">N</text>
</svg>;
const plus = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>;
const minus = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10h11" /></svg>;
const needle = () => <svg class="pl-map-button-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" class="pl-map-bm-ring" />
  <path d="M12 4.6l3.6 9.6L12 12.6l-3.6 1.6Z" class="pl-map-bm-needle" /><path d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2" class="pl-map-bm-ring" /></svg>;
const lantern = () => <svg class="pl-map-button-mark" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M9 4.5h6M12 2v2.5M8 7.5h8l-1 10H9Z" class="pl-map-bm-line" /><path d="M7 19.5h10" class="pl-map-bm-line" />
  <path d="M12 16.2c-1.4 0-2.1-.9-2.1-1.9 0-1.2 1.2-1.8 1.4-3.3.9.6 1.2 1.5 1 2.1.5-.2.9-.6 1-1.1.6.6.8 1.4.8 2.3 0 1.1-.7 1.9-2.1 1.9Z" class="pl-map-bm-flame" />
</svg>;

export function MapPage(props: MapPageProps): JSX.Element {
  const hintId = createUniqueId();
  const [facts, setFacts] = createSignal<Facts>(factsOf(props.map()), { equals: sameFacts });
  const [lit, setLit] = createSignal(props.lights?.lit ?? false);
  const [lightNote, setLightNote] = createSignal<string | null>(null);
  const layers = createMapLayers();
  let canvas: HTMLCanvasElement | undefined, surface: HTMLDivElement | undefined;
  let size = { width: 0, height: 0 };
  /** The view: the world point in the middle, metres per CSS pixel, and whether you have moved it yourself. */
  let centre: [number, number] = [0, 0], mpp = 1, moved = false, fitted = { centre: [0, 0] as [number, number], metresPerPixel: 1 };
  let glide: { from: [number, number]; to: [number, number]; fromMpp: number; toMpp: number; start: number } | null = null;
  let lastGesture = -Infinity, lastKey = '', last = 0, frameId = 0, disposed = false, onScreen = true, revision = '';
  let lastCue = 0;

  if (props.lights) onCleanup(props.lights.onChange(next => { setLit(next); if (next) setLightNote(null); }));

  const clampView = () => {
    mpp = Math.min(fitted.metresPerPixel * ZOOM_OUT, Math.max(fitted.metresPerPixel * ZOOM_IN, mpp));
    const town = props.map()?.town;
    if (town) {
      const b = town.bounds;
      if ([b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite)) {
        centre = [Math.min(b.maxX, Math.max(b.minX, centre[0])), Math.min(b.maxZ, Math.max(b.minZ, centre[1]))];
      }
    }
  };
  const refit = (view: PlayMapView) => {
    fitted = fitTown(view.town, size.width, size.height, Math.min(28, size.width * .05));
    if (!moved) { centre = [...fitted.centre]; mpp = fitted.metresPerPixel; }
    clampView();
  };
  const softCue = (surface: 'parchment' | 'brass') => {
    const now = performance.now();
    if (now - lastCue > 260) { lastCue = now; props.cue(surface); }
  };
  const nudge = () => { lastGesture = performance.now(); moved = true; glide = null; lastKey = ''; };

  /** Zoom by `factor` about a point of the sheet (CSS pixels from its top-left); that point stays where it is. */
  function zoomAbout(px: number, py: number, factor: number) {
    const wx = centre[0] + (px - size.width / 2) * mpp, wz = centre[1] + (py - size.height / 2) * mpp;
    mpp *= factor; clampView();
    centre = [wx - (px - size.width / 2) * mpp, wz - (py - size.height / 2) * mpp];
    clampView(); nudge();
  }
  function panBy(dx: number, dy: number) { centre = [centre[0] - dx * mpp, centre[1] - dy * mpp]; clampView(); nudge(); }

  function glideTo(to: [number, number], toMpp: number) {
    moved = true;
    if (props.reducedMotion()) { centre = to; mpp = toMpp; clampView(); glide = null; lastKey = ''; return; }
    glide = { from: [...centre], to, fromMpp: mpp, toMpp, start: performance.now() };
  }
  function centreOnMe() {
    const you = props.map()?.people.you;
    if (!you) return;
    props.cue('brass');
    glideTo([you.x, you.z], Math.min(mpp, fitted.metresPerPixel * .45));
  }
  function zoomButton(factor: number) {
    props.cue('brass');
    const target = Math.min(fitted.metresPerPixel * ZOOM_OUT, Math.max(fitted.metresPerPixel * ZOOM_IN, mpp * factor));
    glideTo([...centre], target);
  }
  function lightTheWay() {
    if (!props.lights) return;
    props.cue('brass');
    let ok = false;
    try { ok = props.lights.light(); } catch (error) { console.error('The lanterns could not be lit', error); }
    setLightNote(ok ? null : 'No open street reaches your door from here.');
    setLit(props.lights.lit);
  }

  /* ---------------------------------------------------------------- pointers: drag to move, pinch to zoom */
  const pointers = new Map<number, { x: number; y: number }>();
  let origin = { left: 0, top: 0 };
  const local = (event: PointerEvent | WheelEvent) => ({ x: event.clientX - origin.left, y: event.clientY - origin.top });
  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = surface!.getBoundingClientRect(); origin = { left: rect.left, top: rect.top };
    surface!.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) softCue('parchment');
    surface!.dataset.dragging = 'true';
    event.preventDefault();
  }
  function move(event: PointerEvent) {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    const now = local(event);
    if (pointers.size === 1) { panBy(now.x - before.x, now.y - before.y); pointers.set(event.pointerId, now); return; }
    const others = [...pointers.entries()].filter(([id]) => id !== event.pointerId).map(([, p]) => p);
    const other = others[0]!;
    const d0 = Math.hypot(before.x - other.x, before.y - other.y), d1 = Math.hypot(now.x - other.x, now.y - other.y);
    const m0 = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 }, m1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
    pointers.set(event.pointerId, now);
    if (d0 > 4 && d1 > 4) zoomAbout(m1.x, m1.y, d0 / d1);
    panBy(m1.x - m0.x, m1.y - m0.y);
  }
  function up(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (!pointers.size && surface) delete surface.dataset.dragging;
    lastKey = '';
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    const rect = surface!.getBoundingClientRect(); origin = { left: rect.left, top: rect.top };
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    const p = local(event);
    zoomAbout(p.x, p.y, Math.exp(Math.max(-120, Math.min(120, event.deltaY * unit)) * .0022));
    softCue('parchment');
  }
  function key(event: KeyboardEvent) {
    const step = 56;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) { const [dx, dy] = moves[event.key]!; panBy(dx, dy); softCue('parchment'); }
    else if (event.key === '+' || event.key === '=') zoomButton(1 / 1.5);
    else if (event.key === '-' || event.key === '_') zoomButton(1.5);
    else if (event.key === '0' || event.key === 'Home') { props.cue('brass'); moved = false; glideTo([...fitted.centre], fitted.metresPerPixel); moved = false; }
    else return;
    event.preventDefault(); event.stopPropagation();
  }

  /* ---------------------------------------------------------------- the frame loop: at most 30 a second, only on screen */
  function draw(now: number) {
    const view = props.map();
    setFacts(factsOf(view));
    if (!view || !canvas || size.width < 8 || size.height < 8) return;
    if (view.town.revision !== revision) { revision = view.town.revision; refit(view); lastKey = ''; }
    if (glide) {
      const t = Math.min(1, (now - glide.start) / GLIDE_MS), e = 1 - Math.pow(1 - t, 3);
      // Glide in log scale so a zoom feels even.
      mpp = Math.exp(Math.log(glide.fromMpp) + (Math.log(glide.toMpp) - Math.log(glide.fromMpp)) * e);
      centre = [glide.from[0] + (glide.to[0] - glide.from[0]) * e, glide.from[1] + (glide.to[1] - glide.from[1]) * e];
      clampView();
      if (t >= 1) glide = null;
      lastKey = '';
    }
    const reduced = props.reducedMotion();
    const quick = now - lastGesture < 160 || pointers.size > 0;
    const animate = !reduced && !!view.route;
    const you = view.people.you;
    const keyNow = [view.town.revision, view.home, view.inside, view.route?.length.toFixed(1), you && `${you.x.toFixed(2)},${you.z.toFixed(2)},${you.heading.toFixed(3)}`,
      view.view?.toFixed(3), view.people.friends.map(friend => `${friend.id}@${friend.x.toFixed(1)},${friend.z.toFixed(1)}`).join(';'),
      centre.join(','), mpp, size.width, size.height, quick].join('|');
    if (!animate && keyNow === lastKey) return;
    lastKey = keyNow;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.round(size.width * dpr), height = Math.round(size.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const g = canvas.getContext('2d');
    if (!g) return;
    paintTownMap(g, view, { width: size.width, height: size.height, dpr, centre, metresPerPixel: mpp, style: 'page', time: reduced ? 0 : now / 1000, quick }, layers);
  }
  function tick(now: number) {
    frameId = 0;
    if (disposed) return;
    if (now - last >= FRAME_MS - 2) { last = now; try { draw(now); } catch (error) { console.error('The map could not be drawn', error); } }
    if (onScreen && document.visibilityState !== 'hidden') frameId = requestAnimationFrame(tick);
  }
  const wake = () => { if (!frameId && !disposed) frameId = requestAnimationFrame(tick); };

  const resize = new ResizeObserver(entries => {
    for (const entry of entries) size = { width: entry.contentRect.width, height: entry.contentRect.height };
    const view = props.map();
    if (view) refit(view);
    lastKey = ''; wake();
  });
  const seen = new IntersectionObserver(entries => { for (const entry of entries) onScreen = entry.isIntersecting; wake(); });
  const visibility = () => wake();

  onMount(() => {
    if (surface) {
      const rect = surface.getBoundingClientRect();
      size = { width: rect.width, height: rect.height };
      resize.observe(surface); seen.observe(surface);
      surface.addEventListener('wheel', wheel, { passive: false });
    }
    document.addEventListener('visibilitychange', visibility);
    loadMapFonts(layers, () => { lastKey = ''; wake(); });
    wake();
  });
  onCleanup(() => {
    disposed = true; cancelAnimationFrame(frameId);
    resize.disconnect(); seen.disconnect();
    surface?.removeEventListener('wheel', wheel);
    document.removeEventListener('visibilitychange', visibility);
  });

  return <div class="pl-map-page" data-reduced={props.reducedMotion() ? 'true' : undefined}>
    <div class="pl-map-sheet">
      <div class="pl-map-surface" ref={element => { surface = element; }} tabindex="0" role="group" aria-roledescription="map"
        aria-label="The map of the kingdom" aria-describedby={hintId}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onKeyDown={key}>
        <canvas class="pl-map-canvas" ref={element => { canvas = element; }} aria-hidden="true" />
      </div>
      {rose()}
      <div class="pl-map-zoom">
        <button type="button" class="pl-map-knob" aria-label="Closer" onClick={() => zoomButton(1 / 1.6)}>{plus()}</button>
        <button type="button" class="pl-map-knob" aria-label="Farther" onClick={() => zoomButton(1.6)}>{minus()}</button>
      </div>
      <p class="pl-map-hint" id={hintId}>Drag to move the map, or use the arrow keys. Wheel, pinch, plus or minus to come closer.</p>
    </div>

    <div class="pl-map-under">
      <section class="pl-map-way" aria-labelledby={`${hintId}-way`}>
        <header class="pl-map-head"><h3 class="pl-map-title" id={`${hintId}-way`}>The way home</h3></header>
        <Show when={facts().ready} fallback={<p class="pl-map-line">The map opens once you stand in the kingdom.</p>}>
          <Show when={facts().home} fallback={<p class="pl-map-line">You have no home in this kingdom yet.</p>}>
            <Show when={!facts().inside} fallback={<p class="pl-map-line">You are home.</p>}>
              <Show when={facts().route} fallback={<p class="pl-map-line">{facts().you ? 'No open street reaches your door from here.' : 'Your home is marked in gold.'}</p>}>
                <p class="pl-map-streets">{streetWords(facts().streets)}</p>
                <Show when={facts().metres !== null}><p class="pl-map-far">{routeMetres(facts().metres!)}</p></Show>
              </Show>
            </Show>
          </Show>
        </Show>
        <div class="pl-map-actions">
          <Show when={props.lights && facts().route && !facts().inside}>
            <Show when={!lit()} fallback={<p class="pl-map-lit" role="status">{lantern()}<span>The lanterns are lit</span></p>}>
              <button type="button" class="pl-map-light" onClick={lightTheWay}>{lantern()}<span>Light the way home</span></button>
            </Show>
          </Show>
          <Show when={facts().you}>
            <button type="button" class="pl-map-centre" onClick={centreOnMe}>{needle()}<span>Centre on me</span></button>
          </Show>
        </div>
        <Show when={lightNote()}>{note => <p class="pl-map-note" role="status">{note()}</p>}</Show>
      </section>

      <section class="pl-map-key" aria-labelledby={`${hintId}-key`}>
        <header class="pl-map-head"><h3 class="pl-map-title" id={`${hintId}-key`}>Key</h3></header>
        <ul class="pl-map-key-list" role="list">
          <li>{castleMark()}<span>The castle</span></li>
          <li>{marketMark()}<span>The market</span></li>
          <li>{forgeMark()}<span>The Forge</span></li>
          <Show when={facts().home}><li>{homeMark()}<span>Your home</span></li></Show>
          <Show when={facts().route}><li>{lanternMark()}<span>Lanterns to your door</span></li></Show>
          <Show when={facts().you}><li>{youMark()}<span>You</span></li></Show>
          <Show when={facts().friends > 0}><li>{friendMark()}<span>{facts().friends === 1 ? 'Your friend' : 'Your friends'}</span></li></Show>
        </ul>
      </section>
    </div>
  </div>;
}
