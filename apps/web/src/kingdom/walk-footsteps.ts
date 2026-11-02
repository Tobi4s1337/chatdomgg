import type { RealmWalkerPose } from '../realm/client';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { AUDIO_MATERIALS, FINISHED_FAMILIES, type AudioCueOptions, type AudioMaterial, type StepGround, type StepSurface } from '@chatdom/audio';
import { samplePublicGround, sampleLandWater, type RealmFoundedScene } from '@chatdom/world';
import { sampleGenesisSurface } from '@chatdom/world/genesis';

export interface WalkFootstepFrame {
  readonly now: number;
  readonly pose: Pick<RealmWalkerPose, 'distance' | 'x' | 'y' | 'z' | 'speed'> | undefined;
  readonly active: boolean;
  readonly grounded: boolean;
  readonly placement: number;
  readonly revision: number;
}

// The renderer's full left/right stride is 1.8 m. Contacts are its half-stride zero crossings.
const CONTACT_METRES = .9;

/** Observes the existing render clock and distance; never schedules or catches up missed footfalls. */
export function createWalkFootsteps() {
  let previous: WalkFootstepFrame | undefined;
  return {
    reset() { previous = undefined; },
    /** A contact's absolute index (for alternating feet), or null when nothing touches down this frame. */
    update(frame: WalkFootstepFrame): number | null {
      const prior = previous;
      const pose = frame.pose;
      if (!frame.active || !frame.grounded || !pose
        || ![frame.now, pose.distance, pose.x, pose.y, pose.z, pose.speed].every(Number.isFinite)) {
        previous = undefined;
        return null;
      }
      previous = frame;
      if (!prior?.pose || prior.placement !== frame.placement || prior.revision !== frame.revision) return null;
      const elapsed = frame.now - prior.now;
      const travel = pose.distance - prior.pose.distance;
      const displacement = Math.hypot(pose.x - prior.pose.x, pose.z - prior.pose.z);
      // Hidden tabs, relocations and reconciliation may advance the gait over several contacts. Consume
      // that observation silently. Ordinary 7 m/s sprint frames still pass, including a 100 ms frame.
      if (!(elapsed > 0 && elapsed <= 200) || travel < 0 || travel > CONTACT_METRES
        || displacement > CONTACT_METRES || Math.abs(pose.y - prior.pose.y) > .75) return null;
      const before = Math.floor(prior.pose.distance / CONTACT_METRES);
      const contact = Math.floor(pose.distance / CONTACT_METRES);
      return contact === before + 1 && pose.speed > .1 && displacement > .001 ? contact : null;
    },
  };
}

type StepScene = Pick<RealmFoundedScene, 'assets' | 'placements' | 'materials'>;
type Placed = { readonly placement: RealmFoundedScene['placements'][number]; readonly blueprint: RealmFoundedScene['assets'][number]['blueprint']; readonly home?: boolean };

/**
 * The step a solid voxel gives, by what it is made of. `indoor` is a home's own floor: boards there are the
 * floor's wood; out of doors (a bridge deck, a pier, a stall's boards) they are planks.
 */
function voxelStep(surface: string, indoor: boolean): StepSurface | undefined {
  switch (surface) {
    case 'wood': return indoor ? 'wood' : 'plank';
    case 'stone': case 'earth': case 'metal': case 'glass': case 'fabric': case 'grass': return surface;
    case 'plaster': return 'stone';
    default: return undefined;
  }
}

/** The solid voxel a sole rests on in one placement, read from its retained blueprint; later writes (air too) win. */
function readPlaced({ placement, blueprint }: Placed, materials: ReadonlyMap<number, { readonly solid: boolean; readonly surface: string }>,
  feet: Vec3): { readonly solid: boolean; readonly surface: string } | null | undefined {
  const unit = VOXEL_METRES[blueprint.lattice];
  const dx = feet[0] - placement.position[0], dz = feet[2] - placement.position[2];
  const local = placement.rotation === 0 ? [dx, dz] : placement.rotation === 1 ? [-dz, dx]
    : placement.rotation === 2 ? [-dx, -dz] : [dz, -dx];
  const cell = [Math.floor(local[0]! / unit), Math.floor((feet[1] - placement.position[1] - .001) / unit), Math.floor(local[1]! / unit)];
  if (!cell.every((value, axis) => value >= 0 && value < blueprint.size[axis]!)) return undefined;
  for (let index = blueprint.boxes.length - 1; index >= 0; index--) {
    const box = blueprint.boxes[index]!;
    if (!cell.every((value, axis) => value >= box.from[axis]! && value < box.to[axis]!)) continue;
    return materials.get(box.material) ?? null;
  }
  return undefined;
}

