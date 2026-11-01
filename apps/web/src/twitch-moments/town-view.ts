import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { CELL } from './banner';
import { breeze } from './choreography';
import type { DoorAnchor } from './gift-view';
import { BRAZIER_CELLS, GATE_CELLS, brazierBlueprint, gatePoleBlueprint } from './raid-art';
import { hash01, type SpectacleLayer } from './spectacle';
import {
  BEACON_CELLS, CROWN_PARTS, SAPLING_CELLS, STANDARD_CELLS, TAG_CELLS, TREE_CELLS, beaconBlueprint, crumbBlueprint, dyeCellBlueprint, saplingLeafBlueprint,
  saplingSoilBlueprint, saplingStemBlueprint, saplingTuftBlueprint, standardRuns, TAG_VARIANTS, tagBlueprint, tagPegBlueprint, tagVariant, townParts,
  treeCrownBlueprint, treeSoilBlueprint, treeTrunkBlueprint, type DyeRun,
} from './town-art';
import { TOWN_BEAT, TOWN_DYES, TOWN_LIMITS, smoothstep, type BellFrame, type GateFrame, type PlantingFrame, type RelightFrame, type TownColour, type TownFrame, type TownLayerHost } from './town';
import { Pool } from './train-view';
import type { SkyGlow } from './view';

/**
 * The town as Twitch shapes it: the grove by the doors, the relight when someone comes home, the night opening at
 * the gate, and the bell from the castle. Every piece is instanced from parts prepared up front and posed from the
 * frame alone; nothing here invents a home, a window or a place the host did not supply.
 *
 * Placement, from the host's own anchors:
 * - A follower's sapling stands 1.5 m to the door's right and 0.4 m off the wall (the doorstep is 0.375 m out), off
 *   the path and out of the doorway; its tag stands on its peg on the far side, facing the street.
 * - A planted tree stands out on the plot on the door's other side, 3 m along the wall and 2.1 m off it, so its
 *   1.45 m crown clears the house and the door. Each tree turns by its home, and flowers rose or cream by its home.
 * - The night's gate stands outside the Raid Gate's: the raid's braziers flank the road 2 m out and 1.2 m in, its
 *   standard 2.4 m to the right; the night's braziers stand 3.2 m out just outside the gate line and its standard
 *   3.4 m to the left and 1.3 m in, so the two gates can burn together as one avenue of four fires and two colours.
 *
 * Cost: the standing grove (restored plantings) is written once and kept until the set of plantings changes; only
 * plantings that are growing, the relights, the gate's fire and the bell are posed every frame. About 30 draw calls
 * at most, all instanced, bounded by TOWN_LIMITS and TOWN_VIEW_LIMITS.
 */

/** Hard caps for one view: lit cores, glows, light pools, window panes, rings, earth crumbs and standard runs. */
export const TOWN_VIEW_LIMITS = { cores: 256, glows: 64, pools: 48, panes: 32, rings: 8, crumbs: 96, dye: 160, growing: 16 } as const;

/** Where each planting stands from its doorstep, metres: along the door's right (`aside`) and out from it (`out`). */
export const PLANTING_SPOT = { sapling: { aside: 1.5, out: 0.02 }, tree: { aside: -3, out: 1.7 } } as const;
/** A tree whose usual spot would put its crown on the window stands out in the front garden, just off the path. */
export const TREE_GARDEN = { aside: -2.3, out: 3.8 } as const;
/** The night's gate, metres from the gate point: across the road (`aside`, + is the raid standard's side) and in. */
export const NIGHT_GATE = { brazierAside: 3.2, brazierIn: -0.5, poleAside: -5.4, poleIn: 1.3 } as const;

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
/** A toy's settle: past the mark by a hair, then home. */
const backOut = (u: number) => { const k = clamp01(u) - 1, c = 1.25; return 1 + (c + 1) * k * k * k + c * k * k; };

/** A doorstep as the grove uses it: a proper right-handed frame (x across the wall, n out of it) and the host's right. */
export interface Doorway {
  readonly at: THREE.Vector3; readonly x: THREE.Vector3; readonly n: THREE.Vector3; readonly sign: 1 | -1;
  /** Where this home's tree stands (the units of `PLANTING_SPOT.tree`), its crown clear of the window. */
  readonly tree: { readonly aside: number; readonly out: number };
}

/** A window as the grove sees it, for keeping the tree's crown off the glass. */
type WindowLike = { readonly centre: Vec3; readonly normal: Vec3; readonly width: number };

export function doorwayOf(anchor: DoorAnchor, window: WindowLike | null = null): Doorway | null {
  const n = new THREE.Vector3(anchor.normal[0], 0, anchor.normal[2]);
  if (n.lengthSq() < 1e-8) return null;
  n.normalize();
  const x = new THREE.Vector3().crossVectors(UP, n).normalize();
  const at = v3(anchor.doorstep), sign: 1 | -1 = x.x * anchor.right[0] + x.z * anchor.right[2] < 0 ? -1 : 1;
  return { at, x, n, sign, tree: treeSpotOf(at, x, n, sign, window) };
}

/**
 * Beside the door, unless its crown (1.45 m reach) would cover the window on the door's wall: then out in the front
 * garden, just off the path on the same side. It never steps further along the wall, where homes stand close enough
 * that a tree there reads as the neighbour's. A window on another wall, or none, keeps the usual spot.
 */
