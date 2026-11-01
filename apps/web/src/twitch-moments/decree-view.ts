import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '@chatdom/content';
import { CELL } from './banner';
import {
  BOARD_CELLS, DYE_MATERIALS, LANTERN_CELLS, PENNANT_CELLS, POLE_CELLS, RING_CELLS, TOWN_FLAG_CELLS, boardBlueprint, decreeParts, dyeCellBlueprint,
  lanternBlueprint, pennantColumns, poleBlueprint, ringBlueprint, townFlagBlueprint, type PennantRun,
} from './decree-art';
import { hash01, type SpectacleLayer } from './spectacle';
import { TOWN_BEAT, TOWN_COLOURS, TOWN_DYES, TOWN_LIMITS, type BoardChoiceFrame, type BoardFrame, type TownColour, type TownFrame, type TownLayerHost } from './town';
import { CORD_CELLS, cordBlueprint } from './train-art';
import { Pool } from './train-view';
import type { SkyGlow } from './view';

/**
 * The town decides together: the decree board in the plaza while a poll runs, the town's colours on its everyday
 * bunting, and the dressing of a called festival.
 *
 * Placement. The board stands `DECREE_PLACE.aside` metres from the plaza point, on the castle's side of it, its front
 * turned to the plaza: the people gathered in the plaza (and a camera among them) read the notice with the castle on
 * its hill behind it, so the decree reads as issued from the throne. The poles stand behind the board in a shallow
 * arc, so the pennants climb clear above its roof. If a bunting run passes too near that spot (the poles reach
 * 6.4 m, the strings hang at eave height), the board turns round the plaza point to the nearest bearing with room;
 * any string still within reach of the standing board dissolves while it stands.
 *
 * Bunting. Everyday: the runs nearest the plaza, clipped to `everyday.reach` and bounded in length, so the town flies
 * its colours calmly where people gather. A called festival hangs many more runs (bounded) with a lantern at the low
 * point of every swag. Our strings hang half a metre to the side of each run's line, so the Hype Train's own
 * bunting on the same runs strings alongside them, never through them. A colours decree landing live runs out from
 * the plaza: every flag turns on its cord as the wave passes, edge on at the turn, and comes round in the new dyes.
 *
 * Everything is instanced from parts prepared up front, bounded by `DECREE_LIMITS`, and posed from the frame alone.
 */

export const DECREE_LIMITS = { dye: 480, flags: 1000, cords: 1400, lanterns: 160, cores: 192, glows: 192, motes: 32, dust: 18 } as const;

export const DECREE_PLACE = {
  /** Metres from the plaza point (where the balloons float and the crowd gathers) to the board. */
  aside: 5,
  /** Room the board wants from any bunting run, and how near a string may hang to a standing board before it dissolves. */
  clearance: 4.5, keepClear: 3.6,
  /** Poles: spacing across, the group's shift left (the pennants fly right), depth behind the board, how far the ends come forward. */
  spacing: 1.25, shift: -0.44, depth: -0.95, arc: 0.45,
  everyday: { reach: 26, length: 80, runs: 4 },
  festival: { reach: 90, length: 480, runs: 16 },
  /** A swag between supports, flags' pitch on the cord, the gap left for the lantern at its low point, our side offset. */
  span: 6.5, pitch: 0.74, gap: 0.32, lateral: 0.55, step: 0.5,
} as const;

/** Bearings (radians from the castle's direction) the board may stand on round the plaza point, in preference order. */
const BEARINGS = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI] as const;

/** The winner's flourish, ms after the poll ends, inside `TOWN_BEAT.board.decide`; the others sink or droop. */
export const DECREE_BEAT = {
  top: [250, 1450] as const, snap: 1450, glint: [1300, 1550, 1800, 2900] as const, motes: 2200,
  sink: [200, 1800] as const, divided: [0, 1600] as const, cancelled: [0, 2400] as const,
} as const;

const RISE_END = TOWN_BEAT.board.rise[1];
/** Pennants start up their poles just before the board has settled. */
const CLIMB_FROM = RISE_END - 500;
const BOARD_HEIGHT = BOARD_CELLS.height * CELL, POLE_HEIGHT = POLE_CELLS.height * CELL;
const W = 0.1; // the colour wave's front width, in reach

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (u: number) => { const k = clamp01(u); return k * k * (3 - 2 * k); };
const smoothstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 3;
/** A toy's settle: past the mark by a hair, then home. */
const backOut = (u: number) => { const k = clamp01(u) - 1, c = 1.36; return 1 + (c + 1) * k * k * k + c * k * k; };
/** One rock as a part lands, dying away as it settles; zero at rest and while it is still coming up. */
const wobble = (k: number, amplitude: number) => (k <= 0.7 || k >= 1 ? 0 : amplitude * ((1 - k) / 0.3) * Math.sin(((k - 0.7) / 0.3) * Math.PI * 2));
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

