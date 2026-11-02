import * as THREE from 'three';
import { AVATAR_RIG, AVATAR_SOCKETS, VOXEL_METRES, type AvatarAttachmentId, type AvatarBoneId, type AvatarPartBlueprint, type AvatarCapeBlueprint, type MaterialRegistry, type VoxelAsset } from '@chatdom/shared';
import { geometryFromChunks, type VoxelRenderState } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createCitizenCapeRenderer } from './capes';
import { createFootstepState, stepFootsteps, type FootstepFloor, type FootstepGround, type FootstepState } from './footsteps';
import { meshStyledCitizen, STYLED_CITIZEN_RIG, type StyledCitizenLook } from './style-adapter';
import { createStyledCitizenMaterial, styledCitizenGeometry } from './style-material';
import { citizenLookFor } from './default-look';
import type { CitizenLookLibrary } from './look-library';

/** Vertical displacement of the seated head from its standing position. */
export const CITIZEN_SEATED_HEAD_OFFSET_METRES = -4 * VOXEL_METRES.avatar;

/** A compiled wardrobe part. The asset must be the ordered raster of the blueprint. */
export interface CitizenPart { readonly blueprint: AvatarPartBlueprint; readonly asset: VoxelAsset }
export interface CitizenLook { readonly id: string; readonly parts: readonly CitizenPart[]; readonly cape?: AvatarCapeBlueprint }
export type CitizenRenderLook = CitizenLook | StyledCitizenLook;
export type CitizenGesture = 'none' | 'nod' | 'wave' | 'bow' | 'cheer' | 'dance' | 'sit' | 'point';
export interface CitizenSample {
  readonly id: string;
  readonly look: string;
  readonly position: readonly [number, number, number];
  /** Rotation about +Y: zero faces +Z. */
  readonly heading: number;
  /** Total distance actually travelled, in metres. */
  readonly distance: number;
  /** Smooth movement weight from 0 (standing) to 1 (walking). */
  readonly moving: number;
  /** Actual metres per second for cloth lift and settling. */
  readonly speed?: number;
  /** Entrance/exit visibility; the voxel shader applies a screen-door fade. */
  readonly opacity?: number;
  /** Seated position is still the feet/sole datum, not the pelvis. */
  readonly posture?: 'seated';
  readonly gesture?: CitizenGesture;
  /** Shared simulation time in seconds, for gesture timing. */
  readonly time?: number;
  /** Head rotation relative to the body's heading, in radians. */
  readonly lookYaw?: number;
  /** Render-only head inclination, in radians. */
  readonly lookPitch?: number;
  readonly waveWeight?: number;
  /** Standing rise onto the toes, from 0 to 1. Ease this value at the call site. */
  readonly tiptoe?: number;
  /** The drawn ground under this walker while its body follows it (walk/ground `groundFor`): no sole goes under it. */
  readonly ground?: FootstepGround | undefined;
  /** Solid floors and stairs near the feet (walk/ground `floorAt`). */
  readonly floor?: FootstepFloor | undefined;
}
export interface CitizenFootfall {
  readonly id: string;
  readonly side: 'left' | 'right';
  /** Flat-ground sole position in world metres at touchdown. */
  readonly position: readonly [number, number, number];
}
export interface CitizenRendererOptions {
  readonly registry: MaterialRegistry;
  readonly material: VoxelRenderState;
  /** Prepared up front and kept for the renderer's life. */
  readonly looks?: readonly CitizenRenderLook[];
  readonly capacity?: number;
  readonly pool?: VoxelWorkerPool;
  /** Any other token is drawn once this library has it, built on first use; until then the sample is skipped. */
  readonly library?: CitizenLookLibrary;
  /** Library looks kept resident; beyond this, those not drawn for a minute are released. */
  readonly libraryLooks?: number;
}
interface Batch { readonly attachment: AvatarAttachmentId; mesh: THREE.InstancedMesh; readonly pivot: THREE.Matrix4; readonly seatedHem: boolean }
interface LookBatch {
  readonly batches: readonly Batch[]; readonly cape: AvatarCapeBlueprint | undefined; readonly capePaint?: StyledCitizenLook['capePaint'];
  readonly rig: typeof AVATAR_RIG; readonly headBounds: THREE.Box3 | undefined;
  /** Library looks start with a few instance slots and grow; `used` is the last update that asked for them. */
  readonly library?: { instances: number; used: number };
}