function treeSpotOf(at: THREE.Vector3, x: THREE.Vector3, n: THREE.Vector3, sign: 1 | -1, window: WindowLike | null): Doorway['tree'] {
  const usual = PLANTING_SPOT.tree;
  if (!window) return usual;
  const dx = window.centre[0] - at.x, dz = window.centre[2] - at.z;
  const facing = window.normal[0] * n.x + window.normal[2] * n.z;
  if (facing < 0.7 || Math.abs(dx * n.x + dz * n.z) > 1.5) return usual;
  const u = dx * x.x + dz * x.z, clear = window.width / 2 + TREE_CELLS.reach + 0.1;
  return Math.abs(sign * usual.aside - u) >= clear ? usual : TREE_GARDEN;
}

/** The ground point a planting stands on, beside its door. */
export function plantingSpot(door: Doorway, kind: PlantingFrame['kind'], out = new THREE.Vector3()): THREE.Vector3 {
  const spot = kind === 'tree' ? door.tree : PLANTING_SPOT[kind];
  return out.copy(door.at).addScaledVector(door.x, door.sign * spot.aside).addScaledVector(door.n, spot.out);
}

// ---------------------------------------------------------------- light

/**
 * Soft additive light, unfogged and untoned so it feeds the bloom: a round glow facing the camera, a pool lying on
 * the ground, a soft pane laid on a window's glass, or a ring of sound facing the camera (the silhouette of a
 * spreading sphere: a bright rim over a faint fill).
 */
const lightVertex = /* glsl */ `
  varying vec2 vSpot;
  varying vec3 vColour;
  void main() {
    #ifdef USE_INSTANCING_COLOR
      vColour = instanceColor;
    #else
      vColour = vec3(1.0);
    #endif
    #ifdef BILLBOARD
      vSpot = position.xy * 2.0;
      vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      gl_Position = projectionMatrix * (centre + vec4(position.xy * length(instanceMatrix[0].xyz), 0.0, 0.0));
    #else
      #ifdef FLAT
        vSpot = position.xz * 2.0;
      #else
        vSpot = position.xy * 2.0;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #endif
  }
`;
const lightFragment = /* glsl */ `
  varying vec2 vSpot;
  varying vec3 vColour;
  void main() {
    #ifdef PANE
      vec2 a = abs(vSpot);
      float k = (1.0 - smoothstep(0.6, 1.0, a.x)) * (1.0 - smoothstep(0.55, 1.0, a.y)) * (0.82 + 0.18 * (1.0 - a.y));
    #else
      float r = length(vSpot);
      if (r >= 1.0) discard;
      #ifdef RING
        float k = exp(-pow((r - 0.84) / 0.06, 2.0)) + 0.14 * pow(min(r / 0.84, 1.0), 6.0) * step(r, 0.84);
      #else
        float fall = 1.0 - r;
        float k = fall * fall * (0.55 + 0.45 * fall);
      #endif
    #endif
    gl_FragColor = vec4(vColour * k, 1.0);
    #include <colorspace_fragment>
  }
`;

