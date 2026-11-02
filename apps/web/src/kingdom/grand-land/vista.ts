import type { Vec3 } from '@chatdom/shared';

/**
 * The stream director's wide shots of a kingdom on its grand land.
 *
 * `/-/grand` reads as a world because one frame holds the peaks, the water and the town between them. These
 * shots look for the same picture from the kingdom's own surface instead of a fixed compass bearing:
 *
 * - `island` opens the stream high over the land, the town glowing in the lower middle of the frame with the
 *   ranges behind it and the sea or the mere in view. The director glides from it down to the hero.
 * - `hero` is the town's resting shot: low over the streets, homes filling the lower frame, the castle in view
 *   and the land's relief rising behind it.
 * - `vista` is the second wide shot: from another side, the town set against the mere or the sea.
 *
 * Every candidate pose (all yaws, a few heights and distances) is scored by casting rays through its frame into
 * the baked surface: how far the skyline rises above the sea horizon beyond the town, how much of the frame is
 * water, and how the town sits in it. A pose whose eye is buried, whose sight line to the town or castle runs
 * through a hill, or which loses the castle or the town is never chosen. The result is a pure function of the
 * immutable baked surface and the installed layout, independent of the hour and of presence, so every screen
 * frames the same picture. A shot that no pose can satisfy is null, and the scene keeps its native lens.
 */
export type GrandShotName = 'island' | 'hero' | 'vista';
export interface GrandShot { readonly eye: Vec3; readonly target: Vec3; readonly fov: number; readonly yaw: number; readonly score: number }
export interface GrandShots { readonly island: GrandShot | null; readonly hero: GrandShot | null; readonly vista: GrandShot | null }

export interface GrandShotInput {
  /** Visual ground height in installed metres, or null beyond the baked land. */
  readonly height: (x: number, z: number) => number | null;
  /** Water surface where the baked land is wet (rivers, the mere, the sea), or null where it is dry. */
  readonly water?: (x: number, z: number) => number | null;
  /** Sea level in installed metres. Ground below it, and everything beyond the land, is sea. */
  readonly seaLevel: number;
  /** The baked land's installed bounds (a three.js Box3 fits). */
  readonly bounds: { readonly min: { readonly x: number; readonly y: number; readonly z: number }; readonly max: { readonly x: number; readonly y: number; readonly z: number } };
  /** The installed settlement's footprint. */
  readonly town: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly market: Vec3;
  /** The castle's centre on the ground. */
  readonly castle: Vec3;
  /** The town's own lake from the installed layout. */
  readonly lake?: { readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number; readonly level: number } | null;
  /** Width / height of the screen. */
  readonly aspect: number;
  /** The native hero lens. On a land without relief or water the hero keeps facing the way it always has. */
  readonly heroEye?: Vec3;
  readonly heroFov?: number;
}

type V3 = [number, number, number];
interface Lens { readonly eye: Vec3; readonly f: V3; readonly r: V3; readonly u: V3; readonly tanV: number; readonly tanH: number }
interface Candidate { readonly eye: Vec3; readonly target: Vec3; readonly fov: number; readonly yaw: number; readonly focus: Vec3; readonly below: number }
interface Detail { readonly columns: number; readonly cols: number; readonly rows: number }
/** The quick pass ranks every pose; only the best few are measured again at full detail. */
const COARSE: Detail = { columns: 12, cols: 10, rows: 6 }, FINE: Detail = { columns: 24, cols: 20, rows: 12 }, FINALISTS = 6;
const SKY = 0, LAND = 1, WATER = 2;
const TAU = Math.PI * 2;

function lensOf(eye: Vec3, target: Vec3, fov: number, aspect: number): Lens {
  let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  const rl = Math.hypot(fx, fz), rx = -fz / rl, rz = fx / rl;
  const tanV = Math.tan(fov * Math.PI / 360);
  return { eye, f: [fx, fy, fz], r: [rx, 0, rz], u: [-rz * fy, rz * fx - rx * fz, rx * fy], tanV, tanH: tanV * aspect };
}

