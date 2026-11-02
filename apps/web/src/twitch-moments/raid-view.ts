import * as THREE from 'three';
import type { RaidChatCue, RaidChatLight, Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { Tincture } from '../atlas/heraldry/design';
import { CELL, type BannerKit } from './banner';
import { breeze } from './choreography';
import { CART_CELLS, PONY_CELLS, ponyLegBlueprint, ponyTailBlueprint, wheelBlueprint } from './gift-art';
import { Path, type GiftRoute, type PlaceAnchor } from './gift-view';
import {
  BRAZIER_CELLS, GATE_CELLS, RAID_WAGON_CELLS, RAID_WAGON_ORIGIN, ADORNMENT_CELLS, bannerRuns, brazierBlueprint, dyeBlueprint, gatePoleBlueprint, raidParts,
  raidPonyBlueprint, raidWagonBlueprint, raiderArms, adornmentBlueprint, adornmentsOf, type RaiderArms, type Run,
} from './raid-art';
import { Pool } from './train-view';
import { createRaidChatLanternLayer, type RaidChatLantern } from './raid-chat-lantern';
import { RAID_BEAT, RAID_LIMITS, gatePose, wagonElapsed, wagonKind, wagonPose, type RaidFrame } from './raid-beat';

/** Hard caps for one view: instances per part, lit cores, glows and light pools on the ground. */
export const RAID_VIEW_LIMITS = {
  wagons: RAID_LIMITS.units * RAID_LIMITS.caravans, dye: 1400, adornments: 3 * RAID_LIMITS.units * RAID_LIMITS.caravans, cores: 96, glows: 40, pools: 40, arms: 8,
} as const;

export interface RaidLayerHost {
  readonly kit: BannerKit;
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
      gl_Position = projectionMatrix * (centre + vec4(position.xy * length(instanceMatrix[0].xyz), 0.0, 0.0));
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
  constructor(parent: THREE.Group, readonly capacity: number, flat: boolean, name: string) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    if (flat) geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({ vertexShader: glowVertex, fragmentShader: glowFragment, defines: flat ? { FLAT: '' } : {},
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
  constructor(parent: THREE.Group, readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = 'raid-flames';
    parent.add(this.mesh);
  }
  push(at: THREE.Vector3, size: number, yaw: number, colour: THREE.Color, strength: number): void {
    if (this.count >= this.capacity || size <= 0.004) return;
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

/** The fire in a brazier, bottom to tip: size (m), height over the coals (m) and colour. */
const TONGUES = [[0.42, 0.14, '#ff7f2a'], [0.31, 0.4, '#ffb04a'], [0.21, 0.64, '#ffd27a'], [0.12, 0.86, '#ff9a3a']] as const;
const TONGUE_COLOURS = TONGUES.map(([, , c]) => new THREE.Color(c));
const FIRE_GLOW = new THREE.Color('#ff8d40'), FIRE_POOL = new THREE.Color('#ff8436'), EMBER = new THREE.Color('#ffb25a');
const LAMP = new THREE.Color('#ffe2a2'), LAMP_GLOW = new THREE.Color('#ffa850'), LAMP_POOL = new THREE.Color('#ff9440');
const EMBERS = 6;

/** The gate as the road supplies it: its ground point, the way into the town, and the side its standard stands. */
export interface RaidGateSite { readonly position: THREE.Vector3; readonly facing: THREE.Vector3; readonly side: THREE.Vector3 }

interface Banners { readonly arms: RaiderArms; readonly gate: Run[][]; readonly standard: Run[][]; readonly pennant: Run[][] }

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
  let wagonLights = new Map<number, { light: RaidChatLight; slot: number }[]>();
  const lightSlots = new Map<string, { raidId: string; source: string; slot: number }>();
  function pruneLightSlots(): void {
    const active = new Map(lights.map(light => [light.lightId, light]));
    for (const [id, assignment] of lightSlots) {
      const light = active.get(id);
      if (!light || light.raid.raidId !== assignment.raidId || light.raid.fromKingdomId !== assignment.source) lightSlots.delete(id);
    }
  }
  const cores = new Cores(layer, RAID_VIEW_LIMITS.cores);
  const glows = new Glows(layer, RAID_VIEW_LIMITS.glows, false, 'raid-glows');
  const lightPools = new Glows(layer, RAID_VIEW_LIMITS.pools, true, 'raid-light-pools');
  const banners = new Map<string, Banners | null>();
  let road: Path | null | undefined;
  let gate: { site: RaidGateSite; caption: THREE.Vector3 } | null = null;
  let counts = { caravans: 0, wagons: 0 };

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
      cores.push(point, 0.05 * (1 - phase * 0.6), k, EMBER, 1.6 * (1 - phase) * Math.min(1, flame));
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
    const [qx, , qz] = PONY_CELLS.pivot, step = ((d / 1.1) % 1) * TAU;
    p.copy(w).multiply(t.makeTranslation(cells(CART_CELLS.pony[0] - px, 0, CART_CELLS.pony[2] - pz)))
      .multiply(t.makeTranslation(0, Math.abs(Math.sin(step)) * 0.035, 0));
    pool(raidPonyBlueprint(host.kit, colour), capacity).push(m.copy(p).multiply(t.makeTranslation(cells(-qx, 0, -qz))), fade);
    PONY_CELLS.legs.forEach(([x, y, z], i) => {
      m.copy(p).multiply(t.makeTranslation(cells(x - qx, y, z - qz))).multiply(r.makeRotationZ(Math.sin(step + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.42))
        .multiply(t.makeTranslation(cells(-1, -6, -0.5)));
      pool(ponyLegBlueprint(host.kit), capacity * 4).push(m, fade);
    });
    const [tx, ty, tz] = PONY_CELLS.tail;
    m.copy(p).multiply(t.makeTranslation(cells(tx - qx, ty, tz - qz))).multiply(r.makeRotationX(Math.sin(atMs / 1000 * 2.1 + index) * 0.3))
      .multiply(t.makeTranslation(cells(-0.5, -5, -0.5)));
    pool(ponyTailBlueprint(host.kit), capacity).push(m, fade);
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
          cores.push(point, 0.105, index, LAMP, 1.5 * fade);
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
    cores.push(point, 0.11, index, LAMP, 1.7 * flicker * fade);
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
    chatAnchors: () => anchors.map(anchor => ({ ...anchor, position: anchor.position.clone() })),
    apply(frames: readonly RaidFrame[], atMs: number): void {
      for (const instances of pools.values()) instances.count = 0;
      cores.count = 0; glows.count = 0; lightPools.count = 0; gate = null;
      counts = { caravans: 0, wagons: 0 };
      anchors = []; drawnLights = [];
      cues = cues.filter(cue => cue.expiresAt > atMs);
      lights = lights.filter(light => light.expiresAt > atMs);
      pruneLightSlots();
      const here = frames.length ? site() : null, line = frames.length ? path() : null;
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
        if (here && frame.t < frame.sleep + RAID_BEAT.sleepFade) drawGate(frame, here, set, atMs);
        if (line) for (let i = 0; i < Math.min(frame.units, RAID_LIMITS.units); i++) if (drawWagon(frame, set, i, line, atMs)) counts.wagons++;
      }
      for (const instances of pools.values()) instances.flush();
      cores.flush(); glows.flush(); lightPools.flush();
      chatLights.apply(drawnLights);
      layer.updateWorldMatrix(true, false);
      for (const anchor of anchors) layer.localToWorld(anchor.position);
    },
    /** The gate while a raid holds it: where the shot is composed from and the caption hangs. */
    gate: (): RaidGateSite | null => gate?.site ?? null,
    captionPoint: (): THREE.Vector3 | null => gate?.caption.clone() ?? null,
    /** Look in from outside the gate, along the actual road, so the town welcomes the column behind the gate. */
    *shots(portrait: boolean): Generator<readonly [THREE.Vector3, THREE.Vector3, number]> {
      const here = gate?.site ?? site();
      if (!here) return;
      const line = path(), target = here.position.clone().addScaledVector(here.facing, 2).add(new THREE.Vector3(0, portrait ? 2.5 : 3.2, 0));
      const fov = portrait ? 60 : 50, k = portrait ? 0.8 : 1;
      for (const [back, aside, rise] of [[18, -3, 8], [21, -2, 9], [16, -3, 7.5], [18, 3, 8], [23, 2, 10]] as const) {
        const spot = line ? line.at(-back * k) : { position: here.position.clone().addScaledVector(here.facing, -back * k), tangent: here.facing };
        const across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
        yield [spot.position.clone().addScaledVector(across, aside).add(new THREE.Vector3(0, rise * (portrait ? 0.68 : 1), 0)), target, fov] as const;
      }
    },
    stats: () => {
      let instances = 0;
      for (const p of pools.values()) instances += p.count;
      return { caravans: counts.caravans, wagons: counts.wagons, gate: gate ? 1 : 0, instances, chatLanterns: chatLights.stats().lanterns, lights: cores.count + glows.count + lightPools.count };
    },
    dispose(): void {
      for (const instances of pools.values()) instances.dispose();
      pools.clear(); banners.clear();
      chatLights.dispose(); cues = []; lights = []; anchors = []; lightSlots.clear();
      cores.dispose(); glows.dispose(); lightPools.dispose();
      root.remove(layer);
    },
  };
}
export type RaidLayer = ReturnType<typeof createRaidLayer>;
