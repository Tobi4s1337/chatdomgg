import * as THREE from 'three';
import { KingdomIdSchema, type RaidChatCue, type RaidChatLight, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { Tincture } from '../atlas/heraldry/design';
import { CELL, type BannerKit } from './banner';
import { breeze } from './choreography';
import { CART_CELLS, PONY_CELLS, ponyLegBlueprint, ponyTailBlueprint, wheelBlueprint } from './gift-art';
import { Path, type GiftRoute, type PlaceAnchor } from './gift-view';
import {
  BANNER_PONY_CELLS, BRAZIER_CELLS, GATE_CELLS, TORCH_CELLS, bannerPoleBlueprint, bannerPonyRows, skyLanternsPerWagon, torchPairs, torchPostBlueprint, RAID_WAGON_CELLS, RAID_WAGON_ORIGIN, ADORNMENT_CELLS, bannerRuns, brazierBlueprint, dyeBlueprint, gatePoleBlueprint, raidParts,
  raidPonyBlueprint, raidWagonBlueprint, raiderArms, adornmentBlueprint, adornmentsOf, type RaiderArms, type Run,
} from './raid-art';
import { Pool } from './train-view';
import { createRaidChatLanternLayer, type RaidChatLantern } from './raid-chat-lantern';
import { raidFittedShots, type RaidShotClear } from './raid-shot';
import { RAID_BEAT, RAID_LIMITS, gatePose, wagonElapsed, wagonKind, wagonPose, type RaidFrame } from './raid-beat';

/** Hard caps for one view: instances per part, lit cores, glows and light pools on the ground. */
export const RAID_VIEW_LIMITS = {
  wagons: RAID_LIMITS.units * RAID_LIMITS.caravans, dye: 1400, adornments: 3 * RAID_LIMITS.units * RAID_LIMITS.caravans, cores: 96, glows: 40, pools: 40, arms: 8,
  /** Torch posts along the street (six pairs per caravan) and the sky lanterns over the biggest columns. */
  torches: 12 * RAID_LIMITS.caravans, torchCores: 36 * RAID_LIMITS.caravans, sky: 96,
  /** Every pony drawn at once: one per wagon plus the banner ponies, two abreast in at most two rows per gap. */
  ponies: RAID_LIMITS.units * RAID_LIMITS.caravans * 5,
} as const;

/** Banner ponies keep at least this much air (m) to the wagon ahead, the wagon behind and each other, and walk this far either side of the road's middle. */
export const RAID_PONY_LAYOUT = { clear: 0.3, abreast: 0.56 } as const;

/** The torch avenue in metres: the first pair this far inside the gate, then one pair every `spacing` along the street. */
export const RAID_TORCH_LAYOUT = { start: 4.2, spacing: 3.4, aside: [2.75, 3.05, 3.35] as const, ignite: 520, step: 240 } as const;

export type RaidChatGround = (x: number, z: number) => number | null;

/** Layout in metres; the two rows stay clear of the gate road. */
export const RAID_CHAT_GATE_LAYOUT = { aside: 5, spacing: 1.4, start: 1.6, standHeight: 1.25, slots: 32 } as const;

export interface RaidLayerHost {
  readonly kit: BannerKit;
  readonly ground?: RaidChatGround;
  /** The kingdom's crafted voxel material (build lattice), carrying the `aLodFade` dissolve for instanced parts. */
  readonly material: THREE.Material;
  /** A prepared part's mesh (its geometry is the host's). */
  mesh(blueprint: VoxelBlueprint, offset: THREE.Vector3): THREE.Mesh;
  place(place: 'market' | 'gate'): PlaceAnchor | null;
  route(): GiftRoute | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const cells = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x * CELL, y * CELL, z * CELL);

/** The pole stands this far to one side of the road at the gate line; the braziers flank the road a little inside it. */
const POLE_ASIDE = 2.4, BRAZIER_ASIDE = 2.0, BRAZIER_IN = 1.2;

/** Soft light: a round glow facing the camera, or a pool of light lying on the ground. Additive, HDR, unfogged. */
const glowVertex = /* glsl */ `
  varying vec2 vSpot;
  varying vec3 vColour;
  void main() {
    #ifdef USE_INSTANCING_COLOR
      vColour = instanceColor;
    #else
      vColour = vec3(1.0);
    #endif
    #ifdef FLAT
      vSpot = position.xz * 2.0;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vSpot = position.xy * 2.0;
      vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float nearScale = 1.0;
      #ifdef NEAR_FROM
        nearScale = smoothstep(NEAR_FROM, NEAR_TO, length(centre.xyz));
      #endif
      gl_Position = projectionMatrix * (centre + vec4(position.xy * length(instanceMatrix[0].xyz) * nearScale, 0.0, 0.0));
    #endif
  }
`;
const glowFragment = /* glsl */ `
  varying vec2 vSpot;
  varying vec3 vColour;
  void main() {
    float r = length(vSpot);
    if (r >= 1.0) discard;
    float fall = 1.0 - r;
    gl_FragColor = vec4(vColour * fall * fall * (0.55 + 0.45 * fall), 1.0);
    #include <colorspace_fragment>
  }
`;

class Glows {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Color();
  count = 0;
  /** `near` (m): a camera-facing glow shrinks away between these distances from whichever eye draws it. */
  constructor(parent: THREE.Group, readonly capacity: number, flat: boolean, name: string, near?: NearFade) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    if (flat) geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({ vertexShader: glowVertex, fragmentShader: glowFragment,
      defines: { ...(flat ? { FLAT: '' } : {}), ...(near ? nearDefines(near) : {}) },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = name;
    this.mesh.renderOrder = flat ? 1 : 3;
    parent.add(this.mesh);
  }
  /** A glow `size` metres across at `at`, in `colour` times `strength`. */
  push(at: THREE.Vector3, size: number, colour: THREE.Color, strength: number): void {
    if (this.count >= this.capacity || strength <= 0.005 || size <= 0) return;
    this.mesh.setMatrixAt(this.count, this.matrix.makeScale(size, size, size).setPosition(at));
    this.mesh.setColorAt(this.count, this.scratch.copy(colour).multiplyScalar(strength));
    this.count++;
  }
  flush(): void {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    if (this.count > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.dispose(); this.material.dispose(); }
}

/**
 * Lights that drift free of the column (sky lanterns) can rise straight past whichever eye draws them: the gate shot
 * stands over the street, a walking guest stands in it. Within `[from, to]` metres of that eye they shrink away on the
 * GPU, so a lantern never fills the lens as a giant block, whatever camera the scene picked.
 */
type NearFade = readonly [from: number, to: number];
const nearDefines = ([from, to]: NearFade) => ({ NEAR_FROM: from.toFixed(2), NEAR_TO: to.toFixed(2) });
export const RAID_SKY_NEAR: NearFade = [3, 8];

/** Fire and lamp flames: small cubes of plain HDR light (they feed the bloom), coloured per instance. */
class Cores {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private readonly matrix = new THREE.Matrix4();
  private readonly turn = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly scratch = new THREE.Color();
  count = 0;
  constructor(parent: THREE.Group, readonly capacity: number, near?: NearFade) {
    if (near) {
      this.material.defines = nearDefines(near);
      this.material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', /* glsl */ `
          vec3 nearCentre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          transformed *= smoothstep(NEAR_FROM, NEAR_TO, distance(nearCentre, cameraPosition));
          #include <project_vertex>`);
      };
      this.material.customProgramCacheKey = () => `raid-near-${near[0]}-${near[1]}`;
    }
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = 'raid-flames';
    parent.add(this.mesh);
  }
  /** `tall` stretches the core upright (a paper lantern is taller than it is wide). */
  push(at: THREE.Vector3, size: number, yaw: number, colour: THREE.Color, strength: number, tall = 1): void {
    if (this.count >= this.capacity || size <= 0.004) return;
    this.mesh.setMatrixAt(this.count, this.matrix.compose(at, this.turn.setFromAxisAngle(UP, yaw), this.scale.set(size, size * tall, size)));
    this.mesh.setColorAt(this.count, this.scratch.copy(colour).multiplyScalar(strength));
    this.count++;
  }
  /**
   * A flame or lamp going out. These cores are unlit and opaque, so darkening one leaves a black block in the air
   * (a fading sky lantern read as a black cube); a fading light shrinks instead and stays warm until it is gone.
   */
  fade(at: THREE.Vector3, size: number, yaw: number, colour: THREE.Color, strength: number, fade: number, tall = 1): void {
    const f = Math.max(0, Math.min(1, fade));
    this.push(at, size * f, yaw, colour, strength * (0.8 + 0.2 * f), tall);
  }
  flush(): void {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    if (this.count > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); }
}

/** The fire in a brazier, bottom to tip: size (m), height over the coals (m) and colour. */
const TONGUES = [[0.42, 0.14, '#ff7f2a'], [0.31, 0.4, '#ffb04a'], [0.21, 0.64, '#ffd27a'], [0.12, 0.86, '#ff9a3a']] as const;
const TONGUE_COLOURS = TONGUES.map(([, , c]) => new THREE.Color(c));
const FIRE_GLOW = new THREE.Color('#ff8d40'), FIRE_POOL = new THREE.Color('#ff8436'), EMBER = new THREE.Color('#ffb25a');
const LAMP = new THREE.Color('#ffe2a2'), LAMP_GLOW = new THREE.Color('#ffa850'), LAMP_POOL = new THREE.Color('#ff9440');
const EMBERS = 6;
const SKY_LANTERN = new THREE.Color('#ffcf7a'), SKY_GLOW = new THREE.Color('#ff9c4a');
/** A sky lantern: released this long after its wagon is through the gate, every `every` ms, and how long it rises. */
const SKY = { from: 1600, every: 850, life: 11_000, rise: 0.62 } as const;

/** The gate as the road supplies it: its ground point, the way into the town, and the side its standard stands. */
export interface RaidGateSite { readonly position: THREE.Vector3; readonly facing: THREE.Vector3; readonly side: THREE.Vector3 }

interface Banners { readonly arms: RaiderArms; readonly gate: Run[][]; readonly standard: Run[][]; readonly pennant: Run[][]; readonly pony: Run[][] }

/**
 * The Raid Gate and the caravan. The gate (two braziers and the raider's standard on its pole) gathers at the
 * supplied gate place; the wagons follow the gift road from the gate through the market and up the castle road,
 * dissolving at its end. Everything is instanced from parts prepared up front and posed from the frame alone;
 * nothing here invents a person, a name on a wagon or a place the host did not supply.
 */
export function createRaidLayer(root: THREE.Group, host: RaidLayerHost) {
  const layer = new THREE.Group();
  layer.name = 'raid';
  root.add(layer);
  const pools = new Map<string, Pool>();
  const chatLights = createRaidChatLanternLayer(layer, host);
  let cues: readonly RaidChatCue[] = [];
  let lights: readonly RaidChatLight[] = [];
  let anchors: { cue: RaidChatCue; position: THREE.Vector3; opacity: number }[] = [];
  let drawnLights: RaidChatLantern[] = [];
  let ground = host.ground;
  let gateLanterns = 0;
  const gateSlots = new Map<string, { raidId: string; source: string; slot: number }>();
  let priorWagonLights = new Set<string>();
  const gateWakeAt = new Map<string, number>();
  let wagonLights = new Map<number, { light: RaidChatLight; slot: number }[]>();
  const lightSlots = new Map<string, { raidId: string; source: string; slot: number }>();
  function pruneLightSlots(): void {
    const active = new Map(lights.map(light => [light.lightId, light]));
    for (const assignments of [lightSlots, gateSlots]) for (const [id, assignment] of assignments) {
      const light = active.get(id);
      if (!light || light.raid.raidId !== assignment.raidId || light.raid.fromKingdomId !== assignment.source) assignments.delete(id);
    }
    for (const id of gateWakeAt.keys()) if (!active.has(id)) gateWakeAt.delete(id);
  }
  const cores = new Cores(layer, RAID_VIEW_LIMITS.cores);
  const glows = new Glows(layer, RAID_VIEW_LIMITS.glows, false, 'raid-glows');
  const lightPools = new Glows(layer, RAID_VIEW_LIMITS.pools, true, 'raid-light-pools');
  // The street's torches and the sky lanterns have their own budgets, so a long column never starves the gate's fire.
  const torchCores = new Cores(layer, RAID_VIEW_LIMITS.torchCores);
  const torchGlows = new Glows(layer, RAID_VIEW_LIMITS.torches, false, 'raid-torch-glows');
  const torchPools = new Glows(layer, RAID_VIEW_LIMITS.torches, true, 'raid-torch-pools');
  const skyCores = new Cores(layer, RAID_VIEW_LIMITS.sky, RAID_SKY_NEAR);
  const skyGlows = new Glows(layer, RAID_VIEW_LIMITS.sky, false, 'raid-sky-glows', RAID_SKY_NEAR);
  /** Torch sites per raid, chosen once from supported ground beside the actual street; never re-guessed per frame. */
  const avenues = new Map<string, { at: THREE.Vector3; pair: number }[]>();
  let torchSites: Vec3[] = [];
  const banners = new Map<string, Banners | null>();
  let road: Path | null | undefined;
  let gate: { site: RaidGateSite; caption: THREE.Vector3 } | null = null;
  let shotClear: RaidShotClear | undefined;
  let counts = { caravans: 0, wagons: 0, ponies: 0, torches: 0, skyLanterns: 0 };

  const m = new THREE.Matrix4(), w = new THREE.Matrix4(), p = new THREE.Matrix4(), c = new THREE.Matrix4(), t = new THREE.Matrix4(), r = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), a = new THREE.Vector3(), b = new THREE.Vector3();
  const s3 = new THREE.Vector3(), point = new THREE.Vector3();

  function pool(blueprint: VoxelBlueprint, capacity: number): Pool {
    let found = pools.get(blueprint.id);
    if (!found) {
      found = new Pool(host.mesh(blueprint, new THREE.Vector3()).geometry, host.material, capacity, layer, blueprint.id);
      pools.set(blueprint.id, found);
    }
    return found;
  }
  const dye = (tincture: Tincture) => pool(dyeBlueprint(host.kit, tincture), RAID_VIEW_LIMITS.dye);

  /** The whole road: in from the gate to the market, then on up the castle road. */
  function path(): Path | null {
    if (road === undefined) {
      const route = host.route();
      if (!route || route.inbound.length < 2) road = null;
      else {
        const joined = [...route.inbound];
        for (const point of route.outbound) {
          const last = joined.at(-1)!;
          if (Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]) > 0.05) joined.push(point);
        }
        road = new Path(joined);
      }
    }
    return road;
  }

  /** The gate, facing the way the road runs into the town (the anchor's own facing only when there is no road). */
  function site(): RaidGateSite | null {
    const anchor = host.place('gate');
    if (!anchor) return null;
    const line = path(), facing = line && line.length > 1 ? line.at(0.5).tangent : v3(anchor.facing).setY(0);
    if (facing.lengthSq() < 1e-6) return null;
    facing.normalize();
    return { position: v3(anchor.position), facing, side: new THREE.Vector3().crossVectors(UP, facing).normalize() };
  }

  function bannersOf(kingdomId: string): Banners | null {
    if (banners.has(kingdomId)) return banners.get(kingdomId)!;
    const arms = raiderArms(kingdomId);
    const made = arms ? {
      arms,
      gate: bannerRuns(arms.design, { width: GATE_CELLS.cloth.width, rows: GATE_CELLS.cloth.rows, tail: GATE_CELLS.cloth.tail, charges: true }),
      standard: bannerRuns(arms.design, { ...RAID_WAGON_CELLS.standard, charges: true }),
      pennant: bannerRuns(arms.design, { ...RAID_WAGON_CELLS.pennant, charges: false }),
      pony: bannerRuns(arms.design, { ...BANNER_PONY_CELLS.pennant, charges: false }),
    } : null;
    banners.set(kingdomId, made);
    if (banners.size > RAID_VIEW_LIMITS.arms) banners.delete(banners.keys().next().value!);
    return made;
  }

  /**
   * A cloth: rows of runs hanging down from `frame`'s origin (its x across, y up, z out of the cloth's face). Only
   * the first `visible` rows show; `sway(row)` pushes a row out of the cloth's plane, in metres.
   */
  function cloth(frame: THREE.Matrix4, runs: readonly (readonly Run[])[], visible: number, sway: (row: number) => number, fade: number): void {
    for (let row = 0; row < runs.length && row + 1 <= visible + 1e-3; row++) {
      const out = sway(row);
      for (const run of runs[row]!) {
        m.copy(frame).multiply(t.makeTranslation(run.x0 * CELL, -(row + 1) * CELL, out)).multiply(r.makeScale(run.x1 - run.x0, 1, 1));
        dye(run.tincture).push(m, fade);
      }
    }
  }

  function drawGate(frame: RaidFrame, here: RaidGateSite, set: Banners, atMs: number): void {
    const pose = gatePose(frame.t, frame.sleep), fade = pose.presence;
    const basis = new THREE.Matrix4().makeBasis(here.side, UP, here.facing);
    // The standard's pole, beside the road at the gate line.
    const pole = basis.clone().setPosition(a.copy(here.position).addScaledVector(here.side, POLE_ASIDE));
    const [gx, , gz] = GATE_CELLS.pivot;
    gate = { site: here, caption: cells(GATE_CELLS.caption[0] - gx, GATE_CELLS.caption[1], GATE_CELLS.caption[2] - gz).applyMatrix4(pole) };
    if (fade <= 0.01) return;
    pool(gatePoleBlueprint(host.kit), 2).push(m.copy(pole).multiply(t.makeTranslation(cells(-gx, 0, -gz))), fade);
    // The standard: hoisted furled up the pole, then unrolled from under the crossbar.
    const spec = GATE_CELLS.cloth, rows = spec.rows;
    c.copy(pole).multiply(t.makeTranslation(cells(spec.x - gx, spec.top, spec.z - gz)));
    const shown = pose.unfurl * rows, air = breeze(atMs, frame.seed % 997);
    cloth(c, set.gate, pose.hoist >= 1 ? shown : 0, row => {
      const depth = (row + 1) / rows;
      return (air * 0.03 + pose.swingPhase * 0.12) * depth ** 1.4;
    }, fade);
    if (pose.unfurl < 0.995) {
      // The furled roll: up the pole while it is hoisted, then down the cloth as it unrolls, thinning as it goes.
      const top = spec.top - 2, y = pose.hoist < 1 ? GATE_CELLS.rollFrom + (top - GATE_CELLS.rollFrom) * pose.hoist : top - shown;
      const thick = 1 - 0.55 * pose.unfurl;
      m.copy(pole).multiply(t.makeTranslation(cells(spec.x - gx, y - 0.5 + (1 - thick), spec.z - gz - 0.5 + (1 - thick))))
        .multiply(r.makeScale(spec.width, 2 * thick, 2 * thick));
      dye(set.arms.design.field).push(m, fade);
    }
    // The braziers, each side of the road, and their fire.
    const [bx, , bz] = BRAZIER_CELLS.pivot;
    for (const sign of [-1, 1]) {
      const base = new THREE.Vector3().copy(here.position).addScaledVector(here.facing, BRAZIER_IN).addScaledVector(here.side, BRAZIER_ASIDE * sign);
      pool(brazierBlueprint(host.kit), 4).push(m.copy(basis).setPosition(base).multiply(t.makeTranslation(cells(-bx, 0, -bz))), fade);
      fire(base, pose.flame * fade, atMs, sign);
    }
  }

  function fire(base: THREE.Vector3, flame: number, atMs: number, sign: number): void {
    if (flame <= 0.02) return;
    const coals = b.copy(base).addScaledVector(UP, BRAZIER_CELLS.fire[1] * CELL), lift = 0.7 + 0.3 * Math.min(1.4, flame);
    TONGUES.forEach(([size, height, ], k) => {
      const flicker = 1 + 0.14 * Math.sin(atMs * 0.013 + k * 1.7 + sign) + 0.06 * Math.sin(atMs * 0.031 + k * 0.9);
      point.copy(coals).addScaledVector(UP, height * lift);
      point.x += Math.sin(atMs * 0.009 + k * 2.3 + sign) * 0.03; point.z += Math.cos(atMs * 0.007 + k * 1.1) * 0.03;
      cores.push(point, size * (0.6 + 0.4 * Math.min(1.5, flame)) * flicker, atMs * 0.0012 * (k + 1) + sign, TONGUE_COLOURS[k]!, 1.2 + 0.5 * Math.min(1.5, flame));
    });
    glows.push(point.copy(coals).addScaledVector(UP, 0.55), 3.2 * (0.55 + 0.45 * Math.min(1.5, flame)), FIRE_GLOW, 0.5 * flame);
    lightPools.push(point.copy(base).addScaledVector(UP, 0.06), 7, FIRE_POOL, 0.24 * Math.min(1.3, flame));
    if (flame < 0.4) return;
    for (let k = 0; k < EMBERS; k++) {
      const phase = (((atMs / 1000 + k * 0.29 + (sign > 0 ? 0.13 : 0)) / 1.8) % 1 + 1) % 1;
      point.copy(coals).addScaledVector(UP, 0.3 + phase * 2.4);
      point.x += Math.sin(k * 2.1 + phase * 3) * 0.25; point.z += Math.cos(k * 1.3 + phase * 2.2) * 0.2;
      cores.fade(point, 0.05 * (1 - phase * 0.6), k, EMBER, 1.6, (1 - phase) * Math.min(1, flame));
    }
  }

  /**
   * Where the street's torches stand for this raid: pairs beside the actual road inside the gate, each on ground
   * the host's conservative sampler supports (clear of the street, lots, squares and water). A side with no supported
   * ground simply has no torch there; nothing is planted through a house or a stall.
   */
  function avenueOf(frame: RaidFrame, here: RaidGateSite, line: Path): { at: THREE.Vector3; pair: number }[] {
    const known = avenues.get(frame.key);
    if (known) return known;
    const sites: { at: THREE.Vector3; pair: number }[] = [];
    const L = RAID_TORCH_LAYOUT, pairs = torchPairs(frame.units);
    if (ground) for (let pair = 0; pair < pairs; pair++) {
      const distance = L.start + pair * L.spacing;
      if (distance > line.length - 2) break;
      const spot = line.at(distance), across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
      for (const sign of [-1, 1]) for (const aside of L.aside) {
        const x = spot.position.x + across.x * aside * sign, z = spot.position.z + across.z * aside * sign;
        let height: number | null;
        try { height = ground(x, z); } catch { height = null; }
        if (height === null || !Number.isFinite(height)) continue;
        // Never a torch in the gateway itself, behind the braziers.
        if (new THREE.Vector3(x, height, z).sub(here.position).dot(here.facing) < BRAZIER_IN + 1) continue;
        sites.push({ at: new THREE.Vector3(x, height, z), pair }); break;
      }
    }
    avenues.set(frame.key, sites);
    if (avenues.size > RAID_LIMITS.caravans + RAID_LIMITS.queued) avenues.delete(avenues.keys().next().value!);
    return sites;
  }

  /** The town lines its street with torches that catch in a wave from the gate inward, and sleep with the gate. */
  function drawAvenue(frame: RaidFrame, here: RaidGateSite, line: Path, atMs: number): void {
    const fade = gatePose(frame.t, frame.sleep).presence;
    if (fade <= 0.01) return;
    const [tx, , tz] = TORCH_CELLS.pivot, L = RAID_TORCH_LAYOUT;
    for (const torch of avenueOf(frame, here, line)) {
      // Each pair catches a beat after the one nearer the gate; all of them go out with the gate.
      const delay = L.ignite + torch.pair * L.step, lit = gatePose(frame.t - delay, frame.sleep - delay).flame;
      pool(torchPostBlueprint(host.kit), RAID_VIEW_LIMITS.torches).push(m.makeTranslation(torch.at).multiply(t.makeTranslation(cells(-tx, 0, -tz))), fade);
      counts.torches++;
      torchSites.push(torch.at.toArray() as Vec3);
      const flame = lit * fade;
      if (flame <= 0.02) continue;
      const coals = b.copy(torch.at).addScaledVector(UP, TORCH_CELLS.fire[1] * CELL), sign = torch.pair % 2 ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        const [size, height] = TONGUES[k]!;
        const flicker = 1 + 0.16 * Math.sin(atMs * 0.014 + k * 1.7 + torch.pair * 2.3) + 0.07 * Math.sin(atMs * 0.033 + k);
        point.copy(coals).addScaledVector(UP, height * 0.5 * (0.7 + 0.3 * Math.min(1.4, flame)));
        point.x += Math.sin(atMs * 0.01 + k * 2.3 + sign) * 0.02;
        torchCores.push(point, size * 0.48 * (0.6 + 0.4 * Math.min(1.5, flame)) * flicker, atMs * 0.0013 * (k + 1) + torch.pair, TONGUE_COLOURS[k]!, 1.25 + 0.45 * Math.min(1.5, flame));
      }
      torchGlows.push(point.copy(coals).addScaledVector(UP, 0.3), 1.9 * (0.6 + 0.4 * Math.min(1.5, flame)), FIRE_GLOW, 0.42 * flame);
      torchPools.push(point.copy(torch.at).addScaledVector(UP, 0.06), 4.4, FIRE_POOL, 0.2 * Math.min(1.3, flame));
    }
  }

  /**
   * Over the biggest columns, sky lanterns rise from each wagon once it is through the gate, drift on the breeze and
   * go out high over the street. They are light, not people: a fixed number per wagon from the beat alone.
   */
  function drawSkyLanterns(frame: RaidFrame, index: number, line: Path, atMs: number): void {
    const per = skyLanternsPerWagon(frame.viewers), elapsed = wagonElapsed(frame, index);
    if (!per || elapsed === null) return;
    for (let j = 0; j < per; j++) {
      const released = SKY.from + j * SKY.every, age = elapsed - released;
      if (age < 0 || age > SKY.life) continue;
      const from = wagonPose(released, line.length, frame.timing);
      if (from.presence <= 0.05) continue;
      const spot = line.at(from.distance), across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
      const h = ((frame.seed ^ Math.imul(index * 13 + j + 1, 0x9e3779b1)) >>> 0) / 4294967296, s = age / 1000;
      const drift = (h - 0.5) * 2.2, swirl = Math.sin(s * 0.9 + h * TAU) * 0.35;
      point.copy(spot.position).addScaledVector(across, drift + swirl + (h - 0.5) * 0.8 * s * 0.25)
        .addScaledVector(spot.tangent, 0.12 * s).addScaledVector(UP, 2.4 + SKY.rise * s + 0.04 * s * s);
      const opacity = Math.min(1, age / 700) * Math.min(1, (SKY.life - age) / 3200);
      const flicker = 1 + 0.08 * Math.sin(atMs * 0.009 + j * 1.3 + index);
      skyCores.fade(point, 0.17, h * TAU, SKY_LANTERN, 1.35 * flicker, opacity, 1.45);
      skyGlows.push(point, 1.15, SKY_GLOW, 0.3 * flicker * opacity);
      counts.skyLanterns++;
    }
  }

  /** One pony walking in frame `at` (its pivot on the ground), legs in a trot at `step`, tail swinging on `swish`. */
  function pony(at: THREE.Matrix4, colour: RaiderArms['colour'], step: number, swish: number, fade: number): void {
    const [qx, , qz] = PONY_CELLS.pivot, limit = RAID_VIEW_LIMITS.ponies;
    pool(raidPonyBlueprint(host.kit, colour), limit).push(m.copy(at).multiply(t.makeTranslation(cells(-qx, 0, -qz))), fade);
    PONY_CELLS.legs.forEach(([x, y, z], i) => {
      m.copy(at).multiply(t.makeTranslation(cells(x - qx, y, z - qz))).multiply(r.makeRotationZ(Math.sin(step + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.42))
        .multiply(t.makeTranslation(cells(-1, -6, -0.5)));
      pool(ponyLegBlueprint(host.kit), limit * 4).push(m, fade);
    });
    const [tx, ty, tz] = PONY_CELLS.tail;
    m.copy(at).multiply(t.makeTranslation(cells(tx - qx, ty, tz - qz))).multiply(r.makeRotationX(Math.sin(swish) * 0.3))
      .multiply(t.makeTranslation(cells(-0.5, -5, -0.5)));
    pool(ponyTailBlueprint(host.kit), limit).push(m, fade);
  }

  /**
   * The banner ponies led behind wagon `index`, two abreast, in as many rows (up to the column's design) as fit in
   * the air between this wagon's tailboard and the next wagon's pony on the actual road. They share the column's
   * pace and road, so they never close on a wagon; a gap too short for a row simply has none.
   */
  function drawBannerPonies(frame: RaidFrame, set: Banners, index: number, line: Path, atMs: number): void {
    const wanted = bannerPonyRows(frame.units);
    if (!wanted || index >= Math.min(frame.units, RAID_LIMITS.units) - 1) return;
    const lead = frame.t - RAID_BEAT.arrive - index * frame.timing.pitch;
    const speed = wagonPose(0, line.length, frame.timing).speed, gap = frame.timing.pitch / 1000 * speed;
    const P = BANNER_PONY_CELLS, L = RAID_PONY_LAYOUT;
    // The wagon ahead reaches back past its pivot to its tailboard; the one behind reaches forward to its pony's nose.
    const tail = RAID_WAGON_CELLS.pivot[0] * CELL;
    const nose = (CART_CELLS.pony[0] - RAID_WAGON_CELLS.pivot[0] + PONY_CELLS.size[0] - PONY_CELLS.pivot[0]) * CELL;
    const free = gap - tail - nose, length = P.back + P.front;
    let rows = wanted;
    while (rows > 0 && free - rows * length < (rows + 1) * L.clear) rows--;
    if (!rows) return;
    const air = (free - rows * length) / (rows + 1);
    const [ox, oy, oz] = P.origin, spec = P.pennant, [qx, , qz] = PONY_CELLS.pivot;
    for (let row = 0; row < rows; row++) {
      const behind = tail + air * (row + 1) + row * length + P.front;
      const elapsed = lead - behind / speed * 1000;
      if (elapsed < 0 || elapsed >= frame.timing.travel) continue;
      const pose = wagonPose(elapsed, line.length, frame.timing), fade = pose.presence;
      if (fade <= 0.01) continue;
      const d = pose.distance, ahead = line.at(d + 1).position, back = line.at(d - 1).position, at = line.at(d).position;
      const dx = ahead.x - back.x, dz = ahead.z - back.z;
      e.set(0, Math.atan2(-dz, dx), Math.atan2(ahead.y - back.y, Math.hypot(dx, dz)), 'YZX');
      q.setFromEuler(e);
      s3.set(-dz, 0, dx).normalize();
      for (const sign of [-1, 1]) {
        // Each pony keeps its own stride, a little out of step with its partner.
        const step = ((d / 1.1 + (sign > 0 ? 0.37 : 0) + row * 0.21) % 1) * TAU;
        p.compose(a.copy(at).addScaledVector(s3, L.abreast * sign), q, one).multiply(t.makeTranslation(0, Math.abs(Math.sin(step)) * 0.035, 0));
        pony(p, set.arms.colour, step, atMs / 1000 * 2.3 + index * 1.7 + row + sign, fade);
        pool(bannerPoleBlueprint(host.kit), RAID_VIEW_LIMITS.ponies).push(m.copy(p).multiply(t.makeTranslation(cells(ox - qx, oy, oz - qz))), fade);
        c.copy(p).multiply(t.makeTranslation(cells(spec.x - qx, spec.top, spec.z + spec.width - qz)))
          .multiply(r.makeBasis(new THREE.Vector3(0, 0, -1), UP, new THREE.Vector3(1, 0, 0)));
        const breath = breeze(atMs, (frame.seed + index * 31 + row * 7 + (sign > 0 ? 3 : 0)) % 997);
        cloth(c, set.pony, spec.rows, k => 0.01 + (0.025 + breath * 0.02 + Math.sin(step * 2) * 0.012) * ((k + 1) / spec.rows) ** 1.3, fade);
        counts.ponies++;
      }
    }
  }

  function drawWagon(frame: RaidFrame, set: Banners, index: number, line: Path, atMs: number): boolean {
    const elapsed = wagonElapsed(frame, index);
    if (elapsed === null) return false;
    const pose = wagonPose(elapsed, line.length, frame.timing), fade = pose.presence;
    if (fade <= 0.01) return false;
    const d = pose.distance, kind = wagonKind(index), colour = set.arms.colour;
    // Level along the chord from the back axle to the pony, so a bend in the street turns the wagon, never snaps it.
    const ahead = line.at(d + 2.2).position, behind = line.at(d - 1).position, at = line.at(d).position;
    const dx = ahead.x - behind.x, dz = ahead.z - behind.z;
    e.set(0, Math.atan2(-dz, dx), Math.atan2(ahead.y - behind.y, Math.hypot(dx, dz)), 'YZX');
    w.compose(at, q.setFromEuler(e), one);
    const [px, , pz] = RAID_WAGON_CELLS.pivot, origin = RAID_WAGON_ORIGIN[kind];
    // Four fixed fixtures on the outside of the sideboards, clear of the wheels. The cap meets the rail.
    for (const { light, slot } of wagonLights.get(index) ?? []) {
      if (drawnLights.some(drawn => drawn.id === light.lightId)) continue;
      const x = slot % 2 === 0 ? 5 : 12, z = slot < 2 ? -2.5 : 14.5;
      const position = cells(x - px, 1, z - pz).applyMatrix4(w);
      const opacity = fade * Math.min(1, Math.max(0, (atMs - light.asOf) / 350), Math.max(0, (light.expiresAt - atMs) / 500));
      if (opacity <= 0.01) continue;
      drawnLights.push({ id: light.lightId, sourceKingdomId: light.raid.fromKingdomId, position: position.toArray(), yaw: e.y, opacity });
      const cue = cues.find(c => c.lightId === light.lightId && c.raid.raidId === light.raid.raidId
        && c.raid.fromKingdomId === light.raid.fromKingdomId && c.kingdomId === light.kingdomId && c.origin === light.origin
        && c.asOf <= atMs && c.expiresAt > atMs);
      if (cue) anchors.push({ cue, position: position.clone().add(new THREE.Vector3(0, 1.125, 0)),
        opacity: opacity * Math.min(1, (cue.expiresAt - atMs) / 500) });
    }
    const capacity = RAID_VIEW_LIMITS.wagons;
    pool(raidWagonBlueprint(host.kit, kind, colour), capacity).push(m.copy(w).multiply(t.makeTranslation(cells(-px - origin[0], -origin[1], -pz - origin[2]))), fade);
    // Wheels turn with the ground they cover.
    const roll = -d / (CART_CELLS.wheelRadius * CELL);
    for (const [x, y, z] of CART_CELLS.wheels) {
      m.copy(w).multiply(t.makeTranslation(cells(x - px, y, z + 0.5 - pz))).multiply(r.makeRotationZ(roll))
        .multiply(t.makeTranslation(cells(-3.5, -3.5, -0.5)));
      pool(wheelBlueprint(host.kit), capacity * 4).push(m, fade);
    }
    // The pony walks on: a trot, diagonal pairs together, the body bobbing twice a stride.
    const step = ((d / 1.1) % 1) * TAU;
    p.copy(w).multiply(t.makeTranslation(cells(CART_CELLS.pony[0] - px, 0, CART_CELLS.pony[2] - pz)))
      .multiply(t.makeTranslation(0, Math.abs(Math.sin(step)) * 0.035, 0));
    pony(p, colour, step, atMs / 1000 * 2.1 + index, fade);
    // Festival lamps and cloth are permanent wagon fittings.
    for (const seat of adornmentsOf(kind, frame.seed, index)) {
      const size = ADORNMENT_CELLS[seat.kind];
      m.copy(w).multiply(t.makeTranslation(cells(seat.at[0] - px, seat.at[1], seat.at[2] - pz))).multiply(r.makeRotationY(seat.turn ? Math.PI / 2 : 0))
        .multiply(t.makeTranslation(cells(-size[0] / 2, 0, -size[2] / 2)));
      pool(adornmentBlueprint(host.kit, seat.kind), RAID_VIEW_LIMITS.adornments).push(m, fade);
      if (seat.kind === 'lantern-rack') {
        // The two panes are authored in rack-local cells. Follow the complete fitted transform on bends.
        for (const x of [2, 5]) {
          point.copy(cells(x, 5.5, 2.5)).applyMatrix4(m);
          cores.fade(point, 0.105, index, LAMP, 1.5, fade);
        }
        point.copy(cells(3.5, 5.5, 2.5)).applyMatrix4(m);
        glows.push(point, 1.0, LAMP_GLOW, 0.22 * fade);
      }
    }
    // The banner faces forward from its crossbar.
    const spec = kind === 'lead' ? RAID_WAGON_CELLS.standard : RAID_WAGON_CELLS.pennant;
    c.copy(w).multiply(t.makeTranslation(cells(spec.x - px, spec.top, spec.z + spec.width - pz)))
      .multiply(r.makeBasis(new THREE.Vector3(0, 0, -1), UP, new THREE.Vector3(1, 0, 0)));
    // It hangs a hair proud of its pole (never back through it) and lifts and settles with the trot.
    const air = breeze(atMs, (frame.seed + index * 31) % 997);
    cloth(c, kind === 'lead' ? set.standard : set.pennant, spec.rows, row => {
      const depth = (row + 1) / spec.rows;
      return 0.01 + (0.025 + air * 0.02 + Math.sin(step * 2) * 0.012) * depth ** 1.3;
    }, fade);
    // Its lantern, and the warm light it carries along the street.
    const [lx, ly, lz] = RAID_WAGON_CELLS.lantern, flicker = 1 + 0.06 * Math.sin(atMs * 0.011 + index * 1.9);
    point.copy(cells(lx - px, ly, lz - pz)).applyMatrix4(w);
    cores.fade(point, 0.11, index, LAMP, 1.7 * flicker, fade);
    glows.push(point, 1.5, LAMP_GLOW, 0.42 * flicker * fade);
    lightPools.push(b.copy(at).addScaledVector(s3.set(dx, 0, dz).normalize(), 1.3).addScaledVector(UP, 0.05), 3.6, LAMP_POOL, 0.16 * fade);
    return true;
  }

  return {
    blueprints: (): VoxelBlueprint[] => [...raidParts(host.kit), ...chatLights.blueprints(), wheelBlueprint(host.kit), ponyLegBlueprint(host.kit), ponyTailBlueprint(host.kit)],
    chat(nextCues: readonly RaidChatCue[], nextLights: readonly RaidChatLight[]): void {
      const byLight = new Map<string, RaidChatLight>();
      for (const light of nextLights) {
        const old = byLight.get(light.lightId);
        if (!old || light.asOf > old.asOf) byLight.set(light.lightId, light);
      }
      lights = [...byLight.values()].sort((a, b) => b.asOf - a.asOf || a.lightId.localeCompare(b.lightId)).slice(0, 32);
      pruneLightSlots();
      const byCue = new Map<string, RaidChatCue>();
      for (const cue of nextCues) {
        const old = byCue.get(cue.lightId);
        if (!old || cue.asOf > old.asOf) byCue.set(cue.lightId, cue);
      }
      cues = [...byCue.values()].sort((a, b) => b.asOf - a.asOf || a.lightId.localeCompare(b.lightId)).slice(0, 32);
    },
    ground(sample: RaidChatGround | undefined): void { ground = sample; },
    chatAnchors: () => anchors.map(anchor => ({ ...anchor, position: anchor.position.clone() })),
    apply(frames: readonly RaidFrame[], atMs: number): void {
      for (const instances of pools.values()) instances.count = 0;
      cores.count = 0; glows.count = 0; lightPools.count = 0; gate = null;
      counts = { caravans: 0, wagons: 0, ponies: 0, torches: 0, skyLanterns: 0 };
      torchCores.count = 0; torchGlows.count = 0; torchPools.count = 0; skyCores.count = 0; skyGlows.count = 0; torchSites = [];
      anchors = []; drawnLights = []; gateLanterns = 0;
      cues = cues.filter(cue => cue.expiresAt > atMs);
      lights = lights.filter(light => light.expiresAt > atMs);
      pruneLightSlots();
      const here = (frames.length || lights.length) ? site() : null, line = (frames.length || lights.length) ? path() : null;
      for (const frame of frames.slice(0, RAID_LIMITS.caravans)) {
        const set = bannersOf(frame.from.kingdomId);
        // No arms means no channel ID: nothing is drawn rather than a banner nobody bears.
        if (!set) continue;
        // Retain existing fixtures for the lease; probe free fixtures for new authors on hash collisions.
        wagonLights = new Map();
        const occupied = new Set<number>(), slots = Math.min(32, Math.max(0, frame.units) * 4);
        const eligible = lights.filter(light => light.raid.raidId === frame.key
          && light.raid.fromKingdomId === frame.from.kingdomId && light.asOf <= atMs)
          .sort((a, b) => a.lightId.localeCompare(b.lightId));
        for (const light of eligible) {
          const assignment = lightSlots.get(light.lightId);
          if (assignment && assignment.slot < slots) occupied.add(assignment.slot);
          else if (assignment) lightSlots.delete(light.lightId);
        }
        if (slots) for (const light of eligible) {
          let assignment = lightSlots.get(light.lightId);
          if (!assignment) {
            let hash = 2166136261;
            for (const char of light.lightId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
            const start = (hash >>> 0) % slots;
            let slot = -1;
            for (let offset = 0; offset < slots; offset++) {
              const candidate = (start + offset) % slots;
              if (!occupied.has(candidate)) { slot = candidate; break; }
            }
            if (slot < 0) continue;
            assignment = { raidId: frame.key, source: frame.from.kingdomId, slot };
            lightSlots.set(light.lightId, assignment); occupied.add(slot);
          }
          const index = Math.floor(assignment.slot / 4), entries = wagonLights.get(index) ?? [];
          entries.push({ light, slot: assignment.slot % 4 }); wagonLights.set(index, entries);
        }
        counts.caravans++;
        if (here && frame.t < frame.sleep + RAID_BEAT.sleepFade) {
          drawGate(frame, here, set, atMs);
          if (line) drawAvenue(frame, here, line, atMs);
        }
        if (line) for (let i = 0; i < Math.min(frame.units, RAID_LIMITS.units); i++) {
          if (drawWagon(frame, set, i, line, atMs)) counts.wagons++;
          drawBannerPonies(frame, set, i, line, atMs);
          drawSkyLanterns(frame, i, line, atMs);
        }
      }
      // Gate slots are independent from wagon slots. A light whose assigned wagon is not
      // presently visible can wait here; an unrelated caravan never hides it.
      const wagonNow = new Set(drawnLights.map(light => light.id));
      for (const id of wagonNow) gateWakeAt.delete(id);
      if (here && line && ground) {
        const eligible = lights.filter(light => light.asOf <= atMs && !wagonNow.has(light.lightId))
          .sort((a, b) => a.lightId.localeCompare(b.lightId));
        const occupied = new Set([...gateSlots.values()].map(assignment => assignment.slot));
        const positions = new Map<number, THREE.Vector3 | null>();
        const positionFor = (slot: number): THREE.Vector3 | undefined => {
          if (positions.has(slot)) return positions.get(slot) ?? undefined;
          const sign = slot % 2 ? 1 : -1;
          const along = RAID_CHAT_GATE_LAYOUT.start + Math.floor(slot / 2) * RAID_CHAT_GATE_LAYOUT.spacing;
          for (const extra of [0, 0.8, 1.6, 2.4]) {
            const candidate = here.position.clone().addScaledVector(here.facing, along)
              .addScaledVector(here.side, sign * (RAID_CHAT_GATE_LAYOUT.aside + extra));
            let height: number | null = null;
            try { height = ground!(candidate.x, candidate.z); } catch { /* A retired host supplies no fixture. */ }
            if (height !== null && Number.isFinite(height)) {
              candidate.y = height + RAID_CHAT_GATE_LAYOUT.standHeight; positions.set(slot, candidate); return candidate;
            }
          }
          positions.set(slot, null);
          return undefined;
        };
        for (const light of eligible) {
          let assignment = gateSlots.get(light.lightId);
          let position = assignment ? positionFor(assignment.slot) : undefined;
          if (assignment && !position) {
            occupied.delete(assignment.slot); gateSlots.delete(light.lightId); assignment = undefined;
          }
          if (!assignment) {
            // A small party stays together near the gate. Existing leases keep their fixture.
            for (let slot = 0; slot < RAID_CHAT_GATE_LAYOUT.slots; slot++) {
              if (occupied.has(slot)) continue;
              const candidate = positionFor(slot);
              if (!candidate) continue;
              position = candidate;
              assignment = { raidId: light.raid.raidId, source: light.raid.fromKingdomId, slot };
              gateSlots.set(light.lightId, assignment); occupied.add(slot); break;
            }
          }
          if (!position) continue;
          if (priorWagonLights.has(light.lightId)) gateWakeAt.set(light.lightId, atMs);
          const wake = Math.max(light.asOf, gateWakeAt.get(light.lightId) ?? light.asOf);
          const opacity = Math.min(1, Math.max(0, (atMs - wake) / 350), Math.max(0, (light.expiresAt - atMs) / 500));
          if (opacity <= 0.01 || !KingdomIdSchema.safeParse(light.raid.fromKingdomId).success) continue;
          drawnLights.push({ id: light.lightId, sourceKingdomId: light.raid.fromKingdomId, position: position.toArray(), yaw: Math.atan2(here.facing.x, here.facing.z), opacity, stand: true });
          gateLanterns++;
          const cue = cues.find(c => c.lightId === light.lightId && c.raid.raidId === light.raid.raidId
            && c.raid.fromKingdomId === light.raid.fromKingdomId && c.kingdomId === light.kingdomId && c.origin === light.origin
            && c.asOf <= atMs && c.expiresAt > atMs);
          if (cue) anchors.push({ cue, position: position.clone().add(new THREE.Vector3(0, 1.125, 0)),
            opacity: opacity * Math.min(1, (cue.expiresAt - atMs) / 500) });
        }
      }
      priorWagonLights = wagonNow;
      for (const instances of pools.values()) instances.flush();
      cores.flush(); glows.flush(); lightPools.flush();
      torchCores.flush(); torchGlows.flush(); torchPools.flush(); skyCores.flush(); skyGlows.flush();
      chatLights.apply(drawnLights);
      layer.updateWorldMatrix(true, false);
      for (const anchor of anchors) layer.localToWorld(anchor.position);
    },
    /** Torch posts drawn in the last frame, at most twelve per caravan: their foot, footprint radius and height. */
    torchSites: (): { foot: Vec3; radius: number; height: number }[] => torchSites.map(foot => ({ foot, radius: 0.65, height: 2.4 })),
    /** The gate while a raid holds it: where the shot is composed from and the caption hangs. */
    gate: (): RaidGateSite | null => gate?.site ?? null,
    captionPoint: (): THREE.Vector3 | null => gate?.caption.clone() ?? null,
    /**
     * The arrival is seen from the town: from over the street's edge well inside the gate, looking back down the
     * street at the standard, so the column comes through the gate towards the viewer between its torches. Views are
     * kept only when the column's swept envelope stays a readable size wherever it is on screen (raid-shot.ts), so a
     * passing wagon leaves the picture at a moderate size instead of filling a cropped corner. Only when the host
     * rejects every view from inside (a wall, a hill) does the shot fall back to looking in from outside the gate.
     * `aspect` is the picture's width over height (a boolean is read as portrait or landscape).
     */
    *shots(aspect: number | boolean): Generator<readonly [THREE.Vector3, THREE.Vector3, number]> {
      const here = gate?.site ?? site();
      if (!here) return;
      const ratio = typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : aspect === true ? 390 / 844 : 16 / 9;
      const portrait = ratio < 1, line = path(), fov = portrait ? 60 : 50, k = portrait ? 0.8 : 1;
      yield* raidFittedShots(line, here, ratio, shotClear);
      const target = here.position.clone().addScaledVector(here.facing, 2).add(new THREE.Vector3(0, portrait ? 2.5 : 3.2, 0));
      for (const [back, aside, rise] of [[18, -3, 8], [21, -2, 9], [16, -3, 7.5], [18, 3, 8], [23, 2, 10]] as const) {
        const spot = line ? line.at(-back * k) : { position: here.position.clone().addScaledVector(here.facing, -back * k), tangent: here.facing };
        const across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
        yield [spot.position.clone().addScaledVector(across, aside).add(new THREE.Vector3(0, rise * (portrait ? 0.68 : 1), 0)), target, fov] as const;
      }
    },
    /** The adopted world's standing check for the gate shot (houses, the castle, the ground); none means the road alone decides. */
    setShotClear(check: RaidShotClear | undefined): void { shotClear = check; },
    stats: () => {
      let instances = 0;
      for (const p of pools.values()) instances += p.count;
      const points = drawnLights.filter(light => light.stand).map(light => v3(light.position));
      const bounds = new THREE.Box3().setFromPoints(points), centre = points.length ? bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3();
      return { caravans: counts.caravans, wagons: counts.wagons, ponies: counts.ponies, gate: gate ? 1 : 0, instances,
        chatLanterns: chatLights.stats().lanterns, chatGateLanterns: gateLanterns,
        chatGateX: centre.x, chatGateY: centre.y, chatGateZ: centre.z,
        chatGateSpan: points.length ? Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) : 0,
        torches: counts.torches, skyLanterns: counts.skyLanterns,
        lights: cores.count + glows.count + lightPools.count + torchCores.count + torchGlows.count + torchPools.count + skyCores.count + skyGlows.count };
    },
    dispose(): void {
      for (const instances of pools.values()) instances.dispose();
      pools.clear(); banners.clear();
      chatLights.dispose(); cues = []; lights = []; anchors = []; lightSlots.clear(); gateSlots.clear(); gateWakeAt.clear(); priorWagonLights.clear();
      cores.dispose(); glows.dispose(); lightPools.dispose();
      torchCores.dispose(); torchGlows.dispose(); torchPools.dispose(); skyCores.dispose(); skyGlows.dispose(); avenues.clear(); torchSites = []; shotClear = undefined;
      root.remove(layer);
    },
  };
}
export type RaidLayer = ReturnType<typeof createRaidLayer>;
