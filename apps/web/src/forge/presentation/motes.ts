import * as THREE from 'three';

/** Tiny square motes (voxel-native, not soft sprites). Positions are rewritten in place each frame. Additive
 * motes are sparks and embers; normally blended ones are dust and steam. */
export function createMotes(capacity: number, name = 'forge-motes', options: { size?: number; additive?: boolean } = {}) {
  const positions = new Float32Array(capacity * 3), colours = new Float32Array(capacity * 4);
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const colour = new THREE.BufferAttribute(colours, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position); geometry.setAttribute('color', colour);
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({ size: options.size ?? .05, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending });
  material.name = name;
  const points = new THREE.Points(geometry, material);
  points.name = name; points.frustumCulled = false; points.renderOrder = 4; points.visible = false;
  let used = 0;
  return {
    points, capacity,
    begin() { used = 0; },
    push(x: number, y: number, z: number, c: THREE.Color, alpha: number) {
      if (used >= capacity || alpha <= .004) return;
      positions[used * 3] = x; positions[used * 3 + 1] = y; positions[used * 3 + 2] = z;
      colours[used * 4] = c.r; colours[used * 4 + 1] = c.g; colours[used * 4 + 2] = c.b; colours[used * 4 + 3] = Math.min(1, alpha);
      used++;
    },
    end() {
      geometry.setDrawRange(0, used); points.visible = used > 0;
      if (used > 0) { position.needsUpdate = true; colour.needsUpdate = true; }
    },
    get count() { return used; },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
