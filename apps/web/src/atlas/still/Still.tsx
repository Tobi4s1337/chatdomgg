import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack, type JSX } from 'solid-js';
import stampSheetUrl from '../assets/stamps.webp?url';
import stampSheet from '../assets/stamps.json';
import { decodeRings, type Geography, type Settler, type SettlerStore } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import { drawShield, shieldDesign, SHIELD_ASPECT } from '../heraldry';
import type { LivePaint } from '../live/paint';
import type { Distance, Viewport } from '../map/camera';
import { BLOT_SIZE, BLOT_VARIANTS, paintBlot, paintDensity } from '../map/live-marks';
import type { Stamp } from '../map/paint';
import { tileKey, type TileKey } from '../map/pyramid';
import { paintSceneFor } from '../map/scene';
import { INK, PAPER, PAPER_DEEP, VERMILION } from '../map/theme';
import { StampIcon } from '../ui/marks';
import { StillBaker, type Baked } from './bake';
import {
  ancestorCrop, ancestorsOf, FACE_CAPS, FACE_ITALIC, FACE_TEXT, layoutStill, layoutStillSelection, LINE, sheetFrame, stillPixelRatio, stillRibbon, stillView, tileRect,
  washStains, type Font, type Stain, type StillLayout, type StillMark, type StillText, type StillView,
} from './compose';
import './still.css';

const stamps = (stampSheet as { stamps: Stamp[] }).stamps;
const FACES = ['16px "IM Fell English"', 'italic 16px "IM Fell English"', '16px "IM Fell English SC"', '16px "Alegreya"', 'italic 16px "Alegreya"'];
/** Lettering waits this long at most for the faces; after that it is set in whatever the page has. */
const FONT_GRACE_MS = 4_000;
/** The wash is repainted at most this often while streams bloom in or dry away. */
const WASH_REPAINT_MIN_MS = 1_000;

export interface StillProps {
  world: PreviewWorld;
  /** The shared scene owns one dated survey seal instead of duplicating the long ribbon. */
  compactChrome?: boolean;
  geo: Geography;
  store: SettlerStore;
  /** Live paint of the current frame, or null (no frame yet / unavailable). */
  paint: LivePaint | null;
  liveTick: number;
  selected: Settler | null;
  onSelect: (settler: Settler) => void;
  /** Called once the still is fully composed (land + marks + names). */
  onReady: () => void;
  /**
   * Reads a region's towns and villages into the store. When given, they are read quietly after the first view while
   * a live frame is shown, nearest the centre first, so their washes are laid too (as the moving map does).
   */
  loadChunk?: (region: number) => Promise<void>;
  /** The still's fixed scale and distance, for the scale bar and the page's evidence attributes. */
  onView?: (state: { scale: number; distance: Distance }) => void;
  /** The page's notice, if any: it hangs from the ribbon's banner so the two stack at every width. */
  notice?: JSX.Element;
}

interface Land { canvas: HTMLCanvasElement; view: StillView; baked: number; missing: number }

function fontString(font: Font): string {
  if (font.face === 'caps') return `${font.size}px ${FACE_CAPS}`;
  if (font.face === 'italic') return `italic ${font.size}px ${FACE_ITALIC}`;
  return `${font.size}px ${FACE_TEXT}`;
}

const spacingSupported = (ctx: CanvasRenderingContext2D) => 'letterSpacing' in ctx;

/** A blot or density stain as vermilion pigment in alpha, as the wash layer's tinted textures carry it. */
function tinted(paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = BLOT_SIZE;
  const ctx = canvas.getContext('2d')!;
  paint(ctx);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = VERMILION;
  ctx.fillRect(0, 0, BLOT_SIZE, BLOT_SIZE);
  return canvas;
}

/** One slice of wash painting may hold the main thread this long; input and the card always get the next turn. */
const WASH_SLICE_MS = 6;

/**
 * The vermilion wash in Canvas 2D: stains accumulate on one layer with ordinary alpha (overlaps deepen toward full
 * pigment and stop there), and the layer is multiplied into the paper once, so it can only darken toward vermilion.
 *
 * Tens of thousands of stains take a few hundred milliseconds to lay on a slow device, so they are laid in short
 * slices on a back layer and the finished layer is swapped in whole. The drawing then composites the finished layer,
 * which is one image, as often as it likes: a selection or a new name never repaints the wash.
 */
