/**
 * One float64 camera: a world-unit centre and a scale in CSS px per world unit. Screen positions are computed from
 * it every frame, so deep zoom never jitters. North stays up; there is no rotation or pitch.
 */
export interface Viewport { width: number; height: number }
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
/** Screen space taken by panels; the opening view centres the map in what is left. */
export interface Insets { left: number; right: number; top: number; bottom: number }
export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/** Scale thresholds (CSS px per world unit) for the four useful distances of Spec 01 R7. */
export const DISTANCE_SCALE = { continent: 1.4, realm: 4, kingdom: 11 } as const;
export type Distance = 'world' | 'continent' | 'realm' | 'kingdom';
/** The deepest zoom: a capital holding is drawn about 400–480 CSS px wide. It stops at a drawing, never a plan. */
export const MAX_SCALE = 40;

/**
 * The four distance stops the controls and the 1–4 keys fly to: the geometric middle of each band, so a stop never
 * sits on a threshold where marks change. The world stop is the opening view of the current screen.
 */
export const DISTANCE_STOP = {
  continent: Math.sqrt(DISTANCE_SCALE.continent * DISTANCE_SCALE.realm),
  realm: Math.sqrt(DISTANCE_SCALE.realm * DISTANCE_SCALE.kingdom),
  kingdom: Math.sqrt(DISTANCE_SCALE.kingdom * MAX_SCALE),
} as const;
export const DISTANCES: readonly Distance[] = ['world', 'continent', 'realm', 'kingdom'];

export function distanceFor(scale: number): Distance {
  if (scale >= DISTANCE_SCALE.kingdom) return 'kingdom';
  if (scale >= DISTANCE_SCALE.realm) return 'realm';
  if (scale >= DISTANCE_SCALE.continent) return 'continent';
  return 'world';
}

export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  minScale = 0.05;
  readonly maxScale = MAX_SCALE;

  constructor(readonly bounds: Box) {
    this.x = (bounds.minX + bounds.maxX) / 2;
    this.y = (bounds.minY + bounds.maxY) / 2;
  }

  get worldWidth(): number {
    return this.bounds.maxX - this.bounds.minX;
  }

  get worldHeight(): number {
    return this.bounds.maxY - this.bounds.minY;
  }

  /** Whole world inside the viewport (contain); the minimum zoom allows a little paper around it. */
  containScale(view: Viewport): number {
    return Math.min(view.width / this.worldWidth, view.height / this.worldHeight);
  }

  /** The world fills the viewport (cover); used as the opening view on narrow screens. */
  coverScale(view: Viewport): number {
    return Math.max(view.width / this.worldWidth, view.height / this.worldHeight);
  }

  /** The opening view: the whole map on a laptop; on a phone, the map filling the screen at its centre. */
  home(view: Viewport, insets: Insets = NO_INSETS): void {
    const free = { width: Math.max(1, view.width - insets.left - insets.right), height: Math.max(1, view.height - insets.top - insets.bottom) };
    const portrait = view.height > view.width * 1.2;
    this.scale = portrait ? Math.min(this.coverScale(view) * 0.92, this.containScale(view) * 2.6) : this.containScale(free) * 0.97;
    this.x = (this.bounds.minX + this.bounds.maxX) / 2 - (insets.left - insets.right) / 2 / this.scale;
    this.y = (this.bounds.minY + this.bounds.maxY) / 2 - (insets.top - insets.bottom) / 2 / this.scale;
    this.minScale = Math.min(this.containScale(view) * 0.92, this.scale);
    this.clamp(view);
  }

  resize(view: Viewport): void {
    this.minScale = this.containScale(view) * 0.92;
    this.clamp(view);
  }

  worldToScreen(x: number, y: number, view: Viewport): { x: number; y: number } {
    return { x: (x - this.x) * this.scale + view.width / 2, y: (y - this.y) * this.scale + view.height / 2 };
  }

  screenToWorld(sx: number, sy: number, view: Viewport): { x: number; y: number } {
    return { x: this.x + (sx - view.width / 2) / this.scale, y: this.y + (sy - view.height / 2) / this.scale };
  }

  visibleBox(view: Viewport, marginPx = 0): Box {
    const halfW = (view.width / 2 + marginPx) / this.scale;
    const halfH = (view.height / 2 + marginPx) / this.scale;
    return { minX: this.x - halfW, minY: this.y - halfH, maxX: this.x + halfW, maxY: this.y + halfH };
  }

  /** Zoom by a factor while the world point under (sx, sy) stays under it. */
  zoomAt(factor: number, sx: number, sy: number, view: Viewport): void {
    const anchor = this.screenToWorld(sx, sy, view);
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.scale = next;
    this.x = anchor.x - (sx - view.width / 2) / next;
    this.y = anchor.y - (sy - view.height / 2) / next;
    this.clamp(view);
  }

  panBy(dx: number, dy: number, view: Viewport): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.clamp(view);
  }

  /**
   * The centre may wander only so far that most of the screen still shows the map: an edge of the map may come in
   * a quarter of the screen. When the whole map fits on an axis it may sit anywhere along it (so the opening view can
   * clear a side panel) and overhang either edge by that same quarter, so a zoom anchored near the map's edge keeps
   * its point under the pointer. The two rules meet exactly where the map stops fitting.
   */
  clamp(view: Viewport): void {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    const axis = (lo: number, hi: number, half: number, value: number) => {
      const pad = half * 0.5;
      if (hi - lo <= half * 2) return Math.min(lo + half + pad, Math.max(hi - half - pad, value));
      return Math.min(hi - half + pad, Math.max(lo + half - pad, value));
    };
    this.x = axis(this.bounds.minX, this.bounds.maxX, view.width / 2 / this.scale, this.x);
    this.y = axis(this.bounds.minY, this.bounds.maxY, view.height / 2 / this.scale, this.y);
  }

  snapshot(): { x: number; y: number; scale: number } {
    return { x: this.x, y: this.y, scale: this.scale };
  }
}
