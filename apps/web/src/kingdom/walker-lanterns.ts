import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CitizenMotionSample } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';
import type { LightFieldSource } from './light-field';
import { createLanternLightSelection, type LanternLightCandidate } from './lantern-light-selection';

/** A little box-built lantern, with its origin at the hand gripping its handle. */
function cageGeometry(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const part = new THREE.BoxGeometry(w, h, d); part.translate(x, y, z); pieces.push(part);
  };
  // Two handle uprights and a bridge, a cap and foot, and four corner posts.
  box(-.039, -.035, 0, .012, .07, .012); box(.039, -.035, 0, .012, .07, .012);
  box(0, -.006, 0, .09, .012, .012);
  box(0, -.075, 0, .14, .025, .14); box(0, -.224, 0, .14, .025, .14);
  for (const x of [-.057, .057]) for (const z of [-.057, .057]) box(x, -.15, z, .017, .14, .017);
  const merged = mergeGeometries(pieces);
  for (const part of pieces) part.dispose();
  if (!merged) throw new Error('Could not construct the carried lantern cage.');
  return merged;
}

/** Presentation only: the caller supplies the same visible people as the citizen renderer. */
export function createWalkerLanterns(scene: THREE.Scene, capacity: number) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Lantern capacity must be a positive integer.');
  const cage = cageGeometry();
  const pane = new THREE.BoxGeometry(.105, .125, .105); pane.translate(0, -.15, 0);
  cage.scale(1.5, 1.25, 1.5); pane.scale(1.5, 1.25, 1.5);
  // A faceted drop with a narrow tip, small enough to remain inside the glass.
  const flameGeometry = new THREE.SphereGeometry(1, 8, 8);
  const vertices = flameGeometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i), taper = 1 - .38 * Math.max(0, y);
    vertices.setXYZ(i, vertices.getX(i) * .034 * taper, y * .066 - .17, vertices.getZ(i) * .034 * taper);
  }
  vertices.needsUpdate = true; flameGeometry.computeVertexNormals();
  // Shared palette brass and glass; the pane goes into the HDR scene before bloom.
  const iron = new THREE.MeshBasicMaterial({ color: '#8a693b' });
  const glass = new THREE.MeshBasicMaterial({ color: '#d0a66a', transparent: true, opacity: .48, depthWrite: false, toneMapped: true });
  const fire = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(4, 1.35, .22), toneMapped: true });
  const frames = new THREE.InstancedMesh(cage, iron, capacity);
  const panes = new THREE.InstancedMesh(pane, glass, capacity);
  const flames = new THREE.InstancedMesh(flameGeometry, fire, capacity);
  frames.count = panes.count = flames.count = 0;
  frames.frustumCulled = panes.frustumCulled = flames.frustumCulled = false;
  scene.add(frames, panes, flames);
  const matrix = new THREE.Matrix4(), flameMatrix = new THREE.Matrix4(), flameLocal = new THREE.Matrix4();
  const q = new THREE.Quaternion(), rotation = new THREE.Euler(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const day = new THREE.Color('#d0a66a'), glow = new THREE.Color().setRGB(1.5, .52, .12);
  let lights: readonly LightFieldSource[] = [];
  // These are emitters in a bounded voxel field, not individual point-light draws.
  // Every rendered lantern can contribute without a nearest-24 lighting cutoff.
  const selection = createLanternLightSelection(capacity);
  return {
    /** Grip matrices are the renderer's world-space gripRight poses, keyed by citizen slot. */
    update(samples: readonly CitizenMotionSample[], time: number, night: number, focus?: THREE.Vector3 | THREE.Camera,
      grips?: ReadonlyMap<number, THREE.Matrix4>) {
      if (!Number.isFinite(time) || !Number.isFinite(night)) throw new RangeError('Lantern time and night must be finite.');
      const dark = THREE.MathUtils.clamp(night, 0, 1);
      glass.color.copy(day).lerp(glow, dark);
      let count = 0;
      const candidates: LanternLightCandidate[] = [];
      const target = focus instanceof THREE.Camera ? focus.position : focus;
      for (const sample of samples) {
        if (count >= capacity) break;
        if (![...sample.position, sample.heading, sample.distance, sample.speed, sample.opacity].every(Number.isFinite) || sample.opacity <= 0) continue;
        const grip = grips?.get(sample.slot);
        if (!grip || !grip.elements.every(Number.isFinite)) continue;
        const gait = THREE.MathUtils.clamp(sample.speed / 1.2, 0, 1);
        const phase = sample.distance * Math.PI * 2 / 1.8;
        const fade = THREE.MathUtils.clamp(sample.opacity, 0, 1);
        // The handle meets the true socket, while the suspended cage remains upright and swings gently.
        position.setFromMatrixPosition(grip);
        rotation.set(Math.sin(phase - .5) * .09 * gait, sample.heading, Math.sin(time * 1.2 + sample.slot) * .025 * gait);
        q.setFromEuler(rotation); scale.setScalar(fade);
        matrix.compose(position, q, scale);
        frames.setMatrixAt(count, matrix); panes.setMatrixAt(count, matrix);
        // Independent, restrained flicker; only the little flame changes, never the light field.
        const flicker = .92 + .08 * Math.sin(time * 8.7 + sample.slot * 2.31) * Math.sin(time * 4.1 + sample.slot);
        flameLocal.makeScale(dark, dark * flicker, dark);
        flameMatrix.multiplyMatrices(matrix, flameLocal); flames.setMatrixAt(count, flameMatrix); count++;
        if (dark > 0) {
          const p = new THREE.Vector3(0, -.15, 0).applyMatrix4(matrix);
          const source: LightFieldSource = { position: [p.x, p.y, p.z] as Vec3, strength: dark * fade * .7 };
          const distance = target ? p.distanceToSquared(target) : 0;
          candidates.push({ source, distance, slot: sample.slot });
        }
      }
      frames.count = panes.count = flames.count = count;
      frames.instanceMatrix.needsUpdate = panes.instanceMatrix.needsUpdate = flames.instanceMatrix.needsUpdate = true;
      lights = selection.update(candidates, performance.now() / 1000);
    },
    sources(): readonly LightFieldSource[] { return lights; },
    dispose() {
      scene.remove(frames, panes, flames); frames.dispose(); panes.dispose(); flames.dispose(); cage.dispose(); pane.dispose(); flameGeometry.dispose(); iron.dispose(); glass.dispose(); fire.dispose(); selection.clear(); lights = [];
    },
  };
}
