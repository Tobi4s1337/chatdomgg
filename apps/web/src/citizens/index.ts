import * as THREE from 'three';
import { AVATAR_RIG, AVATAR_SOCKETS, VOXEL_METRES, type AvatarAttachmentId, type AvatarBoneId, type AvatarPartBlueprint, type AvatarCapeBlueprint, type MaterialRegistry, type VoxelAsset } from '@chatdom/shared';
import { geometryFromChunks, type VoxelRenderState } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createCitizenCapeRenderer } from './capes';

/** A compiled wardrobe part. The asset must be the ordered raster of the blueprint. */
export interface CitizenPart { readonly blueprint: AvatarPartBlueprint; readonly asset: VoxelAsset }
export interface CitizenLook { readonly id: string; readonly parts: readonly CitizenPart[]; readonly cape?: AvatarCapeBlueprint }
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
  readonly gesture?: 'none' | 'nod' | 'wave';
  /** Shared simulation time in seconds, for gesture timing. */
  readonly time?: number;
  /** Head rotation relative to the body's heading, in radians. */
  readonly lookYaw?: number;
}
export interface CitizenRendererOptions {
  readonly registry: MaterialRegistry;
  readonly material: VoxelRenderState;
  readonly looks: readonly CitizenLook[];
  readonly capacity?: number;
  readonly pool?: VoxelWorkerPool;
}
interface Batch { readonly part: AvatarPartBlueprint; readonly mesh: THREE.InstancedMesh; readonly pivot: THREE.Matrix4 }
interface LookBatch { readonly batches: readonly Batch[]; readonly cape: AvatarCapeBlueprint | undefined }

/**
 * Meshed voxel parts share one draw per part/look, not one draw per person.
 * Callers own the material, assets and optional worker pool. Samples are authoritative;
 * this layer never invents a citizen or a wardrobe selection.
 */