type LightShape = 'glow' | 'pool' | 'pane' | 'ring';
class Lights {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Color();
  count = 0;
  constructor(parent: THREE.Group, readonly capacity: number, shape: LightShape, name: string) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    if (shape === 'pool') geometry.rotateX(-Math.PI / 2);
    const defines: Record<string, string> = shape === 'pool' ? { FLAT: '' } : shape === 'pane' ? { PANE: '' } : shape === 'ring' ? { BILLBOARD: '', RING: '' } : { BILLBOARD: '' };
    this.material = new THREE.ShaderMaterial({ vertexShader: lightVertex, fragmentShader: lightFragment, defines,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = name;
    this.mesh.renderOrder = { pool: 1, pane: 2, glow: 3, ring: 4 }[shape];
    parent.add(this.mesh);
  }
  /** A light `size` metres across at `at`, in `colour` times `strength`. */
  at(at: THREE.Vector3, size: number, colour: THREE.Color, strength: number): void {
    if (size <= 0) return;
    this.put(this.matrix.makeScale(size, size, size).setPosition(at), colour, strength);
  }
  put(matrix: THREE.Matrix4, colour: THREE.Color, strength: number): void {
    if (this.count >= this.capacity || strength <= 0.004) return;
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count, this.scratch.copy(colour).multiplyScalar(strength));
    this.count++;
  }
  flush(): void {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    if (this.count > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.dispose(); this.material.dispose(); }
}

/** Flames, sparks and motes: small cubes of plain HDR light, coloured per instance. */
class Cores {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private readonly matrix = new THREE.Matrix4();
  private readonly turn = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly scratch = new THREE.Color();
  count = 0;
  constructor(parent: THREE.Group, readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = 'town-flames';
    parent.add(this.mesh);
  }
  push(at: THREE.Vector3, size: number, yaw: number, colour: THREE.Color, strength: number): void {
    if (this.count >= this.capacity || size <= 0.004 || strength <= 0.01) return;
    this.mesh.setMatrixAt(this.count, this.matrix.compose(at, this.turn.setFromAxisAngle(UP, yaw), this.scale.setScalar(size)));
    this.mesh.setColorAt(this.count, this.scratch.copy(colour).multiplyScalar(strength));
    this.count++;
  }
  flush(): void {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    if (this.count > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); }
}

/** A fire, bottom to tip: size and height over the coals (both metres at scale 1), and colour. */
const TONGUES = [[0.4, 0.12, '#ff7a2a'], [0.31, 0.36, '#ffa645'], [0.22, 0.6, '#ffd078'], [0.13, 0.82, '#ffe7b0'], [0.08, 1.02, '#ff9a3a']] as const;
const TONGUE_COLOURS = TONGUES.map(([, , c]) => new THREE.Color(c));
const FIRE_GLOW = new THREE.Color('#ff8d40'), FIRE_POOL = new THREE.Color('#ff8436'), EMBER = new THREE.Color('#ffb25a'), SPARK = new THREE.Color('#ffd58a');
/** A window coming home: the pane's warm white, its halo, the spill on the street and the motes it lets go. */
const PANE = new THREE.Color('#ffd496'), WINDOW_GLOW = new THREE.Color('#ffaa58'), WINDOW_POOL = new THREE.Color('#ff9a48'), MOTE = new THREE.Color('#ffd27e');
/** The bell: warm gold rings and the glint on the crown at each stroke. */
const RING = new THREE.Color('#ffe0a0'), BELL_GLOW = new THREE.Color('#ffc570');
const WARM: readonly [number, number, number] = [1, 0.64, 0.34];
const NO_GLOW: SkyGlow = { colour: [0, 0, 0], strength: 0 };
const EMBERS = 6;

/** A home's presence window, as the relight draws on it. */
interface Pane { readonly centre: THREE.Vector3; readonly n: THREE.Vector3; readonly x: THREE.Vector3; readonly width: number; readonly height: number; readonly ground: number }

const REFRESH_MS = 20_000, RETRY_MS = 4000;

export type TownLayer = SpectacleLayer<TownFrame> & { glow(): SkyGlow };

export function createTownLayer(root: THREE.Group, host: TownLayerHost): TownLayer {
  const layer = new THREE.Group();
  layer.name = 'town';
  root.add(layer);
  /** The grove's parts (kept between frames while the standing grove is unchanged), and the per-frame parts. */
  const grove = new Map<string, Pool>(), parts = new Map<string, Pool>(), kept = new Map<Pool, number>();
  const cores = new Cores(layer, TOWN_VIEW_LIMITS.cores);
  const glows = new Lights(layer, TOWN_VIEW_LIMITS.glows, 'glow', 'town-glows');
  const pools = new Lights(layer, TOWN_VIEW_LIMITS.pools, 'pool', 'town-light-pools');
  const panes = new Lights(layer, TOWN_VIEW_LIMITS.panes, 'pane', 'town-panes');
  const rings = new Lights(layer, TOWN_VIEW_LIMITS.rings, 'ring', 'town-bell-rings');
  const kit = host.kit;

  // Supplied anchors, cached; a miss is asked again after a while, and everything is asked again now and then so a
  // home that grows on its plot carries its planting along.
  const doors = new Map<number, Doorway | null>(), windows = new Map<number, Pane | null>(), answering = new Map<number, readonly number[]>();
  const missed = new Map<number, number>();
  let refreshedAt = -Infinity, epoch = 0;
  let standingKey = NaN, standingAt = -Infinity, wasGrowing = false, keptCounts = { plantings: 0, saplings: 0, trees: 0 };
  const standards = new Map<TownColour, DyeRun[][]>();
  let glowSum = [0, 0, 0], glowStrength = 0, lastGlow: SkyGlow = NO_GLOW;
  let counts = { plantings: 0, saplings: 0, trees: 0, growing: 0, relights: 0, answers: 0, gate: 0, beacon: 0, bell: 0 };

  const m = new THREE.Matrix4(), t = new THREE.Matrix4(), r = new THREE.Matrix4(), s = new THREE.Matrix4(), base = new THREE.Matrix4(), turn = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), point = new THREE.Vector3(), spot = new THREE.Vector3();
  const cellT = (x: number, y: number, z: number) => t.makeTranslation(x * CELL, y * CELL, z * CELL);

  function pool(map: Map<string, Pool>, blueprint: VoxelBlueprint, capacity: number): Pool {
    let found = map.get(blueprint.id);
    if (!found) {
      found = new Pool(host.mesh(blueprint, new THREE.Vector3()).geometry, host.material, capacity, layer, blueprint.id);
      map.set(blueprint.id, found);
    }
    return found;
  }
  // Blueprints are built once; the pools only need their ids after the first frame.
  const P = {
    soil: saplingSoilBlueprint(kit), stem: saplingStemBlueprint(kit), leaf: saplingLeafBlueprint(kit), tuft: saplingTuftBlueprint(kit), crumb: crumbBlueprint(kit),
    peg: tagPegBlueprint(kit), tags: { blank: tagBlueprint(kit, 'blank'), short: tagBlueprint(kit, 'short'), mid: tagBlueprint(kit, 'mid'), long: tagBlueprint(kit, 'long') },
    treeSoil: treeSoilBlueprint(kit), trunk: treeTrunkBlueprint(kit),
    hearts: { rose: treeCrownBlueprint(kit, 'heart', 'rose'), cream: treeCrownBlueprint(kit, 'heart', 'cream') },
    east: treeCrownBlueprint(kit, 'east'), west: treeCrownBlueprint(kit, 'west'),
    beacon: beaconBlueprint(kit), brazier: brazierBlueprint(kit), pole: gatePoleBlueprint(kit),
  };
  const dyes = new Map<number, VoxelBlueprint>();
  const dye = (material: number) => {
    let found = dyes.get(material);
    if (!found) { found = dyeCellBlueprint(kit, material); dyes.set(material, found); }
    return pool(parts, found, TOWN_VIEW_LIMITS.dye);
  };
  const N = TOWN_LIMITS.plantings;

  // ---------------------------------------------------------------- anchors

  function doorway(slot: number, atMs: number): Doorway | null {
    const known = doors.get(slot);
    if (known) return known;
    if (known === null && atMs - (missed.get(slot) ?? -Infinity) < RETRY_MS) return null;
    const anchor = host.door(slot), made = anchor ? doorwayOf(anchor, host.window(slot)) : null;
    doors.set(slot, made);
    if (made) { missed.delete(slot); epoch++; } else missed.set(slot, atMs);
    return made;
  }