/** Normalised device coordinates and depth, or null behind the eye. */
function project(lens: Lens, x: number, y: number, z: number): V3 | null {
  const vx = x - lens.eye[0], vy = y - lens.eye[1], vz = z - lens.eye[2], { f, r, u } = lens;
  const depth = vx * f[0] + vy * f[1] + vz * f[2];
  if (depth <= .1) return null;
  return [(vx * r[0] + vz * r[2]) / (depth * lens.tanH), (vx * u[0] + vy * u[1] + vz * u[2]) / (depth * lens.tanV), depth];
}

function rayOf(lens: Lens, nx: number, ny: number): V3 {
  const { f, r, u } = lens, a = nx * lens.tanH, b = ny * lens.tanV;
  const x = f[0] + r[0] * a + u[0] * b, y = f[1] + u[1] * b, z = f[2] + r[2] * a + u[2] * b, l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** The target that puts the focus on the vertical centre line, `below` half-frames under the middle. */
function aim(eye: Vec3, focus: Vec3, below: number, fov: number): Vec3 {
  const dx = focus[0] - eye[0], dy = focus[1] - eye[1], dz = focus[2] - eye[2], h = Math.hypot(dx, dz), distance = Math.hypot(h, dy);
  const pitch = Math.atan2(dy, h) + Math.atan(below * Math.tan(fov * Math.PI / 360)), c = Math.cos(pitch);
  return [eye[0] + dx / h * c * distance, eye[1] + Math.sin(pitch) * distance, eye[2] + dz / h * c * distance];
}

/** 1 inside [lo, hi], falling linearly to 0 a `soft` distance outside it. */
function band(value: number, lo: number, hi: number, soft: number): number {
  return value < lo ? Math.max(0, 1 - (lo - value) / soft) : value > hi ? Math.max(0, 1 - (value - hi) / soft) : 1;
}

function turn(a: number, b: number): number {
  const d = ((a - b) % TAU + TAU) % TAU;
  return d > Math.PI ? TAU - d : d;
}

class Surface {
  readonly sea: number; readonly top: number; readonly far: number;
  constructor(readonly input: GrandShotInput) {
    const { bounds } = input;
    this.sea = input.seaLevel;
    this.top = Math.max(bounds.max.y, input.seaLevel) + 2;
    this.far = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 1.6;
  }
  outside(x: number, z: number): boolean {
    const { min, max } = this.input.bounds;
    return x < min.x || x > max.x || z < min.z || z > max.z;
  }
  /** The surface the eye would see: water level where the land is wet, else null. */
  wet(x: number, z: number, ground: number): number | null {
    let level = ground < this.sea ? this.sea : -Infinity;
    const water = this.input.water?.(x, z);
    if (water !== null && water !== undefined && water > ground) level = Math.max(level, water);
    const lake = this.input.lake;
    if (lake && lake.level > ground && ((x - lake.x) / lake.radiusX) ** 2 + ((z - lake.z) / lake.radiusZ) ** 2 <= 1) level = Math.max(level, lake.level);
    return level === -Infinity ? null : level;
  }
  inTown(x: number, z: number): boolean {
    const { town } = this.input;
    return x >= town.minX && x <= town.maxX && z >= town.minZ && z <= town.maxZ;
  }
  /** March one ray to the first ground, water or open sky. */
  cast(eye: Vec3, d: V3): { kind: number; t: number; x: number; z: number } {
    for (let t = 3; t < this.far; t += Math.max(1.5, t * .012)) {
      const x = eye[0] + d[0] * t, y = eye[1] + d[1] * t, z = eye[2] + d[2] * t;
      if (y > this.top && d[1] >= 0) break;
      const ground = this.input.height(x, z);
      if (ground === null) {
        // Beyond the baked land lies the open sea.
        if (y <= this.sea && this.outside(x, z)) return { kind: WATER, t, x, z };
        continue;
      }
      const level = this.wet(x, z, ground);
      if (level !== null && y <= level) return { kind: WATER, t, x, z };
      if (y <= ground) return { kind: LAND, t, x, z };
    }
    return { kind: SKY, t: Infinity, x: NaN, z: NaN };
  }
  /** Ground (or water) stays at least `margin` below the straight line between two points. */
  clear(from: Vec3, to: Vec3, margin: number): boolean {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const samples = Math.min(160, Math.max(24, Math.ceil(length / 6)));
    for (let i = 1; i < samples; i++) {
      const t = .02 + .95 * i / samples;
      const x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t, z = from[2] + (to[2] - from[2]) * t;
      const ground = this.input.height(x, z);
      if (Math.max(ground ?? this.sea, this.sea) > y - margin) return false;
    }
    return true;
  }
  /** Height of the eye above whatever lies below it; the sea beyond the land counts. */
  clearance(eye: Vec3, overSea: boolean): number {
    const ground = this.input.height(eye[0], eye[2]);
    if (ground === null) return overSea ? eye[1] - this.sea : -Infinity;
    return eye[1] - Math.max(ground, this.wet(eye[0], eye[2], ground) ?? -Infinity);
  }
}

interface Reading {
  /** Mean rise of the skyline above the sea horizon beyond the focus, in half-frames. */
  relief: number;
  water: number; behind: number; sky: number;
  /** Share of the lower half of the frame that lands on the town. */
  lowerTown: number;
  /** The town's width on screen as a share of the frame, and how much of its outline stays inside. */
  townWidth: number; townInside: number;
}

function read(surface: Surface, c: Candidate, aspect: number, detail: Detail): Reading {
  const lens = lensOf(c.eye, c.target, c.fov, aspect), { town } = surface.input, eye = c.eye;
  const focusDistance = Math.hypot(c.focus[0] - eye[0], c.focus[2] - eye[2]);
  const halfTown = Math.hypot(town.maxX - town.minX, town.maxZ - town.minZ) / 4;
  let relief = 0;
  for (let column = 0; column < detail.columns; column++) {
    const ray = rayOf(lens, -.94 + 1.88 * (column + .5) / detail.columns, 0), h = Math.hypot(ray[0], ray[2]), hx = ray[0] / h, hz = ray[2] / h;
    let ridge = -Infinity;
    for (let distance = focusDistance + halfTown; distance < surface.far; distance += Math.max(6, distance * .02)) {
      const x = eye[0] + hx * distance, z = eye[2] + hz * distance, ground = surface.input.height(x, z);
      if (ground === null && surface.outside(x, z)) break;
      const p = project(lens, x, Math.max(ground ?? surface.sea, surface.sea), z);
      if (p) ridge = Math.max(ridge, p[1]);
    }
    const horizon = project(lens, eye[0] + hx * surface.far, surface.sea, eye[2] + hz * surface.far);
    if (horizon && ridge > -Infinity) relief += Math.max(0, Math.min(ridge, .92) - horizon[1]);
  }
  relief /= detail.columns;
  let water = 0, behind = 0, sky = 0, lower = 0, lowerTown = 0;
  for (let j = 0; j < detail.rows; j++) for (let i = 0; i < detail.cols; i++) {
    const ny = -1 + 2 * (j + .5) / detail.rows, hit = surface.cast(eye, rayOf(lens, -1 + 2 * (i + .5) / detail.cols, ny));
    if (hit.kind === WATER) { water++; if (hit.t > focusDistance) behind++; }
    else if (hit.kind === SKY) sky++;
    if (ny < 0) { lower++; if (hit.kind === LAND && surface.inTown(hit.x, hit.z)) lowerTown++; }
  }
  const total = detail.rows * detail.cols;
  let minX = Infinity, maxX = -Infinity, inside = 0, points = 0;
  for (const u of [0, .5, 1]) for (const v of [0, .5, 1]) {
    if (u === .5 && v === .5) continue;
    points++;
    const p = project(lens, town.minX + (town.maxX - town.minX) * u, surface.input.market[1], town.minZ + (town.maxZ - town.minZ) * v);
    if (!p) continue;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    if (Math.abs(p[0]) <= .97 && p[1] >= -.98 && p[1] <= .9) inside++;
  }
  const townWidth = maxX > minX ? (Math.min(1, maxX) - Math.max(-1, minX)) / 2 : 0;
  return { relief, water: water / total, behind: behind / total, sky: sky / total, lowerTown: lower ? lowerTown / lower : 0, townWidth, townInside: inside / points };
}

/** Rank every admissible pose cheaply, then measure the best few in full. Ties keep the earlier candidate. Yields between poses. */
function* choose(surface: Surface, candidates: readonly Candidate[], admit: (c: Candidate) => boolean, score: (reading: Reading, c: Candidate) => number): Generator<void, GrandShot | null> {
  const aspect = surface.input.aspect;
  const ranked: { c: Candidate; score: number; index: number }[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const c = candidates[index]!;
    if (admit(c)) ranked.push({ c, score: score(read(surface, c, aspect, COARSE), c), index });
    yield;
  }
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  let best: GrandShot | null = null;
  for (const { c } of ranked.slice(0, FINALISTS)) {
    const value = score(read(surface, c, aspect, FINE), c);
    if (!best || value > best.score + 1e-9) best = { eye: c.eye, target: c.target, fov: c.fov, yaw: c.yaw, score: value };
    yield;
  }
  return best;
}

/** Yaws from a preferred bearing outward, alternating sides, so equal scores keep the smaller turn. */
function yaws(from: number, step: number): number[] {
  const out = [from], count = Math.round(TAU / step);
  for (let i = 1; out.length < count; i++) { out.push(from + i * step); if (out.length < count) out.push(from - i * step); }
  return out.map(yaw => Math.atan2(Math.sin(yaw), Math.cos(yaw)));
}

/** A point a little above the focus, so a sight line to it never grazes the street it stands on. */
function above(point: Vec3, by: number): Vec3 { return [point[0], point[1] + by, point[2]]; }

function orbit(focus: Vec3, yaw: number, distance: number, height: number): Vec3 {
  return [focus[0] + Math.sin(yaw) * distance, focus[1] + height, focus[2] + Math.cos(yaw) * distance];
}

function validate(input: GrandShotInput): void {
  const { bounds, town } = input;
  const numbers = [...input.market, ...input.castle, input.seaLevel, input.aspect, bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z,
    town.minX, town.maxX, town.minZ, town.maxZ, ...(input.heroEye ?? []), input.heroFov ?? 50];
  if (!numbers.every(Number.isFinite) || input.aspect <= 0 || town.maxX <= town.minX || town.maxZ <= town.minZ || bounds.max.x <= bounds.min.x || bounds.max.z <= bounds.min.z
    || (input.heroFov !== undefined && (input.heroFov <= 10 || input.heroFov >= 120))) throw new Error('Grand shots need a finite land, town and screen');
}

/** Every shot at once. A frame-bound caller should step `grandShotSteps` instead. */
export function grandShots(input: GrandShotInput): GrandShots {
  const steps = grandShotSteps(input);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}

/**
 * The same choice, one candidate pose per step, so a render loop can spend a few milliseconds a frame on it while
 * the land streams in. The result is identical to `grandShots`.
 */
export function* grandShotSteps(input: GrandShotInput): Generator<void, GrandShots> {
  validate(input);
  const surface = new Surface(input), { town, market, castle, aspect } = input, portrait = aspect < 1;
  const centre: Vec3 = [(town.minX + town.maxX) / 2, market[1], (town.minZ + town.maxZ) / 2];
  const span = Math.hypot(town.maxX - town.minX, town.maxZ - town.minZ);

  // Island: the /-/grand framing (about 33 degrees down, fov 43), turned to put the ranges behind the town.
  const islandFov = 43, islandTanH = Math.tan(islandFov * Math.PI / 360) * aspect;
  const widths = portrait ? [.62, .76, .9] : [.42, .52, .64], wanted: [number, number] = portrait ? [.6, .95] : [.4, .62];
  const islandCandidates: Candidate[] = [];
  for (const yaw of yaws(-.45, 7.5 * Math.PI / 180)) for (const pitch of [.57, .46, .68]) for (const width of widths) {
    const distance = span / (2 * islandTanH * width);
    const eye = orbit(centre, yaw, distance * Math.cos(pitch), distance * Math.sin(pitch));
    islandCandidates.push({ eye, target: aim(eye, centre, .3, islandFov), fov: islandFov, yaw, focus: centre, below: .3 });
  }
  const island = yield* choose(surface, islandCandidates,
    c => surface.clearance(c.eye, true) >= 40 && surface.clear(c.eye, above(c.focus, 10), 4),
    (r) => 1.2 * r.relief + .8 * band(r.water, .08, .4, .12) + .9 * band(r.townWidth, wanted[0], wanted[1], .25) + r.townInside + .3 * band(r.sky, .04, .3, .2));

  // Hero: low over the streets as the native lens, but free to face any way the land is finest.
  const heroFov = input.heroFov ?? (portrait ? 58 : 52);
  const heroFocus: Vec3 = [market[0] + (castle[0] - market[0]) * .35, market[1], market[2] + (castle[2] - market[2]) * .35];
  const native = input.heroEye ?? [market[0] - 110, market[1] + 40, market[2] + 160];
  const nativeYaw = Math.atan2(native[0] - heroFocus[0], native[2] - heroFocus[2]);
  const nativeDistance = Math.max(60, Math.hypot(native[0] - heroFocus[0], native[2] - heroFocus[2])), nativeHeight = Math.max(18, native[1] - market[1]);
  const castlePoints: Vec3[] = [[castle[0], castle[1] + 2, castle[2]], [castle[0], castle[1] + 24, castle[2]]];
  const castleSeen = (c: Candidate) => {
    const lens = lensOf(c.eye, c.target, c.fov, aspect);
    return castlePoints.every(point => { const p = project(lens, ...point); return !!p && Math.abs(p[0]) <= .85 && Math.abs(p[1]) <= .92; })
      && surface.clear(c.eye, [castle[0], castle[1] + 10, castle[2]], 2);
  };
  const heroCandidates: Candidate[] = [];
  for (const yaw of yaws(nativeYaw, 5 * Math.PI / 180)) for (const d of [1, .8, 1.25]) for (const h of [1, .75, 1.4]) {
    const eye = orbit(heroFocus, yaw, nativeDistance * d, nativeHeight * h);
    heroCandidates.push({ eye, target: aim(eye, heroFocus, .22, heroFov), fov: heroFov, yaw, focus: heroFocus, below: .22 });
  }
  const hero = yield* choose(surface, heroCandidates,
    c => surface.clearance(c.eye, false) >= 12 && surface.clear(c.eye, above(c.focus, 8), 2) && castleSeen(c),
    (r, c) => 1.6 * r.relief + .6 * band(r.water, .03, .3, .08) + band(r.lowerTown, .45, 1, .35) + .25 * band(r.sky, .12, .5, .1) - .2 * turn(c.yaw, nativeYaw) / Math.PI);

  // Vista: wider and higher, from another side, the town set against the mere or the sea.
  const vistaFov = portrait ? 56 : 46;
  const vistaCandidates: Candidate[] = [];
  for (const yaw of yaws(nativeYaw + Math.PI, 5 * Math.PI / 180)) for (const d of [1.8, 1.4, 2.3]) for (const h of [2, 1.4, 2.8]) {
    const eye = orbit(centre, yaw, nativeDistance * d, nativeHeight * h);
    vistaCandidates.push({ eye, target: aim(eye, centre, .18, vistaFov), fov: vistaFov, yaw, focus: centre, below: .18 });
  }
  const apart = hero ? Math.atan2(hero.eye[0] - centre[0], hero.eye[2] - centre[2]) : null;
  const vista = yield* choose(surface, vistaCandidates,
    c => (apart === null || turn(c.yaw, apart) >= Math.PI / 3) && surface.clearance(c.eye, true) >= 15 && surface.clear(c.eye, above(c.focus, 10), 3),
    r => 1.4 * band(r.water, .14, .5, .12) + band(r.behind, .08, .4, .08) + .8 * r.townInside + .6 * band(r.townWidth, .3, .7, .2) + .6 * r.relief);

  return { island, hero, vista };
}

/**
 * The water surface of a baked land: its level where the encoded water stands above the very same ground sample,
 * else null. Reads the native water owner's borrowed rasters without copying them.
 */
export function bakedWaterLevel(water: {
  readonly ground: { readonly data: ArrayLike<number>; readonly width: number; readonly height: number; readonly origin: readonly [number, number]; readonly step: number };
  readonly raster: { readonly levels: ArrayLike<number>; readonly scale: number; readonly offset: number };
}): (x: number, z: number) => number | null {
  const { ground, raster } = water;
  return (x, z) => {
    const cx = Math.floor((x - ground.origin[0]) / ground.step), cz = Math.floor((z - ground.origin[1]) / ground.step);
    if (!(cx >= 0 && cz >= 0 && cx < ground.width && cz < ground.height)) return null;
    const index = cx + cz * ground.width, level = raster.levels[index]!;
    return level > ground.data[index]! ? level * raster.scale + raster.offset : null;
  };
}
