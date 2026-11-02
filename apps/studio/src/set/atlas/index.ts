// The Atlas set piece (S19, S21): the product's Atlas map (PixiJS) staged by read-only import, with the raid road
// layer drawn by its own camera. The camera and every road's ink are pure functions of shot time t.
//
//   /studio/set.html?scene=atlas&shot=S19[&from=2.5]
//
// The plate is the map's own canvas; nothing is drawn over it. Only the four consenting channels are named on the
// paper (data.ts). `window.__set.idle()` is true once every land tile of the level the frame needs is baked and opaque,
// every label is set in its loaded face, and no redraw is pending.
import '../contract';
import { shotClock } from '../contract';
import { MapView, type MapStats } from '../../../../web/src/atlas/map/view';
import { Camera, DISTANCE_SCALE, type Viewport } from '../../../../web/src/atlas/map/camera';
import type { CameraState } from '../../../../web/src/atlas/map/motion';
import { FADE_MS as TILE_FADE_MS } from '../../../../web/src/atlas/map/tile-plan';
import { RoadLayer, type MapLayer } from '../../../../web/src/atlas/road/layer';
import { planRoad, roadBounds, type RoadPath } from '../../../../web/src/atlas/road/geometry';
import { caravanCount, columnTail } from '../../../../web/src/atlas/road/caravan';
import { NEAR_SCALE } from '../../../../web/src/atlas/road/shot';
import fellRegular from '../../../../web/src/atlas/assets/fonts/im-fell-english-regular.woff2?url';
import fellItalic from '../../../../web/src/atlas/assets/fonts/im-fell-english-italic.woff2?url';
import fellCaps from '../../../../web/src/atlas/assets/fonts/im-fell-english-sc.woff2?url';
import alegreyaLatin from '../../../../web/src/atlas/assets/fonts/alegreya-roman-latin.woff2?url';
import alegreyaCyrillic from '../../../../web/src/atlas/assets/fonts/alegreya-roman-cyrillic.woff2?url';
import alegreyaGreek from '../../../../web/src/atlas/assets/fonts/alegreya-roman-greek.woff2?url';
import alegreyaItalicLatin from '../../../../web/src/atlas/assets/fonts/alegreya-italic-latin.woff2?url';
import alegreyaItalicCyrillic from '../../../../web/src/atlas/assets/fonts/alegreya-italic-cyrillic.woff2?url';
import alegreyaItalicGreek from '../../../../web/src/atlas/assets/fonts/alegreya-italic-greek.woff2?url';
import { loadAtlas, PREVIEW_ID, type AtlasData, type Holding } from './data';
import { COLUMN, PULLBACK_END, RISE_START, SHOTS, type AtlasShot, type RoadPlan } from './shots';

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD, U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116, U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F';
const GREEK = 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF';

/** The Atlas's faces, as atlas.css declares them, each loaded outright (no grace timeout: time stands still here). */
async function loadFaces(): Promise<void> {
  const faces: [string, string, FontFaceDescriptors][] = [
    ['IM Fell English', fellRegular, { style: 'normal', weight: '400' }],
    ['IM Fell English', fellItalic, { style: 'italic', weight: '400' }],
    ['IM Fell English SC', fellCaps, { style: 'normal', weight: '400' }],
    ['Alegreya', alegreyaLatin, { style: 'normal', weight: '400 900', unicodeRange: LATIN }],
    ['Alegreya', alegreyaCyrillic, { style: 'normal', weight: '400 900', unicodeRange: CYRILLIC }],
    ['Alegreya', alegreyaGreek, { style: 'normal', weight: '400 900', unicodeRange: GREEK }],
    ['Alegreya', alegreyaItalicLatin, { style: 'italic', weight: '400 900', unicodeRange: LATIN }],
    ['Alegreya', alegreyaItalicCyrillic, { style: 'italic', weight: '400 900', unicodeRange: CYRILLIC }],
    ['Alegreya', alegreyaItalicGreek, { style: 'italic', weight: '400 900', unicodeRange: GREEK }],
  ];
  await Promise.all(faces.map(async ([family, url, descriptors]) => {
    const face = new FontFace(family, `url(${url}) format('woff2')`, descriptors);
    document.fonts.add(await face.load());
  }));
}

/**
 * Label fades are presentation, not content: a placed name shows whole at once, so a still at any t matches the
 * recording's frame. The map reads this query each frame; nothing else on the page asks for it.
 */