  function paneOf(slot: number, atMs: number): Pane | null {
    if (windows.has(slot)) return windows.get(slot)!;
    const anchor = host.window(slot);
    let pane: Pane | null = null;
    if (anchor) {
      const n = new THREE.Vector3(anchor.normal[0], 0, anchor.normal[2]);
      if (n.lengthSq() > 1e-8) {
        n.normalize();
        const centre = v3(anchor.centre), door = doorway(slot, atMs);
        pane = { centre, n, x: new THREE.Vector3().crossVectors(UP, n).normalize(), width: anchor.width, height: anchor.height,
          ground: door ? Math.min(door.at.y, centre.y - 0.3) : centre.y - 1.4 };
      }
    }
    windows.set(slot, pane);
    return pane;
  }

  /**
   * The homes that answer a homecoming: the 2–4 nearest homes with a window (by window, on the ground plane, within
   * 45 m), nearest first. How many answer is fixed by the home, so a relight always looks the same.
   */
  function answersOf(slot: number, atMs: number): readonly number[] {
    const known = answering.get(slot);
    if (known) return known;
    const own = paneOf(slot, atMs);
    let found: number[] = [];
    if (own) {
      const near: [number, number][] = [];
      for (const other of host.places.homes()) {
        if (other === slot) continue;
        const pane = paneOf(other, atMs);
        if (!pane) continue;
        const d = Math.hypot(pane.centre.x - own.centre.x, pane.centre.z - own.centre.z);
        if (d <= 45) near.push([other, d]);
      }
      near.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      const many = Math.min(TOWN_LIMITS.answers, 2 + Math.floor(hash01(slot, 23) * 3));
      found = near.slice(0, many).map(([other]) => other);
    }
    answering.set(slot, found);
    return found;
  }

  // ---------------------------------------------------------------- the grove

  function soilBurst(p: PlantingFrame, from: number, reach: number): void {
    if (p.t === null) return;
    const age = p.t - from;
    if (age < 0 || age > 1700) return;
    const crumbs = pool(grove, P.crumb, TOWN_VIEW_LIMITS.crumbs), shrink = 1 - smoothstep(1000, 1700, age);
    for (let i = 0; i < 7; i++) {
      const k = clamp01((age - i * 30) / 680);
      if (k <= 0) continue;
      const angle = hash01(p.slot, 30 + i) * TAU, far = reach * (0.45 + 0.55 * hash01(p.slot, 40 + i)), rise = 0.2 + 0.28 * hash01(p.slot, 50 + i);
      m.copy(base).multiply(t.makeTranslation(Math.cos(angle) * far * k, CELL * 0.5 + rise * 4 * k * (1 - k), Math.sin(angle) * far * k))
        .multiply(r.makeRotationY(angle)).multiply(s.makeRotationX(k * 3.1)).multiply(turn.makeScale(0.9 * shrink, 0.9 * shrink, 0.9 * shrink)).multiply(cellT(-0.5, -0.5, -0.5));
      if (shrink > 0.05) crumbs.push(m, 1);
    }
  }

  /** The peg and its tag at `x`, `z` metres in the planting's frame (it faces the street, never turned with the plant). */
  function nameTag(p: PlantingFrame, x: number, z: number, from: number): void {
    const up = p.t === null ? 1 : backOut(smoothstep(from - 380, from + 40, p.t));
    if (up <= 0.02) return;
    const peg = TAG_CELLS.peg, tag = TAG_CELLS.tag;
    m.copy(base).multiply(t.makeTranslation(x, 0, z)).multiply(s.makeScale(1, up, 1)).multiply(cellT(-peg.pivot[0], 0, -peg.pivot[2]));
    pool(grove, P.peg, 2 * N).push(m, 1);
    m.copy(base).multiply(t.makeTranslation(x, 0, z)).multiply(cellT(peg.nail[0] - peg.pivot[0], peg.nail[1] * up, peg.nail[2] - peg.pivot[2]))
      .multiply(r.makeRotationZ(p.tag)).multiply(s.makeScale(up, up, up)).multiply(cellT(-tag.hang[0], -tag.hang[1], -tag.hang[2]));
    pool(grove, P.tags[tagVariant(p.name)], 2 * N).push(m, 1);
  }

