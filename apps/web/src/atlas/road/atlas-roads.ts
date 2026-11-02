import { Container, Graphics, Text } from 'pixi.js';
import type { Camera, Viewport } from '../map/camera';
import { INK, PAPER } from '../map/theme';
import { caravanCount, columnTail } from './caravan';
import { planRoad, rideSeconds, roadBounds, sampleRoad, type RoadPath } from './geometry';
import { dashed, polyline, RoadLayer, type MapLayer } from './layer';
import { compareRoads, networkBudget, roadKey, roadStroke, roadWidth, seaLane, type RoadStroke } from './network';

/**
 * Every road the Atlas remembers, drawn with the map's own camera (Atlas.md §5.2, spec 23 R11): the busiest roads as
 * restrained sepia ink under the marks, the chosen kingdom's roads over them, the road a card is about, the public
 * caravans of fresh raids, and in gate mode the journey the Raid Gate is presenting. Roads are drawn in screen space,
 * so a stroke keeps its weight at every distance; nothing is redrawn while the camera and the roads stand still.
 */

export interface Point { x: number; y: number }

/** One remembered road with both ends placed on this map. */
export interface InkRoad {
  a: string;
  b: string;
  pa: Point;
  pb: Point;
  ra: number | null;
  rb: number | null;
  raids: number;
  travellers: number;
  lastAt: number;
}

interface Drawn extends InkRoad {
  key: string;
  path: RoadPath;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  width: number;
}

/** A fresh raid riding once as the public caravan. */
export interface CaravanStart {
  id: string;
  from: string;
  to: string;
  viewers: number;
  at: number;
  pa: Point;
  pb: Point;
  ra: number | null;
  rb: number | null;
}

interface Riding {
  raid: CaravanStart;
  layer: RoadLayer;
  label: Text;
  path: RoadPath;
  /** performance.now() at departure. */
  start: number;
  ride: number;
  tail: number;
  count: number;
}

export type JourneyStage = 'pencil' | 'rise' | 'road' | 'drawing' | 'arrived' | 'back';

/** At most this many caravans ride at once; a raid beyond it still inks its road, it only does not ride. */
export const MAX_CARAVANS = 6;
/** The banner rests at the gate this long after the last torch is through, then the caravan is gone. */
const ARRIVAL_REST_S = 2.4;
/** In reduced motion the column stands at the destination this long instead of walking. */
const STILL_CARAVAN_S = 8;
const NETWORK_SAMPLES = 40;
/** Roads of the network kept, faintly, while a kingdom, a road or the gate is in front. */
const QUIET_BUDGET = 40;

const pathFor = (pa: Point, pb: Point, a: string, b: string, sea: boolean, samples = NETWORK_SAMPLES): RoadPath => {
  // The bend is chosen by the pair, never by direction, so a caravan back rides the road already inked.
  const forward = roadKey(a, b) === `${a}~${b}`;
  const path = forward ? planRoad(pa, pb, roadKey(a, b), sea, samples) : planRoad(pb, pa, roadKey(a, b), sea, samples);
  return forward ? path : reversePath(path);
};

function reversePath(path: RoadPath): RoadPath {
  const n = path.lengths.length;
  const points = new Float64Array(n * 2);
  const lengths = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    points[i * 2] = path.points[(n - 1 - i) * 2]!;
    points[i * 2 + 1] = path.points[(n - 1 - i) * 2 + 1]!;
    lengths[i] = path.total - path.lengths[n - 1 - i]!;
  }
  return { points, lengths, total: path.total, sea: path.sea };
}

export class AtlasRoadsLayer implements MapLayer {
  readonly under = new Container();
  readonly over = new Container();
  private readonly network = new Graphics();
  private readonly focusInk = new Graphics();
  private readonly chosenInk = new Graphics();
  private readonly caravanUnder = new Container();
  private readonly caravanOver = new Container();
  private roads: Drawn[] = [];
  private focus: { id: string; roads: Drawn[] } | null = null;
  private chosen: Drawn | null = null;
  private readonly riding = new Map<string, Riding>();
  /** Raid IDs that have ridden in this map's life: a raid rides once, whatever the stream sends again. */
  private readonly ridden = new Set<string>();
  private journey: { path: RoadPath; from: string; to: string; stage: JourneyStage; since: number; ink: number; layer: RoadLayer } | null = null;
  private following: string | null = null;
  private drawnKey = '';
  private version = 0;
  private drawnVersion = -1;
  /** Ends of everything drawn, for evidence attributes and checks. */
  stats = { network: 0, focus: 0, chosen: false, caravans: 0, dotted: 0, sea: 0 };