class WashCanvas {
  private readonly blots = Array.from({ length: BLOT_VARIANTS }, (_, i) => tinted((ctx) => paintBlot(ctx, i)));
  private readonly density = tinted(paintDensity);
  private front = document.createElement('canvas');
  private back = document.createElement('canvas');
  private job: { stains: readonly Stain[]; next: number; res: number; opacity: number; owner: object } | null = null;
  /** What the front layer was laid for, and at what opacity it is multiplied in; null while there is none. */
  private shown: { owner: object; opacity: number; count: number } | null = null;

  get busy(): boolean {
    return this.job !== null;
  }

  /** How many stains the shown layer carries for `owner` (0 when it carries none, or was laid for another view). */
  count(owner: object): number {
    return this.shown?.owner === owner ? this.shown.count : 0;
  }

  /** Begin laying `stains` for the view `owner`; any unfinished layer is dropped. */
  begin(owner: object, stains: readonly Stain[], opacity: number, view: Viewport, pixelRatio: number): void {
    const res = Math.min(1.5, pixelRatio);
    const width = Math.max(1, Math.round(view.width * res));
    const height = Math.max(1, Math.round(view.height * res));
    if (this.back.width !== width || this.back.height !== height) {
      this.back.width = width;
      this.back.height = height;
    }
    const ctx = this.back.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    this.job = { stains, next: 0, res, opacity, owner };
  }

  /** Lays stains until `deadline`; true once the layer is finished and shown. */
  step(deadline: number): boolean {
    const job = this.job;
    if (!job) return true;
    const ctx = this.back.getContext('2d')!;
    const { stains, res } = job;
    let i = job.next;
    while (i < stains.length) {
      const stain = stains[i++]!;
      const size = stain.size * res;
      ctx.globalAlpha = Math.min(1, stain.alpha);
      if (stain.variant < 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.density, stain.x * res - size / 2, stain.y * res - size / 2, size, size);
      } else {
        const cos = Math.cos(stain.rotation);
        const sin = Math.sin(stain.rotation);
        ctx.setTransform(cos, sin, -sin, cos, stain.x * res, stain.y * res);
        ctx.drawImage(this.blots[stain.variant % BLOT_VARIANTS]!, -size / 2, -size / 2, size, size);
      }
      // The clock is read every few dozen stains: reading it costs more than one small stain.
      if ((i & 31) === 0 && performance.now() >= deadline) break;
    }
    job.next = i;
    if (i < stains.length) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    [this.front, this.back] = [this.back, this.front];
    this.shown = { owner: job.owner, opacity: job.opacity, count: stains.length };
    this.job = null;
    return true;
  }

  /** Nothing is to be shown (no live frame, or nobody live in view); an unfinished layer is dropped too. */
  clear(owner: object): void {
    this.job = null;
    this.shown = { owner, opacity: 0, count: 0 };
  }

  /** Multiplies the finished layer into `target` when it was laid for `owner`. */
  composite(target: CanvasRenderingContext2D, owner: object): void {
    const shown = this.shown;
    if (!shown || shown.owner !== owner || !shown.count) return;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = 'multiply';
    target.globalAlpha = shown.opacity;
    target.drawImage(this.front, 0, 0, target.canvas.width, target.canvas.height);
    target.restore();
  }

  dispose(): void {
    this.job = null;
    this.shown = null;
    this.front.width = this.front.height = this.back.width = this.back.height = 0;
  }
}