  function sapling(p: PlantingFrame, yaw: number, atMs: number): void {
    const beat = TOWN_BEAT.sapling, g = clamp01(p.grow), live = p.t !== null;
    const soil = live ? backOut(smoothstep(beat.soil[0], beat.soil[1], p.t!)) : 1;
    const stem = Math.max(0.04, smoothstep(0, 0.55, g)), tuft = backOut(smoothstep(0.3, 0.8, g)), leaf = smoothstep(0.35, 0.7, g), open = backOut(smoothstep(0.55, 1, g));
    // While it grows it stirs; once grown it stands still with the rest of the grove.
    const stir = live ? (Math.sin(atMs * 0.0042 + p.slot) * 0.05 + breeze(atMs, p.slot) * 0.025) * (1 - 0.7 * smoothstep(0.8, 1, g)) : 0;
    if (soil > 0.02) {
      const { pivot } = SAPLING_CELLS.soil, xz = 0.7 + 0.3 * soil;
      m.copy(base).multiply(s.makeScale(xz, soil, xz)).multiply(cellT(-pivot[0], -pivot[1], -pivot[2]));
      pool(grove, P.soil, N).push(m, 1);
    }
    if (live) soilBurst(p, beat.soil[0], 0.5);
    if (g <= 0.005) return;
    const rise = SAPLING_CELLS.stem.height * CELL * stem;
    m.copy(base).multiply(r.makeRotationY(yaw)).multiply(s.makeRotationZ(stir * 0.5)).multiply(turn.makeScale(1, stem, 1)).multiply(cellT(-0.5, 0, -0.5));
    pool(grove, P.stem, N).push(m, 1);
    if (leaf > 0.02) for (const [height, around] of SAPLING_CELLS.sprigs) {
      const lift = 1.35 + (0.32 - 1.35) * open + stir;
      m.copy(base).multiply(r.makeRotationY(yaw + around)).multiply(t.makeTranslation(0.5 * CELL, height * CELL * stem, 0)).multiply(s.makeRotationZ(lift))
        .multiply(turn.makeScale(leaf, leaf, leaf)).multiply(cellT(-SAPLING_CELLS.leaf.pivot[0], -SAPLING_CELLS.leaf.pivot[1], -SAPLING_CELLS.leaf.pivot[2]));
      pool(grove, P.leaf, 3 * N).push(m, 1);
    }
    if (tuft > 0.02) {
      const { pivot } = SAPLING_CELLS.tuft;
      m.copy(base).multiply(r.makeRotationY(yaw)).multiply(s.makeRotationZ(stir)).multiply(t.makeTranslation(0, rise, 0)).multiply(turn.makeScale(tuft, tuft, tuft))
        .multiply(cellT(-pivot[0], 0, -pivot[2]));
      pool(grove, P.tuft, N).push(m, 1);
    }
  }

  function tree(p: PlantingFrame, yaw: number, atMs: number): void {
    const beat = TOWN_BEAT.tree, g = clamp01(p.grow), live = p.t !== null;
    const soil = live ? backOut(smoothstep(beat.soil[0], beat.soil[1], p.t!)) : 1;
    if (soil > 0.02) {
      const { pivot } = TREE_CELLS.soil, xz = 0.7 + 0.3 * soil;
      m.copy(base).multiply(r.makeRotationY(yaw)).multiply(s.makeScale(xz, soil, xz)).multiply(cellT(-pivot[0], -pivot[1], -pivot[2]));
      pool(grove, P.treeSoil, N).push(m, 1);
    }
    if (live) soilBurst(p, beat.soil[0], 0.8);
    if (g <= 0.005) return;
    // The bole rises first and thickens as it goes; the crown opens from the fork, heart first, then each side.
    const high = 0.12 + 0.88 * easeOut(smoothstep(0, 0.65, g)), thick = 0.45 + 0.55 * smoothstep(0.05, 0.85, g);
    const { pivot } = TREE_CELLS.trunk;
    m.copy(base).multiply(r.makeRotationY(yaw)).multiply(s.makeScale(thick, high, thick)).multiply(cellT(-pivot[0], 0, -pivot[2]));
    pool(grove, P.trunk, N).push(m, 1);
    const sway = live ? breeze(atMs, p.slot) * 0.018 + Math.sin(atMs * 0.0035 + p.slot) * 0.03 * (1 - smoothstep(0.85, 1, g)) : 0;
    const seat = TREE_CELLS.seat * CELL * high, c = TREE_CELLS.crown.pivot;
    const blossom = hash01(p.slot, 17) < 0.5 ? 'rose' : 'cream';
    for (const part of CROWN_PARTS) {
      const [from, to] = part === 'heart' ? [0.28, 0.78] : part === 'east' ? [0.4, 0.88] : [0.48, 0.96];
      const k = backOut(smoothstep(from, to, g));
      if (k <= 0.02) continue;
      m.copy(base).multiply(r.makeRotationY(yaw)).multiply(t.makeTranslation(0, seat, 0)).multiply(s.makeRotationZ(sway)).multiply(turn.makeScale(k, k, k))
        .multiply(cellT(-c[0], 0, -c[2]));
      pool(grove, part === 'heart' ? P.hearts[blossom] : part === 'east' ? P.east : P.west, N).push(m, 1);
    }
  }

  /** Draw one planting; false when its home has no supplied doorstep. */
  function plant(p: PlantingFrame, atMs: number): boolean {
    const door = doorway(p.slot, atMs);
    if (!door) return false;
    base.makeBasis(door.x, UP, door.n).setPosition(plantingSpot(door, p.kind, spot));
    const yaw = hash01(p.slot, p.kind === 'tree' ? 11 : 5) * TAU;
    if (p.kind === 'tree') {
      tree(p, yaw, atMs);
      // The tag hangs on the trunk's door side, facing the street.
      nameTag(p, -door.sign * Math.sign(door.tree.aside) * 0.62, 0.62, TOWN_BEAT.tree.tag[0]);
      counts.trees++;
    } else {
      sapling(p, yaw, atMs);
      nameTag(p, door.sign * 0.34, 0.3, TOWN_BEAT.sapling.tag[0]);
      counts.saplings++;
    }
    counts.plantings++;
    if (p.t !== null) counts.growing++;
    return true;
  }

