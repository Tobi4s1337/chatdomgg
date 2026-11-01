import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createViewer } from './viewer';

/** Draw the group once from `camera`, the way the renderer does: every visible mesh's onBeforeRender is called. */
function draw(group: THREE.Group, camera: THREE.Camera): void {
  group.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  group.traverse(object => {
    if (object instanceof THREE.Mesh && object.visible) object.onBeforeRender(null as never, null as never, camera, object.geometry, object.material as THREE.Material, null as never);
  });
}

describe('the viewer', () => {
  it('knows where the picture is taken from, in the group’s own space, once a camera has drawn it', () => {
    const scene = new THREE.Group(), group = new THREE.Group();
    group.position.set(100, 0, -40);
    scene.add(group);
    const viewer = createViewer(group), camera = new THREE.PerspectiveCamera();
    expect(viewer.eye()).toBeNull();
    camera.position.set(130, 25, 10);
    draw(scene, camera);
    expect(viewer.eye()!.toArray()).toEqual([30, 25, 50]);
    viewer.dispose();
    expect(group.children).toHaveLength(0);
  });

  it('holds a moment’s eye while the camera moves, and lets go when the moment ends', () => {
    const group = new THREE.Group(), viewer = createViewer(group), camera = new THREE.PerspectiveCamera();
    expect(viewer.held('early')).toBeNull();
    camera.position.set(0, 20, 80);
    draw(group, camera);
    expect(viewer.held('early')).toBeNull();
    expect(viewer.held('skyfire')!.toArray()).toEqual([0, 20, 80]);
    camera.position.set(-60, 30, 10);
    draw(group, camera);
    expect(viewer.eye()!.toArray()).toEqual([-60, 30, 10]);
    expect(viewer.held('skyfire')!.toArray()).toEqual([0, 20, 80]);
    viewer.release(new Set(['other']));
    expect(viewer.held('skyfire')!.toArray()).toEqual([-60, 30, 10]);
    viewer.dispose();
  });
});