/** The land of one view, composed from its tiles; a tile that could not be baked shows the nearest baked ancestor. */
function composeLand(view: StillView, tiles: Map<string, Baked | null>, pixelRatio: number, used: Set<string>): { canvas: HTMLCanvasElement; missing: number } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(view.view.width * pixelRatio));
  canvas.height = Math.max(1, Math.round(view.view.height * pixelRatio));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER_DEEP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let missing = 0;
  for (const key of view.tiles) {
    const rect = tileRect(view.pyramid, key, view.camera, view.view, pixelRatio);
    const own = tiles.get(tileKey(key));
    if (own) {
      used.add(tileKey(key));
      ctx.drawImage(own, rect.x, rect.y, rect.w, rect.h);
      continue;
    }
    const ancestor = ancestorsOf(key).find((parent) => tiles.get(tileKey(parent)));
    if (!ancestor) {
      missing++;
      continue;
    }
    used.add(tileKey(ancestor));
    const image = tiles.get(tileKey(ancestor))!;
    const crop = ancestorCrop(key, ancestor);
    ctx.drawImage(image, crop.x * image.width, crop.y * image.height, crop.size * image.width, crop.size * image.height, rect.x, rect.y, rect.w, rect.h);
  }
  return { canvas, missing };
}

/** A channel's seeded arms on the paper halo the map gives them. */
function StillShield(props: { id: string; width: number; x: number; y: number; pixelRatio: number }) {
  let canvas: HTMLCanvasElement | undefined;
  // A new layout hands every mark a new object; the arms are repainted only when their size really changes.
  const shieldWidth = createMemo(() => props.width);
  const shieldRatio = createMemo(() => props.pixelRatio);
  createEffect(() => {
    const width = shieldWidth();
    const ratio = shieldRatio();
    if (!canvas) return;
    canvas.width = Math.ceil((width + 6) * ratio);
    canvas.height = Math.ceil((width * SHIELD_ASPECT + 6) * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawShield(ctx, shieldDesign(untrack(() => props.id)), 3, 3, width, { halo: true, pixelRatio: ratio });
  });
  return (
    <canvas
      ref={(element) => (canvas = element)}
      class="atlas-still-shield"
      aria-hidden="true"
      style={{ left: `${props.x}px`, top: `${props.y}px`, width: `${props.width + 6}px`, height: `${props.width * SHIELD_ASPECT + 6}px` }}
    />
  );
}

/** The surveyor's ring: a double ink circle with four ticks, as the map marks a selection. */
function Ring(props: { r: number; x: number; y: number }) {
  const pad = 12;
  const size = () => 2 * (props.r + pad);
  const c = () => props.r + pad;
  const ticks = () => [0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 2;
    const at = (d: number) => `${(c() + Math.cos(a) * d).toFixed(2)} ${(c() + Math.sin(a) * d).toFixed(2)}`;
    return `M${at(props.r + 3)}L${at(props.r + 10)}`;
  }).join('');
  return (
    <svg class="atlas-still-ring" aria-hidden="true" width={size()} height={size()} viewBox={`0 0 ${size()} ${size()}`} style={{ left: `${props.x - c()}px`, top: `${props.y - c()}px` }}>
      <circle class="atlas-still-ring-paper" cx={c()} cy={c()} r={props.r} />
      <circle class="atlas-still-ring-ink" cx={c()} cy={c()} r={props.r} />
      <circle class="atlas-still-ring-ink atlas-still-ring-fine" cx={c()} cy={c()} r={props.r + 3.5} />
      <path class="atlas-still-ring-ink atlas-still-ring-ticks" d={ticks()} />
    </svg>
  );
}

/** A survey mark: the small ink symbol old maps use for a settlement too small to draw at this distance. */
function SurveyMark(props: { tierRank: number; size: number }) {
  const r = () => props.size / 2;
  const box = () => props.size + 2;
  return (
    <svg class="atlas-still-survey" aria-hidden="true" width={box()} height={box()} viewBox={`0 0 ${box()} ${box()}`} data-tier={props.tierRank}>
      <circle class="atlas-still-survey-ring" cx={box() / 2} cy={box() / 2} r={r() - 0.6} stroke-width={props.tierRank < 2 ? 1.1 : 0.9} />
      <circle class="atlas-still-survey-dot" cx={box() / 2} cy={box() / 2} r={props.tierRank === 0 ? r() * 0.42 : r() * 0.3} />
    </svg>
  );
}