  constructor(private readonly pixelRatio = 1, private readonly now: () => number = Date.now, private readonly reduceMotion: () => boolean = () => false, private readonly span = 1) {
    this.under.addChild(this.network, this.focusInk, this.chosenInk, this.caravanUnder);
    this.over.addChild(this.caravanOver);
  }

  get animating(): boolean {
    if (this.riding.size > 0) return true;
    const j = this.journey;
    return !!j && (j.stage === 'road' || j.stage === 'drawing' || j.stage === 'back') && performance.now() - j.since < 2_600;
  }

  /** The busiest roads, as the service ranks them. Ends without a place on this map are not drawn. */
  setNetwork(roads: readonly InkRoad[]): void {
    this.roads = roads.map(road => this.prepare(road)).sort(compareRoads);
    this.version++;
  }

  /** The chosen kingdom's roads (or none): drawn over the network, which steps back while they are shown. */
  setFocus(focus: { id: string; roads: readonly InkRoad[] } | null): void {
    this.focus = focus ? { id: focus.id, roads: focus.roads.map(road => this.prepare(road)).sort(compareRoads) } : null;
    this.version++;
  }

  /** The road a road card is about, inked heaviest. */
  setChosen(road: InkRoad | null): void {
    this.chosen = road ? this.prepare(road) : null;
    this.version++;
  }

  /** Add a road that has just been witnessed (a caravan's), or thicken the drawn one. */
  witness(road: InkRoad): void {
    const key = roadKey(road.a, road.b);
    const known = this.roads.find(item => item.key === key);
    if (known) {
      known.raids++;
      known.travellers += road.travellers;
      known.lastAt = Math.max(known.lastAt, road.lastAt);
      known.width = roadWidth(known.raids, known.travellers);
    } else {
      this.roads.push(this.prepare(road));
    }
    this.roads.sort(compareRoads);
    this.version++;
  }

  /**
   * Ride a fresh raid once. Returns false when it has ridden already, when its ends coincide, or when the road is
   * full (its road is still witnessed). The ride takes 12–30 s by distance (Atlas.md §5.2).
   */
  ride(raid: CaravanStart): boolean {
    if (this.ridden.has(raid.id) || raid.from === raid.to) return false;
    this.ridden.add(raid.id);
    if (this.riding.size >= MAX_CARAVANS) {
      this.witness({ ...raid, a: raid.from, b: raid.to, raids: 1, travellers: raid.viewers, lastAt: raid.at });
      return false;
    }
    const path = pathFor(raid.pa, raid.pb, raid.from, raid.to, seaLane(raid.ra, raid.rb), 160);
    if (path.total <= 0) return false;
    const count = caravanCount(raid.viewers);
    const layer = new RoadLayer(path, { sourceId: raid.from, count }, this.pixelRatio);
    const label = new Text({
      text: `${raid.viewers.toLocaleString('en-GB')} ${raid.viewers === 1 ? 'traveller' : 'travellers'}`,
      style: { fontFamily: 'IM Fell English', fontStyle: 'italic', fontSize: 13, fill: INK, stroke: { color: PAPER, width: 4, join: 'round' } },
      resolution: this.pixelRatio, roundPixels: true,
    });
    label.anchor.set(0.5, 1);
    label.visible = false;
    this.caravanUnder.addChild(layer.under);
    this.caravanOver.addChild(layer.over, label);
    this.riding.set(raid.id, { raid, layer, label, path, start: performance.now(), ride: rideSeconds(path, this.span), tail: 0, count });
    return true;
  }

  /** The caravan of this witnessed raid: by its ID, or the same pair within the ledger's dedupe window. */
  caravanFor(raid: { id: string; from: string; to: string; at: number }): CaravanStart | null {
    const direct = this.riding.get(raid.id);
    if (direct) return direct.raid;
    for (const riding of this.riding.values()) {
      if (riding.raid.from === raid.from && riding.raid.to === raid.to && Math.abs(riding.raid.at - raid.at) <= 30_000) return riding.raid;
    }
    return null;
  }

  /** Whether a raid has ridden (or is riding) on this map, matched like `caravanFor`. */
  hasRidden(id: string): boolean {
    return this.ridden.has(id);
  }

  /** Keep this caravan in front: the others dim while a gate follows one. */
  follow(id: string | null): void {
    this.following = id;
    this.version++;
  }

