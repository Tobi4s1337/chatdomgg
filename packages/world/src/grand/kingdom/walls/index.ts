import type { Vec3 } from '@chatdom/shared';
import { seedHash } from '../../../seed';
import type { SettlementPlan, XZ } from '../../../settlement/types';
import { pointInPolygon } from './grid';
import { layoutWalls, WallLayoutContext, type PlannedGate, type PlannedTower, type Stretch } from './layout';
import { outward, yawOf } from './path';
import { gatePainter, PARAPET, TOWER, towerApex, towerPainter, towerPoleTop, towerReach, wallPainter, WALL, WALL_KITS, type WallKit, type WallStep } from './pieces';
import { planRing } from './ring';
import { WallSite } from './site';
import type { TownBannerAnchor, TownGate, TownWallOptions, TownWallPiece, TownWalls, TownWallSegment, TownWallSpan, TownWallTower } from './types';
import { BUILD, cellExtent, rasterise, type Painter, type PieceBounds } from './voxels';

export type { TownBannerAnchor, TownGate, TownWallOptions, TownWallPiece, TownWalls, TownWallSegment, TownWallSpan, TownWallTower, WallStyle, RingSpanKind } from './types';
export { WALL_KITS, WALL_MATERIAL } from './pieces';

/** Curtain steps: level runs of about three metres, so a slope reads as a stair of masonry. */
const STEP = 3;
/** A curtain piece covers at most nine steps (≤ 27 m), well inside the 32 m blueprint limit. */
const PIECE_STEPS = 9;
const MAX_CELLS = 256;

/**
 * The walled town: a circuit around every lot, square and court, closed by the castle and the shore where it meets
 * them, gated wherever a street (active or reserved) crosses it, with drum towers at its corners and every ~50 m.
 * Pure and deterministic from (plan, seedKey, style); the ground and water samplers are the settlement's own.
 */
