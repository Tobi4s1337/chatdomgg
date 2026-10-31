import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CitizenMotionSample } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';
import type { LightFieldSource } from './light-field';

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
  // Shared palette brass and glass; the pane goes into the HDR scene before bloom.
  const iron = new THREE.MeshBasicMaterial({ color: '#765b3a' });
  const glass = new THREE.MeshBasicMaterial({ color: '#d0a66a', toneMapped: true });
  const frames = new THREE.InstancedMesh(cage, iron, capacity);
  const panes = new THREE.InstancedMesh(pane, glass, capacity);
  frames.count = panes.count = 0;
  frames.frustumCulled = panes.frustumCulled = false;
  scene.add(frames, panes);
  const root = new THREE.Matrix4(), local = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion(), rotation = new THREE.Euler(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const day = new THREE.Color('#d0a66a'), glow = new THREE.Color().setRGB(3.2, 1.12, .24);
  let lights: LightFieldSource[] = [];
  return {
    /** time is seconds; night is the same 0–1 dusk factor used by the world. */
    update(samples: readonly CitizenMotionSample[], time: number, night: number, focus?: THREE.Vector3 | THREE.Camera) {
      if (!Number.isFinite(time) || !Number.isFinite(night)) throw new RangeError('Lantern time and night must be finite.');
      const dark = THREE.MathUtils.clamp(night, 0, 1);
      glass.color.copy(day).lerp(glow, dark);
      let count = 0;
      const candidates: { source: LightFieldSource; distance: number; slot: number }[] = [];
      const target = focus instanceof THREE.Camera ? focus.position : focus;
      for (const sample of samples) {
        if (count >= capacity) break;
        if (![...sample.position, sample.heading, sample.distance, sample.speed, sample.opacity].every(Number.isFinite) || sample.opacity <= 0) continue;
        const gait = THREE.MathUtils.clamp(sample.speed / 1.2, 0, 1);
        const phase = sample.distance * Math.PI * 2 / 1.8;
        const stride = Math.sin(phase) * gait;
        // Hand follows the right arm's gait; the lantern trails it on a short handle.
        const armAngle = stride * .30;
        const handY = .9375 - .4375 * Math.cos(armAngle);
        const handZ = -.4375 * Math.sin(armAngle);
        const fade = THREE.MathUtils.clamp(sample.opacity, 0, 1);
        root.makeRotationY(sample.heading); root.setPosition(...sample.position);
        position.set(.34, handY, handZ);
        rotation.set(-armAngle * .38 + Math.sin(phase - .5) * .09 * gait, 0, Math.sin(time * 1.2 + sample.slot) * .025 * gait);
        q.setFromEuler(rotation); scale.setScalar(fade);
        local.compose(position, q, scale); matrix.multiplyMatrices(root, local);
        frames.setMatrixAt(count, matrix); panes.setMatrixAt(count, matrix); count++;
        if (dark > 0) {
          const p = new THREE.Vector3(0, -.15, 0).applyMatrix4(matrix);
          const source: LightFieldSource = { position: [p.x, p.y, p.z] as Vec3, strength: dark * fade * .7 };
          const distance = target ? p.distanceToSquared(target) : 0;
          candidates.push({ source, distance, slot: sample.slot });
        }
      }
      frames.count = panes.count = count;
      frames.instanceMatrix.needsUpdate = panes.instanceMatrix.needsUpdate = true;
      candidates.sort((a, b) => a.distance - b.distance || a.slot - b.slot);
      lights = candidates.slice(0, 24).map(item => item.source);
    },
    sources(): readonly LightFieldSource[] { return lights; },
    dispose() {
      scene.remove(frames, panes); frames.dispose(); panes.dispose(); cage.dispose(); pane.dispose(); iron.dispose(); glass.dispose(); lights = [];
    },
  };
}