function preferReducedMotion(): void {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    if (query.replace(/\s+/g, '') !== '(prefers-reduced-motion:reduce)') return original(query);
    const list = original(query);
    return Object.defineProperty(Object.create(list) as MediaQueryList, 'matches', { value: true });
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smootherstep = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * A pull-back between two poses as a pure zoom about the one world point that holds still on screen (scale on a log
 * curve). A road being left behind stays where the eye has it while the world opens around it.
 */
function zoomBetween(a: CameraState, b: CameraState, u: number): CameraState {
  const scale = Math.exp(lerp(Math.log(a.scale), Math.log(b.scale), u));
  const k = a.scale / b.scale;
  if (Math.abs(1 - k) < 1e-6) return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), scale };
  const ax = (b.x - a.x * k) / (1 - k), ay = (b.y - a.y * k) / (1 - k);
  const f = a.scale / scale;
  return { x: ax + (a.x - ax) * f, y: ay + (a.y - ay) * f, scale };
}

/** Several road layers drawn as one, under and over the holdings' marks, with the map's own camera. */
function roadSet(layers: RoadLayer[]): MapLayer {
  const make = layers[0]!.under.constructor as new () => RoadLayer['under'];
  const under = new make(), over = new make();
  for (const layer of layers) { under.addChild(layer.under); over.addChild(layer.over); }
  return {
    under, over,
    get animating() { return layers.some(layer => layer.animating); },
    update(camera, view) { for (const layer of layers) layer.update(camera, view); },
  };
}

interface ViewInside {
  app: { canvas: HTMLCanvasElement };
  draw(now: number): void;
  dirty: boolean;
  farm: { onBaked: (key: unknown, image: unknown) => void };
  overlay: { animating: boolean };
  tiles: { complete: boolean };
}

interface Road { plan: RoadPlan; path: RoadPath; layer: RoadLayer; count: number }