/** Samples only an accepted home's retained geometry, on contact; later writes (including air) win. */
export function createHomeStepMaterial(scene: StepScene) {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const homes = new Map(scene.placements.filter(placement => placement.plotId && assets.get(placement.assetHash)?.kind === 'home')
    .map(placement => [placement.plotId!, { placement, blueprint: assets.get(placement.assetHash)! }]));
  const materials = new Map(scene.materials.materials.map(material => [material.id, material]));
  return (plotId: string | null, feet: Vec3): StepSurface | undefined => {
    const home = plotId ? homes.get(plotId) : undefined;
    if (!home) return undefined;
    const voxel = readPlaced(home, materials, feet);
    return voxel?.solid ? voxelStep(voxel.surface, true) : undefined;
  };
}

/**
 * The placement a sole stands on in the street, whoever stands there: a bridge deck over a channel, a pier, the
 * castle steps, a stall's boards, the floor of someone's home seen from the street. Read from the same retained
 * blueprints the collision is compiled from, so the step is what is drawn under the foot. Undefined off every
 * placement (then the public ground decides). Placements are binned in 4 m cells; a step reads a few blueprints.
 */
export function createPlacementStepSurface(scene: StepScene) {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const materials = new Map(scene.materials.materials.map(material => [material.id, material]));
  const bins = new Map<string, Placed[]>();
  for (const placement of scene.placements) {
    const blueprint = assets.get(placement.assetHash);
    if (!blueprint) continue;
    const unit = VOXEL_METRES[blueprint.lattice], w = blueprint.size[0] * unit, d = blueprint.size[2] * unit;
    const [px, , pz] = placement.position, turn = placement.rotation;
    // The footprint after the cardinal turn (local [x, z] goes to [z, -x] per turn).
    const xs = turn === 0 ? [px, px + w] : turn === 1 ? [px, px + d] : turn === 2 ? [px - w, px] : [px - d, px];
    const zs = turn === 0 ? [pz, pz + d] : turn === 1 ? [pz - w, pz] : turn === 2 ? [pz - d, pz] : [pz, pz + w];
    const placed: Placed = { placement, blueprint, home: blueprint.kind === 'home' };
    for (let z = Math.floor(zs[0]! / 4); z <= Math.floor(zs[1]! / 4); z++) for (let x = Math.floor(xs[0]! / 4); x <= Math.floor(xs[1]! / 4); x++) {
      const key = `${x},${z}`, bin = bins.get(key);
      if (bin) bin.push(placed); else bins.set(key, [placed]);
    }
  }
  return (feet: Vec3): StepSurface | undefined => {
    for (const placed of bins.get(`${Math.floor(feet[0] / 4)},${Math.floor(feet[2] / 4)}`) ?? []) {
      const voxel = readPlaced(placed, materials, feet);
      if (voxel?.solid) return voxelStep(voxel.surface, placed.home === true);
    }
    return undefined;
  };
}

/** What the land's drawn-surface query answers (SEAMS A2), when the land offers it. */
export interface StepGroundSample { readonly surface: StepSurface; readonly waterDepth: number }

/**
 * The ground a public step lands on. The land's own painted surface wins once it can say (`surfaceAt`, SEAMS A2).
 * Until then only what is really known: standing in water is shallows; the castle's court and forecourt are laid
 * flagstones; other paving (streets, lanes, approaches, the market) is cobble; a trail is an earth path; every
 * other public and open ground is grass, never dirt by default. The home's installed floor is decided before this.
 */