const LANTERN_LIGHT = ['#ffcf7a', '#ffb862', '#ffe2ae'].map(c => new THREE.Color(c));
const LANTERN_GLOW = new THREE.Color('#ffa44e');
const GILT = new THREE.Color('#ffdc84'), GILT_GLOW = new THREE.Color('#ffc65a');
const WARM: readonly [number, number, number] = [1, 0.7, 0.42];

// ---------------------------------------------------------------- the bunting's layout

export interface BuntingFlag { readonly position: THREE.Vector3; readonly yaw: number; readonly weave: number; readonly dist: number; readonly everyday: boolean; readonly phase: number }
export interface BuntingCord { readonly matrix: THREE.Matrix4; readonly dist: number; readonly everyday: boolean }
export interface BuntingLantern { readonly position: THREE.Vector3; readonly yaw: number; readonly dist: number; readonly phase: number; readonly tint: number }
export interface Bunting {
  readonly flags: readonly BuntingFlag[];
  readonly cords: readonly BuntingCord[];
  readonly lanterns: readonly BuntingLantern[];
  /** Metres of string hung every day, and with a festival called (everyday included). */
  readonly everydayLength: number;
  readonly festivalLength: number;
  /** The farthest flag from the plaza, every day and with a festival: the colour wave and the dressing run out to it. */
  readonly everydayReach: number;
  readonly festivalReach: number;
}

interface Piece { readonly points: THREE.Vector3[]; readonly lengths: number[] }

/** Horizontal distance from (x, z) to the nearest point of a polyline. */
function nearestOf(run: readonly Vec3[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < run.length; i++) {
    const a = run[i]!, b = run[Math.min(i + 1, run.length - 1)]!;
    const dx = b[0] - a[0], dz = b[2] - a[2], len2 = dx * dx + dz * dz;
    const u = len2 > 1e-9 ? clamp01(((x - a[0]) * dx + (z - a[2]) * dz) / len2) : 0;
    best = Math.min(best, Math.hypot(a[0] + dx * u - x, a[2] + dz * u - z));
  }
  return best;
}

/** A run sampled every `step`, set `lateral` to its right, cut into the stretches that lie within `reach` of the centre. */
function piecesOf(run: readonly Vec3[], cx: number, cz: number, reach: number): Piece[] {
  const P = DECREE_PLACE, samples: THREE.Vector3[] = [];
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!, b = run[i]!, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const nx = dz / len, nz = -dx / len, steps = Math.max(1, Math.ceil(len / P.step));
    for (let s = 0; s < steps + (i === run.length - 1 ? 1 : 0); s++) {
      const u = s / steps;
      samples.push(new THREE.Vector3(a[0] + dx * u + nx * P.lateral, a[1] + dy * u, a[2] + dz * u + nz * P.lateral));
    }
  }
  const pieces: Piece[] = [];
  let current: Piece | null = null;
  for (const p of samples) {
    if (Math.hypot(p.x - cx, p.z - cz) > reach) { current = null; continue; }
    if (!current) { current = { points: [], lengths: [] }; pieces.push(current); }
    const last = current.points.at(-1);
    current.lengths.push(last ? current.lengths.at(-1)! + last.distanceTo(p) : 0);
    current.points.push(p);
  }
  return pieces;
}

function along(piece: Piece, s: number, target: THREE.Vector3): THREE.Vector3 {
  const { points, lengths } = piece;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i]! < s) i++;
  const l0 = lengths[i - 1]!, l1 = lengths[i] ?? l0, u = l1 > l0 ? clamp01((s - l0) / (l1 - l0)) : 0;
  return target.copy(points[i - 1]!).lerp(points[i] ?? points[i - 1]!, u);
}

/**
 * Where the town's bunting hangs, from the supplied runs and the plaza: runs nearest the plaza first, each clipped to
 * the festival's reach and laid in equal swags; the swags near the plaza (bounded) are the everyday dressing. Pure.
 */