  function drawGrove(plantings: readonly PlantingFrame[], atMs: number): void {
    // The standing grove's identity: which homes, which kind, which tag, and how fully grown.
    let key = epoch | 0, standing = 0, growing = 0;
    for (const p of plantings) {
      if (p.t !== null) { growing++; continue; }
      standing++;
      key = Math.imul(key ^ p.slot, 0x01000193) ^ (p.kind === 'tree' ? 0x9e37 : 0x79b9);
      key = Math.imul(key ^ (TAG_VARIANTS.indexOf(tagVariant(p.name)) * 131 + Math.round(clamp01(p.grow) * 64)), 0x01000193);
    }
    key = Math.imul(key ^ standing, 0x01000193);
    // Homes still without a doorstep are asked again every few seconds, which may change the grove.
    const rebuild = key !== standingKey || (missed.size > 0 && atMs - standingAt > RETRY_MS);
    let drawn = 0;
    if (rebuild) {
      for (const instances of grove.values()) instances.count = 0;
      for (const p of plantings) if (p.t === null && drawn < N && plant(p, atMs)) drawn++;
      kept.clear();
      for (const instances of grove.values()) kept.set(instances, instances.count);
      keptCounts = { plantings: counts.plantings, saplings: counts.saplings, trees: counts.trees };
      standingKey = key; standingAt = atMs;
    } else {
      for (const instances of grove.values()) instances.count = kept.get(instances) ?? 0;
      Object.assign(counts, keptCounts);
      drawn = keptCounts.plantings;
    }
    let live = 0;
    for (const p of plantings) {
      if (p.t === null || live >= TOWN_VIEW_LIMITS.growing || drawn >= N) continue;
      if (plant(p, atMs)) { drawn++; live++; }
    }
    if (rebuild || growing > 0 || wasGrowing) for (const instances of grove.values()) instances.flush();
    wasGrowing = growing > 0;
  }

  // ---------------------------------------------------------------- light at the windows

  /** A window's flare at `strength` (0..1): its pane, halo, the spill on the street, and motes drifting up. */
  function flare(slot: number, pane: Pane, strength: number, age: number, size: number, motes: number): void {
    if (strength > 0.004) {
      m.makeBasis(pane.x, UP, pane.n).multiply(s.makeScale(pane.width + 0.16, pane.height + 0.16, 1)).setPosition(a.copy(pane.centre).addScaledVector(pane.n, 0.03));
      panes.put(m, PANE, 1.05 * strength);
      glows.at(a.copy(pane.centre).addScaledVector(pane.n, 0.4), (1.9 + 1.3 * strength) * size, WINDOW_GLOW, 0.5 * strength);
      pools.at(a.copy(pane.centre).addScaledVector(pane.n, 1.3).setY(pane.ground + 0.04), 4.4 * size, WINDOW_POOL, 0.22 * strength);
    }
    for (let i = 0; i < motes; i++) {
      const k = (age - 180 - i * 170) / 2200;
      if (k <= 0 || k >= 1) continue;
      const across = (hash01(slot, 60 + i) - 0.5) * pane.width * 1.3 + Math.sin(k * 5 + i * 1.7) * 0.09;
      point.copy(pane.centre).addScaledVector(pane.n, 0.3 + 0.5 * k).addScaledVector(pane.x, across).addScaledVector(UP, -0.1 + k * (1.7 + 0.4 * hash01(slot, 70 + i)));
      cores.push(point, 0.055 * (1 - 0.5 * k), i, MOTE, 1.9 * (1 - k) ** 1.4 * smoothstep(0, 0.08, k));
    }
  }

  function drawRelight(frame: RelightFrame, atMs: number): void {
    const own = paneOf(frame.slot, atMs);
    if (!own) return;
    counts.relights++;
    const beat = TOWN_BEAT.relight;
    flare(frame.slot, own, clamp01(frame.flare), frame.t - beat.flare[0], 1, 8);
    // The neighbours answer one after another, nearest first, each a smaller flare that settles with the rest.
    const answers = answersOf(frame.slot, atMs), [from, to] = beat.answer, fall = 1 - smoothstep(beat.settle[0], beat.settle[1], frame.t);
    answers.forEach((slot, k) => {
      const pane = paneOf(slot, atMs);
      if (!pane) return;
      const start = from + (to - from - 300) * (answers.length > 1 ? k / (answers.length - 1) : 0), age = frame.t - start;
      if (age < 0) return;
      const glow = smoothstep(0, 280, age) * (0.58 + 0.42 * Math.exp(-Math.max(0, age - 280) / 600)) * fall;
      flare(slot, pane, 0.62 * glow, age + 180, 0.65, 3);
      counts.answers++;
    });
  }

  // ---------------------------------------------------------------- fire

  function fire(coals: THREE.Vector3, scale: number, flame: number, atMs: number, seed: number, ground: THREE.Vector3 | null): void {
    if (flame <= 0.02) return;
    const f = Math.min(1.4, flame), lift = (0.65 + 0.35 * f) * scale;
    TONGUES.forEach(([size, height], k) => {
      const flicker = 1 + 0.14 * Math.sin(atMs * 0.013 + k * 1.7 + seed) + 0.06 * Math.sin(atMs * 0.031 + k * 0.9 + seed * 0.7);
      point.copy(coals).addScaledVector(UP, height * lift);
      point.x += Math.sin(atMs * 0.009 + k * 2.3 + seed) * 0.03 * scale; point.z += Math.cos(atMs * 0.007 + k * 1.1 + seed) * 0.03 * scale;
      cores.push(point, size * scale * (0.55 + 0.45 * f) * flicker, atMs * 0.0012 * (k + 1) + seed, TONGUE_COLOURS[k]!, 1.15 + 0.5 * f);
    });
    glows.at(point.copy(coals).addScaledVector(UP, 0.5 * scale), 3 * scale * (0.55 + 0.45 * f), FIRE_GLOW, 0.48 * flame);
    if (ground) pools.at(point.copy(ground).addScaledVector(UP, 0.06), 6.5 * scale, FIRE_POOL, 0.22 * f);
    if (flame < 0.4) return;
    for (let k = 0; k < EMBERS; k++) {
      const phase = (((atMs / 1000 + k * 0.29 + seed * 0.13) / 1.8) % 1 + 1) % 1;
      point.copy(coals).addScaledVector(UP, (0.3 + phase * 2.4) * scale);
      point.x += Math.sin(k * 2.1 + phase * 3 + seed) * 0.25 * scale; point.z += Math.cos(k * 1.3 + phase * 2.2 + seed) * 0.2 * scale;
      cores.push(point, 0.05 * scale * (1 - phase * 0.6), k, EMBER, 1.6 * (1 - phase) * Math.min(1, flame));
    }
  }