function MarkButton(props: { mark: StillMark; z: number; selected: boolean; pixelRatio: number; onSelect: (settler: Settler) => void }) {
  const m = () => props.mark;
  const dx = (x: number) => x - m().box.x;
  const dy = (y: number) => y - m().box.y;
  return (
    <button
      type="button"
      class="atlas-still-mark"
      data-settler={m().id}
      data-kind={m().stamp ? 'stamp' : 'mark'}
      data-tier={m().settler.tier}
      data-named={m().name ? 'true' : 'false'}
      aria-pressed={props.selected}
      aria-label={m().label}
      style={{ left: `${m().box.x}px`, top: `${m().box.y}px`, width: `${m().box.w}px`, height: `${m().box.h}px`, 'z-index': props.z }}
      on:click={() => props.onSelect(m().settler)}
    >
      <Ring r={m().ring.r} x={dx(m().ring.x)} y={dy(m().ring.y)} />
      {/* Keyed: a stamp redrawn at another size is a new sprite. */}
      <Show when={m().stamp} keyed>
        {(stamp) => <span class="atlas-still-stamp"><StampIcon group={stamp.group} index={stamp.index} width={stamp.w} /></span>}
      </Show>
      <Show when={m().mark}>{(mark) => <SurveyMark tierRank={m().settler.tierRank} size={mark().size} />}</Show>
      <Show when={m().shield}>
        {(shield) => <StillShield id={m().id} width={shield().width} x={dx(shield().x)} y={dy(shield().y)} pixelRatio={props.pixelRatio} />}
      </Show>
      <Show when={m().name}>
        {(name) => (
          <span
            class="atlas-still-name"
            data-tier={m().settler.tier}
            style={{
              left: `${dx(name().x)}px`, top: `${dy(name().y)}px`, height: `${name().h}px`, 'line-height': `${name().h}px`,
              'font-size': `${name().size}px`, 'letter-spacing': `${name().spacing}px`,
            }}
          >
            {name().text}
          </span>
        )}
      </Show>
    </button>
  );
}

/**
 * The Atlas where WebGL is missing (Spec 01 R10, Atlas.md §8.6): a real, dated still of the same survey revision.
 * The land is inked once by the map's own bakers from the same preview files at the level that matches the opening
 * view; the vermilion wash of the live frame is multiplied into it and repainted as frames arrive; the margin, the
 * neatline and the language names are set as the map sets them. Every holding the map would mark at this distance is
 * a real button over the drawing that opens its card. The world is fixed for the life of the component.
 */