export function buntingOf(runs: readonly (readonly Vec3[])[], anchor: Vec3 | null): Bunting {
  const P = DECREE_PLACE;
  const flags: BuntingFlag[] = [], cords: BuntingCord[] = [], lanterns: BuntingLantern[] = [];
  let everydayLength = 0, festivalLength = 0;
  const centre = anchor ?? runs.find(run => run.length > 0)?.[0] ?? null;
  if (!centre) return { flags, cords, lanterns, everydayLength, festivalLength, everydayReach: 1, festivalReach: 1 };
  const [cx, , cz] = centre;
  const flat = (p: THREE.Vector3) => Math.hypot(p.x - cx, p.z - cz);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), mid = new THREE.Vector3();
  const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3();

  /** One swag from a to b: the cord's lengths, the flags either side of its low point, a lantern at it. */
  function hang(everyday: boolean): void {
    const span = a.distanceTo(b);
    if (span < 0.3) return;
    const sag = Math.min(0.9, 0.035 * span + 0.12);
    const curve = (u: number, target: THREE.Vector3) => target.copy(a).lerp(b, u).addScaledVector(UP, -sag * 4 * u * (1 - u));
    const segments = Math.min(32, Math.max(2, Math.ceil(span / 0.5)));
    for (let k = 0; k < segments && cords.length < DECREE_LIMITS.cords; k++) {
      curve(k / segments, p0); curve((k + 1) / segments, p1);
      const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z, length = Math.hypot(dx, dy, dz);
      e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)), 'YZX');
      const matrix = new THREE.Matrix4().compose(p0, q.setFromEuler(e), s3.set(length / (CORD_CELLS.length * CELL), 1, 1))
        .multiply(tmp.makeTranslation(0, -CORD_CELLS.pivot[1] * CELL, -CORD_CELLS.pivot[2] * CELL));
      cords.push({ matrix, dist: flat(mid.copy(p0).lerp(p1, 0.5)), everyday });
    }
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const half = Math.max(0, Math.floor((span / 2 - P.gap - 0.04) / P.pitch));
    for (let i = 0; i < half * 2 && flags.length < DECREE_LIMITS.flags; i++) {
      const j = i < half ? half - 1 - i : i - half, side = i < half ? -1 : 1;
      const position = curve(0.5 + side * (P.gap + P.pitch * (j + 0.5)) / span, new THREE.Vector3()).addScaledVector(UP, -0.5 * CELL);
      const dist = flat(position);
      flags.push({ position, yaw, weave: i % 2, dist, everyday, phase: hash01(flags.length, 11) * TAU + dist * 0.45 });
    }
    if (lanterns.length < DECREE_LIMITS.lanterns) {
      const position = curve(0.5, new THREE.Vector3()).addScaledVector(UP, -0.02);
      lanterns.push({ position, yaw, dist: flat(position), phase: hash01(lanterns.length, 23) * TAU, tint: lanterns.length % LANTERN_LIGHT.length });
    }
  }

  const ranked = runs.map((run, index) => ({ run, index, near: run.length > 1 ? nearestOf(run, cx, cz) : Infinity }))
    .filter(r => r.near <= P.festival.reach).sort((x, y) => x.near - y.near || x.index - y.index);
  let everydayRuns = 0, festivalRuns = 0, full = false;
  for (const { run, near } of ranked) {
    if (full || festivalRuns >= P.festival.runs) break;
    festivalRuns++;
    const everydayRun = near <= P.everyday.reach && everydayRuns < P.everyday.runs;
    if (everydayRun) everydayRuns++;
    for (const piece of piecesOf(run, cx, cz, P.festival.reach)) {
      const total = piece.lengths.at(-1) ?? 0;
      if (total < 2) continue;
      const n = Math.max(1, Math.round(total / P.span)), span = total / n;
      for (let k = 0; k < n; k++) {
        if (festivalLength + span > P.festival.length) { full = true; break; }
        along(piece, k * span, a); along(piece, (k + 1) * span, b);
        const everyday = everydayRun && flat(mid.copy(a).lerp(b, 0.5)) <= P.everyday.reach && everydayLength + span <= P.everyday.length;
        if (everyday) everydayLength += span;
        festivalLength += span;
        hang(everyday);
      }
      if (full) break;
    }
  }
  let everydayReach = 1, festivalReach = 1;
  for (const flag of flags) { festivalReach = Math.max(festivalReach, flag.dist); if (flag.everyday) everydayReach = Math.max(everydayReach, flag.dist); }
  return { flags, cords, lanterns, everydayLength, festivalLength, everydayReach, festivalReach };
}

// ---------------------------------------------------------------- lights

const glowVertex = /* glsl */ `
  varying vec2 vSpot;
  varying vec3 vColour;
  void main() {
    #ifdef USE_INSTANCING_COLOR
      vColour = instanceColor;
    #else
      vColour = vec3(1.0);
    #endif
    vSpot = position.xy * 2.0;
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * (centre + vec4(position.xy * length(instanceMatrix[0].xyz), 0.0, 0.0));
  }
`;
const glowFragment = /* glsl */ `
  varying vec2 vSpot;
  varying vec3 vColour;
  void main() {
    float r = length(vSpot);
    if (r >= 1.0) discard;
    float fall = 1.0 - r;
    gl_FragColor = vec4(vColour * fall * fall * (0.5 + 0.5 * fall), 1.0);
    #include <colorspace_fragment>
  }
`;

/** Plain HDR light drawn many times, coloured per instance: lantern flames and the gilt glint (boxes), and their glows. */
class Lit {
  readonly mesh: THREE.InstancedMesh;
  private readonly scratch = new THREE.Color();
  count = 0;
  constructor(parent: THREE.Group, readonly capacity: number, private readonly geometry: THREE.BufferGeometry, private readonly material: THREE.Material, name: string, order: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = name; this.mesh.renderOrder = order;
    parent.add(this.mesh);
  }
  push(matrix: THREE.Matrix4, colour: THREE.Color, strength: number): void {
    if (this.count >= this.capacity || strength <= 0.005) return;
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count, this.scratch.copy(colour).multiplyScalar(strength));
    this.count++;
  }
  flush(): void {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    if (this.count > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); }
}

