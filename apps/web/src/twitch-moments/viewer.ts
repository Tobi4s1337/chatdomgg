import * as THREE from 'three';

/**
 * Where the picture is taken from: an empty, never-culled mesh under `group` that notes the camera's position (in
 * the group's own space) every time the group is drawn. Sky moments use it to face their viewer: names and pictures
 * turn toward it, curtains hang beyond the town from it, a flying beast crosses its view. Until a camera has drawn
 * the group (tests, a hidden view) `eye()` is null and callers keep their town-relative default.
 *
 * `held(key)` reads the eye once per moment and keeps it until `release` is called, so a director move or a drifting
 * hero view never swings a pose mid-moment.
 */
export function createViewer(group: THREE.Group) {
  const probe = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)),
    new THREE.MeshBasicMaterial({ visible: true, transparent: true, opacity: 0, depthWrite: false, depthTest: false }),
  );
  probe.frustumCulled = false;
  probe.name = 'viewer-probe';
  const seen = new THREE.Vector3();
  let eye: THREE.Vector3 | null = null;
  const held = new Map<string, THREE.Vector3 | null>();
  probe.onBeforeRender = (_renderer, _scene, camera) => {
    seen.setFromMatrixPosition(camera.matrixWorld);
    eye = group.worldToLocal(seen.clone());
  };
  group.add(probe);
  return {
    /** The camera's last position in the group's space, or null before any camera has drawn it. */
    eye: (): THREE.Vector3 | null => eye,
    /** The eye as it was when `key` was first asked about; null if no camera had drawn the group by then. */
    held(key: string): THREE.Vector3 | null {
      if (!held.has(key)) held.set(key, eye ? eye.clone() : null);
      return held.get(key)!;
    },
    /** Forget every held eye whose key is not in `live`. */
    release(live: ReadonlySet<string>): void { for (const key of [...held.keys()]) if (!live.has(key)) held.delete(key); },
    dispose(): void { group.remove(probe); probe.geometry.dispose(); probe.material.dispose(); held.clear(); },
  };
}
export type Viewer = ReturnType<typeof createViewer>;