  /** The catch: a fistful of sparks thrown up as a fire takes, over a second. */
  function sparks(coals: THREE.Vector3, scale: number, age: number, seed: number, many: number): void {
    if (age < 0 || age > 1300) return;
    for (let i = 0; i < many; i++) {
      const k = clamp01((age - i * 22) / 1100);
      if (k <= 0 || k >= 1) continue;
      const angle = hash01(seed, 80 + i) * TAU, out = (0.3 + 0.7 * hash01(seed, 90 + i)) * scale;
      point.copy(coals).addScaledVector(UP, (0.2 + 2.6 * easeOut(k) - 0.6 * k * k) * scale);
      point.x += Math.cos(angle) * out * easeOut(k); point.z += Math.sin(angle) * out * easeOut(k);
      cores.push(point, 0.06 * scale * (1 - 0.6 * k), i, SPARK, 2.2 * (1 - k) ** 1.3);
    }
  }

  // ---------------------------------------------------------------- the night's gate and the beacon

  function standard(colour: TownColour): DyeRun[][] {
    let runs = standards.get(colour);
    if (!runs) { runs = standardRuns(colour); standards.set(colour, runs); }
    return runs;
  }

  function addGlow(strength: number): void {
    if (strength <= 0.001) return;
    glowSum = [glowSum[0]! + WARM[0] * strength, glowSum[1]! + WARM[1] * strength, glowSum[2]! + WARM[2] * strength];
    glowStrength = 1 - (1 - glowStrength) * (1 - strength);
  }

  function drawGate(gate: GateFrame, atMs: number): void {
    const beat = TOWN_BEAT.gate, live = gate.t !== null, clock = gate.t ?? Infinity;
    const anchor = host.gate();
    // The beacon is the castle's, not the gate's: it catches even where the road supplies no gate.
    drawBeacon(gate, atMs);
    if (!anchor) return;
    const facing = new THREE.Vector3(anchor.facing[0], 0, anchor.facing[2]);
    if (facing.lengthSq() < 1e-8) return;
    facing.normalize();
    const side = new THREE.Vector3().crossVectors(UP, facing).normalize(), at = v3(anchor.position);
    const basis = new THREE.Matrix4().makeBasis(side, UP, facing), fade = live ? smoothstep(0, 700, clock) : 1;
    counts.gate = 1;
    // The braziers, either side of the road just outside the gate line; the left catches first, the right answers.
    const [bx, , bz] = BRAZIER_CELLS.pivot;
    for (const sign of [-1, 1] as const) {
      const foot = new THREE.Vector3().copy(at).addScaledVector(side, NIGHT_GATE.brazierAside * sign).addScaledVector(facing, NIGHT_GATE.brazierIn);
      pool(parts, P.brazier, 2).push(m.copy(basis).setPosition(foot).multiply(cellT(-bx, 0, -bz)), fade);
      const catchAt = beat.braziers[0] + (sign < 0 ? 0 : 320);
      const flame = gate.braziers * (live && sign > 0 ? smoothstep(catchAt, catchAt + 600, clock) : 1);
      const coals = b.copy(foot).addScaledVector(UP, BRAZIER_CELLS.fire[1] * CELL);
      fire(coals, 1, flame, atMs, sign + 3, foot);
      if (live) sparks(coals, 1, clock - catchAt - 120, 7 + sign, 10);
    }
    // The standard: hoisted furled up its pole, then unrolled from under the crossbar in the town's colours.
    const [gx, , gz] = GATE_CELLS.pivot, spec = GATE_CELLS.cloth;
    const pole = basis.clone().setPosition(a.copy(at).addScaledVector(side, NIGHT_GATE.poleAside).addScaledVector(facing, NIGHT_GATE.poleIn));
    pool(parts, P.pole, 1).push(m.copy(pole).multiply(cellT(-gx, 0, -gz)), fade);
    const raised = clamp01(gate.standard), hoist = smoothstep(0, 0.6, raised), unfurl = smoothstep(0.55, 1, raised);
    const runs = standard(gate.colour), rows = STANDARD_CELLS.rows, shown = unfurl * rows, air = breeze(atMs, 401);
    // Once it is out it flies: a few decaying swings as the cloth finds the wind, then the breeze alone.
    const since = live ? clock - beat.standard[1] : Infinity, swing = since > 0 && since < 6000 ? Math.exp(-since / 1100) * Math.sin(since * 0.0062) * 0.16 : 0;
    const cloth = new THREE.Matrix4().copy(pole).multiply(cellT(spec.x - gx, spec.top, spec.z - gz));
    if (hoist >= 0.999) for (let row = 0; row < runs.length && row + 1 <= shown + 1e-3; row++) {
      const depth = (row + 1) / rows, out = 0.008 + (air * 0.035 + swing) * depth ** 1.4;
      for (const run of runs[row]!) {
        m.copy(cloth).multiply(t.makeTranslation(run.x0 * CELL, -(row + 1) * CELL, out)).multiply(s.makeScale(run.x1 - run.x0, 1, 1));
        dye(run.material).push(m, fade);
      }
    }
    if (unfurl < 0.995) {
      const top = spec.top - 2, y = hoist < 0.999 ? GATE_CELLS.rollFrom + (top - GATE_CELLS.rollFrom) * hoist : top - shown, thick = 1 - 0.55 * unfurl;
      m.copy(pole).multiply(cellT(spec.x - gx, y - 0.5 + (1 - thick), spec.z - gz - 0.5 + (1 - thick))).multiply(s.makeScale(spec.width, 2 * thick, 2 * thick));
      dye(TOWN_DYES[gate.colour].field).push(m, fade);
    }
  }