// ---------------------------------------------------------------- the layer

export type DecreeLayer = SpectacleLayer<TownFrame> & {
  /** Where the poll's question hangs: over the board and its poles, in world space; null while no board stands. */
  captionPoint(): THREE.Vector3 | null;
  /** Under each pennant, in choice order, in world space: where each choice's label hangs. Read it each frame. */
  choicePoints(): readonly THREE.Vector3[];
  /** Where the standing board is and which way it reads, in world space, so a shot can face it; null while none stands. */
  stand(): { readonly origin: THREE.Vector3; readonly facing: THREE.Vector3; readonly right: THREE.Vector3 } | null;
  glow(): SkyGlow;
};

interface PennantPose { level: number; droop: number; calm: number; snap: number }

export function createDecreeLayer(root: THREE.Group, host: TownLayerHost): DecreeLayer {
  const layer = new THREE.Group();
  layer.name = 'decree';
  root.add(layer);
  const pools = new Map<string, Pool>();
  const cores = new Lit(layer, DECREE_LIMITS.cores, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 'decree-lights', 0);
  const glows = new Lit(layer, DECREE_LIMITS.glows, new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: glowVertex, fragmentShader: glowFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }), 'decree-glows', 3);

  const kit = host.kit;
  const parts = {
    board: boardBlueprint(kit, false), decree: boardBlueprint(kit, true), pole: poleBlueprint(kit), ring: ringBlueprint(kit), lantern: lanternBlueprint(kit),
    cord: cordBlueprint(kit),
    dyes: new Map(DYE_MATERIALS.map(m => [m, dyeCellBlueprint(kit, m)] as const)),
    flags: Object.fromEntries(TOWN_COLOURS.map(c => [c, Array.from({ length: TOWN_FLAG_CELLS.weaves }, (_, w) => townFlagBlueprint(kit, c, w))])) as Record<TownColour, VoxelBlueprint[]>,
  };
  const columns = Object.fromEntries(TOWN_COLOURS.map(c => [c, pennantColumns(c)])) as Record<TownColour, readonly (readonly PennantRun[])[]>;

  // Scratch: nothing below allocates per frame.
  const m = new THREE.Matrix4(), t = new THREE.Matrix4(), r = new THREE.Matrix4(), pole = new THREE.Matrix4(), cloth = new THREE.Matrix4(), part = new THREE.Matrix4();
  const q = new THREE.Quaternion(), turn = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p = new THREE.Vector3(), o = new THREE.Vector3();
  const pose: PennantPose = { level: 0, droop: 0, calm: 1, snap: 0 };
  const counts = { board: 0, choices: 0, pennants: 0, flags: 0, cords: 0, lanterns: 0, motes: 0, lights: 0 };
  const choiceSpots = Array.from({ length: TOWN_LIMITS.choices }, () => new THREE.Vector3());
  const shown: THREE.Vector3[] = [];
  const caption = new THREE.Vector3();
  let captionShown = false;
  let skyGlow: SkyGlow = { colour: WARM, strength: 0 }, warmth = 0;

  // The site and the bunting are worked out once per supplied plaza, castle and runs.
  const site = { ok: false, origin: new THREE.Vector3(), basis: new THREE.Matrix4(), rotation: new THREE.Quaternion() };
  let siteKey = NaN, lastRuns: readonly (readonly Vec3[])[] | null = null, runsKey = 0, buntingKey = NaN;
  let bunting: Bunting = buntingOf([], null);

  function pool(blueprint: VoxelBlueprint, capacity: number): Pool {
    let found = pools.get(blueprint.id);
    if (!found) {
      found = new Pool(host.mesh(blueprint, new THREE.Vector3()).geometry, host.material, capacity, layer, blueprint.id);
      pools.set(blueprint.id, found);
    }
    return found;
  }
  const dye = (material: number) => pool(parts.dyes.get(material)!, DECREE_LIMITS.dye);
  const flagPool = (colour: TownColour, weave: number) => pool(parts.flags[colour][weave]!, Math.ceil(DECREE_LIMITS.flags / 2) + 8);

  function keyOf(runs: readonly (readonly Vec3[])[]): number {
    if (runs === lastRuns) return runsKey;
    let sum = runs.length * 7919;
    for (const run of runs) { sum += run.length * 31; for (const [x, y, z] of run) sum += x * 1.31 + y * 0.77 + z * 2.03; }
    lastRuns = runs; runsKey = sum;
    return sum;
  }

  /** The board's spot round the plaza point: toward the castle unless a bunting run passes too close there. */
  function placeBoard(runs: readonly (readonly Vec3[])[], key: number): void {
    const plaza = host.places.plaza();
    const toward = host.places.castle()?.crown ?? host.places.sky()?.centre ?? null;
    const k = plaza ? key * 3 + plaza[0] * 1.7 + plaza[1] * 0.3 + plaza[2] * 2.9 + (toward ? toward[0] * 0.61 + toward[2] * 1.13 + 5 : 0) : -1;
    if (k === siteKey) return;
    siteKey = k;
    site.ok = plaza !== null;
    if (!plaza) return;
    let dx = toward ? toward[0] - plaza[0] : 0, dz = toward ? toward[2] - plaza[2] : 0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) { dx = 0; dz = -1; } else { dx /= len; dz /= len; }
    let best = { bearing: 0, room: -1 };
    for (const bearing of BEARINGS) {
      const c = Math.cos(bearing), s = Math.sin(bearing), bx = dx * c - dz * s, bz = dx * s + dz * c;
      const x = plaza[0] + bx * DECREE_PLACE.aside, z = plaza[2] + bz * DECREE_PLACE.aside;
      let room = Infinity;
      for (const run of runs) if (run.length > 1) room = Math.min(room, nearestOf(run, x, z));
      if (room >= DECREE_PLACE.clearance) { best = { bearing, room }; break; }
      if (room > best.room) best = { bearing, room };
    }
    const c = Math.cos(best.bearing), s = Math.sin(best.bearing), bx = dx * c - dz * s, bz = dx * s + dz * c;
    site.origin.set(plaza[0] + bx * DECREE_PLACE.aside, plaza[1], plaza[2] + bz * DECREE_PLACE.aside);
    // Front to the plaza point: the board's +z looks back along the bearing, its +x is the reader's right.
    const facing = new THREE.Vector3(-bx, 0, -bz), right = new THREE.Vector3().crossVectors(UP, facing).normalize();
    site.basis.makeBasis(right, UP, facing).setPosition(site.origin);
    site.rotation.setFromRotationMatrix(site.basis);
  }

  function currentBunting(runs: readonly (readonly Vec3[])[], key: number): Bunting {
    const anchor = host.places.plaza() ?? host.places.sky()?.centre ?? null;
    const k = key + (anchor ? anchor[0] * 3.7 + anchor[1] * 0.9 + anchor[2] * 5.3 + 11 : 0);
    if (k !== buntingKey) { buntingKey = k; bunting = buntingOf(runs, anchor); }
    return bunting;
  }

  // ---------------------------------------------------------------- bunting

  /** How much a string at (x, z) still shows beside a standing board: it dissolves out of the board's way. */
  function aside(x: number, z: number, board: number): number {
    if (board <= 0) return 1;
    const d = Math.hypot(x - site.origin.x, z - site.origin.z);
    return 1 - board * (1 - smoothstep(DECREE_PLACE.keepClear - 0.8, DECREE_PLACE.keepClear, d));
  }

  function drawBunting(frame: TownFrame, atMs: number, board: number): void {
    const { flags, cords, everydayReach, festivalReach } = bunting;
    if (!cords.length) return;
    const festival = frame.festival, dressed = festival ? clamp01(festival.dressed) : 0, change = frame.colourChange;
    const reach = dressed > 0 ? festivalReach : everydayReach;
    const cordPool = pool(parts.cord, DECREE_LIMITS.cords);
    for (const cord of cords) {
      const shown = cord.everyday ? 1 : clamp01((dressed - 0.55 * cord.dist / festivalReach) / 0.2);
      if (shown > 0) cordPool.push(cord.matrix, shown * aside(cord.matrix.elements[12]!, cord.matrix.elements[14]!, board));
    }
    counts.cords = cordPool.count;
    const [px, py, pz] = TOWN_FLAG_CELLS.pivot;
    for (const flag of flags) {
      const up = flag.everyday ? 1 : clamp01((dressed - 0.6 * flag.dist / festivalReach) / 0.4);
      if (up <= 0) continue;
      let colour: TownColour = flag.everyday || !festival ? frame.colour : festival.colour, flip = 0;
      if (change) {
        flip = clamp01((change.wave * (1 + W) - flag.dist / reach) / W);
        colour = flip < 0.5 ? change.from : change.to;
      }
      // The turn: a half turn about the hanging line, edge on (and the dye changing) half way, with a little hop.
      const turning = flip > 0 && flip < 1 ? smooth(flip) : 0;
      const flutter = (0.2 * Math.sin(atMs * 0.0024 + flag.phase) + 0.09 * Math.sin(atMs * 0.0061 + flag.phase * 1.7)) * (0.4 + 0.6 * up) * (1 - Math.sin(Math.PI * turning));
      e.set(flutter, flag.yaw + Math.PI * turning + 0.08 * Math.sin(atMs * 0.0017 + flag.phase), 0, 'YXZ');
      p.copy(flag.position).addScaledVector(UP, 0.1 * Math.sin(Math.PI * turning));
      m.compose(p, q.setFromEuler(e), s3.set(0.5 + 0.5 * smooth(up), Math.max(0.02, backOut(up)), 1)).multiply(t.makeTranslation(-px * CELL, -py * CELL, -pz * CELL));
      flagPool(colour, flag.weave).push(m, clamp01(up * 2) * aside(flag.position.x, flag.position.z, board));
    }
    if (dressed > 0) drawLanterns(atMs, dressed, festivalReach, board);
  }

  function drawLanterns(atMs: number, dressed: number, festivalReach: number, board: number): void {
    const target = pool(parts.lantern, DECREE_LIMITS.lanterns), [lx, ly, lz] = LANTERN_CELLS.pivot, drop = (LANTERN_CELLS.pivot[1] - LANTERN_CELLS.glass[1]) * CELL;
    let lit = 0;
    for (const lantern of bunting.lanterns) {
      const order = lantern.dist / festivalReach;
      const up = clamp01((dressed - 0.6 * order) / 0.4) * aside(lantern.position.x, lantern.position.z, board);
      if (up <= 0.01) continue;
      const size = Math.max(0.05, easeOut(up));
      e.set(0.07 * Math.sin(atMs * 0.0019 + lantern.phase) + 0.03 * Math.sin(atMs * 0.0047 + lantern.phase * 2.1), lantern.yaw, 0, 'YXZ');
      q.setFromEuler(e);
      m.compose(lantern.position, q, s3.setScalar(size)).multiply(t.makeTranslation(-lx * CELL, -ly * CELL, -lz * CELL));
      target.push(m, clamp01(up * 2));
      // Its light catches after it has hung, from the plaza outward, and breathes a little.
      const light = clamp01((dressed - 0.5 * order - 0.2) / 0.3) * up;
      if (light <= 0.01) continue;
      const flicker = 1 + 0.08 * Math.sin(atMs * 0.011 + lantern.phase) + 0.05 * Math.sin(atMs * 0.029 + lantern.phase * 1.7);
      p.set(0, -drop * size, 0).applyQuaternion(q).add(lantern.position);
      cores.push(m.compose(p, q, s3.set(1.3 * CELL * size, 2 * CELL * size, 1.3 * CELL * size)), LANTERN_LIGHT[lantern.tint]!, 1.9 * light * flicker);
      // A halo wide enough to read from across the town: the festival's streets are strings of warm light at night.
      glows.push(m.makeScale(2.6, 2.6, 2.6).setPosition(p), LANTERN_GLOW, 0.4 * light * flicker);
      lit += light;
    }
    counts.lanterns = target.count;
    warmth = bunting.lanterns.length ? Math.min(0.07, 0.07 * dressed * lit / bunting.lanterns.length) : 0;
  }

  // ---------------------------------------------------------------- the board

  /** The board in board-local metres (x the reader's right, y up, z toward the plaza) into the layer. */
  const local = (x: number, y: number, z: number, target: THREE.Vector3) => target.set(x, y, z).applyMatrix4(site.basis);

  function pennantPose(board: BoardFrame, choice: BoardChoiceFrame, arrival: number): PennantPose {
    pose.level = clamp01(choice.share) * arrival; pose.droop = 0; pose.calm = 1; pose.snap = 0;
    const d = board.decidedT;
    if (d === null) return pose;
    if (board.phase === 'decided' && choice.winner) {
      pose.level += (1 - pose.level) * smooth((d - DECREE_BEAT.top[0]) / (DECREE_BEAT.top[1] - DECREE_BEAT.top[0]));
      pose.snap = d >= DECREE_BEAT.snap ? Math.exp(-(d - DECREE_BEAT.snap) / 380) : 0;
    } else if (board.phase === 'decided') {
      const s = smoothstep(DECREE_BEAT.sink[0], DECREE_BEAT.sink[1], d);
      pose.level = Math.max(0, pose.level - 0.16 * s); pose.droop = 0.32 * s; pose.calm = 1 - 0.45 * s;
    } else if (board.phase === 'divided') {
      const s = smoothstep(DECREE_BEAT.divided[0], DECREE_BEAT.divided[1], d);
      pose.droop = 0.14 * s; pose.calm = 1 - 0.3 * s;
    } else {
      const s = smoothstep(DECREE_BEAT.cancelled[0], DECREE_BEAT.cancelled[1], d);
      pose.level *= 1 - s; pose.droop = 0.5 * s; pose.calm = 1 - 0.6 * s;
    }
    return pose;
  }

  function drawBoard(board: BoardFrame, atMs: number): void {
    const raised = clamp01(board.raised), n = Math.min(board.choices.length, TOWN_LIMITS.choices);
    const kb = clamp01(raised / 0.75);
    part.copy(site.basis).multiply(t.makeTranslation(0, -(1 - easeOut(kb)) * BOARD_HEIGHT, 0)).multiply(r.makeRotationZ(wobble(kb, 0.03)))
      .multiply(t.makeTranslation(-BOARD_CELLS.pivot[0] * CELL, 0, -BOARD_CELLS.pivot[2] * CELL));
    pool(board.decree ? parts.decree : parts.board, 2).push(part, clamp01(kb * 4));
    counts.board = 1; counts.choices = n;
    dust(kb, atMs);
    const arrival = smoothstep(CLIMB_FROM, CLIMB_FROM + TOWN_BEAT.board.climb, board.t);
    for (let i = 0; i < n; i++) drawPole(board, board.choices[i]!, i, n, raised, arrival, atMs);
    if (raised > 0.05) { local(0, POLE_HEIGHT + 0.6, DECREE_PLACE.depth * 0.5, caption); captionShown = true; }
  }

  function drawPole(board: BoardFrame, choice: BoardChoiceFrame, i: number, n: number, raised: number, arrival: number, atMs: number): void {
    const P = DECREE_PLACE, off = i - (n - 1) / 2, u = off / 2;
    const x = off * P.spacing + P.shift, z = P.depth + P.arc * u * u;
    const k = clamp01((raised - 0.05 * (i + 1)) / 0.75), fade = clamp01(k * 4);
    if (fade <= 0.01) return;
    const lift = -(1 - easeOut(k)) * POLE_HEIGHT;
    pole.copy(site.basis).multiply(t.makeTranslation(x, lift, z)).multiply(r.makeRotationZ(wobble(k, i % 2 ? -0.05 : 0.05)));
    pool(parts.pole, TOWN_LIMITS.choices).push(m.copy(pole).multiply(t.makeTranslation(-POLE_CELLS.pivot[0] * CELL, 0, -POLE_CELLS.pivot[2] * CELL)), fade);

    const { level, droop, calm, snap } = pennantPose(board, choice, arrival);
    const [lo, hi] = POLE_CELLS.travel, rows = PENNANT_CELLS.rows, length = PENNANT_CELLS.length;
    // Pennants ride at the foot of their travel while the poles come up and go down.
    const top = lo + (hi - lo) * level * smoothstep(0.82, 1, k);
    const rings = pool(parts.ring, TOWN_LIMITS.choices * 2), [rx, , rz] = RING_CELLS.pivot;
    for (let k = 0; k < 2; k++) rings.push(m.copy(pole).multiply(t.makeTranslation(-rx * CELL, (k ? top - rows - 1 : top) * CELL, -rz * CELL)), fade);
    // The halyard, made fast at the cleat, runs up beside the shaft into the lower traveller.
    const cleat = POLE_CELLS.cleat, hoisted = top - rows - 1 - cleat;
    if (hoisted > 0) dye(MAT.cream).push(m.copy(pole).multiply(t.makeTranslation(1.4 * CELL, cleat * CELL, -0.2 * CELL)).multiply(r.makeScale(0.4, hoisted, 0.4)), fade);

    // The cloth, column by column: a ripple running out to the tails, a snap when it wins, a droop when it loses.
    const phase = i * 1.7 + 0.4, stretch = 1 + 0.12 * snap, amp = 0.05 * calm * (1 + 2.4 * snap);
    cloth.copy(pole).multiply(t.makeTranslation(CELL, top * CELL, 0)).multiply(r.makeRotationZ(-droop));
    const cols = columns[choice.colour] ?? columns.gold;
    for (let c = 0; c < length; c++) {
      const reachOut = c === 0 ? 0 : (c / (length - 1)) ** 1.25;
      const wave = Math.sin(atMs * 0.0047 + phase - c * 0.8) + 0.35 * Math.sin(atMs * 0.0113 + phase * 1.3 - c * 1.4);
      const zc = amp * reachOut * wave, yc = 0.012 * reachOut * Math.cos(atMs * 0.0047 + phase - c * 0.8);
      const x0 = c === 0 ? 0 : CELL * (1 + (c - 1) * stretch), sx = c === 0 ? 1 : stretch;
      for (const run of cols[c]!) {
        m.copy(cloth).multiply(t.makeTranslation(x0, -run.r1 * CELL + yc, zc - 0.5 * CELL)).multiply(r.makeScale(sx, run.r1 - run.r0, 1));
        dye(run.material).push(m, fade);
        counts.pennants++;
      }
    }
    // The choice's label hangs under the middle of its pennant, a little forward of the cloth.
    const spot = choiceSpots[i]!;
    local(x + 0.55, lift + (top - rows) * CELL - 0.24, z + 0.25, spot);
    shown.push(spot);

    const d = board.decidedT;
    if (board.phase === 'decided' && choice.winner && d !== null) flourish(choice.colour, d, x, lift, z, top);
  }

  /** The winner tops its pole: the gilt finial glints, and a burst of motes in its dyes and gold leaves the cloth. */
  function flourish(colour: TownColour, d: number, x: number, lift: number, z: number, top: number): void {
    const [g0, g1, g2, g3] = DECREE_BEAT.glint;
    const glint = smoothstep(g0, g1, d) * (1 - smoothstep(g2, g3, d));
    if (glint > 0.01) {
      local(x, lift + POLE_CELLS.finial[1] * CELL, z, p);
      for (let arm = 0; arm < 2; arm++) {
        turn.setFromAxisAngle(o.set(0, 0, 1), d * 0.0012 + arm * Math.PI / 2);
        q.copy(site.rotation).multiply(turn);
        cores.push(m.compose(p, q, s3.set(1.1 * glint, 0.05, 0.05)), GILT, 2.6 * glint);
      }
      glows.push(m.makeScale(2.2, 2.2, 2.2).setPosition(p), GILT_GLOW, 0.8 * glint);
    }
    const age = (d - DECREE_BEAT.snap) / 1000;
    if (age < 0 || age * 1000 > DECREE_BEAT.motes) return;
    const dyes = TOWN_DYES[colour], ox = x + CELL + 3.5 * CELL, oy = lift + (top - 3) * CELL;
    for (let k = 0; k < DECREE_LIMITS.motes; k++) {
      const life = 1.3 + 0.7 * hash01(k, 2);
      if (age > life) continue;
      const a = hash01(k, 3) * TAU, speed = 1.1 + 1.6 * hash01(k, 4);
      const vx = Math.cos(a) * speed + 0.4, vy = 1.5 + Math.sin(a) * speed * 0.7, vz = (hash01(k, 5) - 0.5) * 1.6;
      local(ox + vx * age, oy + vy * age - 2.1 * age * age, z + vz * age, p);
      const size = 0.85 * (1 - (age / life) ** 2);
      e.set(age * 6 + k, age * 4 + k * 0.7, 0);
      q.copy(site.rotation).multiply(turn.setFromEuler(e));
      m.compose(p, q, s3.setScalar(size)).multiply(t.makeTranslation(-0.5 * CELL, -0.5 * CELL, -0.5 * CELL));
      dye(k % 3 === 0 ? dyes.field : k % 3 === 1 ? dyes.trim : MAT.goldLeaf).push(m, 1 - smoothstep(life * 0.75, life, age));
      counts.motes++;
    }
  }

  /** Stone dust puffs round the board's foot while it comes up out of the ground or goes back down. */
  function dust(kb: number, atMs: number): void {
    const envelope = kb > 0.001 && kb < 0.999 ? Math.sin(Math.PI * kb) ** 0.7 : 0;
    if (envelope < 0.03) return;
    for (let k = 0; k < DECREE_LIMITS.dust; k++) {
      const a = (k / DECREE_LIMITS.dust) * TAU + hash01(k, 7) * 0.3, phase = (atMs / 700 + hash01(k, 9)) % 1;
      local(Math.cos(a) * (1.7 + 0.6 * phase), 0.04 + 0.35 * Math.sin(Math.PI * phase), Math.sin(a) * (0.75 + 0.4 * phase) - 0.1, p);
      e.set(phase * 3 + k, phase * 2, 0);
      m.compose(p, q.setFromEuler(e), s3.setScalar(0.9 * (1 - phase) * envelope)).multiply(t.makeTranslation(-0.5 * CELL, -0.5 * CELL, -0.5 * CELL));
      dye(MAT.limestone).push(m, 1);
      counts.motes++;
    }
  }

  // ---------------------------------------------------------------- lifecycle

  function reset(): void {
    for (const found of pools.values()) found.count = 0;
    cores.count = 0; glows.count = 0;
    counts.board = 0; counts.choices = 0; counts.pennants = 0; counts.flags = 0; counts.cords = 0; counts.lanterns = 0; counts.motes = 0; counts.lights = 0;
    shown.length = 0; captionShown = false; warmth = 0;
  }

  return {
    blueprints: () => [...decreeParts(kit), parts.cord],
    apply(frame: TownFrame, atMs: number): void {
      reset();
      const runs = host.places.bunting(), key = keyOf(runs);
      placeBoard(runs, key);
      currentBunting(runs, key);
      const board = frame.board && site.ok && frame.board.raised > 0.002 ? frame.board : null;
      drawBunting(frame, atMs, board ? clamp01(board.raised) : 0);
      if (board) drawBoard(board, atMs);
      for (const found of pools.values()) found.flush();
      cores.flush(); glows.flush();
      counts.lights = cores.count + glows.count;
      if (warmth !== skyGlow.strength) skyGlow = { colour: WARM, strength: warmth };
      for (const colour of TOWN_COLOURS) for (const flag of parts.flags[colour]) counts.flags += pools.get(flag.id)?.count ?? 0;
      layer.updateWorldMatrix(true, false);
      if (captionShown) layer.localToWorld(caption);
      for (const spot of shown) layer.localToWorld(spot);
    },
    stats: () => ({ ...counts }),
    captionPoint: () => (captionShown ? caption : null),
    choicePoints: () => shown,
    stand: () => {
      if (!captionShown || !site.ok) return null;
      layer.updateWorldMatrix(true, false);
      const origin = layer.localToWorld(site.origin.clone());
      const facing = new THREE.Vector3().setFromMatrixColumn(site.basis, 2).transformDirection(layer.matrixWorld).setY(0).normalize();
      const right = new THREE.Vector3().setFromMatrixColumn(site.basis, 0).transformDirection(layer.matrixWorld).setY(0).normalize();
      return { origin, facing, right };
    },
    glow: () => skyGlow,
    dispose(): void {
      for (const found of pools.values()) found.dispose();
      pools.clear();
      cores.dispose(); glows.dispose();
      shown.length = 0; captionShown = false;
      root.remove(layer);
    },
  };
}
