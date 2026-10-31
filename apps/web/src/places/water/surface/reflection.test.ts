import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mirrorCamera } from './mirror';
import { reflectionPoint } from './pillars';
import { createPlanarReflection, type ReflectionRenderer } from './reflection';

/** A recording stand-in for the renderer surface the pass touches; every getter reads what a setter wrote. */
class RecordingRenderer implements ReflectionRenderer {
  target: THREE.WebGLRenderTarget | null = null; face = 0; mip = 0;
  viewport = new THREE.Vector4(0, 0, 640, 400); scissor = new THREE.Vector4(10, 20, 30, 40); scissorTest = true;
  clearColour = new THREE.Color(0x336699); clearAlpha = 0.7;
  clippingPlanes: THREE.Plane[] = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 3)];
  localClippingEnabled = true; autoClear = true;
  shadowMap = { autoUpdate: true, needsUpdate: true }; xr = { enabled: true };
  info = { render: { calls: 0, triangles: 0 } };
  extensions = { has: (name: string) => name === 'EXT_color_buffer_float' };
  status = 2; renders: { camera: THREE.Camera; target: THREE.WebGLRenderTarget | null; state: string }[] = [];
  onRender: (() => void) | null = null;
  getRenderTarget() { return this.target; }
  getActiveCubeFace() { return this.face; }
  getActiveMipmapLevel() { return this.mip; }
  setRenderTarget(target: THREE.WebGLRenderTarget | null, face = 0, mip = 0) { this.target = target; this.face = face; this.mip = mip; }
  getViewport(v: THREE.Vector4) { return v.copy(this.viewport); }
  setViewport(v: THREE.Vector4) { this.viewport.copy(v); }
  getScissor(v: THREE.Vector4) { return v.copy(this.scissor); }
  setScissor(v: THREE.Vector4) { this.scissor.copy(v); }
  getScissorTest() { return this.scissorTest; }
  setScissorTest(on: boolean) { this.scissorTest = on; }
  getClearColor(c: THREE.Color) { return c.copy(this.clearColour); }
  getClearAlpha() { return this.clearAlpha; }
  setClearColor(c: THREE.ColorRepresentation, alpha = 1) { this.clearColour.set(c); this.clearAlpha = alpha; }
  getDrawingBufferSize(v: THREE.Vector2) { return v.set(1440, 900); }
  clear() {}
  getContext() { return { FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, checkFramebufferStatus: () => this.status }; }
  render(_scene: THREE.Object3D, camera: THREE.Camera) {
    this.renders.push({ camera, target: this.target, state: `${this.shadowMap.autoUpdate}/${this.shadowMap.needsUpdate}/${this.xr.enabled}/${this.clippingPlanes.length}` });
    this.info.render.calls = 37; this.info.render.triangles = 51_000;
    this.onRender?.();
  }
  snapshot() {
    return {
      target: this.target, face: this.face, mip: this.mip, viewport: this.viewport.toArray(), scissor: this.scissor.toArray(),
      scissorTest: this.scissorTest, clear: this.clearColour.getHex(), alpha: this.clearAlpha, planes: this.clippingPlanes,
      local: this.localClippingEnabled, autoClear: this.autoClear, shadow: { ...this.shadowMap }, xr: this.xr.enabled,
    };
  }
}

function eyeCamera(eye: THREE.Vector3Tuple = [0, 3, 20], target: THREE.Vector3Tuple = [0, 1, 0]) {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 500);
  camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld();
  return camera;
}