export function Still(props: StillProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let baker: StillBaker | null = null;
  let wash: WashCanvas | null = null;
  let generation = 0;
  let disposed = false;
  let readyFired = false;
  let washTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let fontTimer: ReturnType<typeof setTimeout> | undefined;
  let versionTimer: ReturnType<typeof setInterval> | undefined;
  let idleHandle: number | undefined;
  let selectionFrame = 0;
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;
  let chunksStarted = false;
  const pixelRatio = stillPixelRatio(window.devicePixelRatio);
  const tiles = new Map<string, Baked | null>();
  const baking = new Map<string, Promise<Baked | null>>();
  const lettered = new Map<string, HTMLCanvasElement>();
  const measured = new Map<string, number>();
  const measureCtx = document.createElement('canvas').getContext('2d');

  const [view, setView] = createSignal<Viewport | null>(null);
  const [fontsIn, setFontsIn] = createSignal(false);
  const [land, setLand] = createSignal<Land | null>(null);
  const [labelsVersion, setLabelsVersion] = createSignal(props.store.labelsVersion);
  const [washTick, setWashTick] = createSignal(0);
  const [washes, setWashes] = createSignal(0);
  const [drawnAt, setDrawnAt] = createSignal<number | null>(null);
  const [ready, setReady] = createSignal(false);

  const measure = (text: string, font: Font): number => {
    const key = `${font.face}|${font.size}|${font.spacing}|${text}`;
    let width = measured.get(key);
    if (width === undefined) {
      if (!measureCtx) width = text.length * font.size * 0.55 + text.length * font.spacing;
      else {
        measureCtx.font = fontString(font);
        if (spacingSupported(measureCtx)) measureCtx.letterSpacing = `${font.spacing}px`;
        width = measureCtx.measureText(text).width + (spacingSupported(measureCtx) ? 0 : text.length * font.spacing);
      }
      measured.set(key, width);
    }
    return width;
  };

  const geom = createMemo(() => {
    const size = view();
    return size ? stillView(props.geo.bounds, size) : null;
  });

  /** Bake a tile once; concurrent wishes for the same tile share one bake. */
  const want = (key: TileKey): Promise<Baked | null> => {
    const id = tileKey(key);
    if (tiles.has(id)) return Promise.resolve(tiles.get(id)!);
    let pending = baking.get(id);
    if (!pending) {
      pending = (baker ? baker.bake(key) : Promise.resolve(null)).then((tile) => {
        baking.delete(id);
        if (disposed) {
          if (tile && 'close' in tile) tile.close();
          return null;
        }
        tiles.set(id, tile);
        return tile;
      });
      baking.set(id, pending);
    }
    return pending;
  };

  async function inkLand(target: StillView, run: number): Promise<void> {
    const results = await Promise.all(target.tiles.map(want));
    // A tile that could not be baked keeps its nearest ancestor (R10), each ancestor baked at most once.
    for (const [i, key] of target.tiles.entries()) {
      if (results[i]) continue;
      for (const parent of ancestorsOf(key)) if (await want(parent)) break;
    }
    if (disposed || run !== generation) return;
    const used = new Set<string>();
    const { canvas: image, missing } = composeLand(target, tiles, pixelRatio, used);
    // Tiles of earlier sizes that this view did not use are let go.
    for (const [id, tile] of tiles) {
      if (used.has(id)) continue;
      if (tile && 'close' in tile) tile.close();
      tiles.delete(id);
    }
    setLand({ canvas: image, view: target, baked: target.tiles.filter((key) => tiles.get(tileKey(key))).length, missing });
    if (drawnAt() === null) setDrawnAt(Date.now());
  }

  createEffect(on(geom, (target) => {
    if (!target) return;
    props.onView?.({ scale: target.scale, distance: target.distance });
    void inkLand(target, ++generation);
  }));

  /** Marks follow the land actually drawn, so the buttons and the drawing never disagree during a resize. */
  const baseLayout = createMemo<StillLayout | null>(() => {
    const drawn = land();
    if (!drawn || !fontsIn()) return null;
    void labelsVersion();
    return layoutStill({ world: props.world, geo: props.geo, store: props.store, camera: drawn.view.camera, view: drawn.view.view, stamps, measure });
  });
  /**
   * The selection the lettering is laid around follows the card by one painted frame: the card and its seal answer
   * the tap first, then the map makes room for the chosen holding. The pressed state of a drawn mark is immediate.
   */
  const [laidSelection, setLaidSelection] = createSignal<Settler | null>(untrack(() => props.selected));
  createEffect(on(() => props.selected, (next) => {
    cancelAnimationFrame(selectionFrame);
    clearTimeout(selectionTimer);
    selectionFrame = requestAnimationFrame(() => {
      selectionTimer = setTimeout(() => {
        if (!disposed) setLaidSelection(next);
      }, 0);
    });
  }, { defer: true }));
  /** The selection is drawn first and always, as on the moving map; a holding already drawn keeps the layout as it is. */
  const layout = createMemo<StillLayout | null>(() => {
    const base = baseLayout();
    const drawn = land();
    const selected = laidSelection();
    if (!base || !drawn) return base;
    void labelsVersion();
    return layoutStillSelection(base, { world: props.world, geo: props.geo, store: props.store, camera: drawn.view.camera, view: drawn.view.view, stamps, measure, selected });
  });
  const ids = createMemo(() => layout()?.marks.map((mark) => mark.id) ?? []);
  const byId = createMemo(() => new Map(layout()?.marks.map((mark) => [mark.id, mark]) ?? []));

  const letter = (text: StillText): HTMLCanvasElement => {
    const key = `${text.font.face}|${text.font.size}|${text.font.spacing}|${text.stroke}|${text.lines.join('\n')}`;
    let image = lettered.get(key);
    if (!image) {
      image = document.createElement('canvas');
      image.width = Math.ceil(text.w * pixelRatio) + 2;
      image.height = Math.ceil(text.h * pixelRatio) + 2;
      const ctx = image.getContext('2d')!;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.font = fontString(text.font);
      const spaced = spacingSupported(ctx);
      if (spaced) ctx.letterSpacing = `${text.font.spacing}px`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = text.stroke;
      ctx.strokeStyle = PAPER;
      ctx.fillStyle = INK;
      // Canvas letter spacing trails the last letter too; half of it is given back so the line stays centred.
      const x = text.w / 2 + (spaced ? text.font.spacing / 2 : 0);
      text.lines.forEach((line, i) => {
        const y = text.stroke / 2 + (text.font.size * LINE) / 2 + i * text.lineHeight;
        ctx.strokeText(line, x, y);
        ctx.fillText(line, x, y);
      });
      lettered.set(key, image);
    }
    return image;
  };

  /**
   * The wash is laid apart from the drawing. A request while a layer is being laid waits for it, so a stream of
   * arriving chunks never starves the layer; a request soon after the last one waits out WASH_REPAINT_MIN_MS, unless
   * the land itself changed. The layer is laid in slices of WASH_SLICE_MS and swapped in whole when it is finished.
   */
  let washQueued = false;
  let washOwner: Land | null = null;
  let washStartedAt = -Infinity;
  let washSlice: ReturnType<typeof setTimeout> | undefined;
  const [washVersion, setWashVersion] = createSignal(0);

  const scheduleWash = (next: number) => {
    clearTimeout(washTimer);
    washTimer = undefined;
    if (!Number.isFinite(next)) return;
    washTimer = setTimeout(() => {
      washTimer = undefined;
      requestWash();
    }, Math.max(WASH_REPAINT_MIN_MS, next));
  };

  const pumpWash = () => {
    washSlice = setTimeout(() => {
      washSlice = undefined;
      if (disposed || !wash) return;
      if (!wash.step(performance.now() + WASH_SLICE_MS)) return pumpWash();
      finishWash();
    }, 0);
  };

  const finishWash = () => {
    const drawn = land();
    setWashes(drawn && wash ? wash.count(drawn) : 0);
    setWashVersion(washVersion() + 1);
    const paint = props.paint;
    if (paint?.frame) scheduleWash(paint.nextChange(paint.time()));
    else clearTimeout(washTimer);
    if (washQueued) {
      washQueued = false;
      requestWash();
    }
  };

  const startWash = () => {
    const drawn = land();
    if (disposed || !drawn) return;
    washStartedAt = performance.now();
    const paint = props.paint;
    wash ??= new WashCanvas();
    if (!paint?.frame) {
      wash.clear(drawn);
      return finishWash();
    }
    const { stains, opacity } = washStains(props.store, paint, drawn.view.camera, drawn.view.view, paint.time());
    if (!stains.length) {
      wash.clear(drawn);
      return finishWash();
    }
    wash.begin(drawn, stains, opacity, drawn.view.view, pixelRatio);
    pumpWash();
  };

  function requestWash(): void {
    if (disposed) return;
    const drawn = land();
    if (!drawn) return;
    // A new land drops whatever was being laid for the old one and is laid at once.
    if (washOwner !== drawn) {
      clearTimeout(washSlice);
      washSlice = undefined;
      clearTimeout(washTimer);
      washTimer = undefined;
      washQueued = false;
      washOwner = drawn;
      return startWash();
    }
    if (wash?.busy) {
      washQueued = true;
      return;
    }
    const wait = washStartedAt + WASH_REPAINT_MIN_MS - performance.now();
    if (wait > 0) {
      if (washTimer === undefined) washTimer = setTimeout(() => {
        washTimer = undefined;
        requestWash();
      }, wait);
      return;
    }
    startWash();
  }

  createEffect(() => {
    land();
    void props.liveTick;
    void washTick();
    void props.paint;
    untrack(requestWash);
  });

  /**
   * The paper: land, the finished wash multiplied into it, the margin and neatline over both. It is composed once per
   * land and finished wash, so the drawing below is a single copy of it plus the lettering.
   */
  const paper = document.createElement('canvas');
  let paperFor: { land: Land; wash: number } | null = null;
  const composePaper = (drawn: Land) => {
    if (paper.width !== drawn.canvas.width) paper.width = drawn.canvas.width;
    if (paper.height !== drawn.canvas.height) paper.height = drawn.canvas.height;
    const ctx = paper.getContext('2d');
    if (!ctx) return;
    const target = drawn.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(drawn.canvas, 0, 0);
    wash?.composite(ctx, drawn);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const frame = sheetFrame(props.geo.bounds, target.camera, target.view);
    ctx.fillStyle = PAPER_DEEP;
    for (const rect of frame.margin) ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(frame.inner.x, frame.inner.y, frame.inner.w, frame.inner.h);
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(frame.outer.x, frame.outer.y, frame.outer.w, frame.outer.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  };

  // The drawing: the paper, then the lettering. A selection or a change of names only redraws this.
  createEffect(() => {
    const drawn = land();
    const placed = layout();
    const washed = washVersion();
    if (!drawn || !placed || !canvas) return;
    if (paperFor?.land !== drawn || paperFor.wash !== washed) {
      composePaper(drawn);
      paperFor = { land: drawn, wash: washed };
    }
    if (canvas.width !== drawn.canvas.width) canvas.width = drawn.canvas.width;
    if (canvas.height !== drawn.canvas.height) canvas.height = drawn.canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.globalAlpha = 1;
    ctx.drawImage(paper, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const text of placed.texts) {
      ctx.globalAlpha = text.alpha;
      ctx.drawImage(letter(text), Math.round(text.x * pixelRatio), Math.round(text.y * pixelRatio));
    }
    ctx.globalAlpha = 1;

    // The still is ready once its first wash is in (or there is none to lay), so it is never shown as bare paper.
    if (!readyFired && washVersion() > 0 && !wash?.busy) {
      readyFired = true;
      // Two frames, so the buttons and shields are on screen before anyone is told the still is ready.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed) return;
        setReady(true);
        props.onReady();
      }));
    }
  });

  const idle = (run: () => void): number => (typeof requestIdleCallback === 'function'
    ? requestIdleCallback(run, { timeout: 1500 })
    : window.setTimeout(run, 120));
  const cancelIdle = (handle: number | undefined) => {
    if (handle === undefined) return;
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
    else clearTimeout(handle);
  };

  // Small live channels take their pencil places a few milliseconds at a time; their dabs are laid there once placed.
  const placeDabs = () => {
    cancelIdle(idleHandle);
    idleHandle = undefined;
    const paint = props.paint;
    if (!paint?.frame) return;
    const step = () => {
      idleHandle = undefined;
      if (disposed || props.paint !== paint) return;
      if (paint.work(6)) idleHandle = idle(step);
      else setWashTick(washTick() + 1);
    };
    idleHandle = idle(step);
  };
  createEffect(on(() => [props.paint, props.liveTick] as const, placeDabs));

  // With a live frame on the still, towns and villages are read after the first view so their washes exist too.
  createEffect(() => {
    const load = props.loadChunk;
    if (!ready() || !props.paint?.frame || !load || chunksStarted) return;
    chunksStarted = true;
    const target = land()?.view;
    const centre = target ? target.camera.screenToWorld(target.view.width / 2, target.view.height / 2, target.view) : { x: 0, y: 0 };
    const order = props.geo.regions
      .filter((region) => !props.store.hasRegion(region.index))
      .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - a.r - (Math.hypot(b.x - centre.x, b.y - centre.y) - b.r) || a.index - b.index);
    void (async () => {
      for (const region of order) {
        if (disposed) return;
        await new Promise<void>((resolve) => idle(() => resolve()));
        try {
          await load(region.index);
        } catch {
          continue;
        }
        if (disposed) return;
        props.paint?.regionLoaded(region.index);
        placeDabs();
        setWashTick(washTick() + 1);
      }
    })();
  });

  const ribbon = createMemo(() => {
    const at = drawnAt();
    if (at === null) return null;
    void props.liveTick;
    return stillRibbon({ asOf: props.world.asOf, drawnAt: at, liveAsOf: props.paint?.frame?.asOf ?? null, now: Date.now(), landMissing: (land()?.missing ?? 0) > 0 });
  });

  onMount(() => {
    if (!root) return;
    const measureRoot = () => {
      if (!root) return;
      const width = root.clientWidth;
      const height = root.clientHeight;
      if (!width || !height) return;
      const current = view();
      if (current && current.width === width && current.height === height) return;
      setView({ width, height });
    };
    baker = new StillBaker(paintSceneFor(props.world, props.geo, decodeRings(props.world)), stampSheetUrl, stamps, pixelRatio);
    measureRoot();
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measureRoot, 140);
    });
    observer.observe(root);
    onCleanup(() => observer.disconnect());
    if ('fonts' in document) {
      const all = Promise.all(FACES.map((face) => document.fonts.load(face, 'Atlas Кириллица'))).then(() => undefined, () => undefined);
      void Promise.race([all, new Promise<void>((resolve) => { fontTimer = setTimeout(resolve, FONT_GRACE_MS); })]).then(() => {
        clearTimeout(fontTimer);
        if (!disposed) setFontsIn(true);
      });
    } else setFontsIn(true);
    // Chunks contain towns/villages, below the still's base tiers. Only changed labels re-letter its fixed head.
    versionTimer = setInterval(() => {
      if (props.store.labelsVersion !== labelsVersion()) setLabelsVersion(props.store.labelsVersion);
    }, 1_000);
  });

  onCleanup(() => {
    disposed = true;
    generation++;
    clearTimeout(washTimer);
    clearTimeout(washSlice);
    clearTimeout(selectionTimer);
    cancelAnimationFrame(selectionFrame);
    wash?.dispose();
    wash = null;
    paperFor = null;
    paper.width = paper.height = 0;
    clearTimeout(fontTimer);
    clearTimeout(resizeTimer);
    clearInterval(versionTimer);
    cancelIdle(idleHandle);
    baker?.dispose();
    baker = null;
    for (const tile of tiles.values()) if (tile && 'close' in tile) tile.close();
    tiles.clear();
    lettered.clear();
  });

  const total = () => layout()?.marks.length ?? 0;

  return (
    <div
      ref={(element) => (root = element)}
      class="atlas-still"
      data-still={ready() ? 'ready' : 'inking'}
      data-still-level={land()?.view.level}
      data-still-scale={land()?.view.scale.toFixed(4)}
      data-still-tiles={land() ? `${land()!.baked}/${land()!.view.tiles.length}` : undefined}
      data-still-missing={land()?.missing}
      data-still-marks={layout()?.marks.length}
      data-still-shields={layout()?.shields}
      data-still-names={layout()?.names}
      data-still-washes={washes()}
    >
      <canvas ref={(element) => (canvas = element)} class="atlas-still-canvas" aria-hidden="true" />
      <div class="atlas-still-marks" role="group" aria-label="Holdings drawn on this still">
        <For each={ids()}>
          {(id, index) => (
            <Show when={byId().get(id)}>
              {(mark) => (
                <MarkButton
                  mark={mark()}
                  z={total() - index()}
                  selected={props.selected === mark().settler}
                  pixelRatio={pixelRatio}
                  onSelect={props.onSelect}
                />
              )}
            </Show>
          )}
        </For>
      </div>
      <div class="atlas-still-banner">
      <Show when={props.compactChrome && (land()?.missing ?? 0) > 0}>
        <aside class="atlas-notice" role="status" data-still-warning="missing-land">Some land could not be drawn; this still is incomplete. Reload to try again.</aside>
      </Show>
      <Show when={!props.compactChrome && ribbon()}>
        {(text) => (
          <aside class="atlas-still-ribbon" aria-label="About this still">
            <svg class="atlas-still-tail" data-side="left" viewBox="0 0 24 40" preserveAspectRatio="none" aria-hidden="true"><path d="M23.5 0.5H0.5l8 19.5-8 19.5h23" /></svg>
            <svg class="atlas-still-tail" data-side="right" viewBox="0 0 24 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0.5 0.5h23l-8 19.5 8 19.5H0.5" /></svg>
            <p class="atlas-still-ribbon-title">{text().title}</p>
            <p class="atlas-still-ribbon-facts">
              <span>{text().facts[0]}</span>
              <span>{text().facts[1]}</span>
              <Show when={text().live}>{(live) => <span class="atlas-still-ribbon-live"><span class="atlas-live-mark" aria-hidden="true" />{live()}</span>}</Show>
            </p>
            <p class="atlas-still-ribbon-why">{text().why}</p>
          </aside>
        )}
      </Show>
      {props.notice}
      </div>
    </div>
  );
}
