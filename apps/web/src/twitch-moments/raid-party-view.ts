import * as THREE from 'three';
import { MAT } from '@chatdom/content';
import { RAID_PARTY_DRAWN, type RaidPartyPublicFrame, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { CitizenSample } from '../citizens';
import type { Tincture } from '../atlas/heraldry/design';
import { blueprint, box, CELL, type BannerKit, type Box } from './banner';
import { breeze } from './choreography';
import { Path, type GiftRoute, type PlaceAnchor } from './gift-view';
import { BRAZIER_CELLS, GATE_CELLS, TINCTURE_LIST, bannerRuns, brazierBlueprint, dyeBlueprint, gatePoleBlueprint, raiderArms, type RaiderArms, type Run } from './raid-art';
import { RAID_PENNANT_WALL_LAYOUT, RAID_PENNANT_WALL_RADIUS } from './raid-pennant-wall';
import { RAID_SHOT_FOREGROUND_TIERS, raidShotSees, type RaidShotCandidate, type RaidShotClear } from './raid-shot';
import { RAID_CHAT_GATE_LAYOUT, RAID_GATE_LAYOUT, RAID_TORCH_LAYOUT, raidApproachPoints, type RaidChatGround } from './raid-view';
import { Pool } from './train-view';

/**
 * The gate party (RS11): the real walkers who chose to march, in their own looks, gathered inside this kingdom's own
 * gate between its braziers, the streamer at the front under the kingdom's standard, banners and torches in their
 * hands. On Twitch's witnessed raid they set out through the gate and down the road and are gone into the dusk.
 *
 * Everyone drawn here is a marcher in the frame (at most RAID_PARTY_DRAWN of them); `more` is never drawn. People are
 * drawn by the host's own citizen renderer (`MomentPeoplePort`), lit like the town's people; this layer poses them,
 * puts what they carry in their hands and lights their fires. It adds no light, no renderer and no animation loop:
 * everything is posed from the frame and the clock the view is applied with.
 */

/** A host's people renderer: the same citizen renderer, looks and lighting as the town's own walkers. */
export interface MomentPeople {
  /** The look IDs this renderer can draw. */
  readonly looks: ReadonlySet<string>;
  /** World matrix of each drawn person's right-hand grip, keyed by sample ID, for the last update only. */
  readonly grips: ReadonlyMap<string, THREE.Matrix4>;
  /** Draws exactly these people (an empty list hides everyone). `atMs` is the presentation clock. */
  update(samples: readonly CitizenSample[], atMs: number): void;
  dispose(): void;
}
/** Made once, when a party first gathers; the view never builds a material or a renderer itself. */
export interface MomentPeoplePort {
  create(capacity: number): Promise<MomentPeople>;
}

/** Hard caps for one view. People never exceed RAID_PARTY_DRAWN, whatever joins, leaves or fades. */
export const RAID_PARTY_LIMITS = {
  people: RAID_PARTY_DRAWN, renderer: 48, torches: RAID_PARTY_DRAWN, banners: 12, dye: 720, cores: 176, glows: 64, pools: 24,
  /** The deepest formation searched for supported ground, in ranks behind the front. */
  ranks: 18,
} as const;

/**
 * The formation in metres, measured along the street from the gate (`front` and `firstRank` inside it) and across
 * it. The leader stands between and just inside the braziers; ranks of two to four abreast stand behind.
 */
export const RAID_PARTY_LAYOUT = {
  front: 2.6, firstRank: 4.1, rankSpacing: 1.15, lane: 0.9,
  /** A person's footprint, and the air kept to gate furniture and to each other. */
  body: 0.3, air: 0.12,
  /** Every third rank (from the first) bears banners in its outer lanes; the rest carry torches. */
  bannerEvery: 3,
} as const;

/** Party timing in ms: joining, leaving, re-forming, the countdown's flare and held breath, and the set-out. */
export const RAID_PARTY_BEAT = {
  join: 900, joinStep: 1.1, leave: 900, leaveStep: 0.8, reform: 1300, fresh: 3000,
  flare: 750, breath: 3000, rise: 1200, settle: 800,
  /** The whole set-out: the column is gone this long after Twitch's witnessed raid, whatever its length. */
  setout: 14_000, lastFade: 1600, fireOut: 2200,
  /** Each rank steps off this long after the one in front; the leader first. */
  ripple: 320, reaction: 450, pace: 1.55, maxPace: 2.1, accel: 600,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const cells = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x * CELL, y * CELL, z * CELL);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const hashOf = (text: string) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const { poleAside: POLE_ASIDE, brazierAside: BRAZIER_ASIDE, brazierIn: BRAZIER_IN } = RAID_GATE_LAYOUT;

// ---------------------------------------------------------------- what they carry (build cells, 0.125 m)

/** A pitch torch: a timber shaft, a copper band and the wrapped head. Pivot: the hand, a quarter of the way up. */
export const PARTY_TORCH_CELLS = { size: [3, 9, 3] as const, grip: [1.5, 2.5, 1.5] as const, flame: [1.5, 9.4, 1.5] as const } as const;
export function partyTorchBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-raid-party-torch-${kit}`, kit, [3, 9, 3], [
    box(1, 0, 1, 2, 7, 2, MAT.timber), box(1, 2, 1, 2, 3, 2, MAT.bark),
    box(0, 7, 0, 3, 8, 3, MAT.hairCopper), box(0, 8, 0, 3, 9, 3, MAT.hairBlack),
  ]);
}

/**
 * A carried staff with a crossbar running out to the bearer's right and a gilt finial; the cloth hangs from under
 * the crossbar, clear of the bearer's head. `banner` is a bearer's pennant staff, `standard` the leader's.
 */
export const PARTY_STAFF_CELLS = {
  banner: { size: [9, 25, 1] as const, grip: [0.5, 4.5, 0.5] as const, bar: 22, cloth: { width: 7, rows: 9, tail: 2, charges: false } },
  standard: { size: [13, 32, 1] as const, grip: [0.5, 4.5, 0.5] as const, bar: 29, cloth: { width: 11, rows: 14, tail: 3, charges: true } },
} as const;
type StaffKind = keyof typeof PARTY_STAFF_CELLS;
export function partyStaffBlueprint(kit: BannerKit, kind: StaffKind): VoxelBlueprint {
  const spec = PARTY_STAFF_CELLS[kind], [w, h] = spec.size, bar = spec.bar, boxes: Box[] = [];
  boxes.push(box(0, 0, 0, 1, h - 1, 1, MAT.timber), box(0, 0, 0, 1, 1, 1, MAT.brass), box(0, 4, 0, 1, 5, 1, MAT.bark));
  boxes.push(box(1, bar, 0, w, bar + 1, 1, MAT.timber), box(w - 1, bar - 1, 0, w, bar + 2, 1, MAT.brass), box(0, bar - 1, 0, 1, bar + 2, 1, MAT.brass));
  boxes.push(box(0, h - 1, 0, 1, h, 1, MAT.goldLeaf));
  return blueprint(`moment-raid-party-${kind}-${kit}`, kit, [w, h, 1], boxes);
}

// ---------------------------------------------------------------- light (unlit HDR, owned here)

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

/** A soft additive light: a round glow facing the eye, or a pool lying on the ground. */
class Halo {
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

/** Flames: small cubes of plain HDR light that feed the bloom. A fading flame shrinks; it never darkens to a black block. */
class Flames {
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
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.name = 'raid-party-flames';
    parent.add(this.mesh);
  }
  push(at: THREE.Vector3, size: number, yaw: number, colour: THREE.Color, strength: number, fade = 1): void {
    const f = clamp01(fade), s = size * f;
    if (this.count >= this.capacity || s <= 0.004) return;
    this.mesh.setMatrixAt(this.count, this.matrix.compose(at, this.turn.setFromAxisAngle(UP, yaw), this.scale.set(s, s * 1.15, s)));
    this.mesh.setColorAt(this.count, this.scratch.copy(colour).multiplyScalar(strength * (0.8 + 0.2 * f)));
    this.count++;
  }
  flush(): void {
    this.mesh.count = this.count; this.mesh.visible = this.count > 0;
    if (this.count > 0) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); }
}

const TONGUES = [[0.42, 0.14, '#ff7f2a'], [0.31, 0.4, '#ffb04a'], [0.21, 0.64, '#ffd27a'], [0.12, 0.86, '#ff9a3a']] as const;
const TONGUE_COLOURS = TONGUES.map(([, , c]) => new THREE.Color(c));
const FIRE_GLOW = new THREE.Color('#ff8d40'), FIRE_POOL = new THREE.Color('#ff8436'), EMBER = new THREE.Color('#ffb25a');
const TORCH_GLOW = new THREE.Color('#ff9a48');

// ---------------------------------------------------------------- the road and the formation

/** The street in from the gate, with the open approach out in front of it when the host has one. `at(s)`: s > 0 inside. */
interface PartyRoad { readonly line: Path; readonly approach: number; readonly inside: number; at(s: number): { position: THREE.Vector3; tangent: THREE.Vector3 } }

export type PartyRole = 'leader' | 'banner' | 'torch';
/** One place in the formation: along the street from the gate, across it (+ is `cross(up, into town)`), and its ground. */
export interface PartySlot { readonly along: number; readonly aside: number; readonly rank: number; readonly lane: number; readonly role: PartyRole; readonly position: THREE.Vector3 }

/** Two to four abreast as the party grows (shrinking only once it is clearly smaller, so a leaver never reshuffles a rank). */
export function partyAbreast(count: number, current = 0): number {
  const wanted = count <= 4 ? 2 : count <= 12 ? 3 : 4;
  if (wanted >= current || current === 0) return wanted;
  const lower = current === 4 ? 10 : 2;
  return count <= lower ? wanted : current;
}

interface Furniture { readonly x: number; readonly z: number; readonly r: number }

interface SetoutPlan { readonly departedAt: number; readonly fadeFrom: number; readonly fadeTo: number; readonly pace: number; readonly narrow: number }

interface MarcherState {
  readonly key: string;
  name: string; look: string; walker: string | null; leader: boolean;
  slot: number;
  /** The glide to this slot: where from, when it began, and how far had been walked before it. */
  from: THREE.Vector3 | null; fromAt: number; walked: number;
  joinAt: number;
  leaveAt: number | null; leftFrom: THREE.Vector3 | null; leftSlot: PartySlot | null;
  /** A stable stride offset, so neighbours never step in unison. */
  phase: number;
}

export interface RaidPartyLayerHost {
  readonly kit: BannerKit;
  /** The kingdom's crafted voxel material (build lattice), for what the party carries and its gate furniture. */
  readonly material: THREE.Material;
  mesh(blueprint: VoxelBlueprint, offset: THREE.Vector3): THREE.Mesh;
  place(place: 'gate'): PlaceAnchor | null;
  route(): GiftRoute | null;
  /** True while an incoming raid already stands its braziers and standard at the gate. */
  gateBusy?(): boolean;
  readonly people?: MomentPeoplePort;
}

type Phase = RaidPartyPublicFrame['phase'];

export function createRaidPartyLayer(root: THREE.Group, host: RaidPartyLayerHost) {
  const layer = new THREE.Group();
  layer.name = 'raid-party';
  root.add(layer);
  const pools = new Map<string, Pool>();
  const flames = new Flames(layer, RAID_PARTY_LIMITS.cores);
  const halos = new Halo(layer, RAID_PARTY_LIMITS.glows, false, 'raid-party-glows');
  const groundLight = new Halo(layer, RAID_PARTY_LIMITS.pools, true, 'raid-party-light-pools');

  let ground: RaidChatGround | undefined, approachGround: RaidChatGround | undefined, shotClear: RaidShotClear | undefined;
  let peoplePort = host.people, people: MomentPeople | null = null, creating: Promise<void> | null = null, peopleFailed = false;
  let pending: RaidPartyPublicFrame | null = null, current: RaidPartyPublicFrame | null = null, processed: RaidPartyPublicFrame | null | undefined;
  const marchers = new Map<string, MarcherState>();
  let order: string[] = [];
  let abreast = 0, slots: PartySlot[] = [], layoutKey = '', road: PartyRoad | null | undefined;
  let phase: Phase | null = null, flareAt = -Infinity, signalAt = -Infinity, presentSince = -Infinity, firesOutAt = -Infinity;
  /** A set-out frame kept after the gate forgot it, so the column finishes leaving. */
  let held = false, planned: SetoutPlan | null = null;
  let here: ReturnType<typeof site> = null, lastAt = 0, lastPeople = 0, disposed = false;
  let drawn = { people: 0, leaving: 0, torches: 0, banners: 0, standard: 0, crown: 0, braziers: 0 };
  let drawnWalkers: string[] = [], fires: { position: Vec3; strength: number }[] = [];
  const arms = new Map<string, { arms: RaiderArms; gate: Run[][]; banner: Run[][]; standard: Run[][] } | null>();

  const m = new THREE.Matrix4(), t = new THREE.Matrix4(), r = new THREE.Matrix4(), c = new THREE.Matrix4();
  const q = new THREE.Quaternion(), a = new THREE.Vector3(), b = new THREE.Vector3(), point = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

  function pool(part: VoxelBlueprint, capacity: number): Pool {
    let found = pools.get(part.id);
    if (!found) { found = new Pool(host.mesh(part, new THREE.Vector3()).geometry, host.material, capacity, layer, part.id); pools.set(part.id, found); }
    return found;
  }
  const dye = (tincture: Tincture) => pool(dyeBlueprint(host.kit, tincture), RAID_PARTY_LIMITS.dye);

  function armsOf(kingdomId: string) {
    if (arms.has(kingdomId)) return arms.get(kingdomId)!;
    const found = raiderArms(kingdomId);
    const made = found ? {
      arms: found,
      gate: bannerRuns(found.design, { width: GATE_CELLS.cloth.width, rows: GATE_CELLS.cloth.rows, tail: GATE_CELLS.cloth.tail, charges: true }),
      banner: bannerRuns(found.design, PARTY_STAFF_CELLS.banner.cloth),
      standard: bannerRuns(found.design, PARTY_STAFF_CELLS.standard.cloth),
    } : null;
    arms.set(kingdomId, made);
    if (arms.size > 2) arms.delete(arms.keys().next().value!);
    return made;
  }

  /** The gate's street inward (gift route in, then on out) and, where the land in front is open, the road out of it. */
  function roadOf(): PartyRoad | null {
    if (road !== undefined) return road;
    const route = host.route();
    if (!route || route.inbound.length < 2) return (road = null);
    const joined = [...route.inbound];
    for (const p of route.outbound) {
      const last = joined.at(-1)!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.05) joined.push(p);
    }
    const inward = new Path(joined), entry = inward.at(0);
    // The same road out as the incoming caravan comes in by (it bends away from the gate's standard).
    const out = raidApproachPoints(entry, approachGround, new THREE.Vector3().crossVectors(UP, entry.tangent));
    const line = out.length ? new Path([...out, ...joined]) : inward;
    const approach = out.length ? new Path([...out, joined[0]!]).length : 0;
    road = { line, approach, inside: inward.length, at(s) {
      if (s >= -approach) return line.at(s + approach);
      // Past the road's end (or with no open road), straight on out of the gate; the party has faded before this matters.
      const end = line.at(0), dir = approach > 0 ? line.at(0.5).tangent : inward.at(0.5).tangent;
      return { position: end.position.clone().addScaledVector(dir, s + approach), tangent: dir };
    } };
    return road;
  }

  /** The gate in the road's frame: its point, the way into the town and the side its standard stands. */
  function site(): { position: THREE.Vector3; facing: THREE.Vector3; side: THREE.Vector3 } | null {
    const anchor = host.place('gate'), line = roadOf();
    if (!anchor || !line) return null;
    const facing = line.at(0.5).tangent.clone().setY(0);
    if (facing.lengthSq() < 1e-6) return null;
    facing.normalize();
    return { position: v3(anchor.position), facing, side: new THREE.Vector3().crossVectors(UP, facing).normalize() };
  }

  /** Everything the raid layer can stand at this gate (RAID_GATE_FURNITURE mirrors it for the realm): never stood in. */
  function furnitureOf(here: NonNullable<ReturnType<typeof site>>, line: PartyRoad): Furniture[] {
    const out: Furniture[] = [];
    const put = (p: THREE.Vector3, radius: number) => out.push({ x: p.x, z: p.z, r: radius });
    const at = (along: number, aside: number) => here.position.clone().addScaledVector(here.facing, along).addScaledVector(here.side, aside);
    put(at(0, POLE_ASIDE), 0.2);
    for (const sign of [-1, 1]) put(at(BRAZIER_IN, BRAZIER_ASIDE * sign), 0.6);
    const T = RAID_TORCH_LAYOUT;
    for (let pair = 0; pair < 6; pair++) {
      const d = T.start + pair * T.spacing;
      if (d > line.inside - 2) break;
      const spot = line.at(d), across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
      for (const sign of [-1, 1]) for (const aside of T.aside) put(spot.position.clone().addScaledVector(across, aside * sign), 0.35);
    }
    const C = RAID_CHAT_GATE_LAYOUT;
    for (let slot = 0; slot < C.slots; slot++) put(at(C.start + Math.floor(slot / 2) * C.spacing, C.aside * (slot % 2 ? 1 : -1)), 0.3);
    const P = RAID_PENNANT_WALL_LAYOUT;
    for (let row = 0; row < P.rows; row++) for (const side of [-1, 1]) for (const outward of P.outward) {
      put(at(row === 0 ? 0 : Math.ceil(row / 2) * P.spacing * (row % 2 ? 1 : -1), side * (P.aside + outward)), RAID_PENNANT_WALL_RADIUS);
    }
    return out;
  }

  /**
   * The formation's places for `count` marchers behind an optional leader: the leader's first, then rank by rank,
   * each kept only on ground the host's conservative sampler supports, clear of every piece of gate furniture and of
   * each other. A refused place is nudged toward the middle of the street once, then skipped; nobody is placed where
   * the host has not said there is ground.
   */
  function layOut(count: number): PartySlot[] {
    const here = site(), line = roadOf(), sample = ground;
    if (!here || !line || !sample) return [];
    const L = RAID_PARTY_LAYOUT, furniture = furnitureOf(here, line), placed: PartySlot[] = [];
    const supported = (along: number, aside: number): THREE.Vector3 | null => {
      if (along > line.inside - 1) return null;
      const spot = line.at(along), across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
      const p = spot.position.clone().addScaledVector(across, aside);
      if (furniture.some(f => Math.hypot(p.x - f.x, p.z - f.z) < f.r + L.body + L.air)) return null;
      if (placed.some(s => Math.hypot(p.x - s.position.x, p.z - s.position.z) < 2 * L.body + L.air)) return null;
      let height: number | null;
      try { height = sample(p.x, p.z); } catch { height = null; }
      if (height === null || !Number.isFinite(height)) return null;
      p.y = height;
      return p;
    };
    // The leader's place: in the middle of the street just inside the braziers (or a step further in).
    for (const along of [L.front, L.front + 0.6]) {
      const p = supported(along, 0);
      if (p) { placed.push({ along, aside: 0, rank: -1, lane: 0, role: 'leader', position: p }); break; }
    }
    const k = abreast || 2;
    for (let rank = 0; rank < RAID_PARTY_LIMITS.ranks && placed.length - (placed[0]?.role === 'leader' ? 1 : 0) < count; rank++) {
      const along = L.firstRank + rank * L.rankSpacing;
      for (let lane = 0; lane < k; lane++) {
        const aside = (lane - (k - 1) / 2) * L.lane;
        for (const tried of [aside, aside * 0.66]) {
          const p = supported(along, tried);
          if (!p) continue;
          const outer = lane === 0 || lane === k - 1;
          placed.push({ along, aside: tried, rank, lane, role: rank % L.bannerEvery === 0 && outer ? 'banner' : 'torch', position: p });
          break;
        }
      }
    }
    return placed;
  }

  /** The current place of a slot index, or null when the layout has no such place. */
  const slotAt = (index: number): PartySlot | null => slots[index] ?? null;
  const leaderSlot = () => (slots[0]?.role === 'leader' ? 0 : -1);

  /** Where a marcher is drawn now, before the set-out: their slot, the glide into it, the step in or the step back. */
  function standing(state: MarcherState, atMs: number): { position: THREE.Vector3; heading: number; moving: number; speed: number; walked: number; opacity: number; slot: PartySlot | null } | null {
    if (!here) return null;
    const out = here.facing.clone().negate(), outYaw = Math.atan2(out.x, out.z), B = RAID_PARTY_BEAT;
    if (state.leaveAt !== null) {
      // Turn back into the town, take a step or two and fade.
      const u = (atMs - state.leaveAt) / B.leave, from = state.leftFrom ?? state.leftSlot?.position;
      if (!from || u >= 1) return null;
      const position = from.clone().addScaledVector(here.facing, B.leaveStep * smooth(u));
      const speed = B.leaveStep * 6 * clamp01(u) * (1 - clamp01(u)) / (B.leave / 1000);
      return { position, heading: Math.atan2(here.facing.x, here.facing.z), moving: clamp01(speed / 1.1), speed, walked: state.walked + B.leaveStep * smooth(u),
        opacity: 1 - smooth(u), slot: state.leftSlot };
    }
    const slot = slotAt(state.slot);
    if (!slot) return null;
    let position = slot.position.clone(), heading = outYaw, moving = 0, speed = 0, walked = state.walked, opacity = 1;
    if (state.from) {
      const span = state.from.distanceTo(slot.position), time = Math.max(B.reform, span / 1.2 * 1500), u = (atMs - state.fromAt) / time;
      if (u < 1) {
        position = state.from.clone().lerp(slot.position, smooth(u));
        speed = span * 6 * clamp01(u) * (1 - clamp01(u)) / (time / 1000);
        moving = clamp01(speed / 1.1);
        const way = slot.position.clone().sub(state.from).setY(0);
        if (moving > 0.3 && way.lengthSq() > 1e-4) heading = Math.atan2(way.x, way.z);
        walked += span * smooth(u);
      } else walked += span;
    }
    if (Number.isFinite(state.joinAt)) {
      // Step in from behind (the town side) into the place, torch flaring as it is lit.
      const u = (atMs - state.joinAt) / B.join;
      if (u < 1) {
        const back = B.joinStep * (1 - smooth(u));
        position.addScaledVector(here.facing, back);
        const stepSpeed = B.joinStep * 6 * clamp01(u) * (1 - clamp01(u)) / (B.join / 1000);
        speed = Math.max(speed, stepSpeed); moving = Math.max(moving, clamp01(stepSpeed / 1.1));
        opacity = smooth(u / 0.7);
      }
      walked += B.joinStep * smooth(u);
    }
    return { position, heading, moving, speed, walked, opacity, slot };
  }

  /** Metres walked out by `elapsed` ms after stepping off: a short gathering of pace, then the column's steady walk. */
  const travelled = (elapsed: number, pace: number) => {
    if (elapsed <= 0) return 0;
    const s = elapsed / 1000, tau = RAID_PARTY_BEAT.accel / 1000;
    return pace * (s - tau * (1 - Math.exp(-s / tau)));
  };

  /**
   * The set-out's shape, fixed at Twitch's word so the column's progress never jumps: how far out the open road runs
   * before the dusk takes them (a short party fades sooner, so it is still seen whole), the pace that gets the last rank
   * out in time, and how far the ranks close up to pass between the braziers.
   */
  function setoutPlan(departedAt: number): SetoutPlan {
    if (planned?.departedAt === departedAt) return planned;
    const line = roadOf(), B = RAID_PARTY_BEAT;
    let deepest = 0, latest = 0, widest = 0.45;
    for (const state of marchers.values()) {
      const slot = slotAt(state.slot);
      if (!slot || state.leaveAt !== null) continue;
      deepest = Math.max(deepest, slot.along); latest = Math.max(latest, stepOff(slot)); widest = Math.max(widest, Math.abs(slot.aside));
    }
    const open = line && line.approach >= 6;
    const fadeTo = open ? Math.min(18, line.approach, 9 + deepest) : 5, fadeFrom = open ? Math.max(1.5, fadeTo - 8) : 1.5;
    const pace = Math.min(B.maxPace, Math.max(B.pace, (deepest + fadeTo) / Math.max(4, (B.setout - B.lastFade - latest) / 1000)));
    planned = { departedAt, fadeFrom, fadeTo, pace, narrow: Math.min(1, 0.95 / widest) };
    return planned;
  }
  /** When a place steps off after Twitch's word: the leader at once, then each rank a beat after the one before. */
  const stepOff = (slot: PartySlot) => slot.role === 'leader' ? 0 : RAID_PARTY_BEAT.reaction + slot.rank * RAID_PARTY_BEAT.ripple + slot.lane * 60;

  function marching(state: MarcherState, atMs: number, plan: SetoutPlan) {
    const before = standing(state, Math.max(plan.departedAt, state.joinAt + RAID_PARTY_BEAT.join));
    const slot = before?.slot ?? slotAt(state.slot), line = roadOf();
    if (!slot || !line || !before) return null;
    const B = RAID_PARTY_BEAT, elapsed = atMs - plan.departedAt, own = elapsed - stepOff(slot);
    const gone = travelled(own, plan.pace), s = slot.along - gone;
    // Through the gateway the ranks close up to pass between the braziers, and keep that width out on the road.
    const squeeze = plan.narrow + (1 - plan.narrow) * smooth((s - 2.6) / 2);
    const spot = line.at(s), across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
    const position = spot.position.clone().addScaledVector(across, slot.aside * squeeze);
    // From the stood ground onto the road's own line within the first metre.
    position.y = before.position.y + (spot.position.y - before.position.y) * smooth(gone);
    const speed = own > 0 ? plan.pace * (1 - Math.exp(-own / B.accel)) : 0;
    const heading = gone > 0.02 ? Math.atan2(-spot.tangent.x, -spot.tangent.z) : before.heading;
    const opacity = before.opacity * (1 - smooth((-s - plan.fadeFrom) / Math.max(0.5, plan.fadeTo - plan.fadeFrom)))
      * (1 - smooth((elapsed - (B.setout - B.lastFade)) / B.lastFade));
    return { position, heading, moving: clamp01(speed / 1.1), speed, walked: before.walked + gone, opacity, slot, outside: -s };
  }

  const setoutOver = (frame: RaidPartyPublicFrame | null, atMs: number) =>
    frame?.phase === 'setout' && frame.departedAt !== null && atMs - frame.departedAt >= RAID_PARTY_BEAT.setout;

  /** No party any more: whoever still stands steps back and fades, and the fires die down. */
  function end(atMs: number): void {
    if (!current) return;
    if (current.phase === 'setout') marchers.clear();
    else for (const state of marchers.values()) if (state.leaveAt === null) beginLeave(state, atMs);
    firesOutAt = current.phase === 'setout' && current.departedAt !== null ? Math.min(atMs, current.departedAt + RAID_PARTY_BEAT.setout) : atMs;
    current = null; phase = null; order = []; flareAt = signalAt = -Infinity;
  }

  /** Turns the newest frame into marcher state: who joined, who left, the phase's moments and each person's place. */
  function process(next: RaidPartyPublicFrame | null, atMs: number): void {
    // Twitch's word is final: a set-out already under way finishes even if the gate forgets the party meanwhile.
    if (!next) {
      if (current?.phase === 'setout' && !setoutOver(current, atMs)) { held = true; return; }
      end(atMs); return;
    }
    if (current && (setoutOver(current, atMs) || current.kingdomId !== next.kingdomId || current.origin !== next.origin)) { end(atMs); marchers.clear(); }
    const prior = current;
    if (!prior) presentSince = atMs;
    if (phase !== null && phase !== next.phase) {
      if (next.phase === 'countdown') flareAt = atMs;
      if (next.phase === 'setout') signalAt = atMs;
    }
    current = next; phase = next.phase; held = false;
    const keys = new Set(next.marchers.map(each => each.key));
    for (const state of marchers.values()) if (!keys.has(state.key) && state.leaveAt === null) beginLeave(state, atMs);
    for (const each of next.marchers) {
      let state = marchers.get(each.key);
      if (!state || state.leaveAt !== null) {
        // A fresh join steps in and lights a torch; someone already gathered when we arrived simply stands there.
        state = { key: each.key, name: each.name, look: each.look, walker: each.walker, leader: each.leader, slot: -1, from: null, fromAt: 0, walked: 0,
          joinAt: prior && next.asOf - each.joinedAt < RAID_PARTY_BEAT.fresh ? atMs : -Infinity, leaveAt: null, leftFrom: null, leftSlot: null, phase: hashOf(each.key) };
        marchers.set(each.key, state);
      }
      state.name = each.name; state.look = each.look; state.walker = each.walker; state.leader = each.leader;
    }
    order = next.marchers.map(each => each.key);
    assign(atMs);
  }

  function beginLeave(state: MarcherState, atMs: number): void {
    const now = standing(state, atMs);
    state.leftSlot = now?.slot ?? slotAt(state.slot);
    state.leftFrom = now?.position ?? state.leftSlot?.position.clone() ?? null;
    state.walked = now?.walked ?? state.walked;
    state.leaveAt = atMs; state.slot = -1; state.from = null;
  }

  /**
   * Every present marcher keeps their place while others come and go; a newcomer takes the frontmost free place.
   * Only when the street's width changes (two, three or four abreast) does everyone re-form, walking to their new place.
   */
  function assign(atMs: number): void {
    if (!current) return;
    const present = order.map(key => marchers.get(key)!).filter(state => state.leaveAt === null);
    const others = present.filter(state => !state.leader).length;
    const nextAbreast = partyAbreast(others, abreast);
    const key = JSON.stringify([here?.position.toArray(), here?.facing.toArray(), nextAbreast, road?.approach ?? -1]);
    if (key !== layoutKey || abreast !== nextAbreast) {
      const reforming = slots.length > 0;
      const before = new Map(present.map(state => [state.key, reforming ? standing(state, atMs) : null]));
      abreast = nextAbreast; layoutKey = key;
      slots = layOut(RAID_PARTY_DRAWN);
      const ranked = [...present].sort((x, y) => (x.slot < 0 ? Infinity : x.slot) - (y.slot < 0 ? Infinity : y.slot));
      for (const state of present) state.slot = -1;
      place(ranked);
      for (const state of present) {
        const was = before.get(state.key), slot = slotAt(state.slot);
        if (was && slot && was.position.distanceTo(slot.position) > 0.05) { state.walked = was.walked; state.from = was.position.clone(); state.fromAt = atMs; state.joinAt = -Infinity; }
      }
      return;
    }
    place(present.filter(state => state.slot < 0 || !slotAt(state.slot)));
  }

  function place(list: readonly MarcherState[]): void {
    const taken = new Set([...marchers.values()].filter(s => s.leaveAt === null && s.slot >= 0).map(s => s.slot));
    const lead = leaderSlot();
    for (const state of list) {
      if (state.leader && lead >= 0 && !taken.has(lead)) { state.slot = lead; taken.add(lead); continue; }
      for (let index = 0; index < slots.length; index++) {
        if (taken.has(index) || index === lead) continue;
        state.slot = index; taken.add(index); break;
      }
    }
  }

  /** What a hand holds: a torch, a pennant staff or the standard, upright through the grip, turned with the bearer. */
  function carried(grip: THREE.Matrix4 | undefined, heading: number, role: PartyRole, fade: number, flare: number, atMs: number, seed: number, set: ReturnType<typeof armsOf>, sway: number): void {
    if (!grip || !grip.elements.every(Number.isFinite) || fade <= 0.01) return;
    point.setFromMatrixPosition(grip);
    // Carried with a slight lean out from the body, the way a torch is held clear of the face.
    const lean = role === 'torch' ? 0.1 : 0.03;
    q.setFromEuler(new THREE.Euler(role === 'torch' ? -0.06 : 0, heading, -lean, 'YXZ'));
    const frame = new THREE.Matrix4().compose(point, q, one);
    if (role === 'torch') {
      const [gx, gy, gz] = PARTY_TORCH_CELLS.grip;
      pool(partyTorchBlueprint(host.kit), RAID_PARTY_LIMITS.torches).push(m.copy(frame).multiply(t.makeTranslation(cells(-gx, -gy, -gz))), fade);
      const [fx, fy, fz] = PARTY_TORCH_CELLS.flame, tip = cells(fx - gx, fy - gy, fz - gz).applyMatrix4(frame);
      const lit = fade * flare;
      for (let k = 0; k < 3; k++) {
        const [size, height] = TONGUES[k]!;
        const flicker = 1 + 0.16 * Math.sin(atMs * 0.015 + k * 1.7 + seed * TAU) + 0.07 * Math.sin(atMs * 0.035 + k + seed * 9);
        a.copy(tip).addScaledVector(UP, height * 0.32 * Math.min(1.5, flare));
        a.x += Math.sin(atMs * 0.011 + k * 2.3 + seed * 5) * 0.015;
        flames.push(a, size * 0.36 * flicker * Math.min(1.6, flare), atMs * 0.0013 * (k + 1) + seed * TAU, TONGUE_COLOURS[k]!, 1.3 + 0.4 * Math.min(1.6, flare), fade);
      }
      halos.push(a.copy(tip).addScaledVector(UP, 0.18), 1.25 * (0.75 + 0.25 * Math.min(1.6, flare)), TORCH_GLOW, 0.3 * lit);
      fires.push({ position: tip.toArray() as Vec3, strength: 0.6 * lit });
      drawn.torches++;
      return;
    }
    const kind: StaffKind = role === 'leader' ? 'standard' : 'banner', spec = PARTY_STAFF_CELLS[kind], [gx, gy, gz] = spec.grip;
    const staff = m.copy(frame).multiply(t.makeTranslation(cells(-gx, -gy, -gz)));
    pool(partyStaffBlueprint(host.kit, kind), kind === 'standard' ? 2 : RAID_PARTY_LIMITS.banners).push(staff, fade);
    if (!set) return;
    // The cloth hangs from under the crossbar out to the bearer's right, its arms reading the right way round from in
    // front; it lifts in the breeze and with the bearer's stride.
    const runs = kind === 'standard' ? set.standard : set.banner, width = spec.cloth.width;
    c.copy(staff).multiply(t.makeTranslation(cells(1 + width, spec.bar, 1)))
      .multiply(r.makeBasis(new THREE.Vector3(-1, 0, 0), UP, new THREE.Vector3(0, 0, -1)));
    const air = breeze(atMs, Math.floor(seed * 997));
    cloth(c, runs, row => (0.015 + air * 0.025 + sway) * ((row + 1) / runs.length) ** 1.3, fade);
    if (kind === 'standard') drawn.standard++; else drawn.banners++;
  }

  /** Rows of runs hanging down from `frame`'s origin (x across, y up, z out of the face). */
  function cloth(frame: THREE.Matrix4, runs: readonly (readonly Run[])[], sway: (row: number) => number, fade: number): void {
    for (let row = 0; row < runs.length; row++) {
      const out = sway(row);
      for (const run of runs[row]!) {
        m.copy(frame).multiply(t.makeTranslation(run.x0 * CELL, -(row + 1) * CELL, out)).multiply(r.makeScale(run.x1 - run.x0, 1, 1));
        dye(run.tincture).push(m, fade);
      }
    }
  }

  /** The gate's braziers, lit for the party; and with no leader marching, the crown's standard on the gate's pole. */
  function drawGate(fade: number, flare: number, atMs: number, set: ReturnType<typeof armsOf>, crown: boolean): void {
    if (!here || fade <= 0.01 || host.gateBusy?.()) return;
    const basis = new THREE.Matrix4().makeBasis(here.side, UP, here.facing), [bx, , bz] = BRAZIER_CELLS.pivot;
    for (const sign of [-1, 1]) {
      const base = here.position.clone().addScaledVector(here.facing, BRAZIER_IN).addScaledVector(here.side, BRAZIER_ASIDE * sign);
      pool(brazierBlueprint(host.kit), 2).push(m.copy(basis).setPosition(base).multiply(t.makeTranslation(cells(-bx, 0, -bz))), fade);
      fire(base, fade * flare, atMs, sign);
      drawn.braziers++;
    }
    if (!crown || !set) return;
    const pole = basis.clone().setPosition(a.copy(here.position).addScaledVector(here.side, POLE_ASIDE)), [gx, , gz] = GATE_CELLS.pivot;
    pool(gatePoleBlueprint(host.kit), 1).push(m.copy(pole).multiply(t.makeTranslation(cells(-gx, 0, -gz))), fade);
    const spec = GATE_CELLS.cloth;
    // Hung on the town side of the pole, so from in front of the gate the arms face the viewer over the party.
    c.copy(pole).multiply(t.makeTranslation(cells(spec.x - gx + spec.width, spec.top, 2 - gz)))
      .multiply(r.makeBasis(new THREE.Vector3(-1, 0, 0), UP, new THREE.Vector3(0, 0, -1)));
    const air = breeze(atMs, 211);
    cloth(c, set.gate, row => (air * 0.03) * ((row + 1) / spec.rows) ** 1.4, fade);
    drawn.crown = 1;
  }

  function fire(base: THREE.Vector3, flame: number, atMs: number, sign: number): void {
    if (flame <= 0.02) return;
    const coals = b.copy(base).addScaledVector(UP, BRAZIER_CELLS.fire[1] * CELL), lift = 0.7 + 0.3 * Math.min(1.4, flame);
    TONGUES.forEach(([size, height], k) => {
      const flicker = 1 + 0.14 * Math.sin(atMs * 0.013 + k * 1.7 + sign) + 0.06 * Math.sin(atMs * 0.031 + k * 0.9);
      point.copy(coals).addScaledVector(UP, height * lift);
      point.x += Math.sin(atMs * 0.009 + k * 2.3 + sign) * 0.03; point.z += Math.cos(atMs * 0.007 + k * 1.1) * 0.03;
      flames.push(point, size * (0.6 + 0.4 * Math.min(1.5, flame)) * flicker, atMs * 0.0012 * (k + 1) + sign, TONGUE_COLOURS[k]!, 1.2 + 0.5 * Math.min(1.5, flame));
    });
    halos.push(point.copy(coals).addScaledVector(UP, 0.55), 3.2 * (0.55 + 0.45 * Math.min(1.5, flame)), FIRE_GLOW, 0.5 * flame);
    groundLight.push(point.copy(base).addScaledVector(UP, 0.06), 7, FIRE_POOL, 0.24 * Math.min(1.3, flame));
    fires.push({ position: coals.toArray() as Vec3, strength: Math.min(1.3, flame) });
    if (flame < 0.4) return;
    for (let k = 0; k < 5; k++) {
      const rise = (((atMs / 1000 + k * 0.31 + (sign > 0 ? 0.13 : 0)) / 1.8) % 1 + 1) % 1;
      point.copy(coals).addScaledVector(UP, 0.3 + rise * 2.4);
      point.x += Math.sin(k * 2.1 + rise * 3) * 0.25; point.z += Math.cos(k * 1.3 + rise * 2.2) * 0.2;
      flames.push(point, 0.05 * (1 - rise * 0.6), k, EMBER, 1.6, (1 - rise) * Math.min(1, flame));
    }
  }

  function ensurePeople(): void {
    if (people || creating || !peoplePort || peopleFailed || disposed) return;
    const port = peoplePort;
    creating = port.create(RAID_PARTY_LIMITS.renderer).then(made => {
      if (disposed || port !== peoplePort) made.dispose(); else people = made;
    }, error => { peopleFailed = true; console.error('The gate party could not be drawn', error); }).finally(() => { if (port === peoplePort) creating = null; });
  }

  /** How bright the party's fires burn: lit as it gathers, a flare as Twitch holds the raid and another on its word. */
  function flareAt_(atMs: number): number {
    const B = RAID_PARTY_BEAT;
    const pulse = (from: number, size: number) => (atMs >= from ? size * Math.exp(-(atMs - from) / B.flare) : 0);
    return 1 + pulse(flareAt, 0.75) + pulse(signalAt, 0.5);
  }

  return {
    blueprints: (): VoxelBlueprint[] => [partyTorchBlueprint(host.kit), partyStaffBlueprint(host.kit, 'banner'), partyStaffBlueprint(host.kit, 'standard'),
      brazierBlueprint(host.kit), gatePoleBlueprint(host.kit), ...TINCTURE_LIST.map(tincture => dyeBlueprint(host.kit, tincture))],
    /** The current party, or null; the caller has checked its kingdom, origin and freshness. */
    receive(next: RaidPartyPublicFrame | null): void { if (!disposed) pending = next; },
    /** Supported standing ground in and around the street (lots, squares and water refused), or none: then nobody stands. */
    ground(sample: RaidChatGround | undefined): void { if (!disposed && sample !== ground) { ground = sample; layoutKey = ''; } },
    approachGround(sample: RaidChatGround | undefined): void { if (!disposed && sample !== approachGround) { approachGround = sample; road = undefined; layoutKey = ''; } },
    setShotClear(check: RaidShotClear | undefined): void { shotClear = check; },
    setPeople(port: MomentPeoplePort | undefined): void {
      if (disposed || port === peoplePort) return;
      peoplePort = port; people?.dispose(); people = null; creating = null; peopleFailed = false; lastPeople = 0;
    },
    apply(atMs: number, visible: boolean): void {
      if (disposed) return;
      for (const instances of pools.values()) instances.count = 0;
      flames.count = 0; halos.count = 0; groundLight.count = 0;
      drawn = { people: 0, leaving: 0, torches: 0, banners: 0, standard: 0, crown: 0, braziers: 0 };
      drawnWalkers = []; fires = []; lastAt = atMs; here = site();
      if (pending !== processed) { processed = pending; process(pending, atMs); }
      else if (current) assign(atMs);
      if (current) ensurePeople();
      const samples: CitizenSample[] = [], roles: { key: string; heading: number; role: PartyRole; fade: number; flare: number; seed: number; sway: number }[] = [];
      const set = current ? armsOf(current.kingdomId) : null, B = RAID_PARTY_BEAT, flare = flareAt_(atMs);
      const setout = current?.phase === 'setout' && current.departedAt !== null ? current.departedAt : null;
      const plan = setout !== null ? setoutPlan(setout) : null, over = setout !== null && atMs - setout >= B.setout;
      if (over) {
        for (const [key, state] of marchers) if (state.leaveAt === null) marchers.delete(key);
        if (firesOutAt < setout! + B.setout) firesOutAt = setout! + B.setout;
      }
      // The fires: lit as the party first gathers, burning while it waits, and dying down once it has gone.
      const fireFade = current && !over ? smooth((atMs - presentSince) / 1200) : 1 - smooth((atMs - firesOutAt) / B.fireOut);
      if (visible) drawGate(fireFade, flare, atMs, set, !!current && !over && !current.marchers.some(each => each.leader));
      const fallback = people ? (people.looks.has('hearth') ? 'hearth' : people.looks.values().next().value ?? null) : null;
      const countdownEnds = current?.phase === 'countdown' || current?.phase === 'checking' ? current.countdownEndsAt : null;
      if (visible && people && fallback) {
        // Present marchers first (leader first), then those stepping away while there is room under the cap.
        const states = [...order.map(key => marchers.get(key)).filter((s): s is MarcherState => !!s && s.leaveAt === null),
          ...[...marchers.values()].filter(s => s.leaveAt !== null).sort((x, y) => x.leaveAt! - y.leaveAt!)];
        for (const state of states) {
          if (samples.length >= RAID_PARTY_LIMITS.people) break;
          const pose = setout !== null && plan && state.leaveAt === null ? marching(state, atMs, plan) : standing(state, atMs);
          if (!pose) { if (state.leaveAt !== null) marchers.delete(state.key); continue; }
          if (state.leaveAt !== null && setout !== null) pose.opacity *= 1 - smooth((atMs - state.leaveAt) / 400);
          if (pose.opacity <= 0.01) continue;
          const role: PartyRole = state.leader ? 'leader' : pose.slot?.role === 'banner' ? 'banner' : 'torch';
          // The held breath: still, faces out through the gate, rising onto their toes in Twitch's last seconds.
          let lookYaw = 0, tiptoe = 0;
          if (current?.phase === 'gather' && setout === null) lookYaw = 0.28 * Math.sin(atMs / 1000 * 0.35 + state.phase * TAU) * Math.max(0, Math.sin(atMs / 1000 * 0.13 + state.phase * 11));
          if (countdownEnds !== null && pose.moving < 0.05) {
            const rising = smooth((atMs - (countdownEnds - B.breath)) / B.rise), settled = atMs > countdownEnds ? 1 - smooth((atMs - countdownEnds) / B.settle) : 1;
            tiptoe = 0.55 * rising * settled;
          }
          samples.push({ id: state.key, look: people.looks.has(state.look) ? state.look : fallback, position: pose.position.toArray() as [number, number, number],
            heading: pose.heading, distance: pose.walked + state.phase * 1.8, moving: pose.moving, speed: pose.speed, opacity: pose.opacity,
            time: atMs / 1000, lookYaw, lookPitch: countdownEnds !== null ? -0.04 : 0, tiptoe });
          const joining = Number.isFinite(state.joinAt) ? Math.max(0, 1 - (atMs - state.joinAt) / B.join) : 0;
          const step = pose.walked / 1.1 * TAU;
          roles.push({ key: state.key, heading: pose.heading, role, fade: pose.opacity, flare: flare + 0.8 * joining * joining, seed: state.phase,
            sway: pose.moving * Math.sin(step * 2) * 0.03 });
          if (state.leaveAt === null) drawn.people++; else drawn.leaving++;
          if (state.walker) drawnWalkers.push(state.walker);
        }
      }
      if (people && (samples.length || lastPeople)) {
        try { people.update(samples, atMs); } catch (error) { console.error('The gate party could not be posed', error); samples.length = 0; roles.length = 0; }
        lastPeople = samples.length;
      }
      if (people) for (const each of roles) carried(people.grips.get(each.key), each.heading, each.role, each.fade, each.flare, atMs, each.seed, set, each.sway);
      // One warm pool of torchlight under each rank, rather than one per torch, so a capital's party never burns the street white.
      if (samples.length) {
        const ranks = new Map<number, { at: THREE.Vector3; n: number; fade: number }>();
        for (const sample of samples) {
          const rank = Math.round(sample.position[0] * 0.5) * 1000 + Math.round(sample.position[2] * 0.5);
          const entry = ranks.get(rank) ?? { at: new THREE.Vector3(), n: 0, fade: 0 };
          entry.at.add(point.set(...sample.position)); entry.n++; entry.fade = Math.max(entry.fade, sample.opacity ?? 1); ranks.set(rank, entry);
        }
        for (const { at, n, fade } of ranks.values()) groundLight.push(at.divideScalar(n).addScaledVector(UP, 0.05), 3.4, FIRE_POOL, 0.13 * fade * Math.min(1.4, flare));
      }
      for (const instances of pools.values()) instances.flush();
      flames.flush(); halos.flush(); groundLight.flush();
    },
    /** Whether a party stands (or is setting out) at the gate now: the camera holds it only then. */
    present: (): boolean => drawn.people > 0 || (current !== null && drawn.braziers > 0 && (current.phase !== 'setout' || drawn.people > 0)),
    /** The public walker IDs this party is drawing at the gate, so a host can hide those bodies where they walk. */
    walkers: (): readonly string[] => drawnWalkers,
    /** The party's fires this frame (torches and braziers), for a host that feeds its light field: at most 44. */
    fires: (): readonly { position: Vec3; strength: number }[] => fires.slice(0, RAID_PARTY_LIMITS.people + 4),
    /** Each drawn place, for tests and the bench: key, place and role. */
    places: (): { key: string; slot: PartySlot }[] => [...marchers.values()].flatMap(state => { const slot = state.leaveAt === null ? slotAt(state.slot) : null; return slot ? [{ key: state.key, slot }] : []; }),
    slots: (): readonly PartySlot[] => slots,
    /**
     * The gathering seen from in front: out on the road beyond the gate, crane-high, looking back in at the party with
     * the braziers and the leader nearest and the dressed street and the town in haze behind. The nearest view that
     * holds the whole formation in the picture wins; views the adopted world refuses (a wall, a roof filling the side
     * of the picture) are skipped, tier by tier, as the arrival shot does. Set-out walks the column toward this eye and
     * fades it into the dusk before it reaches it.
     */
    *shots(aspect: number): Generator<RaidShotCandidate> {
      const here = site(), line = roadOf(), used = [...marchers.values()].flatMap(state => { const slot = state.leaveAt === null ? slotAt(state.slot) : null; return slot ? [slot] : []; });
      if (!here || !line) return;
      const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9, portrait = ratio < 1, fov = portrait ? 60 : 46;
      const front = used.find(slot => slot.role === 'leader')?.position ?? here.position.clone().addScaledVector(here.facing, RAID_PARTY_LAYOUT.front);
      const deepest = used.reduce((best, slot) => (slot.along > best.along ? slot : best), used[0] ?? { along: RAID_PARTY_LAYOUT.front, position: front } as PartySlot);
      const marks = [front.clone().add(new THREE.Vector3(0, 1.6, 0)), front.clone().add(new THREE.Vector3(0, 0.1, 0)), deepest.position.clone().add(new THREE.Vector3(0, 2.1, 0)),
        ...[-1, 1].map(sign => here.position.clone().addScaledVector(here.facing, BRAZIER_IN).addScaledVector(here.side, BRAZIER_ASIDE * sign).add(new THREE.Vector3(0, 1.3, 0))),
        ...used.filter(slot => slot.rank === 0).map(slot => slot.position.clone().add(new THREE.Vector3(0, 1.6, 0)))];
      const middle = front.clone().lerp(deepest.position, 0.4).add(new THREE.Vector3(0, portrait ? 1.6 : 1.3, 0));
      // Beyond where the column fades on its way out, when the road allows, so the set-out is watched to its end; nearer
      // views only when nothing out there stands clear.
      const fadeTo = line.approach >= 6 ? Math.min(18, line.approach, 9 + deepest.along) : 5;
      const fitted: RaidShotCandidate[] = [];
      const all = portrait ? [17, 20, 23, 26, 30] : [13, 15, 17, 20, 23, 26];
      const backs = [...all.filter(back => back >= fadeTo + 2), ...all.filter(back => back < fadeTo + 2).reverse()];
      for (const back of backs) for (const rise of [5.5, 7, 8.5, 4.5]) for (const aside of [0, 2.5, -2.5, 5, -5]) {
        const spot = line.at(-back), across = new THREE.Vector3().crossVectors(UP, spot.tangent).normalize();
        const eye = spot.position.clone().addScaledVector(across, aside).add(new THREE.Vector3(0, rise * (portrait ? 1.15 : 1), 0));
        if (!marks.every(mark => raidShotSees(mark, eye, middle, fov, ratio, 0.1))) continue;
        fitted.push([eye, middle.clone(), fov] as const);
      }
      const given = new Set<RaidShotCandidate>();
      if (shotClear) for (const maxBlocked of RAID_SHOT_FOREGROUND_TIERS) for (const shot of fitted) {
        if (given.has(shot) || !shotClear(shot[0], shot[1], maxBlocked === undefined ? { fov: shot[2], aspect: ratio } : { fov: shot[2], aspect: ratio, maxBlocked })) continue;
        given.add(shot); yield shot;
      }
      for (const shot of fitted) if (!given.has(shot) && (!shotClear || shotClear(shot[0], shot[1]))) yield shot;
    },
    /** A key for the party's shape: the camera re-frames only when the formation's depth changes. */
    shape: (): string => { const used = [...marchers.values()].filter(s => s.leaveAt === null && s.slot >= 0).map(s => slotAt(s.slot)?.rank ?? -1); return `${slots.length ? Math.max(-1, ...used) : -2}:${road?.approach ?? 0}`; },
    stats: () => {
      let instances = 0;
      for (const p of pools.values()) instances += p.count;
      const phaseCode = current ? ['gather', 'countdown', 'checking', 'setout'].indexOf(current.phase) : -1;
      return { phase: phaseCode, marchers: drawn.people, leaving: drawn.leaving, torches: drawn.torches, banners: drawn.banners, standard: drawn.standard,
        crownStandard: drawn.crown, braziers: drawn.braziers, slots: slots.length, abreast, more: current?.more ?? 0, instances,
        lights: flames.count + halos.count + groundLight.count, peopleReady: people ? 1 : 0, peopleFailed: peopleFailed ? 1 : 0,
        held: held ? 1 : 0, setout: current?.phase === 'setout' && current.departedAt !== null ? clamp01((lastAt - current.departedAt) / RAID_PARTY_BEAT.setout) : 0 };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      people?.dispose(); people = null; peoplePort = undefined;
      for (const instances of pools.values()) instances.dispose();
      pools.clear(); arms.clear(); marchers.clear(); order = []; slots = []; drawnWalkers = []; fires = [];
      flames.dispose(); halos.dispose(); groundLight.dispose(); current = pending = null;
      root.remove(layer);
    },
  };
}
export type RaidPartyLayer = ReturnType<typeof createRaidPartyLayer>;
