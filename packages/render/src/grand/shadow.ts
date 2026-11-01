import * as THREE from 'three';
import type { GrandUniforms } from './light';

/**
 * One orthographic sun shadow map fitted to the whole land (worldgen-at-scale §7.3): at 4096² over a
 * 768 m island a texel is under 0.2 m, so a single tree casts a soft shadow. It is re-rendered only when
 * the sun moves or the land changes, never per frame.
 */
export class GrandShadow {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2);
  readonly size: number;
  private readonly matrix = new THREE.Matrix4();

  constructor(size: number) {
    this.size = size;
    const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    this.target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture: depth });
    this.target.texture.generateMipmaps = false;
  }

  /** Fit the light's view to a world box and point it along the sun. */
  fit(box: THREE.Box3, sun: THREE.Vector3): void {
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const eye = centre.clone().addScaledVector(sun.clone().normalize(), radius * 2);
    this.camera.position.copy(eye);
    this.camera.up.set(0, 1, 0);
    if (Math.abs(sun.y) > 0.99) this.camera.up.set(0, 0, 1);
    this.camera.lookAt(centre);
    this.camera.updateMatrixWorld(true);
    const inverse = this.camera.matrixWorldInverse;
    const bounds = new THREE.Box3();
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      bounds.expandByPoint(corner.applyMatrix4(inverse));
    }
    this.camera.left = bounds.min.x; this.camera.right = bounds.max.x;
    this.camera.bottom = bounds.min.y; this.camera.top = bounds.max.y;
    this.camera.near = -bounds.max.z - 1; this.camera.far = -bounds.min.z + 1;
    this.camera.updateProjectionMatrix();
  }

  /** Render the casters with their depth twins. `prepare` swaps materials and face buckets for the pass. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, prepare: (on: boolean) => void, uniforms: GrandUniforms): void {
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    prepare(true);
    renderer.setRenderTarget(this.target);
    renderer.autoClear = true;
    renderer.clear(true, true, false);
    renderer.render(scene as THREE.Scene, this.camera);
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(previous);
    prepare(false);
    this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    uniforms.uShadowMatrix.value.copy(this.matrix);
    uniforms.uShadowMap.value = this.target.depthTexture;
    uniforms.uShadowTexel.value = 1 / this.size;
    uniforms.uShadowOn.value = 1;
  }

  dispose(): void { this.target.depthTexture?.dispose(); this.target.dispose(); }
}
