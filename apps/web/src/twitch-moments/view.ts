import * as THREE from 'three';
import type { RaidChatCue, RaidChatFrame, RaidPennantFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import {
  BANNER_CELLS, BANNER_TIERS, CELL, RIBBON_SLOTS, SHIMMER_PHASES, SWAG_CELLS, bannerBracket, bannerParts, bannerRibbon, type BannerKit, type BannerTier,
} from './banner';
import { breeze } from './choreography';
import { CameraPoseSchema, type CameraPose } from './contracts';
import type { FocusFrame, HomeDressFrame, MomentCue, MomentFrame, MomentPlace, MomentSubject, Tint } from './controller';
import { createDragonLayer } from './dragon-view';
import { createGiftLayer, type DoorAnchor, type GiftRoute, type PlaceAnchor } from './gift-view';
import { createRaidLayer, type RaidChatGround } from './raid-view';
import type { RaidShotClear } from './raid-shot';
import { createRaidPennantWall } from './raid-pennant-wall';
import { createSkyFlightLayer } from './sky-flight-view';
import { createSkyLightLayer } from './sky-light-view';
import type { CrowdCall } from './stage-beat';
import type { SpectacleLayerHost, SpectaclePlaces } from './spectacle';
import { createTrainLayer } from './train-view';
import { createDecreeLayer } from './decree-view';
import type { TownLayerHost } from './town';
import { createTownLayer } from './town-view';

export type { DoorAnchor, GiftRoute, PlaceAnchor } from './gift-view';

/** Public anchors for one home, supplied by the host's real settlement. Never derived from a deed. */
export interface HomeAnchor {
  /** Wall surface under the middle of the banner rod. */
  readonly mount: Vec3;
  /** Outward wall normal and the wall's right-hand direction, both horizontal unit vectors. */
  readonly normal: Vec3;
  readonly right: Vec3;
  /** The doorstep: what a shot of this home keeps in view. */
  readonly doorstep: Vec3;
}

export interface MomentSoundPort {
  /** Schedule a finite cue at kingdom time `atMs`; the return cancels it, including any tail. */
  play(cue: MomentCue, atMs: number, gain: number): () => void;
}

export interface CameraLease {
  read(): CameraPose;
  /** False once the lease has been revoked; the view then stops writing. */
  write(pose: CameraPose): boolean;
  release(): void;
}
export interface CameraLeasePort {
  acquire(owner: string, priority: number, signal: AbortSignal): CameraLease | null;
}

export interface MomentViewHost {
  /** A dedicated removable group under the real scene. The view owns only what it adds to it. */
  readonly parent: THREE.Group;
  /** The kingdom's crafted voxel material (build lattice). */
  readonly material: THREE.Material;
  readonly kit: BannerKit;
  /** Mesh a blueprint through the host's voxel pipeline. */
  mesh(blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry>;
  homeAnchor(slot: number): HomeAnchor | null;
  readonly sound: MomentSoundPort | null;
  readonly camera: CameraLeasePort | null;
  /** Current picture size, for shot composition and labels. */
  viewport(): { width: number; height: number };
  /** Optional host check of near bounds/occlusion; returning null forbids the pose. */
  validatePose?(pose: CameraPose): CameraPose | null;
  /** A home's real doorstep, for parcels; defaults to the banner anchor's doorstep. */
  doorAnchor?(slot: number): DoorAnchor | null;
  /** Supplied public places: the market where the gift cart stops, the gate where homeless recipients are welcomed. */
  placeAnchor?(place: 'market' | 'gate'): PlaceAnchor | null;
  /** The cart's real street route, gate to market and on out. Without one the cart stands at the market. */
  giftRoute?(): GiftRoute | null;
  /** The home's presence window, for its tier edge: centre on the glass, outward normal, right, pane size in metres. */
  windowAnchor?(slot: number): WindowAnchor | null;
  /** The town's sky, castle, plaza, lair, track, bunting runs and roofs, for cheers, the train and the dragon. */
  readonly places?: SpectaclePlaces;
  /** The sky's light on the town this frame: the host tints its night by it (fireworks flash, aurora, dragon fire). */
  light?(glow: SkyGlow): void;
  /**
   * The staged beat for the host's crowd, every frame: the stage and the point to turn toward, or null. The host
   * moves only its real present people (`chooseWatchers`, `crowdPose`); the view never adds a person to the town.
   */
  crowd?(call: CrowdCall | null): void;
  /** Where the host's present people would stand to watch, so a sky shot can keep a few of them in its foreground. */
  watchers?(): readonly Vec3[];
}

export interface SkyGlow {
  readonly colour: readonly [number, number, number];
  readonly strength: number;
  /**
   * The lamps' held breath before a staged climax, 0..1: the host dims its ambient (never its windows) by this share,
   * so the climax lands on a darker town and the warm windows read brighter. Absent means 0.
   */
  readonly hush?: number;
  /**
   * How far the sky has deepened toward night for this beat, 0..0.55 (Skyfire draws the dusk down before its aurora):
   * the host lowers its sky fill and moonlight by this share so the town sits under the same darker sky. Absent means 0.
   */
  readonly night?: number;
}
/**
 * The sky's light and the dragon's on the town, as one: colours weighted by strength, strengths combined as lights
 * (never past the sky's 0.6 cap), and the deeper of the two dusks.
 */
export function mergeGlow(a: SkyGlow, b: SkyGlow): SkyGlow {
  const total = a.strength + b.strength, mixed = (i: 0 | 1 | 2) => total > 0 ? (a.colour[i] * a.strength + b.colour[i] * b.strength) / total : 0;
  return { colour: [mixed(0), mixed(1), mixed(2)], strength: Math.min(0.6, 1 - (1 - a.strength) * (1 - b.strength)), night: Math.max(a.night ?? 0, b.night ?? 0) };
}
export interface RaidChatLabel { readonly cue: RaidChatCue; readonly x: number; readonly y: number; readonly distance: number; readonly opacity: number }

export interface ScreenNameplate { readonly id: string; readonly name: string; readonly x: number; readonly y: number }

const NO_PLACES: SpectaclePlaces = {
  sky: () => null, castle: () => null, plaza: () => null, lair: () => null, track: () => null, bunting: () => [], roof: () => null, homes: () => [],
};

export interface WindowAnchor { readonly centre: Vec3; readonly normal: Vec3; readonly right: Vec3; readonly width: number; readonly height: number }

export interface ScreenCaption {
  readonly id: string; readonly title: string; readonly line: string; readonly detail: string | null; readonly opacity: number; readonly x: number; readonly y: number;
}

const DIRECTOR_PRIORITY = 20;
const UP = new THREE.Vector3(0, 1, 0);
/** Most parts the view asks the host to mesh at once while preparing. */
const PREPARE_IN_FLIGHT = 24;
/** Farthest apart (m) two eyes may be for the director to glide between them rather than cut. */
const GLIDE_LIMIT = 30;
const EASE_IN_MS = 1500, EASE_OUT_MS = 1700, CANCEL_MS = 700, FOLLOW_MS = 1400;
const MOUNT = BANNER_CELLS.mount;
const local = (x: number, y: number, z: number) => new THREE.Vector3((x - MOUNT[0]) * CELL, (y - MOUNT[1]) * CELL, (z - MOUNT[2]) * CELL);
const smooth = (t: number) => { const v = Math.min(1, Math.max(0, t)); return v * v * (3 - 2 * v); };

interface HomeBanner {
  readonly root: THREE.Group;
  readonly tier: BannerTier;
  readonly bracket: THREE.Mesh;
  readonly head: THREE.Mesh;
  readonly rows: THREE.Mesh[];
  readonly roll: THREE.Group;
  readonly rollLapsed: THREE.Mesh;
  readonly ribbons: THREE.Mesh[];
  readonly ribbonsLapsed: THREE.Mesh[];
  readonly swag: THREE.Mesh | null;
  readonly swagLapsed: THREE.Mesh | null;
  /** Tier 3: each row's geometry per shimmer phase. */
  readonly shimmer: THREE.BufferGeometry[][];
}

/** The tier's edge on a present, named window: a slim frame of colour around the pane; the warm core is untouched. */
const EDGE: Record<Exclude<Tint, 'rainbow'>, number> = { gold: 0xf0c45e, rose: 0xec8fae };
const RAINBOW_EDGE = [0xe0574a, 0xee9440, 0xf0c45e, 0x7cbc6a, 0x5f93d6, 0x9a6fd0];
const EDGE_WIDTH = 0.045;
/** Tier 3's rainbow border marches one row per this many ms: a slow shimmer, never a strobe. */
const SHIMMER_MS = 340;

/**
 * Applies sampled frames to the host scene: banners on real homes, cue playback through the sound port and a
 * leased director shot. Every resource it creates is released on hide, frame removal or dispose.
 */
export function createTwitchMomentView(host: MomentViewHost) {
  const root = new THREE.Group();
  root.name = 'twitch-moments';
  host.parent.add(root);
  const geometries = new Map<string, Promise<THREE.BufferGeometry>>(), ready = new Map<string, THREE.BufferGeometry>();
  const banners = new Map<number, HomeBanner>();
  const edges = new Map<number, { group: THREE.Group; tint: Tint }>();
  const edgeMaterials = new Map<number, THREE.MeshBasicMaterial>(), edgeGeometry = new THREE.PlaneGeometry(1, 1);
  const playing = new Map<string, () => void>();
  let director: { focus: FocusFrame; lease: CameraLease; prior: CameraPose; shot: CameraPose; abort: AbortController; leaving: number | null; from: CameraPose | null;
    /** The followed subject's shot, once the shot has moved on to it; undefined until then, null when it has none. */
    second?: CameraPose | null } | null = null;
  let lastFrame: MomentFrame | null = null, disposed = false;
  const disposeListeners = new Set<() => void>();

  function geometry(blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry> {
    let promise = geometries.get(blueprint.id);
    if (!promise) {
      promise = host.mesh(blueprint).then(g => { if (disposed) g.dispose(); else ready.set(blueprint.id, g); return g; });
      geometries.set(blueprint.id, promise);
    }
    return promise;
  }

  const meshOf = (blueprint: VoxelBlueprint, position: THREE.Vector3) => {
    const g = ready.get(blueprint.id);
    if (!g) throw new Error('Moment part used before prepare()');
    const mesh = new THREE.Mesh(g, host.material);
    mesh.position.copy(position); mesh.frustumCulled = false; mesh.matrixAutoUpdate = true;
    return mesh;
  };

  const door = (slot: number): DoorAnchor | null => host.doorAnchor?.(slot) ?? host.homeAnchor(slot);
  const gifts = createGiftLayer(root, { kit: host.kit, door, place: place => host.placeAnchor?.(place) ?? null, route: () => host.giftRoute?.() ?? null,
    mesh: (blueprint, offset) => meshOf(blueprint, offset) });
  // The Raid Gate and its caravan, on the same supplied gate and road as the gift cart.
  const raid = createRaidLayer(root, { kit: host.kit, material: host.material, mesh: (blueprint, offset) => meshOf(blueprint, offset),
    place: place => host.placeAnchor?.(place) ?? null, route: () => host.giftRoute?.() ?? null });
  const pennantWall = createRaidPennantWall(root, { kit: host.kit, material: host.material, mesh: (blueprint, offset) => meshOf(blueprint, offset),
    place: place => host.placeAnchor?.(place) ?? null, route: () => host.giftRoute?.() ?? null });

  // The spectacle layers: the sky's light, what flies through it, the festival train and the dragon.
  const places = host.places ?? NO_PLACES;
  const spectacleHost: SpectacleLayerHost = { kit: host.kit, places, material: host.material, mesh: (blueprint, offset) => meshOf(blueprint, offset),
    meshAsync: blueprint => geometry(blueprint) };
  const skyLight = createSkyLightLayer(root, spectacleHost), flight = createSkyFlightLayer(root, spectacleHost);
  const trainLayer = createTrainLayer(root, spectacleHost), dragon = createDragonLayer(root, spectacleHost);
  const spectacles = [skyLight, flight, trainLayer, dragon];
  // The town as its channel shapes it: the grove, the relight, the gate's night and the bell; the decree board, the
  // town's colours on its bunting and a festival. Both stand only on what the host supplies.
  const townHost: TownLayerHost = { ...spectacleHost, door, window: slot => host.windowAnchor?.(slot) ?? null, gate: () => host.placeAnchor?.('gate') ?? null };
  const townLayer = createTownLayer(root, townHost), decree = createDecreeLayer(root, townHost);
  const glowNow = (): SkyGlow => mergeGlow(mergeGlow(skyLight.glow(), dragon.glow()), mergeGlow(townLayer.glow(), decree.glow()));

  /** Mesh every banner and gift part before the first meaningful frame, so no beat waits on a worker. */
  async function prepare(): Promise<void> {
    const parts: VoxelBlueprint[] = [bannerBracket(host.kit), ...RIBBON_SLOTS.flatMap((_, i) => [bannerRibbon(host.kit, i), bannerRibbon(host.kit, i, true)]), ...gifts.blueprints(), ...raid.blueprints(), ...pennantWall.blueprints(), ...spectacles.flatMap(layer => layer.blueprints()),
      ...townLayer.blueprints(), ...decree.blueprints()];
    for (const tier of BANNER_TIERS) {
      const p = bannerParts(tier, host.kit);
      parts.push(p.head, p.roll, p.rollLapsed, ...p.rows, ...p.shimmer.flat());
      if (p.swag) parts.push(p.swag, p.swagLapsed!);
    }
    // The host's voxel pipeline is a bounded queue shared with the town: feed it a few parts at a time, never all
    // several hundred at once.
    const unique = [...new Map(parts.map(part => [part.id, part])).values()];
    let next = 0;
    const lane = async () => { while (next < unique.length && !disposed) await geometry(unique[next++]!); };
    await Promise.all(Array.from({ length: Math.min(PREPARE_IN_FLIGHT, unique.length) }, lane));
  }

  function build(slot: number, tier: BannerTier, anchor: HomeAnchor): HomeBanner {
    const group = new THREE.Group();
    group.name = `banner-${slot}`;
    const [nx, , nz] = anchor.normal, [rx, , rz] = anchor.right;
    group.matrixAutoUpdate = false;
    group.matrix.makeBasis(new THREE.Vector3(rx, 0, rz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(...anchor.mount);
    const parts = bannerParts(tier, host.kit);
    const bracket = meshOf(bannerBracket(host.kit), local(0, 0, 0));
    const head = meshOf(parts.head, local(BANNER_CELLS.cloth.x, BANNER_CELLS.rod.y, 1));
    const rows = parts.rows.map((row, i) => meshOf(row, local(BANNER_CELLS.cloth.x, BANNER_CELLS.rod.y - 1 - i, BANNER_CELLS.cloth.z)));
    const roll = new THREE.Group();
    roll.add(meshOf(parts.roll, new THREE.Vector3(-4.5 * CELL, -1.5 * CELL, -1.5 * CELL)));
    const { x: clothX, z: clothZ } = BANNER_CELLS.cloth;
    // The lapsed roll sits exactly where the furled roll rests in its bracket.
    const rollLapsed = meshOf(parts.rollLapsed, local(clothX, BANNER_CELLS.rod.y - 2, clothZ - 1));
    const ribbons = RIBBON_SLOTS.map((s, i) => meshOf(bannerRibbon(host.kit, i), local(s.x, s.top - s.length + 1, s.z)));
    const ribbonsLapsed = RIBBON_SLOTS.map((s, i) => meshOf(bannerRibbon(host.kit, i, true), local(s.x, s.top - s.length + 1, s.z)));
    // The cloak swags over the rod in front of the head row; it frames the banner and never sways.
    const swag = parts.swag ? meshOf(parts.swag, local(SWAG_CELLS.x, SWAG_CELLS.y, SWAG_CELLS.z)) : null;
    const swagLapsed = parts.swagLapsed ? meshOf(parts.swagLapsed, local(SWAG_CELLS.x, SWAG_CELLS.y, SWAG_CELLS.z)) : null;
    const shimmer = parts.shimmer.map(phase => phase.map(row => ready.get(row.id)!));
    group.add(bracket, head, ...rows, roll, rollLapsed, ...ribbons, ...ribbonsLapsed);
    for (const cloak of [swag, swagLapsed]) if (cloak) group.add(cloak);
    root.add(group);
    return { root: group, tier, bracket, head, rows, roll, rollLapsed, ribbons, ribbonsLapsed, swag, swagLapsed, shimmer };
  }

  function remove(slot: number): void {
    const banner = banners.get(slot);
    if (!banner) return;
    root.remove(banner.root);
    banners.delete(slot);
  }

  function pose(banner: HomeBanner, dress: HomeDressFrame, atMs: number): void {
    const { rows: count, x: clothX, z: clothZ } = BANNER_CELLS.cloth;
    const air = breeze(atMs, dress.slot) * (dress.active ? 1 : 0.2);
    const seated = dress.drop < 0.02;
    // Furled and lapsed: the muted roll with its cream tie rests in the bracket. Nothing earned is taken down.
    const resting = !dress.active && dress.unfurl < 0.01 && dress.phase === 'idle';
    // The bracket is set with a weighted little settle as the roll arrives; it never sways.
    const setIn = dress.phase === 'anticipation' ? smooth((0.45 - dress.drop) / 0.12) : 1;
    banner.bracket.scale.setScalar(0.85 + 0.15 * setIn);
    banner.bracket.visible = dress.phase !== 'anticipation' || dress.drop < 0.4;
    banner.head.visible = seated;
    const length = dress.unfurl * count;
    const phase = banner.tier === '3' && dress.active ? Math.floor(atMs / SHIMMER_MS) % SHIMMER_PHASES : 0;
    banner.rows.forEach((row, i) => {
      const depth = (i + 1) / count;
      row.visible = seated && i + 1 <= length + 0.001;
      if (banner.shimmer.length) row.geometry = banner.shimmer[phase]![i]!;
      const out = (air * 0.028 + dress.swingPhase * 0.11) * depth ** 1.4;
      const side = Math.sin(atMs / 1000 * 1.9 + dress.slot + depth * 2.1) * 0.012 * depth * (dress.active ? 1 : 0);
      row.position.copy(local(clothX, BANNER_CELLS.rod.y - 1 - i, clothZ)).add(new THREE.Vector3(side, 0, Math.max(-0.02, out)));
    });
    // The roll rides down the wall, unwinding as it goes; it disappears once the cloth is fully out.
    const rollY = BANNER_CELLS.rod.y - length - 0.5;
    banner.roll.visible = dress.unfurl < 0.995 && !resting;
    banner.roll.position.copy(local(clothX + 4.5, rollY, clothZ + 0.5)).add(new THREE.Vector3(0, dress.drop, 0.03 * Math.min(1, length / 4)));
    const thickness = 1 - 0.55 * dress.unfurl;
    banner.roll.scale.set(1, thickness, thickness);
    banner.rollLapsed.visible = resting;
    if (banner.swag) banner.swag.visible = seated && !resting;
    if (banner.swagLapsed) banner.swagLapsed.visible = resting;
    RIBBON_SLOTS.forEach((slot, i) => {
      const earned = seated && i < dress.ribbons, newest = i === dress.ribbons - 1 && dress.ribbonDrop < 1.06 && dress.ribbonDrop !== 1;
      for (const [ribbon, show] of [[banner.ribbons[i]!, earned && !resting], [banner.ribbonsLapsed[i]!, earned && resting]] as const) {
        ribbon.visible = show && (!newest || dress.ribbonDrop > 0.02);
        // The newest ribbon falls from its knot: the tail grows down from the rod while the knot stays put.
        const fall = newest ? Math.max(0.02, dress.ribbonDrop) : 1;
        ribbon.scale.y = fall;
        ribbon.position.copy(local(slot.x, slot.top + 1, slot.z)).add(new THREE.Vector3(0, -slot.length * CELL * fall, air * 0.01));
      }
    });
  }

  function edgeMaterial(colour: number): THREE.MeshBasicMaterial {
    let material = edgeMaterials.get(colour);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      edgeMaterials.set(colour, material);
    }
    return material;
  }

  /** A slim tier-coloured frame just outside the presence pane: four strips, or twelve rainbow segments. */
  function buildEdge(anchor: WindowAnchor, tint: Tint): THREE.Group {
    const group = new THREE.Group(), w = anchor.width, h = anchor.height, e = EDGE_WIDTH;
    group.matrixAutoUpdate = false;
    const [nx, , nz] = anchor.normal, [rx, , rz] = anchor.right;
    group.matrix.makeBasis(new THREE.Vector3(rx, 0, rz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(...anchor.centre);
    group.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.012));
    // Around the pane clockwise from the top-left: top, right, bottom, left; each split in three for the rainbow.
    const sides: [number, number, number, number][] = [[0, h / 2 + e / 2, w + 2 * e, e], [w / 2 + e / 2, 0, e, h], [0, -h / 2 - e / 2, w + 2 * e, e], [-w / 2 - e / 2, 0, e, h]];
    sides.forEach(([x, y, sw, sh], side) => {
      const parts = tint === 'rainbow' ? 3 : 1;
      for (let k = 0; k < parts; k++) {
        const horizontal = sw > sh, f = (k + 0.5) / parts - 0.5;
        const colour = tint === 'rainbow' ? RAINBOW_EDGE[(side * 3 + k) % RAINBOW_EDGE.length]! : EDGE[tint];
        const strip = new THREE.Mesh(edgeGeometry, edgeMaterial(colour));
        strip.position.set(x + (horizontal ? f * sw : 0), y + (horizontal ? 0 : -f * sh), 0);
        strip.scale.set(horizontal ? sw / parts : sw, horizontal ? sh : sh / parts, 1);
        strip.renderOrder = 2;
        group.add(strip);
      }
    });
    root.add(group);
    return group;
  }

  function syncEdges(frame: MomentFrame): void {
    const wanted = new Map(frame.homes.filter(h => h.tint !== null).map(h => [h.slot, h.tint!] as const));
    for (const [slot, edge] of edges) if (wanted.get(slot) !== edge.tint) { root.remove(edge.group); edges.delete(slot); }
    for (const [slot, tint] of wanted) {
      if (edges.has(slot)) continue;
      const anchor = host.windowAnchor?.(slot);
      if (anchor) edges.set(slot, { group: buildEdge(anchor, tint), tint });
    }
  }

  function syncAudio(frame: MomentFrame): void {
    const wanted = new Set(frame.audio.map(c => c.id));
    for (const [id, cancel] of playing) if (!wanted.has(id)) { cancel(); playing.delete(id); }
    if (!host.sound || !frame.visible) return;
    for (const cue of frame.audio) {
      // Play each cue once, near its authored time; a seek far past it never fires a stale sound.
      if (playing.has(cue.id) || frame.atMs < cue.atMs - 120 || frame.atMs > cue.atMs + 400) continue;
      playing.set(cue.id, host.sound.play(cue.cue, cue.atMs, cue.gain));
    }
  }

  const checked = (eye: THREE.Vector3, target: THREE.Vector3, fov: number): CameraPose | null => {
    const candidate = CameraPoseSchema.safeParse({ eye: eye.toArray(), target: target.toArray(), fov });
    if (!candidate.success) return null;
    return host.validatePose ? host.validatePose(candidate.data) : candidate.data;
  };

  /** A close, slightly oblique shot of the banner and its doorstep, composed for the picture's shape. */
  function homeShot(slot: number): CameraPose | null {
    const { width, height } = host.viewport(), portrait = height > width;
    const anchor = host.homeAnchor(slot);
    if (!anchor) {
      // A home with no banner wall still has a doorstep: frame the door and the parcels beside it.
      const d = door(slot);
      if (!d) return null;
      const subject = new THREE.Vector3(...d.doorstep).add(new THREE.Vector3(0, 1.1, 0));
      const eye = subject.clone().addScaledVector(new THREE.Vector3(...d.normal), portrait ? 9 : 7).addScaledVector(new THREE.Vector3(...d.right), portrait ? 1.2 : 2.2).add(new THREE.Vector3(0, portrait ? 2.6 : 2, 0));
      return checked(eye, subject, portrait ? 56 : 44);
    }
    const mount = new THREE.Vector3(...anchor.mount), normal = new THREE.Vector3(...anchor.normal), right = new THREE.Vector3(...anchor.right);
    const doorstep = new THREE.Vector3(...anchor.doorstep);
    const subject = mount.clone().lerp(doorstep, 0.35).add(new THREE.Vector3(0, -0.15, 0));
    const eye = subject.clone().addScaledVector(normal, portrait ? 9.5 : 7.4).addScaledVector(right, portrait ? 1.4 : 2.6).add(new THREE.Vector3(0, portrait ? 1.6 : 1.2, 0));
    return checked(eye, subject, portrait ? 56 : 44);
  }

  /**
   * A home's front garden from the street: the whole house front, its door and the planting beside it, the eye a
   * little above head height and far enough out that the words over the door stay in frame.
   */
  function gardenShot(slot: number): CameraPose | null {
    const { width, height } = host.viewport(), portrait = height > width;
    const d = door(slot);
    if (!d) return homeShot(slot);
    const anchor = host.homeAnchor(slot);
    const normal = new THREE.Vector3(...d.normal), right = new THREE.Vector3(...d.right);
    const doorstep = new THREE.Vector3(...d.doorstep);
    const words = anchor ? new THREE.Vector3(...anchor.mount) : doorstep.clone().add(new THREE.Vector3(0, 2.4, 0));
    // Aim between the doorstep and the words, a touch toward the sapling's side of the door.
    const subject = doorstep.clone().lerp(words, 0.45).addScaledVector(right, 0.8);
    const eye = subject.clone().addScaledVector(normal, portrait ? 15 : 12).addScaledVector(right, portrait ? 2 : 4.2).add(new THREE.Vector3(0, portrait ? 3.4 : 2.8, 0));
    return checked(eye, subject, portrait ? 56 : 44) ?? homeShot(slot);
  }

  /** The decree board from across the square: its question over the poles and every pennant, the plaza behind. */
  function boardShot(): CameraPose | null {
    const { width, height } = host.viewport(), portrait = height > width;
    const stand = decree.stand();
    if (!stand) return null;
    const target = stand.origin.clone().add(new THREE.Vector3(0, portrait ? 3.8 : 3.4, 0));
    for (const [out, aside] of [[15, 2.5], [15, -2.5], [19, 0], [12, 4]] as const) {
      const eye = target.clone().addScaledVector(stand.facing, portrait ? out * 1.3 : out).addScaledVector(stand.right, aside).add(new THREE.Vector3(0, 0.6, 0));
      const pose = checked(eye, target, portrait ? 58 : 44);
      if (pose) return pose;
    }
    return null;
  }

  /**
   * The gathering: the cart's stop seen from behind it, looking toward where its parcels are bound, raised enough to
   * watch the waves lift over the roofs. A wide spread of homes pulls the shot back so the whole street stays in it.
   */
  function placeShot(place: 'market' | 'gate', prior: CameraPose, toward: readonly MomentSubject[]): CameraPose | null {
    const { width, height } = host.viewport(), portrait = height > width;
    let point: THREE.Vector3, across: THREE.Vector3;
    if (place === 'market') {
      const stop = gifts.stop();
      if (!stop) return null;
      point = stop.position; across = new THREE.Vector3().crossVectors(stop.tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const bound = toward.flatMap(t => { const d = t.kind === 'home' ? gifts.destination({ kind: 'home', slot: t.slot }) : gifts.destination({ kind: 'gate' }); return d ? [d] : []; });
      const centre = bound.length ? bound.reduce((sum, d) => sum.add(d), new THREE.Vector3()).divideScalar(bound.length) : null;
      const direction = centre ? centre.clone().sub(point).setY(0) : null;
      if (centre && direction && direction.lengthSq() > 4) {
        const ahead = direction.normalize();
        const side = new THREE.Vector3().crossVectors(ahead, new THREE.Vector3(0, 1, 0)).normalize();
        // How far the destinations fan out across the line of sight: a ward needs a wider, higher view than one door.
        const spread = Math.min(1, Math.max(...bound.map(d => Math.abs(d.clone().sub(centre).dot(side)))) / 24);
        const back = (portrait ? 14 : 12) + spread * 6, rise = (portrait ? 7.5 : 6) + spread * 3.5;
        const target = point.clone().addScaledVector(ahead, (portrait ? 7 : 9) + spread * 3).add(new THREE.Vector3(0, (portrait ? 3.6 : 3.2) + spread, 0));
        const eye = point.clone().addScaledVector(ahead, -back).addScaledVector(side, portrait ? 2.5 : 5).add(new THREE.Vector3(0, rise, 0));
        const aimed = checked(eye, target, (portrait ? 62 : 50) + spread * 6);
        if (aimed) return aimed;
      }
    } else {
      const gate = host.placeAnchor?.('gate');
      if (!gate) return null;
      point = new THREE.Vector3(...gate.position); across = new THREE.Vector3(...gate.facing).setY(0).normalize();
    }
    // Look from the side the viewer already stands on, so the cut reads as a step closer rather than a jump.
    if (across.dot(new THREE.Vector3(...prior.eye).sub(point)) < 0) across.negate();
    const target = point.clone().add(new THREE.Vector3(0, place === 'market' ? 1.6 : 1.1, 0));
    const eye = target.clone().addScaledVector(across, portrait ? 19 : 14).add(new THREE.Vector3(0, portrait ? 9 : 6.5, 0));
    return checked(eye, target, portrait ? 60 : 48);
  }

  /** The first candidate the host accepts: a shot never stands inside a wall or looks through one. */
  const first = (candidates: Iterable<readonly [THREE.Vector3, THREE.Vector3, number]>) => {
    for (const [eye, target, fov] of candidates) { const pose = checked(eye, target, fov); if (pose) return pose; }
    return null;
  };

  const framer = new THREE.PerspectiveCamera(), projected = new THREE.Vector3();
  /** Whether the view either side of the aim (about a third of the way out) is clear for 13 m. */
  function openSides(eye: THREE.Vector3, target: THREE.Vector3): boolean {
    const ahead = target.clone().sub(eye).setY(0).normalize();
    return [0.45, -0.45].every(turn => checked(eye, eye.clone().addScaledVector(ahead.clone().applyAxisAngle(UP, turn), 13).add(new THREE.Vector3(0, 0.6, 0)), 60) !== null);
  }

  /**
   * How many watchers a pose holds whole in its lower picture, near enough to read as people (5–48 m); with `seen`,
   * only those the host's sightline check can actually see from the eye.
   */
  function foreground(pose: CameraPose, watching: readonly Vec3[], seen = false): number {
    const { width, height } = host.viewport();
    framer.fov = pose.fov; framer.aspect = width / Math.max(1, height); framer.near = 0.5; framer.far = 400;
    framer.position.set(...pose.eye); framer.lookAt(...pose.target); framer.updateProjectionMatrix(); framer.updateMatrixWorld();
    let score = 0;
    for (const w of watching) {
      const distance = Math.hypot(w[0] - pose.eye[0], w[1] - pose.eye[1], w[2] - pose.eye[2]);
      if (distance < 5 || distance > 48) continue;
      // Feet and head both inside the picture's lower part: a whole person, not a cropped head.
      const feet = projected.set(w[0], w[1] + 0.05, w[2]).project(framer).clone(), head = projected.set(w[0], w[1] + 1.8, w[2]).project(framer);
      if (![feet, head].every(p => p.z > 0 && p.z < 1 && Math.abs(p.x) < 0.88 && p.y > -0.96 && p.y < 0.15)) continue;
      if (seen && !checked(new THREE.Vector3(...pose.eye), new THREE.Vector3(w[0], w[1] + 1.5, w[2]), pose.fov)) continue;
      score++;
    }
    return score;
  }

  /** Candidate turns (radians) about a subject, nearest the viewer's own side first. */
  const TURNS = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, Math.PI];
  const turned = (direction: THREE.Vector3, turn: number) => direction.clone().applyAxisAngle(UP, turn);

  /** Horizontal unit direction from a point toward where the viewer already stands, so cuts read as steps, not jumps. */
  const sideOf = (point: THREE.Vector3, prior: CameraPose) => {
    const d = new THREE.Vector3(...prior.eye).sub(point).setY(0);
    return d.lengthSq() > 1e-4 ? d.normalize() : new THREE.Vector3(0, 0, 1);
  };

  /**
   * The spectacle shots. The sky is watched from low in the town, roofs silhouetted against it; the castle from
   * across its walls; the plaza from the street. The train and the dragon move, so their shots keep the eye still
   * and turn to follow, like someone in the street watching them pass.
   */
  function spectacleShot(place: MomentPlace, prior: CameraPose): CameraPose | null {
    const { width, height } = host.viewport(), portrait = height > width;
    const sky = places.sky();
    switch (place) {
      case 'sky': {
        if (!sky) return null;
        const centre = new THREE.Vector3(...sky.centre), side = sideOf(centre, prior);
        const target = centre.clone().add(new THREE.Vector3(0, sky.ceiling * 0.52, 0));
        // Within the nearest workable distance, the turn that keeps the most watchers in the foreground: the town's
        // people under the sky they are looking at. Only from the town's front (castle toward the centre), where the
        // name and the emotes read the right way round; otherwise, and without watchers, the first legal pose.
        const watching = host.watchers?.() ?? [], castle = places.castle();
        const front = castle ? centre.clone().sub(new THREE.Vector3(...castle.crown)).setY(0) : null;
        if (front && front.lengthSq() > 1e-4) front.normalize();
        const facesFront = (eye: THREE.Vector3) => !!front && front.lengthSq() > 0.5 && eye.clone().sub(centre).setY(0).normalize().dot(front) >= 0.5;
        // Over the watchers' shoulders: a little behind and beside real present people on the town's front, low and
        // wide, so they stand in the lower picture with arms up under the sky they are watching. Kept only when a
        // watcher is plainly in sight and neither side is walled in; the sky stays the subject (aimed a little lower).
        if (watching.length >= 2 && front && front.lengthSq() > 0.5) {
          const low = centre.clone().add(new THREE.Vector3(0, sky.ceiling * 0.4, 0));
          let best: CameraPose | null = null, bestScore = 0;
          for (const w of watching) {
            const at = new THREE.Vector3(...w), out = at.clone().sub(centre).setY(0);
            if (out.lengthSq() < 1) continue;
            out.normalize();
            const across = new THREE.Vector3().crossVectors(out, UP);
            // Behind them, then beside them along the street (three-quarter on, the sky beyond).
            for (const [back, aside] of [[9, 2.5], [9, -2.5], [12, 0], [7, 4], [7, -4], [14, 5], [14, -5], [4, 8], [4, -8], [1, 10], [1, -10]] as const) {
              const eye = at.clone().addScaledVector(out, back).addScaledVector(across, aside).add(new THREE.Vector3(0, 2.4, 0));
              if (!facesFront(eye)) continue;
              const pose = checked(eye, low, portrait ? 74 : 64);
              // Open on both sides: no wall standing close across a third of the picture.
              if (!pose || !openSides(eye, low)) continue;
              const score = foreground(pose, watching, true);
              if (score > bestScore) { best = pose; bestScore = score; }
            }
          }
          if (best) return best;
        }
        for (const reach of [portrait ? 0.95 : 0.8, 0.62, 1.1]) {
          let fallback: CameraPose | null = null, best: CameraPose | null = null, bestScore = -1;
          for (const turn of TURNS) {
            const direction = turned(side, turn), eye = centre.clone().addScaledVector(direction, sky.radius * reach).add(new THREE.Vector3(0, portrait ? 6 : 5, 0));
            const pose = checked(eye, target, portrait ? 68 : 56);
            if (!pose) continue;
            fallback ??= pose;
            if (!watching.length || !facesFront(eye)) continue;
            const score = foreground(pose, watching);
            if (score > bestScore) { best = pose; bestScore = score; }
          }
          if (best ?? fallback) return best ?? fallback;
        }
        return null;
      }
      case 'castle': {
        const castle = places.castle();
        if (!castle) return sky ? spectacleShot('sky', prior) : null;
        const crown = new THREE.Vector3(...castle.crown), side = sideOf(crown, prior);
        const target = crown.clone().add(new THREE.Vector3(0, 7, 0));
        return first(function* () {
          for (const reach of [portrait ? 40 : 34, 46]) for (const turn of TURNS) {
            yield [crown.clone().addScaledVector(turned(side, turn), reach).add(new THREE.Vector3(0, -2, 0)), target, portrait ? 66 : 54] as const;
          }
        }());
      }
      case 'plaza': {
        const plaza = places.plaza();
        if (!plaza) return null;
        // The plaza's float rides 15 m and more over the stalls: stand back across the square and look up at it.
        const point = new THREE.Vector3(...plaza), side = sideOf(point, prior), target = point.clone().add(new THREE.Vector3(0, portrait ? 22 : 20, 0));
        return first(function* () {
          for (const reach of [portrait ? 36 : 32, 40, 26]) for (const turn of TURNS) {
            yield [point.clone().addScaledVector(turned(side, turn), reach).add(new THREE.Vector3(0, 4, 0)), target, portrait ? 68 : 58] as const;
          }
        }());
      }
      case 'train': {
        const at = trainLayer.focus();
        if (!sky || !at) return null;
        // From trackside, outside the loop, the town behind the train: the shot rides along with it.
        // Low, at a child's height by the rails, so the train stands against the town's roofs and the dusk over them.
        const out = at.clone().sub(new THREE.Vector3(...sky.centre)).setY(0).normalize(), target = at.clone().add(new THREE.Vector3(0, 2.6, 0));
        return first(function* () {
          for (const reach of [portrait ? 20 : 17, 24, 12]) for (const turn of [0, 0.35, -0.35, 0.7, -0.7]) {
            yield [at.clone().addScaledVector(turned(out, turn), reach).add(new THREE.Vector3(0, portrait ? 4.6 : 3.4, 0)), target, portrait ? 62 : 50] as const;
          }
        }());
      }
      case 'dragon':
      case 'lair': {
        const lair = places.lair(), at = place === 'dragon' ? dragon.focus() : null;
        if (!lair || !sky) return null;
        const centre = new THREE.Vector3(...sky.centre), den = new THREE.Vector3(...lair.position);
        const out = den.clone().sub(centre).setY(0).normalize(), target = at ?? den.clone().add(new THREE.Vector3(0, 5, 0));
        const fov = portrait ? 66 : 54;
        // At its lair the dragon is watched from behind its shoulder, three-quarters on, looking past it at what it
        // wakes to: the castle lit on its hill and the town's glow beyond. Aloft, from the far side of the town, seen
        // over the roofs as it comes.
        const toward = den.clone().addScaledVector(out, -30).add(new THREE.Vector3(0, 9, 0));
        const near = function* () {
          // Aimed between the dragon and the castle, so both stand in the picture.
          const aim = at ? at.clone().lerp(toward, 0.4) : toward;
          for (const reach of [36, 46, 28]) for (const rise of [9, 14]) for (const turn of [0.55, -0.55, 0.35, -0.35, 0.85, -0.85]) {
            yield [den.clone().addScaledVector(turned(out, turn), reach).add(new THREE.Vector3(0, rise, 0)), aim, fov] as const;
          }
        };
        const far = function* () {
          for (const reach of [0.55, 0.4, 0.75]) for (const rise of [portrait ? 7 : 6, 14]) for (const turn of TURNS.slice(0, 5)) {
            yield [centre.clone().addScaledVector(turned(out, turn), -sky.radius * reach).add(new THREE.Vector3(0, rise, 0)), target, fov] as const;
          }
        };
        const aloft = at !== null && at.y - den.y > 18;
        return first(function* () { yield* aloft ? far() : near(); yield* aloft ? near() : far(); }());
      }
      default: return null;
    }
  }

  /**
   * A cheer rising from a home: the roof and the sky over it, seen from the town's side of the home, so the
   * shells climb out of the cheerer's own street and burst in frame.
   */
  function homeSkyShot(slot: number, prior: CameraPose): CameraPose | null {
    const { width, height } = host.viewport(), portrait = height > width;
    const roof = places.roof(slot), anchor = host.homeAnchor(slot), at = roof ?? anchor?.mount, sky = places.sky();
    if (!at) return null;
    const point = new THREE.Vector3(...at), target = point.clone().add(new THREE.Vector3(0, portrait ? 6 : 4, 0));
    // From the town's side of the home, so its own street is in the picture; otherwise from where the viewer stands.
    const inward = sky ? new THREE.Vector3(...sky.centre).sub(point).setY(0) : null;
    const side = inward && inward.lengthSq() > 1 ? inward.normalize() : sideOf(point, prior);
    for (const reach of [portrait ? 38 : 36, 44, 28]) for (const turn of TURNS) {
      const eye = point.clone().addScaledVector(turned(side, turn), reach).add(new THREE.Vector3(0, 3, 0));
      // The home itself must be in sight, not only the sky over it.
      if (!checked(eye, point, portrait ? 70 : 66)) continue;
      const pose = checked(eye, target, portrait ? 70 : 66);
      if (pose) return pose;
    }
    return null;
  }


  /**
   * A moving subject's shot this frame. The train's shot rides along beside it; the dragon's keeps its eye and
   * turns to follow. Something passing in front for a moment is how the street sees it too, so only the eye is
   * held to the host's check here; the aim follows regardless.
   */
  function trackedShot(place: MomentPlace, held: CameraPose, prior: CameraPose): CameraPose | null {
    if (place === 'train') return spectacleShot('train', prior);
    const at = dragon.focus();
    if (!at) return null;
    // While it can be seen from where the shot stands, only the aim turns; once a wall or a hill hides it, the
    // shot finds a new place to watch from (a cut), and only with none left does the aim follow it blind.
    const seen = checked(new THREE.Vector3(...held.eye), at, held.fov);
    if (seen) return seen;
    const moved = spectacleShot('dragon', prior);
    if (moved) return moved;
    const pose = CameraPoseSchema.safeParse({ eye: held.eye, target: at.toArray(), fov: held.fov });
    return pose.success ? pose.data : null;
  }

  const MOVING = new Set<string>(['train', 'dragon']);
  /** While a raid holds the gate: from over the road inside the town, looking back at the standard and the column. */
  const raidShot = () => {
    if (!lastFrame?.visible || lastFrame.raids.length === 0) return null;
    const { width, height } = host.viewport();
    return first(raid.shots(width > 0 && height > 0 ? width / height : height > width));
  };
  /** Pixels between two pennant labels' centres below which the board is too far away to label each pennant. */
  const BOARD_LABEL_GAP = 150;
  const shotFor = (subject: MomentSubject, prior: CameraPose, toward: readonly MomentSubject[] = [], skyward = false, framing?: FocusFrame['framing']): CameraPose | null =>
    subject.kind === 'home' ? (skyward ? homeSkyShot(subject.slot, prior) : framing === 'garden' ? gardenShot(subject.slot) : homeShot(subject.slot))
      : (framing === 'board' ? boardShot() : null)
        ?? (subject.place === 'gate' ? raidShot() ?? placeShot('gate', prior, toward)
          : subject.place === 'market' ? placeShot(subject.place, prior, toward) : spectacleShot(subject.place, prior));

  /** World point a caption hangs above. */
  function captionPoint(subject: MomentSubject): THREE.Vector3 | null {
    if (subject.kind === 'home') {
      const anchor = host.homeAnchor(subject.slot);
      if (anchor) return new THREE.Vector3(...anchor.mount).add(new THREE.Vector3(0, 0.55, 0));
      const d = door(subject.slot);
      return d ? new THREE.Vector3(...d.doorstep).add(new THREE.Vector3(0, 2.4, 0)) : null;
    }
    const sky = places.sky();
    switch (subject.place) {
      case 'market': case 'gate': {
        // A woken Raid Gate carries its words over the standard's crossbar.
        const raised = subject.place === 'gate' ? raid.captionPoint() : null;
        if (raised) return raised;
        const point = subject.place === 'market' ? gifts.stop()?.position : (() => { const g = host.placeAnchor?.('gate'); return g ? new THREE.Vector3(...g.position) : null; })();
        // Just over the cart's pennant (2.1 m), so the card reads as the cart's, not the stall's behind it.
        return point ? point.clone().add(new THREE.Vector3(0, 2.6, 0)) : null;
      }
      // Sky captions hang low in the sky, under the bursts, so the words never cover the light they describe.
      case 'sky': return sky ? new THREE.Vector3(...sky.centre).add(new THREE.Vector3(0, sky.ceiling * 0.3, 0)) : null;
      case 'castle': { const c = places.castle(); return c ? new THREE.Vector3(...c.crown).add(new THREE.Vector3(0, 3, 0)) : null; }
      // A standing decree board carries the question over its poles.
      case 'plaza': { const board = decree.captionPoint(); if (board) return board; const p = places.plaza(); return p ? new THREE.Vector3(...p).add(new THREE.Vector3(0, 4.5, 0)) : null; }
      case 'train': return trainLayer.focus()?.clone().add(new THREE.Vector3(0, 3.4, 0)) ?? null;
      case 'dragon': return (dragon.head() ?? dragon.focus())?.clone().add(new THREE.Vector3(0, 4, 0))
        ?? (() => { const l = places.lair(); return l ? new THREE.Vector3(...l.position).add(new THREE.Vector3(0, 8, 0)) : null; })();
      case 'lair': { const l = places.lair(); return l ? new THREE.Vector3(...l.position).add(new THREE.Vector3(0, 8, 0)) : null; }
    }
  }

  /** Where the town turns to look for a staged subject: up into the sky, the home's banner, the cart, the train, the dragon. */
  function lookPoint(subject: MomentSubject): THREE.Vector3 | null {
    if (subject.kind === 'place' && subject.place === 'sky') {
      const sky = places.sky();
      return sky ? new THREE.Vector3(...sky.centre).add(new THREE.Vector3(0, sky.ceiling * 0.55, 0)) : null;
    }
    if (subject.kind === 'place' && subject.place === 'dragon') return dragon.head() ?? dragon.focus() ?? captionPoint(subject);
    return captionPoint(subject);
  }

  let crowdCalled = false;
  function callCrowd(frame: MomentFrame): void {
    const stage = frame.visible ? frame.stage : null, point = stage && stage.watchers > 0 ? lookPoint(stage.subject) : null;
    if (stage && point) { host.crowd?.({ ...stage, point: point.toArray() }); crowdCalled = true; }
    else if (crowdCalled) { host.crowd?.(null); crowdCalled = false; }
  }

  const mix = (a: CameraPose, b: CameraPose, t: number): CameraPose => {
    const k = smooth(t), lerp3 = (p: readonly number[], q: readonly number[]) => p.map((v, i) => v + (q[i]! - v) * k) as [number, number, number];
    return { eye: lerp3(a.eye, b.eye), target: lerp3(a.target, b.target), fov: a.fov + (b.fov - a.fov) * k };
  };

  function release(): void {
    if (!director) return;
    const { lease, prior, abort } = director;
    director = null;
    // Return to the actual prior view, then hand the camera back.
    lease.write(prior); lease.release(); abort.abort();
  }

  function direct(frame: MomentFrame): void {
    const atMs = frame.atMs, focus = frame.visible && frame.focus?.cut ? frame.focus : null;
    if (director && director.leaving === null && atMs < director.focus.endAt && (!focus || focus.id !== director.focus.id)) {
      // Cancelled or replaced before its end: leave promptly from wherever the shot is now.
      director.leaving = atMs; director.from = director.lease.read();
    }
    if (!director && focus && host.camera && atMs < focus.endAt) {
      const abort = new AbortController(), lease = host.camera.acquire('twitch-moments', DIRECTOR_PRIORITY, abort.signal);
      const subject = focus.subject, skyward = subject.kind === 'home'
        && frame.sky.some(beat => beat.kind === 'cheer' && beat.origin.kind === 'home' && beat.origin.slot === subject.slot);
      const prior = lease?.read(), shot = lease && prior ? shotFor(subject, prior, focus.follow ? [focus.follow.subject] : focus.toward, skyward, focus.framing) : null;
      // No legal shot of a supplied subject: hand the camera straight back rather than guess one.
      if (lease && prior && shot) director = { focus, lease, prior, shot, abort, leaving: null, from: null };
      else if (lease) { lease.release(); abort.abort(); }
    }
    if (!director) return;
    const { focus: f, lease, prior } = director;
    // A moving subject keeps its eye and turns to follow; a subject that leaves every legal pose keeps the last one.
    if (f.subject.kind === 'place' && MOVING.has(f.subject.place) && director.leaving === null) {
      const tracked = trackedShot(f.subject.place, director.shot, prior);
      if (tracked) director.shot = tracked;
    }
    // Following a parcel home: the shot glides from the gathering to the doorstep it is bound for.
    if (f.follow && atMs >= f.follow.at && director.second === undefined) director.second = shotFor(f.follow.subject, director.shot);
    const followed = f.follow && director.second ? director.second : null;
    const shot = followed ? mix(director.shot, followed, (atMs - f.follow!.at) / FOLLOW_MS) : director.shot;
    // A shot across the town is a cut, in and back: a glide between far-apart eyes would fly through roofs and hills.
    const far = (a: CameraPose, b: CameraPose) => Math.hypot(a.eye[0] - b.eye[0], a.eye[1] - b.eye[1], a.eye[2] - b.eye[2]) > GLIDE_LIMIT;
    let next: CameraPose;
    if (director.leaving !== null) {
      const t = (atMs - director.leaving) / CANCEL_MS;
      if (t >= 1 || far(director.from!, prior)) { release(); return; }
      next = mix(director.from!, prior, t);
    } else if (atMs >= f.endAt) {
      const t = (atMs - f.endAt) / EASE_OUT_MS;
      if (t >= 1 || far(shot, prior)) { release(); return; }
      next = mix(shot, prior, t);
    } else {
      next = far(prior, shot) ? shot : mix(prior, shot, (atMs - f.startAt) / EASE_IN_MS);
    }
    if (!lease.write(next)) { director.abort.abort(); director = null; }
  }

  return {
    prepare,
    /** Caller has checked the frame's origin and destination against this kingdom. */
    receiveRaidChat(frame: RaidChatFrame): void { if (!disposed) raid.chat(frame.cues, frame.lights); },
    /** The feature host supplies its adopted surface; no sampler means no stationary fixtures. */
    setRaidChatGround(sample: RaidChatGround | undefined): void { if (!disposed) raid.ground(sample); },
    /** The open land in front of the gate, from the adopted plan and terrain, that an incoming column may come down. */
    setRaidApproachGround(sample: RaidChatGround | undefined): void { if (!disposed) raid.approachGround(sample); },
    /** The adopted world's standing check for the gate shot: houses, the castle and the ground the eye may not enter. */
    setRaidShotClear(check: RaidShotClear | undefined): void { if (!disposed) raid.setShotClear(check); },
    raidPennantSites: () => pennantWall.sites(),
    /** The torch posts the current raid has actually drawn beside the street, for the scene's occupancy and light field. */
    raidTorchSites: () => raid.torchSites(),
    receiveRaidPennants(frame: RaidPennantFrame | null): void { if (!disposed) pennantWall.receive(frame); },
    setRaidPennantGround(sample: RaidChatGround | undefined): void { if (!disposed) pennantWall.ground(sample); },
    onDispose(listener: () => void): () => void {
      if (disposed) { listener(); return () => {}; }
      disposeListeners.add(listener);
      return () => { disposeListeners.delete(listener); };
    },
    raidChatLabels(camera: THREE.Camera): RaidChatLabel[] {
      if (!lastFrame?.visible) return [];
      const { width, height } = host.viewport(), eye = camera.getWorldPosition(new THREE.Vector3());
      const candidates = raid.chatAnchors().flatMap(({ cue, position, opacity }) => {
        const distance = eye.distanceTo(position), p = position.clone().project(camera);
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) return [];
        return [{ cue, x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, distance, opacity }];
      }).sort((a, b) => a.distance - b.distance);
      const out: RaidChatLabel[] = [];
      for (const candidate of candidates) {
        if (out.every(other => Math.abs(other.x - candidate.x) >= 180 || Math.abs(other.y - candidate.y) >= 76)) out.push(candidate);
        if (out.length === 3) break;
      }
      return out;
    },
    apply(frame: MomentFrame): void {
      if (disposed) return;
      lastFrame = frame;
      root.visible = frame.visible;
      const present = new Set<number>();
      for (const dress of frame.homes) {
        const anchor = host.homeAnchor(dress.slot);
        // An unavailable anchor shows nothing; a banner is never placed at a guessed address.
        if (!anchor) continue;
        let banner = banners.get(dress.slot);
        if (banner && banner.tier !== dress.tier) { remove(dress.slot); banner = undefined; }
        banner ??= build(dress.slot, dress.tier, anchor);
        banners.set(dress.slot, banner);
        pose(banner, dress, frame.atMs);
        present.add(dress.slot);
      }
      for (const slot of [...banners.keys()]) if (!present.has(slot)) remove(slot);
      syncEdges(frame);
      gifts.apply(frame);
      raid.apply(frame.visible ? frame.raids : [], frame.atMs);
      pennantWall.apply(frame.atMs, frame.visible);
      skyLight.apply(frame.visible ? frame.sky : [], frame.atMs);
      flight.apply(frame.visible ? frame.sky : [], frame.atMs);
      trainLayer.apply(frame.visible ? frame.train : null, frame.atMs);
      dragon.apply(frame.visible ? frame.dragon : null, frame.atMs);
      townLayer.apply(frame.town, frame.atMs);
      decree.apply(frame.town, frame.atMs);
      host.light?.(frame.visible ? { ...glowNow(), hush: Math.min(1, Math.max(0, frame.stage?.hush ?? 0)) } : { colour: [0, 0, 0], strength: 0, hush: 0 });
      callCrowd(frame);
      syncAudio(frame);
      if (frame.visible) direct(frame); else release();
    },
    labels(camera: THREE.Camera): ScreenCaption[] {
      if (!lastFrame?.visible) return [];
      const { width, height } = host.viewport(), out: ScreenCaption[] = [];
      for (const caption of lastFrame.captions) {
        const point = captionPoint(caption.at);
        if (!point) continue;
        const p = point.project(camera);
        if (p.z < 0 || p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
        out.push({ id: caption.id, title: caption.title, line: caption.line, detail: caption.detail, opacity: caption.opacity, x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 });
      }
      // Each pennant on the decree board is labelled under it: the choice, and its share of one-person votes.
      const board = lastFrame.town.board, points = board ? decree.choicePoints() : [];
      if (board && board.raised > 0.6) {
        const labels: ScreenCaption[] = [];
        board.choices.forEach((choice, i) => {
          const point = points[i];
          if (!point) return;
          const p = point.clone().project(camera);
          if (p.z < 0 || p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) return;
          labels.push({ id: `${board.key}:${choice.id}`, title: choice.title, line: `${Math.round(choice.share * 100)}%`, detail: choice.winner ? 'chosen' : null,
            opacity: Math.min(1, (board.raised - 0.6) / 0.4), x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 });
        });
        // Seen from across the town the pennants stand a few pixels apart: their labels would pile on each other and on
        // the question, so only a board near enough to read gets one under each pennant.
        const apart = labels.every((a, i) => labels.every((b, j) => j <= i || Math.abs(a.x - b.x) >= BOARD_LABEL_GAP || Math.abs(a.y - b.y) >= 64));
        if (apart) out.push(...labels);
      }
      return out;
    },
    /** The train's carriage nameplates: the observed contributors riding it, never an amount. */
    nameplates(camera: THREE.Camera): ScreenNameplate[] {
      if (!lastFrame?.visible || !lastFrame.train) return [];
      const { width, height } = host.viewport();
      return trainLayer.nameplates().flatMap(({ name, position }, i) => {
        const p = position.clone().project(camera);
        if (p.z < 0 || p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) return [];
        return [{ id: `plate:${i}`, name, x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }];
      });
    },
    /** The sky's light this frame, for hosts that tint their own lighting rather than take `light()` calls. */
    glow: glowNow,
    stats: (): Record<string, number | boolean> => ({ banners: banners.size, meshes: [...banners.values()].reduce((n, b) => n + b.root.children.length, 0), edges: edges.size,
      ...gifts.stats(), ...prefixed('sky', skyLight.stats()), ...prefixed('flight', flight.stats()), ...prefixed('train', trainLayer.stats()),
      ...prefixed('dragon', dragon.stats()), ...prefixed('raid', raid.stats()), ...prefixed('pennantWall', pennantWall.stats()),
      ...prefixed('town', townLayer.stats()), ...prefixed('decree', decree.stats()), geometries: ready.size, sounds: playing.size, leased: director !== null, attached: root.parent === host.parent,
      'stage.watchers': lastFrame?.visible && lastFrame.stage ? lastFrame.stage.watchers : 0, crowd: crowdCalled }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const listeners = [...disposeListeners];
      disposeListeners.clear();
      for (const listener of listeners) {
        try { listener(); } catch (error) { console.error('Moment view disposal listener failed', error); }
      }
      release();
      if (crowdCalled) { host.crowd?.(null); crowdCalled = false; }
      host.light?.({ colour: [0, 0, 0], strength: 0, hush: 0 });
      for (const cancel of playing.values()) cancel();
      playing.clear();
      for (const slot of [...banners.keys()]) remove(slot);
      for (const edge of edges.values()) root.remove(edge.group);
      edges.clear(); gifts.dispose(); raid.dispose(); pennantWall.dispose();
      for (const layer of spectacles) layer.dispose();
      townLayer.dispose(); decree.dispose();
      host.parent.remove(root);
      for (const material of edgeMaterials.values()) material.dispose();
      edgeMaterials.clear(); edgeGeometry.dispose();
      for (const g of ready.values()) g.dispose();
      ready.clear(); geometries.clear();
    },
  };
}
const prefixed = (prefix: string, stats: Readonly<Record<string, number>>) =>
  Object.fromEntries(Object.entries(stats).map(([key, value]) => [`${prefix}.${key}`, value]));

export type TwitchMomentView = ReturnType<typeof createTwitchMomentView>;
