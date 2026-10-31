import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import {
  BANNER_CELLS, BANNER_TIERS, CELL, RIBBON_SLOTS, SHIMMER_PHASES, SWAG_CELLS, bannerBracket, bannerParts, bannerRibbon, type BannerKit, type BannerTier,
} from './banner';
import { breeze } from './choreography';
import { CameraPoseSchema, type CameraPose } from './contracts';
import type { FocusFrame, HomeDressFrame, MomentCue, MomentFrame, MomentPlace, MomentSubject, Tint } from './controller';
import { createDragonLayer } from './dragon-view';
import { createGiftLayer, type DoorAnchor, type GiftRoute, type PlaceAnchor } from './gift-view';
import { createSkyFlightLayer } from './sky-flight-view';
import { createSkyLightLayer } from './sky-light-view';
import type { SpectacleLayerHost, SpectaclePlaces } from './spectacle';
import { createTrainLayer } from './train-view';

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
}

export interface SkyGlow { readonly colour: readonly [number, number, number]; readonly strength: number }
export interface ScreenNameplate { readonly id: string; readonly name: string; readonly x: number; readonly y: number }

const NO_PLACES: SpectaclePlaces = {
  sky: () => null, castle: () => null, plaza: () => null, lair: () => null, track: () => null, bunting: () => [], roof: () => null, homes: () => [],
};

export interface WindowAnchor { readonly centre: Vec3; readonly normal: Vec3; readonly right: Vec3; readonly width: number; readonly height: number }

export interface ScreenCaption {
  readonly id: string; readonly title: string; readonly line: string; readonly detail: string | null; readonly opacity: number; readonly x: number; readonly y: number;
}