export function planTownWalls(plan: SettlementPlan, options: TownWallOptions): TownWalls {
  const r = options.region;
  if (![r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isFinite) || r.maxX - r.minX < 16 || r.maxZ - r.minZ < 16) throw new Error('Town walls need a finite region');
  const site = new WallSite(plan, r, options.water, options.ground);
  const ring = planRing(site);
  const kit = WALL_KITS[options.style];
  const context = new WallLayoutContext(site, ring, options, kit);
  const layout = layoutWalls(context);
  const tag = seedHash(`${options.seedKey}|${plan.revision}|${options.style}`).toString(36);
  const blueprintId = (id: string) => `town-wall.${tag}.${id.replace(/:/g, '.')}`;

  const pieces: TownWallPiece[] = [], segments: TownWallSegment[] = [], bannerAnchors: TownBannerAnchor[] = [];
  const add = (id: string, kind: TownWallPiece['kind'], raster: ReturnType<typeof rasterise>) => {
    if (raster.blueprint.boxes.length) pieces.push({ id, kind, blueprint: raster.blueprint, position: raster.position, rotation: 0 });
  };
  // A piece standing on steep ground can reach deeper than one blueprint is tall: its footing goes down in courses of
  // its own, each a piece directly below the last, so the masonry meets the ground however far the slope falls.
  const paint = (id: string, kind: TownWallPiece['kind'], painter: Painter) => {
    for (const [n, slice] of courses(painter).entries()) add(n ? `${id}:footing${n}` : id, kind, rasterise(blueprintId(n ? `${id}:footing${n}` : id), options.style, slice, site));
  };

  for (const stretch of layout.stretches) buildStretch(stretch, kit, options, (id, painter) => paint(id, 'wall', painter), segments);

  const towers: TownWallTower[] = [];
  const gateTowersLoose = new Set<string>();
  for (const gate of layout.gates) {
    if (gate.kind !== 'arch') continue;
    const bounds = gateBounds(gate);
    if (horizontal(bounds)) { gateTowersLoose.add(gate.id); continue; }
    paint(gate.id, 'gatehouse', gatePainter(gate.shape, bounds));
  }
  if (gateTowersLoose.size) {
    // Too wide for one blueprint: the arch block alone, with its towers as their own pieces.
    for (const gate of layout.gates) if (gateTowersLoose.has(gate.id)) {
      const shape = { ...gate.shape, towers: [] };
      paint(gate.id, 'gatehouse', gatePainter(shape, gateBounds({ ...gate, shape })));
    }
  }
  for (const tower of layout.towers) {
    const loose = tower.standalone || (tower.gateId !== undefined && gateTowersLoose.has(tower.gateId));
    if (loose) paint(tower.id, 'tower', towerPainter(tower.shape, towerBounds(tower)));
    towers.push(describeTower(tower));
    bannerAnchors.push({ id: tower.id, position: [tower.shape.centre[0], towerPoleTop(tower.shape), tower.shape.centre[1]], facing: yawOf(tower.shape.normal) });
  }
  const gates: TownGate[] = layout.gates.map(gate => {
    const { centre, normal, spring } = gate.shape;
    if (gate.kind === 'arch') bannerAnchors.push({ id: gate.id, position: [centre[0] + normal[0] * (gate.shape.depth + 0.3), gate.shape.top - 0.75, centre[1] + normal[1] * (gate.shape.depth + 0.3)], facing: yawOf(normal) });
    return { id: gate.id, streetId: gate.streetId, streetIds: gate.streetIds, growthNodeIds: gate.growthNodeIds, position: [centre[0], gate.streetTop, centre[1]], yaw: yawOf(normal),
      width: gate.shape.width, headroom: spring - gate.streetTop, kind: gate.kind };
  });

  // The circuit as built: each wall span's final centre line (straight through its gates), the closures as traced.
  const spans: TownWallSpan[] = [];
  let line = 0;
  for (const span of ring.spans) {
    if (span.kind === 'wall') spans.push({ kind: 'wall', points: layout.wallLines[line++]! });
    else spans.push({ kind: span.kind, points: span.points });
  }
  const loop: XZ[] = [];
  for (const span of spans) loop.push(...span.points.slice(0, -1));
  if (ring.cyclic && spans.length === 1) loop.splice(0, loop.length, ...spans[0]!.points.slice(0, -1));

  const enclosed = (lot: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
    [[lot.minX, lot.minZ], [lot.maxX, lot.minZ], [lot.maxX, lot.maxZ], [lot.minX, lot.maxZ]].every(([x, z]) => pointInPolygon(loop, x!, z!));
  const homes = new Set(plan.homes.map(home => home.id));
  const beyond = plan.reservations.filter(plot => !homes.has(plot.id) && (!ring.enclosedLots.has(plot.id) || !enclosed(plot.lot))).map(plot => plot.id).sort();

  return { ring: loop, spans, segments, towers, gates, pieces, bannerAnchors, beyond };
}

/** True when a piece is wider or deeper than one blueprint allows (height is laid in courses instead). */
const horizontal = (bounds: PieceBounds): boolean => { const [x, , z] = cellExtent(bounds); return x > MAX_CELLS || z > MAX_CELLS; };

/**
 * The painter as courses no taller than one blueprint, top course first (it keeps the piece's id). The painter fills
 * absolute metres, so each course is the same painter with its bounds cut: a course paints only what falls inside it.
 */
function courses(painter: Painter): Painter[] {
  const b = painter.bounds, tall = MAX_CELLS * BUILD - 2 * BUILD;
  if (cellExtent(b)[1] <= MAX_CELLS) return [painter];
  const out: Painter[] = [];
  // Course joints on the build lattice, so no cell is laid twice or missed between two courses.
  for (let top = Math.ceil(b.maxY / BUILD - 1e-9) * BUILD; top > b.minY + 1e-9; top -= tall) {
    const bounds = { ...b, minY: Math.max(b.minY, top - tall), maxY: top };
    out.push({ bounds, headroom: painter.headroom, paint: (x, z, column) => painter.paint(x, z, column) });
  }
  return out;
}

function describeTower(tower: PlannedTower): TownWallTower {
  const { shape } = tower, crown = shape.crown + TOWER.hoarding;
  const base: TownWallTower = { id: tower.id, position: [shape.centre[0], shape.base, shape.centre[1]], radius: shape.radius, height: crown - shape.base, apex: towerApex(shape) };
  return tower.gateId ? { ...base, gateId: tower.gateId } : base;
}

function towerBounds(tower: Pick<PlannedTower, 'shape'>): PieceBounds {
  const { shape } = tower, reach = towerReach(shape.radius) + 0.25;
  return { minX: shape.centre[0] - reach, maxX: shape.centre[0] + reach, minZ: shape.centre[1] - reach, maxZ: shape.centre[1] + reach,
    minY: shape.base, maxY: towerPoleTop(shape) + 0.125 };
}

function gateBounds(gate: Pick<PlannedGate, 'shape'>): PieceBounds {
  const { centre, tangent: t, normal: n, reach, depth, base, top } = gate.shape;
  const across = depth + 0.75, xs: number[] = [], zs: number[] = [];
  for (const a of [-reach, reach]) for (const b of [-across, across]) { xs.push(centre[0] + t[0] * a + n[0] * b); zs.push(centre[1] + t[1] * a + n[1] * b); }
  let minY = base, maxY = top + 1.0 + across + 0.5;
  for (const tower of gate.shape.towers) {
    const bounds = towerBounds({ shape: tower });
    xs.push(bounds.minX, bounds.maxX); zs.push(bounds.minZ, bounds.maxZ);
    minY = Math.min(minY, bounds.minY); maxY = Math.max(maxY, bounds.maxY);
  }
  return { minX: Math.min(...xs) - 0.25, maxX: Math.max(...xs) + 0.25, minZ: Math.min(...zs) - 0.25, maxZ: Math.max(...zs) + 0.25, minY, maxY };
}

/** Level steps along a stretch on the sampled ground, then pieces of up to nine steps each. */
function buildStretch(stretch: Stretch, kit: WallKit, options: TownWallOptions, emit: (id: string, painter: ReturnType<typeof wallPainter>) => void, segments: TownWallSegment[]): void {
  const { path, before, after } = stretch, L = path.total, ground = options.ground;
  const count = Math.max(1, Math.round(L / STEP)), stepLength = L / count, steps: WallStep[] = [];
  for (let k = 0; k < count; k++) {
    const s0 = k === 0 ? -before : k * stepLength, s1 = k === count - 1 ? L + after : (k + 1) * stepLength;
    let low = Infinity, high = -Infinity, centre = 0, samples = 0;
    for (let j = 0; j <= 4; j++) {
      const s = s0 + (s1 - s0) * j / 4, p = path.at(s), n = outward(path.tangent(Math.max(0, Math.min(L, s)), 1));
      for (const v of [-WALL.plinth, 0, WALL.plinth]) {
        const g = ground(p[0] + n[0] * v, p[1] + n[1] * v);
        low = Math.min(low, g); high = Math.max(high, g);
        if (v === 0) { centre += g; samples++; }
      }
    }
    const base = Math.floor((low - 0.5) / 0.125) * 0.125, plinthTop = Math.ceil((high + 0.5) / 0.25) * 0.25;
    const walk = Math.max(Math.round((centre / samples + stretch.walkHeight) / 0.5) * 0.5, plinthTop + 4);
    steps.push({ base, plinthTop, walk, band: walk - 3 });
    const a = path.at(k * stepLength), b = path.at((k + 1) * stepLength);
    segments.push({ from: [a[0], base, a[1]] as Vec3, to: [b[0], base, b[1]] as Vec3, height: walk + PARAPET.merlon - base });
  }
  const pieceBounds = (k0: number, k1: number): PieceBounds => {
    const from = k0 === 0 ? -before : k0 * stepLength, to = k1 === count ? L + after : k1 * stepLength;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let s = from; ; s = Math.min(to, s + 0.5)) {
      const p = path.at(s);
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
      if (s >= to) break;
    }
    for (let k = k0; k < k1; k++) { minY = Math.min(minY, steps[k]!.base); maxY = Math.max(maxY, steps[k]!.walk + PARAPET.merlon); }
    const pad = WALL.plinth + 0.25;
    return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, minY, maxY };
  };
  let part = 0;
  const place = (k0: number, k1: number) => {
    const bounds = pieceBounds(k0, k1);
    if (k1 - k0 > 1 && horizontal(bounds)) { const mid = (k0 + k1) >> 1; place(k0, mid); place(mid, k1); return; }
    const from = k0 === 0 ? -before : k0 * stepLength, to = k1 === count ? L + after + 1e-6 : k1 * stepLength;
    emit(`${stretch.id}:${part++}`, wallPainter({ path, from, to, before, after, stepLength, steps, phase: stretch.phase, kit, bounds }));
  };
  for (let k = 0; k < count; k += PIECE_STEPS) place(k, Math.min(count, k + PIECE_STEPS));
}
