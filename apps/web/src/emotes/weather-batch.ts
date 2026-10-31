import * as THREE from 'three';
import { VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import type { ApprovedEmoteVisual, EmoteWeatherBatch, EmoteWeatherHost } from '../../../../packages/emotes/src/index';

const CELL = VOXEL_METRES.build;

export interface WeatherBatchHostInput {
  /** Where the weather lives; matrices are in this object's space. */
  readonly parent: THREE.Object3D;
  /** The kingdom's clay material (it already supports instancing and a per-instance dithered fade). */
  readonly material: THREE.Material;
  /** Meshes one blueprint with the kingdom's voxel workers into a geometry this host owns. */
  readonly mesh: (blueprint: VoxelBlueprint) => Promise<THREE.BufferGeometry>;
  /** Soft round sprite for the warm glint each carved emote carries through the dusk. */
  readonly glow: THREE.Texture;
  readonly glintColour?: THREE.ColorRepresentation;
}

export interface WeatherBatchHost extends EmoteWeatherHost {
  /** Meshes every distinct frame of a revision ahead of time, so the first raining frame is never empty. */
  prepare(visual: ApprovedEmoteVisual): Promise<void>;
  readonly stats: { readonly geometries: number; readonly bytes: number; readonly draws: number };
  dispose(): void;
}

const geometryBytes = (geometry: THREE.BufferGeometry): number =>
  Object.values(geometry.attributes).reduce((sum, attribute) => sum + ((attribute as THREE.BufferAttribute).array?.byteLength ?? 0), 0) + (geometry.index?.array.byteLength ?? 0);

/**
 * The bench kingdom's binding of `EmoteWeatherHost`: one instanced clay mesh per raining revision (the
 * frame's geometry swapped in as the emote plays), the instance fade on the material's own dithered
 * `aLodFade`, and one additive glint per carved emote so the cloud catches the lantern light. Frame
 * geometries are cached per revision and released with the batch.
 */
export function createWeatherBatchHost(input: WeatherBatchHostInput): WeatherBatchHost {
  const frames = new Map<string, Promise<THREE.BufferGeometry[]>>();
  const ready = new Map<string, THREE.BufferGeometry[]>();
  const owned = new Set<THREE.BufferGeometry>();
  /** Live batches and the revision each draws. */
  const live = new Map<EmoteWeatherBatch, string>();
  let bytes = 0, disposed = false;

  const prepare = (visual: ApprovedEmoteVisual): Promise<THREE.BufferGeometry[]> => {
    let pending = frames.get(visual.revision);
    if (!pending) {
      // Frames that carve to the same boxes share one geometry.
      const keys = visual.frames.map(frame => JSON.stringify(frame.blueprint.boxes));
      const unique = [...new Set(keys)];
      pending = Promise.all(unique.map(key => input.mesh(visual.frames[keys.indexOf(key)]!.blueprint))).then(meshed => {
        if (disposed || !frames.has(visual.revision)) { meshed.forEach(g => g.dispose()); return []; }
        for (const geometry of meshed) { owned.add(geometry); bytes += geometryBytes(geometry); }
        const byFrame = keys.map(key => meshed[unique.indexOf(key)]!);
        ready.set(visual.revision, byFrame);
        return byFrame;
      });
      frames.set(visual.revision, pending);
    }
    return pending;
  };
  const release = (revision: string): void => {
    const list = ready.get(revision);
    frames.delete(revision); ready.delete(revision);
    if (!list) return;
    for (const geometry of new Set(list)) { bytes -= geometryBytes(geometry); owned.delete(geometry); geometry.dispose(); }
  };

  const host: WeatherBatchHost = {
    prepare: async visual => { await prepare(visual); },
    createBatch(visual, capacity) {
      void prepare(visual);
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
      fade.setUsage(THREE.DynamicDrawUsage);
      // A placeholder until the frames are meshed; it carries the fade attribute the shader expects.
      const empty = new THREE.BufferGeometry();
      let mesh: THREE.InstancedMesh | null = null, shownFrame = -1;
      const glintPositions = new Float32Array(capacity * 3);
      const glintGeometry = new THREE.BufferGeometry();
      glintGeometry.setAttribute('position', new THREE.BufferAttribute(glintPositions, 3).setUsage(THREE.DynamicDrawUsage));
      const glintMaterial = new THREE.PointsMaterial({ map: input.glow, color: input.glintColour ?? 0xffc477, size: .62, sizeAttenuation: true, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false });
      const glints = new THREE.Points(glintGeometry, glintMaterial);
      glints.frustumCulled = false; glints.visible = false; glints.name = `emote-weather-glints-${visual.revision.slice(-8)}`;
      input.parent.add(glints);
      const [w, h, d] = visual.frames[0]!.blueprint.size;
      const centre = [w / 2 * CELL, h / 2 * CELL, d / 2 * CELL] as const;
      const batch: EmoteWeatherBatch = {
        show(frameIndex, matrices, fades, count) {
          const geometries = ready.get(visual.revision);
          if (!geometries?.length) { batch.hide(); return; }
          if (!mesh) {
            mesh = new THREE.InstancedMesh(empty, input.material, capacity);
            mesh.name = `emote-weather-${visual.revision.slice(-8)}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false; mesh.castShadow = false;
            input.parent.add(mesh);
          }
          const geometry = geometries[Math.min(frameIndex, geometries.length - 1)]!;
          if (frameIndex !== shownFrame || mesh.geometry !== geometry) {
            geometry.setAttribute('aLodFade', fade);
            mesh.geometry = geometry; shownFrame = frameIndex;
          }
          const n = Math.min(count, capacity);
          (mesh.instanceMatrix.array as Float32Array).set(matrices.subarray(0, n * 16));
          mesh.instanceMatrix.needsUpdate = true;
          (fade.array as Float32Array).set(fades.subarray(0, n));
          fade.needsUpdate = true;
          mesh.count = n; mesh.visible = n > 0;
          // The glint sits at each carving's middle, a little behind so the clay reads in front of it.
          for (let i = 0; i < n; i++) {
            const m = i * 16;
            glintPositions[i * 3] = matrices[m + 12]! + matrices[m]! * centre[0] + matrices[m + 4]! * centre[1] + matrices[m + 8]! * (centre[2] - .2);
            glintPositions[i * 3 + 1] = matrices[m + 13]! + matrices[m + 1]! * centre[0] + matrices[m + 5]! * centre[1] + matrices[m + 9]! * (centre[2] - .2);
            glintPositions[i * 3 + 2] = matrices[m + 14]! + matrices[m + 2]! * centre[0] + matrices[m + 6]! * centre[1] + matrices[m + 10]! * (centre[2] - .2);
          }
          glintGeometry.setDrawRange(0, n);
          glintGeometry.attributes.position!.needsUpdate = true;
          glints.visible = n > 0;
        },
        hide() { if (mesh) mesh.visible = false; glints.visible = false; },
        dispose() {
          live.delete(batch);
          if (mesh) { input.parent.remove(mesh); mesh.dispose(); mesh = null; }
          input.parent.remove(glints); glintGeometry.dispose(); glintMaterial.dispose(); empty.dispose();
          // The revision stopped raining: its carved frames go with it.
          if (![...live.values()].includes(visual.revision)) release(visual.revision);
        },
      };
      live.set(batch, visual.revision);
      return batch;
    },
    get stats() {
      return { geometries: owned.size, bytes, draws: live.size * 2 };
    },
    dispose() {
      disposed = true;
      for (const batch of [...live.keys()]) batch.dispose();
      for (const revision of [...frames.keys()]) release(revision);
    },
  };
  return host;
}