const DIRECTOR_PRIORITY = 20;
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

  // The spectacle layers: the sky's light, what flies through it, the festival train and the dragon.
  const places = host.places ?? NO_PLACES;
  const spectacleHost: SpectacleLayerHost = { kit: host.kit, places, material: host.material, mesh: (blueprint, offset) => meshOf(blueprint, offset),
    meshAsync: blueprint => geometry(blueprint) };
  const skyLight = createSkyLightLayer(root, spectacleHost), flight = createSkyFlightLayer(root, spectacleHost);
  const trainLayer = createTrainLayer(root, spectacleHost), dragon = createDragonLayer(root, spectacleHost);
  const spectacles = [skyLight, flight, trainLayer, dragon];

  /** Mesh every banner and gift part before the first meaningful frame, so no beat waits on a worker. */
  async function prepare(): Promise<void> {
    const parts: VoxelBlueprint[] = [bannerBracket(host.kit), ...RIBBON_SLOTS.flatMap((_, i) => [bannerRibbon(host.kit, i), bannerRibbon(host.kit, i, true)]), ...gifts.blueprints(), ...spectacles.flatMap(layer => layer.blueprints())];
    for (const tier of BANNER_TIERS) {
      const p = bannerParts(tier, host.kit);
      parts.push(p.head, p.roll, p.rollLapsed, ...p.rows, ...p.shimmer.flat());
      if (p.swag) parts.push(p.swag, p.swagLapsed!);
    }
    await Promise.all(parts.map(geometry));
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
        const eye = centre.clone().addScaledVector(side, sky.radius * (portrait ? 0.95 : 0.8)).add(new THREE.Vector3(0, portrait ? 6 : 5, 0));
        const target = centre.clone().add(new THREE.Vector3(0, sky.ceiling * 0.52, 0));
        return checked(eye, target, portrait ? 68 : 56);
      }
      case 'castle': {
        const castle = places.castle();
        if (!castle) return sky ? spectacleShot('sky', prior) : null;
        const crown = new THREE.Vector3(...castle.crown), side = sideOf(crown, prior);
        const target = crown.clone().add(new THREE.Vector3(0, 7, 0));
        const eye = crown.clone().addScaledVector(side, portrait ? 40 : 34).add(new THREE.Vector3(0, -2, 0));
        return checked(eye, target, portrait ? 66 : 54);
      }
      case 'plaza': {
        const plaza = places.plaza();
        if (!plaza) return null;
        const point = new THREE.Vector3(...plaza), side = sideOf(point, prior);
        const eye = point.clone().addScaledVector(side, portrait ? 22 : 18).add(new THREE.Vector3(0, 3.5, 0));
        return checked(eye, point.clone().add(new THREE.Vector3(0, 9, 0)), portrait ? 64 : 52);
      }
      case 'train': {
        const at = trainLayer.focus();
        if (!sky || !at) return null;
        // From a raised spot inside the loop, on the viewer's side, turning to follow the train round the town.
        const centre = new THREE.Vector3(...sky.centre), side = sideOf(centre, prior);
        const eye = centre.clone().addScaledVector(side, sky.radius * 0.35).add(new THREE.Vector3(0, portrait ? 12 : 10, 0));
        return checked(eye, at.clone().add(new THREE.Vector3(0, 1.2, 0)), portrait ? 62 : 48);
      }
      case 'dragon':
      case 'lair': {
        const lair = places.lair(), at = place === 'dragon' ? dragon.focus() : null;
        if (!lair || !sky) return null;
        // Low on the town's far side from the hills, so the dragon is seen over the roofs as it comes.
        const centre = new THREE.Vector3(...sky.centre), out = new THREE.Vector3(...lair.position).sub(centre).setY(0).normalize();
        const eye = centre.clone().addScaledVector(out, -sky.radius * 0.55).add(new THREE.Vector3(0, portrait ? 7 : 6, 0));
        const target = at ?? new THREE.Vector3(...lair.position).add(new THREE.Vector3(0, 6, 0));
        return checked(eye, target, portrait ? 66 : 54);
      }
      default: return null;
    }
  }

  const MOVING = new Set<string>(['train', 'dragon']);
  const shotFor = (subject: MomentSubject, prior: CameraPose, toward: readonly MomentSubject[] = []) =>
    subject.kind === 'home' ? homeShot(subject.slot)
      : subject.place === 'market' || subject.place === 'gate' ? placeShot(subject.place, prior, toward) : spectacleShot(subject.place, prior);

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
        const point = subject.place === 'market' ? gifts.stop()?.position : (() => { const g = host.placeAnchor?.('gate'); return g ? new THREE.Vector3(...g.position) : null; })();
        // Just over the cart's pennant (2.1 m), so the card reads as the cart's, not the stall's behind it.
        return point ? point.clone().add(new THREE.Vector3(0, 2.6, 0)) : null;
      }
      // Sky captions hang low in the sky, under the bursts, so the words never cover the light they describe.
      case 'sky': return sky ? new THREE.Vector3(...sky.centre).add(new THREE.Vector3(0, sky.ceiling * 0.3, 0)) : null;
      case 'castle': { const c = places.castle(); return c ? new THREE.Vector3(...c.crown).add(new THREE.Vector3(0, 3, 0)) : null; }
      case 'plaza': { const p = places.plaza(); return p ? new THREE.Vector3(...p).add(new THREE.Vector3(0, 4.5, 0)) : null; }
      case 'train': return trainLayer.focus()?.clone().add(new THREE.Vector3(0, 3.4, 0)) ?? null;
      case 'dragon': return (dragon.head() ?? dragon.focus())?.clone().add(new THREE.Vector3(0, 4, 0))
        ?? (() => { const l = places.lair(); return l ? new THREE.Vector3(...l.position).add(new THREE.Vector3(0, 8, 0)) : null; })();
      case 'lair': { const l = places.lair(); return l ? new THREE.Vector3(...l.position).add(new THREE.Vector3(0, 8, 0)) : null; }
    }
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
      const prior = lease?.read(), shot = lease && prior ? shotFor(focus.subject, prior, focus.follow ? [focus.follow.subject] : focus.toward) : null;
      // No legal shot of a supplied subject: hand the camera straight back rather than guess one.
      if (lease && prior && shot) director = { focus, lease, prior, shot, abort, leaving: null, from: null };
      else if (lease) { lease.release(); abort.abort(); }
    }
    if (!director) return;
    const { focus: f, lease, prior } = director;
    // A moving subject keeps its eye and turns to follow; a subject that leaves every legal pose keeps the last one.
    if (f.subject.kind === 'place' && MOVING.has(f.subject.place) && director.leaving === null) {
      const tracked = spectacleShot(f.subject.place, prior);
      if (tracked) director.shot = { ...tracked, eye: director.shot.eye };
    }
    // Following a parcel home: the shot glides from the gathering to the doorstep it is bound for.
    if (f.follow && atMs >= f.follow.at && director.second === undefined) director.second = shotFor(f.follow.subject, director.shot);
    const followed = f.follow && director.second ? director.second : null;
    const shot = followed ? mix(director.shot, followed, (atMs - f.follow!.at) / FOLLOW_MS) : director.shot;
    let next: CameraPose;
    if (director.leaving !== null) {
      const t = (atMs - director.leaving) / CANCEL_MS;
      if (t >= 1) { release(); return; }
      next = mix(director.from!, prior, t);
    } else if (atMs >= f.endAt) {
      const t = (atMs - f.endAt) / EASE_OUT_MS;
      if (t >= 1) { release(); return; }
      next = mix(shot, prior, t);
    } else {
      next = mix(prior, shot, (atMs - f.startAt) / EASE_IN_MS);
    }
    if (!lease.write(next)) { director.abort.abort(); director = null; }
  }

  return {
    prepare,
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
      skyLight.apply(frame.visible ? frame.sky : [], frame.atMs);
      flight.apply(frame.visible ? frame.sky : [], frame.atMs);
      trainLayer.apply(frame.visible ? frame.train : null, frame.atMs);
      dragon.apply(frame.visible ? frame.dragon : null, frame.atMs);
      host.light?.(frame.visible ? skyLight.glow() : { colour: [0, 0, 0], strength: 0 });
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
    glow: (): SkyGlow => skyLight.glow(),
    stats: (): Record<string, number | boolean> => ({ banners: banners.size, meshes: [...banners.values()].reduce((n, b) => n + b.root.children.length, 0), edges: edges.size,
      ...gifts.stats(), ...prefixed('sky', skyLight.stats()), ...prefixed('flight', flight.stats()), ...prefixed('train', trainLayer.stats()),
      ...prefixed('dragon', dragon.stats()), geometries: ready.size, sounds: playing.size, leased: director !== null, attached: root.parent === host.parent }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      release();
      for (const cancel of playing.values()) cancel();
      playing.clear();
      for (const slot of [...banners.keys()]) remove(slot);
      for (const edge of edges.values()) root.remove(edge.group);
      edges.clear(); gifts.dispose();
      for (const layer of spectacles) layer.dispose();
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