export async function start(query: URLSearchParams, canvas: HTMLCanvasElement): Promise<void> {
  const shot: AtlasShot = SHOTS[(query.get('shot') ?? 'S19') as AtlasShot['id']] ?? SHOTS.S19;
  const clock = shotClock(Number(query.get('from') ?? 0));
  preferReducedMotion();

  // The map mounts its own canvas in a full-window host; that canvas is the plate.
  canvas.style.display = 'none';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#e2d3ae';
  // `ui=k` (default 1.5) draws the map's type, stamps, strokes and figures k times larger, so the names and the
  // column read in a film frame as they do on a laptop: the map is laid out at 1/k of the window and scaled up with
  // k times the pixel density, so each canvas pixel still lands on one screen pixel. The map caps its density at 2,
  // so k is held to 2 / device scale (at device scale 2 the map is drawn at its own size, crisp).
  const dpr = window.devicePixelRatio || 1;
  const ui = Math.min(2 / dpr, Math.max(1, Number(query.get('ui') ?? 1.5) || 1));
  if (ui > 1) {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr * ui });
    host.style.cssText += `;right:auto;bottom:auto;width:${100 / ui}vw;height:${100 / ui}vh;transform:scale(${ui});transform-origin:0 0`;
  }
  document.body.appendChild(host);

  let view: MapView | null = null;
  let inside: ViewInside | null = null;
  let roads: Road[] = [];
  let poseAt: ((t: number) => CameraState) | null = null;
  let ready = false;
  let settleQueued = false;
  let bonus = 0;
  let data: AtlasData | null = null;

  // Registered before the map's own frame loop, so each frame's pose lands in the frame the map draws next.
  const drive = () => {
    requestAnimationFrame(drive);
    if (view && poseAt) place(clock.t());
  };
  requestAnimationFrame(drive);

  function place(t: number): void {
    view!.setCamera(poseAt!(t));
    const scale = poseAt!(t).scale;
    for (const road of roads) {
      const { plan } = road;
      const opacity = plan.appear ? smootherstep(plan.appear[0], plan.appear[1], t) : 1;
      const travel = plan.ink[1] < 0 ? 1 : smootherstep(plan.ink[0], plan.ink[1], t);
      if (plan.viewers === null) {
        road.layer.set({ head: travel, inked: travel, time: 0, opacity, marching: false });
        continue;
      }
      // The column: out of the gate, along the road, then filing in through the destination's gate.
      const tail = columnTail(road.path, road.count, scale) * 1.05;
      const file = clamp01((t - COLUMN.file[0]) / (COLUMN.file[1] - COLUMN.file[0]));
      const head = travel + file * tail;
      road.layer.set({ head, inked: Math.min(1, head), time: t, opacity, marching: t >= COLUMN.out && file < 1 });
    }
  }

  await loadFaces();
  data = await loadAtlas();
  const { holdings } = data;
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  roads = shot.roads.map(plan => {
    const from = holdings[plan.from], to = holdings[plan.to];
    const path = planRoad(from, to, `${from.id}>${to.id}`, false);
    const count = caravanCount(plan.viewers ?? 1);
    return { plan, path, count, layer: new RoadLayer(path, { sourceId: from.id, count }, pixelRatio) };
  });

  const viewport = (): Viewport => ({ width: host.clientWidth || 1, height: host.clientHeight || 1 });
  const raid = planRoad(holdings.tobi4s_, holdings.MashaD4, `${holdings.tobi4s_.id}>${holdings.MashaD4.id}`, false);
  const composed = composedPose(raid, viewport());
  const home = (() => { const c = new Camera(data.geo.bounds); c.home(viewport()); return c.snapshot(); })();
  const rise: CameraState = { x: holdings.tobi4s_.x, y: holdings.tobi4s_.y, scale: NEAR_SCALE * RISE_START };
  poseAt = shot.camera === 'rise'
    ? t => zoomBetween(rise, composed, easeOut(t / shot.duration))
    : t => zoomBetween(composed, home, smootherstep(0, PULLBACK_END, t));

  view = await MapView.create(host, {
    world: data.world, geo: data.geo, store: data.store,
    loadChunk: async () => undefined,
  }, {
    ready: () => undefined, select: () => undefined, selectDab: () => undefined, camera: () => undefined,
    chunkFailed: () => undefined, tilesFailed: () => undefined, context: () => undefined,
  }, undefined, poseAt(clock.t()));
  inside = view as unknown as ViewInside;
  view.attachLayer(roadSet(roads.map(r => r.layer)));
  const plate = inside.app.canvas;

  // Every draw finishes its own fades: the map's clock is moved on past the tile fade for the frame's redraw, never
  // backwards, so a tile that has arrived is drawn whole and the frame on screen is the final one.
  const draw = Object.getPrototypeOf(view).draw as (this: MapView, now: number) => void;
  const stats = () => view!.stats();
  Object.defineProperty(view, 'draw', {
    configurable: true,
    value: (now: number) => {
      draw.call(view!, now + bonus);
      for (let pass = 0; pass < 4 && (stats().tiles.fading > 0 || inside!.overlay.animating); pass++) {
        bonus += TILE_FADE_MS + 1;
        draw.call(view!, performance.now() + bonus);
      }
      if (!ready && settled()) {
        ready = true;
        clock.begin();
        window.__chatdomReady = true;
      }
    },
  });
  // Tiles bake in workers on the real event loop; when one arrives the frame is redrawn at once (no frame passes in
  // virtual time while the recorder waits for idle()).
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    settleQueued = false;
    inside!.dirty = false;
    inside!.draw(performance.now());
  };
  const baked = inside.farm.onBaked;
  inside.farm.onBaked = (key, image) => {
    baked(key, image);
    if (!settleQueued) { settleQueued = true; channel.port2.postMessage(0); }
  };

  function settled(): boolean {
    const s: MapStats = stats();
    // `complete`: every visible tile at the level the screen needs is baked and opaque. A view held only by coarser
    // stand-ins counts as covered in `uncovered`, but those draw another level's decor, so they never make a plate.
    return inside!.tiles.complete && s.tiles.uncovered === 0 && s.tiles.fading === 0 && !inside!.overlay.animating && !roads.some(r => r.layer.animating);
  }

  place(clock.t());
  window.addEventListener('resize', () => { if (view) place(clock.t()); });
  window.__set = {
    scene: 'atlas',
    duration: shot.duration,
    canvas: plate,
    idle: () => ready && !settleQueued && !inside!.dirty && settled(),
    t: () => clock.t(),
    stats: () => {
      const s = stats();
      return {
        shot: shot.id, preview: PREVIEW_ID, pixelRatio, ui, camera: s.camera, distance: s.distance, tiles: s.tiles, overlay: s.overlay,
        holdings: Object.fromEntries(Object.entries(holdings).map(([k, h]: [string, Holding]) => [k, { x: +h.x.toFixed(2), y: +h.y.toFixed(2), tier: h.tier, settled: h.settled }])),
        hiddenLabels: data!.hiddenLabels,
        named: view!.drawnMarks(400).filter(m => m.name !== null).map(m => m.name),
      };
    },
  };
}

/** The road and both its holdings framed together, at kingdom distance or closer so even a village is drawn. */
function composedPose(path: RoadPath, view: Viewport): CameraState {
  const box = roadBounds(path);
  const w = Math.max(1, box.maxX - box.minX), h = Math.max(1, box.maxY - box.minY);
  const fit = Math.min((view.width * 0.58) / w, (view.height * 0.5) / h);
  const scale = Math.min(NEAR_SCALE, Math.max(DISTANCE_SCALE.kingdom * 1.04, fit));
  // A touch above the middle: the holdings' names sit under their stamps.
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 + 12 / scale, scale };
}