  /** Where the banner of a riding caravan is, in world units. */
  headOf(id: string): Point | null {
    const riding = this.riding.get(id);
    if (!riding) return null;
    const t = Math.min(1, Math.max(0, (performance.now() - riding.start) / 1000 / riding.ride));
    const at = sampleRoad(riding.path, t);
    return { x: at.x, y: at.y };
  }

  /** Gate mode's journey: the way from the source to the pick, pencilled, then inked stage by stage. */
  setJourney(journey: { from: string; to: string; pa: Point; pb: Point; ra: number | null; rb: number | null } | null): void {
    this.journey?.layer.destroy();
    this.journey = null;
    if (journey) {
      const path = pathFor(journey.pa, journey.pb, journey.from, journey.to, seaLane(journey.ra, journey.rb), 160);
      const layer = new RoadLayer(path, { sourceId: journey.from, count: 1 }, this.pixelRatio);
      this.caravanUnder.addChildAt(layer.under, 0);
      this.journey = { path, from: journey.from, to: journey.to, stage: 'pencil', since: performance.now(), ink: 0, layer };
    }
    this.version++;
  }

  journeyStage(stage: JourneyStage): void {
    const j = this.journey;
    if (!j || j.stage === stage) return;
    j.ink = this.journeyInk(performance.now());
    j.stage = stage;
    j.since = performance.now();
    this.version++;
  }

  journeyBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    return this.journey ? roadBounds(this.journey.path) : null;
  }

  dispose(): void {
    for (const riding of this.riding.values()) riding.layer.destroy();
    this.riding.clear();
    this.journey?.layer.destroy();
    this.journey = null;
    this.under.destroy({ children: true });
    this.over.destroy({ children: true });
  }

  update(camera: Camera, view: Viewport): void {
    const key = `${camera.x}|${camera.y}|${camera.scale}|${view.width}|${view.height}`;
    if (key !== this.drawnKey || this.version !== this.drawnVersion) {
      this.drawnKey = key;
      this.drawnVersion = this.version;
      this.drawStill(camera, view);
    }
    this.drawJourney(camera, view);
    this.drawCaravans(camera, view);
  }

  private prepare(road: InkRoad): Drawn {
    const path = pathFor(road.pa, road.pb, road.a, road.b, seaLane(road.ra, road.rb));
    return { ...road, key: roadKey(road.a, road.b), path, box: roadBounds(path), width: roadWidth(road.raids, road.travellers) };
  }

  private drawStill(camera: Camera, view: Viewport): void {
    const now = this.now();
    const box = camera.visibleBox(view, 24);
    const stats = { network: 0, focus: 0, chosen: false, caravans: this.riding.size, dotted: 0, sea: 0 };
    const visible = (road: Drawn) => road.box.maxX >= box.minX && road.box.minX <= box.maxX && road.box.maxY >= box.minY && road.box.minY <= box.maxY
      && (road.box.maxX - road.box.minX + road.box.maxY - road.box.minY) * camera.scale >= 5;
    const screen = (road: Drawn) => {
      const out: number[] = [];
      const p = road.path.points;
      for (let i = 0; i < p.length; i += 2) out.push((p[i]! - camera.x) * camera.scale + view.width / 2, (p[i + 1]! - camera.y) * camera.scale + view.height / 2);
      return out;
    };
    const ink = (g: Graphics, road: Drawn, alpha: number, boost = 1) => {
      const stroke: RoadStroke = roadStroke(road, now);
      const points = screen(road);
      const width = road.width * boost;
      if (stroke === 'dotted') {
        stats.dotted++;
        dashed(g, points, 1.1, Math.max(3.4, width * 2.2));
        g.stroke({ color: INK, width: Math.max(1.3, width * 0.9), alpha: alpha * 0.9, cap: 'round' });
        return;
      }
      if (stroke === 'sea') {
        stats.sea++;
        dashed(g, points, 7, 5);
        g.stroke({ color: INK, width: Math.max(1, width * 0.8), alpha, cap: 'round' });
        return;
      }
      if (width >= 2) {
        polyline(g, points);
        g.stroke({ color: '#a98457', width: width + 3.5, alpha: alpha * 0.22, cap: 'round', join: 'round' });
      }
      polyline(g, points);
      g.stroke({ color: INK, width, alpha, cap: 'round', join: 'round' });
    };
    const net = this.network;
    net.clear();
    const focusId = this.focus?.id ?? null;
    const quiet = focusId !== null || this.chosen !== null || this.journey !== null || this.following !== null;
    // While something else holds the eye (a kingdom's roads, a road card, the gate), only the strongest few stay.
    const budget = quiet ? Math.min(QUIET_BUDGET, networkBudget(camera.scale, camera.minScale)) : networkBudget(camera.scale, camera.minScale);
    // Closer than the whole world, a road is drawn only when one of its ends is in or near the view: a road that
    // merely passes over the land on its way between two far places reads as a scratch, not a road.
    const zoom = camera.minScale > 0 ? camera.scale / camera.minScale : 1;
    const reach = (Math.max(view.width, view.height) * 0.25) / camera.scale;
    const near = (p: Point) => p.x >= box.minX - reach && p.x <= box.maxX + reach && p.y >= box.minY - reach && p.y <= box.maxY + reach;
    const anchored = (road: Drawn) => zoom < 1.6 || near(road.pa) || near(road.pb);
    let drawn = 0;
    for (const road of this.roads) {
      if (drawn >= budget) break;
      if (focusId !== null && (road.a === focusId || road.b === focusId)) continue;
      drawn++;
      if (!visible(road) || !anchored(road)) continue;
      stats.network++;
      ink(net, road, quiet ? 0.1 : 0.42);
    }
    const focus = this.focusInk;
    focus.clear();
    for (const road of this.focus?.roads ?? []) {
      if (!visible(road)) continue;
      stats.focus++;
      ink(focus, road, this.chosen ? 0.32 : 0.86, 1.15);
    }
    const chosen = this.chosenInk;
    chosen.clear();
    if (this.chosen && visible(this.chosen)) {
      stats.chosen = true;
      const points = screen(this.chosen);
      polyline(chosen, points);
      chosen.stroke({ color: PAPER, width: this.chosen.width * 1.4 + 7, alpha: 0.6, cap: 'round', join: 'round' });
      ink(chosen, this.chosen, 0.95, 1.4);
    }
    this.stats = stats;
  }

  private journeyInk(now: number): number {
    const j = this.journey;
    if (!j) return 0;
    const t = Math.min(1, (now - j.since) / (this.reduceMotion() ? 1 : 2_400));
    const ease = t * t * (3 - 2 * t);
    const target = j.stage === 'pencil' || j.stage === 'rise' ? 0 : j.stage === 'road' ? 0.55 : j.stage === 'back' ? 0 : 1;
    return j.ink + (target - j.ink) * ease;
  }

  private drawJourney(camera: Camera, view: Viewport): void {
    const j = this.journey;
    if (!j) return;
    const inked = this.journeyInk(performance.now());
    j.layer.set({ head: inked, inked, time: 0, opacity: 1, marching: false });
    j.layer.update(camera, view);
  }

  private drawCaravans(camera: Camera, view: Viewport): void {
    const now = performance.now();
    for (const [id, riding] of this.riding) {
      const elapsed = (now - riding.start) / 1000;
      const still = this.reduceMotion();
      const tail = columnTail(riding.path, riding.count, camera.scale);
      const travel = still ? 1 : Math.min(1, elapsed / riding.ride);
      const fileTime = Math.max(1.2, tail * riding.ride);
      const file = still ? 0 : Math.min(1, Math.max(0, (elapsed - riding.ride) / fileTime));
      const done = still ? elapsed > STILL_CARAVAN_S : elapsed > riding.ride + fileTime + ARRIVAL_REST_S;
      if (done) {
        riding.layer.destroy();
        riding.label.destroy();
        this.riding.delete(id);
        // The ride has inked its road: from now on it is part of the map's memory.
        this.witness({ a: riding.raid.from, b: riding.raid.to, pa: riding.raid.pa, pb: riding.raid.pb, ra: riding.raid.ra, rb: riding.raid.rb, raids: 1, travellers: riding.raid.viewers, lastAt: riding.raid.at });
        continue;
      }
      const head = travel + file * tail;
      const dim = this.following !== null && this.following !== id;
      riding.layer.set({ head, inked: Math.min(1, head), time: still ? 0 : elapsed, marching: travel < 1 || file < 1 || still, opacity: dim ? 0.35 : 1 });
      riding.layer.update(camera, view);
      const banner = riding.layer.head;
      riding.label.visible = banner.visible && !dim;
      if (banner.visible) riding.label.position.set(Math.round(banner.x), Math.round(banner.y - 44));
    }
    this.stats.caravans = this.riding.size;
  }
}