/** Library looks start this small: a saved look is usually worn by one person. */
const LIBRARY_LOOK_INSTANCES = 4;
const LIBRARY_LOOK_IDLE_MS = 60_000;

/**
 * Meshed voxel parts share one draw per part/look, not one draw per person.
 * Callers own the material, assets and optional worker pool. Samples are authoritative;
 * this layer never invents a citizen or a wardrobe selection.
 */
export async function createCitizenRenderer(scene: THREE.Scene, options: CitizenRendererOptions) {
  const capacity = options.capacity ?? 256;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Citizen capacity must be a positive integer.');
  const libraryLooks = options.libraryLooks ?? 96;
  const library = options.library;
  let pool = options.pool;
  const ownsPool = !options.pool;
  const group = new THREE.Group();
  const looks = new Map<string, LookBatch>();
  const meshes = new Set<THREE.InstancedMesh>();
  const paintedMaterials = new Map<'solid' | 'glass', THREE.ShaderMaterial>();
  const broken = new Set<string>();
  function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, instances: number, name: string) {
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(instances).fill(1), 1));
    const mesh = new THREE.InstancedMesh(geometry, material, instances);
    mesh.name = name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instance bounds change with every sample; cull the complete citizen below.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    if (material.transparent) mesh.renderOrder = 1;
    group.add(mesh); meshes.add(mesh);
    return mesh;
  }
  function addBatch(geometry: THREE.BufferGeometry, material: THREE.Material, attachment: AvatarAttachmentId, pivotCells: readonly number[], name: string, seatedHem = false, instances = capacity): Batch {
    const mesh = instanced(geometry, material, instances, name);
    const pivot = new THREE.Matrix4().makeTranslation(...pivotCells.map(n => -n * VOXEL_METRES.avatar) as [number, number, number]);
    return { attachment, mesh, pivot, seatedHem };
  }
  function release(mesh: THREE.InstancedMesh, geometry: boolean) {
    group.remove(mesh); meshes.delete(mesh);
    if (geometry) mesh.geometry.dispose();
    mesh.dispose();
  }
  // Union head-attached geometry in head-local metres once per look. Sockets
  // inherit the head pose; body parts and cloth must not affect this anchor.
  function headBoundsFor(batches: readonly Batch[]): THREE.Box3 | undefined {
    const bounds = new THREE.Box3().makeEmpty();
    for (const batch of batches) {
      const socket = batch.attachment === 'hat' || batch.attachment === 'face' ? AVATAR_SOCKETS[batch.attachment] : undefined;
      if (batch.attachment !== 'head' && !socket) continue;
      const geometry = batch.mesh.geometry;
      const packed = geometry.getAttribute('aPacked'), material = geometry.getAttribute('aMaterial');
      let partBounds: THREE.Box3;
      if (packed && material) {
        // Legacy voxel meshes store positions in two packed integers; their
        // geometry bounding box covers whole 32-cell chunks, not the model.
        partBounds = new THREE.Box3().makeEmpty();
        for (let i = 0; i < packed.count; i++) {
          const vertex = packed.getX(i) >>> 0, chunk = material.getX(i) >>> 0;
          partBounds.expandByPoint(new THREE.Vector3(
            (vertex & 63) + 32 * ((chunk >>> 16) & 31),
            ((vertex >>> 6) & 63) + 32 * ((chunk >>> 21) & 31),
            ((vertex >>> 12) & 63) + 32 * ((chunk >>> 26) & 31),
          ).multiplyScalar(VOXEL_METRES.avatar));
        }
      } else {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        partBounds = geometry.boundingBox?.clone() ?? new THREE.Box3().makeEmpty();
      }
      if (partBounds.isEmpty()) continue;
      const transform = batch.pivot.clone();
      if (socket) transform.premultiply(new THREE.Matrix4().makeTranslation(...socket.offset.map(n => n * VOXEL_METRES.avatar) as [number, number, number]));
      bounds.union(partBounds.applyMatrix4(transform));
    }
    return bounds.isEmpty() ? undefined : bounds;
  }
  // Painted looks mesh synchronously, so a library look can be built the first frame it is wanted.
  function preparePainted(look: StyledCitizenLook, instances = capacity): LookBatch {
    const batches: Batch[] = [];
    try {
      for (const part of meshStyledCitizen(look)) {
        let material = paintedMaterials.get(part.surface);
        if (!material) { material = createStyledCitizenMaterial(options.material, part.surface); paintedMaterials.set(part.surface, material); }
        batches.push(addBatch(styledCitizenGeometry(part.mesh, part.surface), material, part.attachment, part.pivot, `Citizen ${look.id} ${part.seatedHem ? 'hem' : part.attachment} ${part.surface}`, part.seatedHem, instances));
      }
    } catch (error) {
      for (const batch of batches) release(batch.mesh, true);
      throw error;
    }
    return { batches, cape: look.cape, ...(look.capePaint ? { capePaint: look.capePaint } : {}), rig: STYLED_CITIZEN_RIG, headBounds: headBoundsFor(batches) };
  }
  try {
    for (const look of options.looks ?? []) {
      if (looks.has(look.id)) throw new Error(`Duplicate citizen look ${look.id}.`);
      if ('kind' in look) { looks.set(look.id, preparePainted(look)); continue; }
      const batches: Batch[] = [];
      // Painted-only scenes need no voxel worker. Legacy assets keep their
      // established worker/registry path, including keepers and saved v1 looks.
      pool ??= new VoxelWorkerPool({ size: 2 });
      for (const { blueprint, asset } of look.parts) {
        if (asset.lattice !== 'avatar' || blueprint.lattice !== 'avatar' || asset.id !== blueprint.id) throw new Error(`Invalid avatar asset ${blueprint.id}.`);
        // Worker transfers its input; retain the caller's source for other consumers.
        const result = await pool.submit({ kind: 'asset', asset: { ...asset, voxels: asset.voxels.slice() }, materials: options.registry.materials, materialRevision: options.registry.revision });
        if (!result || result.kind !== 'asset') throw new Error(`Could not mesh avatar part ${blueprint.id}.`);
        batches.push(addBatch(geometryFromChunks(result.chunks, 'avatar'), options.material.material, blueprint.attachment, blueprint.pivot, `Citizen ${look.id} ${blueprint.id}`));
      }
      looks.set(look.id, { batches, cape: look.cape, rig: AVATAR_RIG, headBounds: headBoundsFor(batches) });
    }
  } catch (error) {
    for (const mesh of [...meshes]) release(mesh, true);
    for (const material of paintedMaterials.values()) material.dispose();
    if (ownsPool) pool?.dispose();
    throw error;
  }
  /** The look to draw for a token now, building a library look on first use; otherwise asks the library and skips. */
  function lookFor(token: string, now: number): LookBatch | undefined {
    const known = looks.get(token);
    if (known) {
      if (known.library) known.library.used = now;
      return known;
    }
    if (!library || broken.has(token)) return undefined;
    const recipe = library.has(token) ? library.recipe(token) : null;
    if (!recipe) { library.request(token); return undefined; }
    try {
      const built: LookBatch = { ...preparePainted(citizenLookFor(token, recipe), Math.min(capacity, LIBRARY_LOOK_INSTANCES)),
        library: { instances: Math.min(capacity, LIBRARY_LOOK_INSTANCES), used: now } };
      looks.set(token, built);
      return built;
    } catch (error) {
      // A recipe the library accepted but this build cannot draw stays a simple figure rather than failing every frame.
      broken.add(token);
      console.warn(`Citizen look ${token} could not be built.`, error);
      return undefined;
    }
  }
  function grow(look: LookBatch & { library: { instances: number } }, needed: number) {
    const instances = Math.min(capacity, Math.max(needed, look.library.instances * 2));
    for (const batch of look.batches) {
      const old = batch.mesh;
      release(old, false);
      batch.mesh = instanced(old.geometry, old.material as THREE.Material, instances, old.name);
    }
    look.library.instances = instances;
  }
  let lastSweep = -Infinity;
  // GPU memory stays bounded: beyond the resident count, library looks idle for a minute are released, oldest first.
  function sweep(now: number) {
    if (now - lastSweep < 1000) return;
    lastSweep = now;
    const resident = [...looks].filter(([, look]) => look.library);
    if (resident.length <= libraryLooks) return;
    resident.sort(([, a], [, b]) => a.library!.used - b.library!.used);
    let excess = resident.length - libraryLooks;
    for (const [token, look] of resident) {
      if (excess <= 0 || now - look.library!.used < LIBRARY_LOOK_IDLE_MS) break;
      for (const batch of look.batches) release(batch.mesh, true);
      looks.delete(token);
      excess--;
    }
  }
  scene.add(group);
  const capes = createCitizenCapeRenderer(scene, { registry: options.registry, material: options.material, capacity });
  const local = new THREE.Matrix4(), root = new THREE.Matrix4(), matrix = new THREE.Matrix4(), hemRotation = new THREE.Matrix4();
  const rotation = new THREE.Euler(), translation = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const poses = new Map<AvatarAttachmentId, THREE.Matrix4>();
  const grips = new Map<string, THREE.Matrix4>();
  const heads = new Map<string, THREE.Vector3>();
  const worldHeadBounds = new THREE.Box3();
  const footfalls: CitizenFootfall[] = [];
  const frustum = new THREE.Frustum(), projectionView = new THREE.Matrix4();
  // A generous radius covers the authored body, gait and short cloak as a
  // single culling unit, including their edges during a stride.
  const citizenBounds = new THREE.Sphere(new THREE.Vector3(), 2.5);
  type AnimatedGesture = Exclude<CitizenGesture, 'none' | 'sit'>;
  const gestureNames: readonly AnimatedGesture[] = ['nod', 'wave', 'bow', 'cheer', 'dance', 'point'];
  const animationById = new Map<string, { seated: number; heading: number; weights: Record<AnimatedGesture, number>; last: number; footsteps?: FootstepState }>();
  function pose(sample: CitizenSample, seated: number, heading: number, weights: Record<AnimatedGesture, number>, rig: typeof AVATAR_RIG, footstepState: FootstepState, now: number) {
    const locomotion = stepFootsteps(footstepState, { position: sample.position, heading, distance: sample.distance,
      moving: sample.moving * (1 - seated) * (1 - Math.max(0, Math.min(1, sample.tiptoe ?? 0))),
      speed: sample.speed ?? sample.moving * 1.2, timeMs: now, ground: sample.ground, floor: sample.floor });
    // Arms and torso follow the same distance-driven cycle as the planted legs.
    const phase = footstepState.phase * Math.PI * 2;
    const gait = Math.max(0, Math.min(1, sample.moving)) * (1 - seated);
    const stride = Math.sin(phase) * gait;
    // A standing-only toe pivot: raise the whole rig and pitch the feet about
    // the front of the sole, keeping that contact point on the ground.
    const tiptoe = Math.max(0, Math.min(1, sample.tiptoe ?? 0)) * (1 - seated) * (1 - Math.min(1, gait));
    const toeAngle = tiptoe * .42;
    const toeForward = 3 * VOXEL_METRES.avatar, ankleHeight = VOXEL_METRES.avatar;
    const toeLift = toeForward * Math.sin(toeAngle) - ankleHeight * (1 - Math.cos(toeAngle));
    const toeShift = toeForward * (1 - Math.cos(toeAngle)) + ankleHeight * Math.sin(toeAngle);
    // Slight counterrotation and opposing arms make the small silhouette read at street scale.
    const wave = weights.wave * Math.max(0, Math.min(1, sample.waveWeight ?? 1));
    const waveAngle = sample.waveWeight === undefined ? 1.75 : 2.65;
    const gestureTime = sample.time ?? 0;
    const sitAngle = -Math.PI / 2 * seated;
    const breath = Math.sin(gestureTime * 1.7) * .012 * seated;
    // Gestures own the upper body while the distance-driven legs keep walking.
    // Dancing is a planted sway, muted during movement to preserve the gait.
    const dance = weights.dance * (1 - gait) * (1 - seated);
    const danceBeat = Math.sin(gestureTime * 4.5);
    const cheerBeat = Math.sin(gestureTime * 5);
    const bow = weights.bow * (1 - seated);
    const point = weights.point;
    const cheer = weights.cheer;
    const rightGesture = Math.max(wave, point, cheer, dance);
    const leftGesture = Math.max(cheer, dance);
    const rotations: Partial<Record<AvatarBoneId, readonly [number, number, number]>> = {
      chest: [breath + bow * .48, -stride * .055 + dance * danceBeat * .16, stride * .025 + dance * danceBeat * .10],
      head: [Math.max(-.65, Math.min(.65, sample.lookPitch ?? 0)) + weights.nod * (.14 + .12 * Math.sin(gestureTime * 6)) + bow * .12, (sample.lookYaw ?? 0) + stride * .035, -stride * .025 - dance * danceBeat * .08],
      upperArmLeft: [(-stride * .30 - seated * .18) * (1 - leftGesture) - cheer * (.35 + .10 * cheerBeat) - dance * .35, 0, (.06 + seated * .08) * (1 - leftGesture) - cheer * (2.25 + .12 * cheerBeat) - dance * (1.05 + .25 * danceBeat)],
      upperArmRight: [(stride * .30 - seated * .18) * (1 - rightGesture) - .18 * wave - point * 1.35 - cheer * (.35 + .10 * cheerBeat) - dance * .35, 0, (-.06 - seated * .08) * (1 - rightGesture) + (waveAngle + .22 * Math.sin(gestureTime * 8)) * wave + point * .20 + cheer * (2.25 + .12 * cheerBeat) + dance * (1.05 - .25 * danceBeat)],
      thighLeft: [sitAngle + stride * .42, 0, 0], thighRight: [sitAngle - stride * .42, 0, 0],
      shinLeft: [-sitAngle + Math.max(0, stride) * .38, 0, 0], shinRight: [-sitAngle + Math.max(0, -stride) * .38, 0, 0],
      footLeft: [-stride * .42 - Math.max(0, stride) * .38 + toeAngle, 0, 0],
      footRight: [stride * .42 - Math.max(0, -stride) * .38 + toeAngle, 0, 0],
    };
    root.makeRotationY(heading); root.setPosition(...sample.position);
    root.elements[12]! += Math.sin(heading) * toeShift;
    // Standing on a slope the level pose rises just enough that neither sole cuts the ground; planted feet own it as they walk.
    root.elements[13]! += toeLift + locomotion.lift * (1 - locomotion.blend) * (1 - seated);
    root.elements[14]! += Math.cos(heading) * toeShift;
    for (const fall of locomotion.footfalls) footfalls.push({ id: sample.id, side: fall.side, position: [fall.sole.x, fall.sole.y, fall.sole.z] });
    const legBlend = locomotion.blend;
    const legRotations = new Map<AvatarBoneId, THREE.Quaternion>();
    if (legBlend > 0) {
      const inverseRoot = root.clone().invert();
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 'Left' : 'Right';
        const hip = new THREE.Vector3(i === 0 ? -.125 : .125,
          .5 - 4 * (1 - Math.cos(sitAngle)) * VOXEL_METRES.avatar - .075 * legBlend,
          4 * Math.sin(sitAngle) * VOXEL_METRES.avatar);
        const neutralFoot = new THREE.Vector3(hip.x, VOXEL_METRES.avatar, 0);
        const plantedAnkle = locomotion.feet[i]!.clone().add(new THREE.Vector3(Math.sin(heading) * toeShift, toeLift, Math.cos(heading) * toeShift));
        const target = neutralFoot.lerp(plantedAnkle.applyMatrix4(inverseRoot), legBlend);
        const reach = target.clone().sub(hip);
        const length = THREE.MathUtils.clamp(reach.length(), .063, .43749);
        const axis = reach.normalize();
        const forward = new THREE.Vector3(0, 0, 1);
        const bend = forward.addScaledVector(axis, -forward.dot(axis));
        if (bend.lengthSq() < 1e-6) bend.set(1, 0, 0).addScaledVector(axis, -axis.x);
        bend.normalize();
        const upper = .25, lower = .1875;
        const along = (upper * upper - lower * lower + length * length) / (2 * length);
        const knee = axis.clone().multiplyScalar(along).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
        const lowerDirection = axis.clone().multiplyScalar(length).sub(knee).normalize();
        const upperRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), knee.normalize());
        const lowerWorld = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), lowerDirection);
        const lowerRotation = upperRotation.clone().invert().multiply(lowerWorld);
        legRotations.set(`thigh${side}` as AvatarBoneId, upperRotation);
        legRotations.set(`shin${side}` as AvatarBoneId, lowerRotation);
        legRotations.set(`foot${side}` as AvatarBoneId, lowerWorld.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), toeAngle)));
      }
    }
    poses.clear();
    for (const bone of rig) {
      const angles = rotations[bone.id] ?? [0, 0, 0];
      rotation.set(...angles); quaternion.setFromEuler(rotation);
      if (legRotations.has(bone.id)) quaternion.copy(legRotations.get(bone.id)!);
      translation.set(...bone.offset).multiplyScalar(VOXEL_METRES.avatar);
      if (bone.id === 'pelvis') {
        // The four-cell thigh moves forward as it rises; move the body back and
        // down by the same amount so the vertical shins and feet stay planted.
        translation.y -= 4 * (1 - Math.cos(sitAngle)) * VOXEL_METRES.avatar + .075 * legBlend;
        translation.z += 4 * Math.sin(sitAngle) * VOXEL_METRES.avatar;
      }
      if (legBlend === 0 && (bone.id === 'thighLeft' || bone.id === 'thighRight')) {
        // The authored rig has separate thigh, shin and foot. Keep the sole level
        // and solve the hip's vertical offset from both rotating segments. The
        // planted foot stays at the datum; the swing foot clears the street.
        const legStride = bone.id === 'thighLeft' ? stride : -stride;
        const hip = legStride * .42;
        const knee = Math.max(0, legStride) * .38;
        const soleHeightCells = 4 * (Math.cos(sitAngle) - Math.cos(sitAngle + hip)) + 3 * (1 - Math.cos(hip + knee));
        translation.y += (-soleHeightCells + Math.max(0, legStride) * .9) * VOXEL_METRES.avatar;
      }
      local.compose(translation, quaternion, scale);
      const parent = bone.parent ? poses.get(bone.parent) : root;
      if (!parent) throw new Error(`Avatar rig parent missing: ${bone.parent}`);
      poses.set(bone.id, new THREE.Matrix4().multiplyMatrices(parent, local));
    }
    for (const [id, socket] of Object.entries(AVATAR_SOCKETS)) {
      const parent = poses.get(socket.parent)!;
      local.makeTranslation(...socket.offset.map(n => n * VOXEL_METRES.avatar) as [number, number, number]);
      poses.set(id as AvatarAttachmentId, new THREE.Matrix4().multiplyMatrices(parent, local));
    }
  }
  return {
    get grips(): ReadonlyMap<string, THREE.Matrix4> { return grips; },
    /** Visible head bounds top centre plus 8 cm, in world metres, for this update.
     * Opacity does not suppress an anchor; callers hide first-person labels themselves. */
    get heads(): ReadonlyMap<string, THREE.Vector3> { return heads; },
    /** Touchdowns for the most recent update only; consumed synchronously by presentation. */
    get footfalls(): readonly CitizenFootfall[] { return footfalls; },
    /** True when this token can be drawn now; otherwise it is asked for and the caller draws a simple figure meanwhile. */
    ready(token: string): boolean {
      if (looks.has(token)) return true;
      if (library && !broken.has(token)) {
        if (library.has(token)) return true;
        library.request(token);
      }
      return false;
    },
    /** Never throws for an unknown look: that sample is skipped this frame and its look asked of the library. */
    update(samples: readonly CitizenSample[], camera?: THREE.Camera, now = performance.now()) {
      if (samples.length > capacity) throw new Error(`Citizen count exceeds capacity ${capacity}.`);
      for (const mesh of meshes) mesh.count = 0;
      const drawn = samples.map(sample => lookFor(sample.look, now));
      const wanted = new Map<LookBatch, number>();
      for (const look of drawn) if (look?.library) wanted.set(look, (wanted.get(look) ?? 0) + 1);
      for (const [look, count] of wanted) if (count > look.library!.instances) grow(look as LookBatch & { library: { instances: number } }, count);
      grips.clear(); heads.clear(); footfalls.length = 0;
      capes.beginFrame(samples[0]?.time ?? 0);
      if (camera) {
        camera.updateWorldMatrix(true, false);
        projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projectionView, camera.coordinateSystem);
      }
      const seen = new Set<string>();
      for (const [index, sample] of samples.entries()) {
        seen.add(sample.id);
        const target = sample.posture === 'seated' || (sample.gesture === 'sit' && sample.moving < .1) ? 1 : 0;
        let transition = animationById.get(sample.id);
        if (!transition) {
          transition = { seated: target, heading: sample.heading, weights: { nod: 0, wave: 0, bow: 0, cheer: 0, dance: 0, point: 0 }, last: now };
          animationById.set(sample.id, transition);
        }
        const elapsed = Math.max(0, Math.min(100, now - transition.last));
        const step = elapsed / 280;
        transition.seated += Math.max(-step, Math.min(step, target - transition.seated));
        // Shortest arc avoids spinning through a full turn at the ±π seam.
        const turn = Math.atan2(Math.sin(sample.heading - transition.heading), Math.cos(sample.heading - transition.heading));
        transition.heading += turn * (1 - Math.exp(-elapsed / 90));
        for (const name of gestureNames) {
          const goal = sample.gesture === name ? 1 : 0;
          transition.weights[name] += Math.max(-step, Math.min(step, goal - transition.weights[name]));
        }
        transition.last = now;
        if (![...sample.position, sample.heading, sample.distance, sample.moving, sample.speed ?? sample.moving * 1.2, sample.opacity ?? 1, sample.lookYaw ?? 0, sample.lookPitch ?? 0, sample.waveWeight ?? 1, sample.time ?? 0, sample.tiptoe ?? 0].every(Number.isFinite)) throw new Error(`Invalid citizen sample ${sample.id}.`);
        const look = drawn[index];
        if (!look) continue;
        if (camera) {
          citizenBounds.center.set(sample.position[0], sample.position[1] + .75, sample.position[2]);
          if (!frustum.intersectsSphere(citizenBounds)) {
            // A hidden interval cannot produce delayed audio on re-entry.
            delete transition.footsteps;
            continue;
          }
        }
        transition.footsteps ??= createFootstepState({ position: sample.position, heading: transition.heading, distance: sample.distance, moving: sample.moving, speed: sample.speed ?? sample.moving * 1.2, timeMs: now });
        pose(sample, transition.seated, transition.heading, transition.weights, look.rig, transition.footsteps, now);
        grips.set(sample.id, poses.get('gripRight')!.clone());
        if (look.headBounds) {
          worldHeadBounds.copy(look.headBounds).applyMatrix4(poses.get('head')!);
          heads.set(sample.id, new THREE.Vector3((worldHeadBounds.min.x + worldHeadBounds.max.x) / 2, worldHeadBounds.max.y + .08, (worldHeadBounds.min.z + worldHeadBounds.max.z) / 2));
        }
        if (look.cape) capes.add({ id: sample.id, heading: transition.heading, distance: sample.distance, speed: (sample.speed ?? sample.moving * 1.2) * (1 - transition.seated), opacity: sample.opacity ?? 1 }, look.cape, poses.get('back')!, look.capePaint);
        for (const batch of look.batches) {
          const attachment = poses.get(batch.attachment);
          if (!attachment) throw new Error(`Unknown avatar attachment ${batch.attachment}.`);
          if (batch.seatedHem) {
            // A continuous voxel skirt follows the lap during the same seated
            // blend as the thighs, instead of sinking into the floor or tearing
            // into separate leg columns. This is not a shared rig/socket change.
            hemRotation.makeRotationX(-Math.PI / 2 * transition.seated);
            matrix.multiplyMatrices(attachment, hemRotation).multiply(batch.pivot);
          } else matrix.multiplyMatrices(attachment, batch.pivot);
          const index = batch.mesh.count++;
          batch.mesh.setMatrixAt(index, matrix);
          const fades = batch.mesh.geometry.getAttribute('aLodFade') as THREE.InstancedBufferAttribute;
          fades.setX(index, Math.max(0, Math.min(1, sample.opacity ?? 1)));
        }
      }
      for (const id of animationById.keys()) if (!seen.has(id)) animationById.delete(id);
      capes.endFrame();
      for (const mesh of meshes) {
        mesh.visible = mesh.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.geometry.getAttribute('aLodFade').needsUpdate = true;
      }
      sweep(now);
    },
    dispose() {
      grips.clear(); heads.clear(); footfalls.length = 0;
      animationById.clear();
      capes.dispose(); scene.remove(group);
      for (const mesh of [...meshes]) release(mesh, true);
      looks.clear(); broken.clear();
      for (const material of paintedMaterials.values()) material.dispose();
      if (ownsPool) pool?.dispose();
    },
  };
}

export { citizenLookFor, createDefaultCitizenLook, createDefaultCitizenLooks } from './default-look';
export { createCitizenLookLibrary, sharedCitizenLooks, lookTokenFor, type CitizenLookLibrary, type CitizenLookStatus } from './look-library';
export { createStyledCitizenLook, createWornCitizenLook, type StyledCitizenLook, type StyledCitizenRecipe } from './style-adapter';