export async function createCitizenRenderer(scene: THREE.Scene, options: CitizenRendererOptions) {
  const capacity = options.capacity ?? 256;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Citizen capacity must be a positive integer.');
  const pool = options.pool ?? new VoxelWorkerPool({ size: 2 });
  const ownsPool = !options.pool;
  const group = new THREE.Group();
  const looks = new Map<string, LookBatch>();
  const geometries: THREE.BufferGeometry[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  try {
    for (const look of options.looks) {
      if (looks.has(look.id)) throw new Error(`Duplicate citizen look ${look.id}.`);
      const batches: Batch[] = [];
      for (const { blueprint, asset } of look.parts) {
        if (asset.lattice !== 'avatar' || blueprint.lattice !== 'avatar' || asset.id !== blueprint.id) throw new Error(`Invalid avatar asset ${blueprint.id}.`);
        // Worker transfers its input; retain the caller's source for other consumers.
        const result = await pool.submit({ kind: 'asset', asset: { ...asset, voxels: asset.voxels.slice() }, materials: options.registry.materials, materialRevision: options.registry.revision });
        if (!result || result.kind !== 'asset') throw new Error(`Could not mesh avatar part ${blueprint.id}.`);
        const geometry = geometryFromChunks(result.chunks, 'avatar');
        geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1));
        const mesh = new THREE.InstancedMesh(geometry, options.material.material, capacity);
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Instance bounds change with every sample; avoid stale geometry bounds culling moving citizens.
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        group.add(mesh); geometries.push(geometry); meshes.push(mesh);
        const pivot = new THREE.Matrix4().makeTranslation(...blueprint.pivot.map(n => -n * VOXEL_METRES.avatar) as [number, number, number]);
        batches.push({ part: blueprint, mesh, pivot });
      }
      looks.set(look.id, { batches, cape: look.cape });
    }
  } catch (error) {
    for (const geometry of geometries) geometry.dispose();
    if (ownsPool) pool.dispose();
    throw error;
  }
  scene.add(group);
  const capes = createCitizenCapeRenderer(scene, { registry: options.registry, material: options.material, capacity });
  const local = new THREE.Matrix4(), root = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  const rotation = new THREE.Euler(), translation = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const poses = new Map<AvatarAttachmentId, THREE.Matrix4>();
  const frustum = new THREE.Frustum(), projectionView = new THREE.Matrix4();
  // A generous radius covers the authored body, gait and short cloak as a
  // single culling unit, including their edges during a stride.
  const citizenBounds = new THREE.Sphere(new THREE.Vector3(), 2.5);
  function pose(sample: CitizenSample) {
    // One full left/right stride over 1.8 metres. The old .75 m cycle made ordinary 4 m/s walking
    // churn through more than five cycles a second; distance still keeps stops and corrections planted.
    const phase = sample.distance * Math.PI * 2 / 1.8;
    const gait = Math.max(0, Math.min(1, sample.moving));
    const stride = Math.sin(phase) * gait;
    // Slight counterrotation and opposing arms make the small silhouette read at street scale.
    const wave = sample.gesture === 'wave';
    const gestureTime = sample.time ?? 0;
    const rotations: Partial<Record<AvatarBoneId, readonly [number, number, number]>> = {
      chest: [0, -stride * .055, stride * .025],
      head: [sample.gesture === 'nod' ? .14 + .12 * Math.sin(gestureTime * 6) : 0, (sample.lookYaw ?? 0) + stride * .035, -stride * .025],
      upperArmLeft: [-stride * .30, 0, .06], upperArmRight: [wave ? -.18 : stride * .30, 0, wave ? 1.75 + .22 * Math.sin(gestureTime * 8) : -.06],
      thighLeft: [stride * .42, 0, 0], thighRight: [-stride * .42, 0, 0],
      shinLeft: [Math.max(0, stride) * .38, 0, 0], shinRight: [Math.max(0, -stride) * .38, 0, 0],
      footLeft: [-stride * .42 - Math.max(0, stride) * .38, 0, 0],
      footRight: [stride * .42 - Math.max(0, -stride) * .38, 0, 0],
    };
    root.makeRotationY(sample.heading); root.setPosition(...sample.position);
    poses.clear();
    for (const bone of AVATAR_RIG) {
      const angles = rotations[bone.id] ?? [0, 0, 0];
      rotation.set(...angles); quaternion.setFromEuler(rotation);
      translation.set(...bone.offset).multiplyScalar(VOXEL_METRES.avatar);
      if (bone.id === 'thighLeft' || bone.id === 'thighRight') {
        // The authored rig has separate thigh, shin and foot. Keep the sole level
        // and solve the hip's vertical offset from both rotating segments. The
        // planted foot stays at the datum; the swing foot clears the street.
        const legStride = bone.id === 'thighLeft' ? stride : -stride;
        const hip = legStride * .42;
        const knee = Math.max(0, legStride) * .38;
        const soleHeightCells = 7 - 4 * Math.cos(hip) - 3 * Math.cos(hip + knee);
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
    update(samples: readonly CitizenSample[], camera?: THREE.Camera) {
      if (samples.length > capacity) throw new Error(`Citizen count exceeds capacity ${capacity}.`);
      for (const mesh of meshes) mesh.count = 0;
      capes.beginFrame(samples[0]?.time ?? 0);
      if (camera) {
        camera.updateWorldMatrix(true, false);
        projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projectionView, camera.coordinateSystem);
      }
      for (const sample of samples) {
        const look = looks.get(sample.look);
        if (!look) throw new Error(`Unknown citizen look ${sample.look}.`);
        if (![...sample.position, sample.heading, sample.distance, sample.moving, sample.opacity ?? 1, sample.lookYaw ?? 0, sample.time ?? 0].every(Number.isFinite)) throw new Error(`Invalid citizen sample ${sample.id}.`);
        if (camera) {
          citizenBounds.center.set(sample.position[0], sample.position[1] + .75, sample.position[2]);
          if (!frustum.intersectsSphere(citizenBounds)) continue;
        }
        pose(sample);
        if (look.cape) capes.add({ id: sample.id, heading: sample.heading, distance: sample.distance, speed: sample.speed ?? sample.moving * 1.2, opacity: sample.opacity ?? 1 }, look.cape, poses.get('back')!);
        for (const batch of look.batches) {
          const attachment = poses.get(batch.part.attachment);
          if (!attachment) throw new Error(`Unknown avatar attachment ${batch.part.attachment}.`);
          matrix.multiplyMatrices(attachment, batch.pivot);
          const index = batch.mesh.count++;
          batch.mesh.setMatrixAt(index, matrix);
          const fades = batch.mesh.geometry.getAttribute('aLodFade') as THREE.InstancedBufferAttribute;
          fades.setX(index, Math.max(0, Math.min(1, sample.opacity ?? 1)));
        }
      }
      capes.endFrame();
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.geometry.getAttribute('aLodFade').needsUpdate = true;
      }
    },
    dispose() {
      capes.dispose(); scene.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const mesh of meshes) mesh.dispose();
      if (ownsPool) pool.dispose();
    },
  };
}

export { createDefaultCitizenLooks } from './default-look';