  function drawBeacon(gate: GateFrame, atMs: number): void {
    const castle = host.places.castle();
    if (!castle) return;
    const beat = TOWN_BEAT.gate, live = gate.t !== null, clock = gate.t ?? Infinity, crown = v3(castle.crown);
    const [px, , pz] = BEACON_CELLS.pivot;
    pool(parts, P.beacon, 1).push(m.makeTranslation(crown.x - px * CELL, crown.y, crown.z - pz * CELL), live ? smoothstep(0, 700, clock) : 1);
    const coals = a.copy(crown).addScaledVector(UP, BEACON_CELLS.fire[1] * CELL);
    fire(coals, 1.6, clamp01(gate.beacon) * 1.15, atMs, 11, null);
    counts.beacon = gate.beacon > 0.02 ? 1 : 0;
    if (!live) return;
    const caught = clock - beat.beacon[0] - 200;
    sparks(coals, 1.6, caught, 31, 16);
    // As it catches the whole town warms a little, then settles back to its own lights.
    if (caught > -200) {
      const flash = smoothstep(-200, 450, caught) * (1 - smoothstep(900, beat.beacon[1] - beat.beacon[0] + 2600, caught));
      glows.at(point.copy(coals).addScaledVector(UP, 1), 9 * (0.6 + 0.4 * flash), FIRE_GLOW, 0.4 * flash);
      addGlow(0.11 * flash);
    }
  }

  // ---------------------------------------------------------------- the bell

  function drawBell(bell: BellFrame): void {
    const castle = host.places.castle();
    if (!castle) return;
    const centre = a.copy(v3(castle.crown)).addScaledVector(UP, -1.2);
    let rung = false;
    for (const stroke of TOWN_BEAT.bell.strokes) {
      const age = bell.t - stroke;
      if (age < 0 || age > 2600) continue;
      rung = true;
      // Each stroke sends a ring out from the bell and a fainter echo after it, slowing and thinning as they spread.
      for (const [delay, weight] of [[0, 1], [240, 0.45]] as const) {
        const k = (age - delay) / 2600;
        if (k <= 0 || k >= 1) continue;
        const radius = 0.6 + 21 * (1 - (1 - k) ** 3);
        rings.at(centre, (2 * radius) / 0.84, RING, weight * 0.42 * (1 - k) ** 1.7 * smoothstep(0, 0.035, k));
      }
      const strike = Math.exp(-age / 320);
      glows.at(centre, 4.2, BELL_GLOW, 0.55 * strike);
      cores.push(point.copy(centre).addScaledVector(UP, 0.3), 0.16 * strike, 0, SPARK, 2 * strike);
      addGlow(0.045 * Math.exp(-age / 450));
    }
    counts.bell = rung ? 1 : 0;
  }

  return {
    blueprints: (): readonly VoxelBlueprint[] => townParts(kit),
    apply(frame: TownFrame, atMs: number): void {
      if (atMs - refreshedAt > REFRESH_MS || atMs < refreshedAt) {
        doors.clear(); windows.clear(); answering.clear(); missed.clear();
        refreshedAt = atMs; epoch++;
      }
      for (const instances of parts.values()) instances.count = 0;
      cores.count = 0; glows.count = 0; pools.count = 0; panes.count = 0; rings.count = 0;
      glowSum = [0, 0, 0]; glowStrength = 0;
      counts = { plantings: 0, saplings: 0, trees: 0, growing: 0, relights: 0, answers: 0, gate: 0, beacon: 0, bell: 0 };

      drawGrove(frame.plantings, atMs);
      for (const relight of frame.relights.slice(0, TOWN_LIMITS.relights)) drawRelight(relight, atMs);
      if (frame.gate) drawGate(frame.gate, atMs);
      if (frame.bell) drawBell(frame.bell);

      for (const instances of parts.values()) instances.flush();
      cores.flush(); glows.flush(); pools.flush(); panes.flush(); rings.flush();
      const peak = Math.max(glowSum[0]!, glowSum[1]!, glowSum[2]!);
      lastGlow = glowStrength > 0.001 && peak > 0 ? { colour: [glowSum[0]! / peak, glowSum[1]! / peak, glowSum[2]! / peak], strength: Math.min(0.6, glowStrength) } : NO_GLOW;
    },
    /** The town's warmth on the sky light this frame: the beacon catching and the bell's strokes; nothing otherwise. */
    glow: () => lastGlow,
    stats: () => {
      let instances = 0;
      for (const p of grove.values()) instances += p.count;
      for (const p of parts.values()) instances += p.count;
      return { ...counts, instances, lights: cores.count + glows.count + pools.count + panes.count + rings.count };
    },
    dispose(): void {
      for (const instances of grove.values()) instances.dispose();
      for (const instances of parts.values()) instances.dispose();
      grove.clear(); parts.clear(); kept.clear(); doors.clear(); windows.clear(); answering.clear(); missed.clear(); standards.clear();
      cores.dispose(); glows.dispose(); pools.dispose(); panes.dispose(); rings.dispose();
      root.remove(layer);
    },
  };
}