describe('planar reflection pass', () => {
  it('renders once from the mirrored camera and restores every renderer state it touched', () => {
    const renderer = new RecordingRenderer(), reflection = createPlanarReflection();
    const before = renderer.snapshot();
    const scene = new THREE.Scene(), water = new THREE.Mesh(), sky = new THREE.Mesh(), hiddenAlready = new THREE.Mesh();
    hiddenAlready.visible = false;
    let seen: boolean[] = [];
    renderer.onRender = () => { seen = [water.visible, sky.visible, hiddenAlready.visible]; };
    const report = reflection.render({ renderer, scene, camera: eyeCamera(), frame: 1, exclusions: [sky, hiddenAlready] }, 0.5, [water]);
    expect(report).toEqual({ rendered: true, valid: true, reason: null });
    expect(renderer.renders).toHaveLength(1);
    // During the pass: into its own target, no shadow re-render, no XR, no user clipping; water and exclusions hidden.
    expect(renderer.renders[0]!.target).not.toBeNull();
    expect(renderer.renders[0]!.state).toBe('false/false/false/0');
    expect(seen).toEqual([false, false, false]);
    expect(renderer.snapshot()).toEqual(before);
    expect([water.visible, sky.visible, hiddenAlready.visible]).toEqual([true, true, false]);
    expect(reflection.diagnostics).toMatchObject({ mode: 'full', passes: 1, size: [720, 450], format: 'rgba16f', targetBytes: 720 * 450 * 12, pass: { calls: 37, triangles: 51_000 } });
    reflection.dispose();
  });

  it('restores state and falls back to reduced when the pass throws or the target is incomplete', () => {
    const renderer = new RecordingRenderer(), before = renderer.snapshot();
    const throwing = createPlanarReflection(), water = new THREE.Mesh();
    renderer.onRender = () => { throw new Error('context lost mid-pass'); };
    expect(throwing.render({ renderer, scene: new THREE.Scene(), camera: eyeCamera(), frame: 1 }, 0, [water]).reason).toBe('unavailable');
    expect(renderer.snapshot()).toEqual(before);
    expect(water.visible).toBe(true);
    expect(throwing.diagnostics).toMatchObject({ mode: 'reduced', failure: 'context lost mid-pass', targetBytes: 0 });
    expect(throwing.valid).toBe(false);
    // Reduced stays reduced: no further passes are attempted on later frames.
    expect(throwing.render({ renderer, scene: new THREE.Scene(), camera: eyeCamera(), frame: 2 }, 0, []).reason).toBe('reduced');

    const incomplete = new RecordingRenderer(); incomplete.status = 0x8cd6;
    const blocked = createPlanarReflection();
    expect(blocked.render({ renderer: incomplete, scene: new THREE.Scene(), camera: eyeCamera(), frame: 1 }, 0, []).reason).toBe('unavailable');
    expect(incomplete.renders).toHaveLength(0);
    expect(blocked.diagnostics.failure).toMatch(/incomplete \(0x8cd6\)/);
    expect(blocked.texture).toBeNull();
  });

  it('refuses a pass started from inside a pass and shares one pass per host frame', () => {
    const renderer = new RecordingRenderer(), reflection = createPlanarReflection(), scene = new THREE.Scene(), camera = eyeCamera();
    let nested: string | null = 'unset';
    renderer.onRender = () => { nested = reflection.render({ renderer, scene, camera, frame: 9 }, 0, []).reason; };
    reflection.render({ renderer, scene, camera, frame: 1 }, 0, []);
    expect(nested).toBe('recursive');
    expect(reflection.diagnostics.recursions).toBe(1);
    renderer.onRender = null;
    expect(reflection.render({ renderer, scene, camera, frame: 1 }, 0, []).reason).toBe('shared');
    // A second plane in the same frame gets no second pass, and is not served by the first plane's image.
    expect(reflection.render({ renderer, scene, camera, frame: 1 }, 1.5, [])).toEqual({ rendered: false, valid: false, reason: 'shared' });
    expect(reflection.render({ renderer, scene, camera, frame: 2 }, 0, []).rendered).toBe(true);
    expect(renderer.renders).toHaveLength(2);
  });

  it('has no reflected view for an eye at or below the water and touches nothing then', () => {
    const renderer = new RecordingRenderer(), before = renderer.snapshot(), reflection = createPlanarReflection();
    expect(reflection.render({ renderer, scene: new THREE.Scene(), camera: eyeCamera([0, 0.2, 10]), frame: 1 }, 0.5, []).reason).toBe('below');
    expect(renderer.snapshot()).toEqual(before);
    expect(renderer.renders).toHaveLength(0);
  });
});

describe('mirror camera', () => {
  it('images a point above the water exactly where the eye sees it reflected, and clips what lies below', () => {
    const camera = eyeCamera([3, 4, 18], [-2, 2, 0]), mirror = new THREE.PerspectiveCamera(), texture = new THREE.Matrix4();
    const level = 0.75;
    expect(mirrorCamera(camera, level, mirror, texture)).toBe(true);
    // The water fragment at the reflection point P samples the texel where the mirror pass drew the point itself.
    const uv = (p: readonly [number, number, number]): [number, number] => { const v = new THREE.Vector4(...p, 1).applyMatrix4(texture); return [v.x / v.w, v.y / v.w]; };
    for (const point of [[-4, 6, -3], [2, 1.2, 4], [0, 9, -20]] as const) {
      const at = reflectionPoint([3, 4, 18], point, level)!;
      const [u, v] = uv(point), [pu, pv] = uv(at);
      expect(u).toBeCloseTo(pu, 6);
      expect(v).toBeCloseTo(pv, 6);
      expect(u > 0 && u < 1 && v > 0 && v < 1).toBe(true);
    }
    const clip = (y: number) => {
      const p = new THREE.Vector4(-1, y, 2, 1).applyMatrix4(new THREE.Matrix4().multiplyMatrices(mirror.projectionMatrix, mirror.matrixWorldInverse));
      return p.z / p.w;
    };
    expect(clip(level + 0.3)).toBeGreaterThan(-1);
    expect(clip(level - 0.3)).toBeLessThan(-1);
    expect(mirrorCamera(eyeCamera([0, 0.5, 10]), level, mirror, texture)).toBe(false);
  });
});