export function createPublicStepSurface(plan: RealmFoundedScene['plan'],
  surfaceAt?: (x: number, z: number) => StepGroundSample | null) {
  const wet = (x: number, z: number) => plan.genesisSurface
    ? sampleGenesisSurface(plan.genesisSurface, x, z).shoreDistance < 0
    : (sampleLandWater(plan.landform, x, z)?.shoreDistance ?? 1) < 0;
  return (x: number, z: number): StepSurface => {
    const painted = surfaceAt?.(x, z);
    if (painted) return painted.waterDepth > .02 ? 'shallows' : painted.surface;
    if (wet(x, z)) return 'shallows';
    const ground = samplePublicGround(plan, x, z);
    if (ground && ground.pavingDistance <= 0) return ground.kind === 'court' || ground.kind === 'forecourt' ? 'stone' : 'cobble';
    if (ground?.kind === 'trail' && ground.reservedDistance <= 0) return 'earth';
    return 'grass';
  };
}

/**
 * The nearest finished building-material step for each outdoor ground, used only while the audio library does not
 * register that ground as its own `step:<ground>` family (the registration is with the audio owner,
 * `work/lanes/play/patches/audio-step-grounds.patch`). Grass and sand are soft earth, gravel and cobble and rock
 * are stone, boards out of doors are wood, snow is the muffled earth step, and shallows are earth until they can
 * splash.
 */
const NEAREST_MATERIAL: Readonly<Record<StepGround, AudioMaterial>> = {
  grass: 'earth', meadow: 'earth', gravel: 'stone', cobble: 'stone', plank: 'wood', sand: 'earth', snow: 'earth',
  shallows: 'earth', rock: 'stone',
};

/** What a `step` cue takes as its `material` in this build. */
type StepCueMaterial = NonNullable<AudioCueOptions['material']>;

/**
 * Turns a step surface into the `material` a `step` cue accepts in this build. A building material passes as it
 * is; a ground passes as itself once the library has finished `step:<ground>`, and as its nearest material before
 * that, so a step is never silent and never throws. `finished` is the library's own list (`FINISHED_FAMILIES`).
 */
export function createStepCueMaterial(finished: readonly string[] = FINISHED_FAMILIES) {
  const registered = new Set(finished);
  return (surface: StepSurface): StepCueMaterial => {
    if ((AUDIO_MATERIALS as readonly string[]).includes(surface)) return surface as AudioMaterial;
    // A registered ground is a valid material for `step` once the library's type carries it; until then this is the
    // one place the walk names it.
    if (registered.has(`step:${surface}`)) return surface as StepCueMaterial;
    return NEAREST_MATERIAL[surface as StepGround] ?? 'earth';
  };
}

/** Other walkers' steps are heard within this many metres of the camera. */
export const OTHERS_STEP_METRES = 12;
/** At most this many other walkers' steps start in any half second, nearest first: a crowd is heard, never a roar. */
export const OTHERS_STEPS_PER_HALF_SECOND = 6;
/** One walker's two feet never sound closer together than this. */
const OTHERS_STEP_GAP_MS = 180;
/**
 * Where another walker's step is placed for the ear: 6 dB under a step of yours at the same distance, and a little
 * duller. The kingdom's mix halves a step's level every `8 + 2d` metres (gain `1 / (1 + d / 8)`), so twice the
 * distance plus eight is exactly half the gain; the engine's mix itself is not changed.
 */
export function othersStepDistance(metres: number): number {
  return 8 + 2 * Math.max(0, metres);
}

/**
 * Chooses which footfalls of the people around you are heard this frame. The engine's step tier stays the hard cap;
 * this keeps the crowd inside a small share of it so your own steps (and building) rarely have to make room.
 * `falls` carry the distance from the camera; the result is nearest first.
 */
export function createOthersSteps() {
  const lastAt = new Map<string, number>();
  const recent: number[] = [];
  return {
    choose<T extends { readonly id: string; readonly distance: number }>(now: number, falls: readonly T[]): T[] {
      while (recent.length && now - recent[0]! >= 500) recent.shift();
      const heard: T[] = [];
      for (const fall of [...falls].sort((a, b) => a.distance - b.distance)) {
        if (!(fall.distance <= OTHERS_STEP_METRES)) break;
        if (recent.length >= OTHERS_STEPS_PER_HALF_SECOND) break;
        if (now - (lastAt.get(fall.id) ?? -Infinity) < OTHERS_STEP_GAP_MS) continue;
        lastAt.set(fall.id, now); recent.push(now); heard.push(fall);
      }
      if (lastAt.size > 256) for (const [id, at] of lastAt) if (now - at > 2000) lastAt.delete(id);
      return heard;
    },
    reset() { lastAt.clear(); recent.length = 0; },
  };
}
