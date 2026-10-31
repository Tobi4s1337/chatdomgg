import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getEnvironment } from '@chatdom/render';
import type { WaterBody } from '@chatdom/world';
import type { ReachPoint, WaterReach } from '../../../../../../packages/world/src/places/water/reaches';
import type { WaterGround } from './coverage';
import { FLOW_PERIOD, waterPhases } from './phases';
import type { ReflectionRenderer } from './reflection';
import { CONTACT_CAP } from './shader';
import { createWaterSurface, type WaterContact, type WaterSurface, type WaterSurfaceOptions } from './surface';
import type { WaterLightSource } from './pillars';

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
  status = 2; renders: { camera: THREE.Camera; target: THREE.WebGLRenderTarget | null }[] = [];
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
    this.renders.push({ camera, target: this.target });
    this.info.render.calls = 37; this.info.render.triangles = 51_000;
  }
}

// ── Fixture: a bowl lake at level 0 round the origin, and a mill stream 1.5 m higher running along z = 30. ──
const lake: WaterBody = { id: 'lake', x: 0, z: 0, radiusX: 12, radiusZ: 12, level: 0, depth: 2 };
const STREAM_LEVEL = 1.5;

function landGround(): WaterGround {
  const width = 81, height = 81, origin: [number, number] = [-40, -40], step = 1;
  const data = new Float32Array(width * height);
  for (let k = 0; k < height; k++) for (let i = 0; i < width; i++) {
    const x = origin[0] + i * step, z = origin[1] + k * step;
    const bowl = Math.min(3, -2 + 3 * (Math.hypot(x, z) / 12) ** 2);
    const channel = Math.abs(z - 30) < 2.5 && Math.abs(x) <= 22 ? 0.8 : 3;
    data[i + width * k] = Math.min(bowl, channel);
  }
  return { data, width, height, origin, step };
}

function millStream(): WaterReach {
  const points: ReachPoint[] = [-20, -10, 0, 10, 20].map(x => ({
    position: [x, 30], bed: 0.8, level: STREAM_LEVEL, width: 3, depth: STREAM_LEVEL - 0.8, s: x + 20,
    tangent: [1, 0], slope: 0, speed: 0.5, flow: [0.5, 0], still: false,
  }));
  return { id: 'mill-stream', kind: 'stream', length: 40, points, source: { kind: 'spring' }, mouth: { kind: 'open' }, openSpeed: 0.5 };
}

function options(overrides: Partial<WaterSurfaceOptions> = {}): WaterSurfaceOptions {
  return { bodies: [lake], reaches: [millStream()], ground: landGround(), quality: 'full', ...overrides };
}

function camera(eye: THREE.Vector3Tuple, target: THREE.Vector3Tuple) {
  const made = new THREE.PerspectiveCamera(50, 1.6, 0.1, 500);
  made.position.set(...eye); made.lookAt(...target); made.updateMatrixWorld();
  return made;
}
/** From the lake's south shore, looking over it; the stream lies behind the eye. */
const lakeCamera = () => camera([0, 6, 20], [0, 0, 0]);
/** Above the stream bank, looking steeply down into it; the lake is below the bottom of the view. */
const streamCamera = () => camera([0, 10, 38], [0, STREAM_LEVEL, 30]);

/** Lit panes on the north shore facing the lake, and the beacon above them. */
const sources: WaterLightSource[] = [
  ...[-4, -1, 2, 5].map((x): WaterLightSource => ({ position: [x, 2, -14], strength: 0.7, kind: 'window', normal: [0, 0, 1] })),
  { position: [0, 9, -30], strength: 1, kind: 'beacon' },
];
const night = getEnvironment(22);

function frame(time: number, view: THREE.Camera = lakeCamera()) {
  return { time, environment: night, camera: view, sources };
}

const uniformsOf = (surface: WaterSurface) => ((surface.root.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;

/** Every time-driven and frame-driven value the shader reads. */
function motion(surface: WaterSurface) {
  const u = uniformsOf(surface);
  const count = u.uPillarCount!.value as number;
  return {
    wind: (u.uWind!.value as THREE.Vector3).toArray(),
    flow: (u.uFlowPhase!.value as THREE.Vector2).toArray(),
    offset0: (u.uFlowOffset0!.value as THREE.Vector2).toArray(),
    offset1: (u.uFlowOffset1!.value as THREE.Vector2).toArray(),
    pillars: count,
    pillarPos: (u.uPillarPos!.value as THREE.Vector4[]).slice(0, count).map(v => v.toArray()),
    pillarShape: (u.uPillarShape!.value as THREE.Vector4[]).slice(0, count).map(v => v.toArray()),
  };
}

describe('water surface: outside ground', () => {
  it('uses the occluding default or a finite caller-supplied bed for all materials', () => {
    const normal = createWaterSurface(options());
    const ocean = createWaterSurface(options({ outsideGroundHeight: -8 }));
    expect(uniformsOf(normal).uOutsideGroundHeight!.value).toBe(1e4);
    for (const mesh of ocean.root.children as THREE.Mesh[]) {
      expect((mesh.material as THREE.ShaderMaterial).uniforms.uOutsideGroundHeight!.value).toBe(-8);
    }
    expect(() => createWaterSurface(options({ outsideGroundHeight: Infinity }))).toThrow(/finite/);
    expect(() => createWaterSurface(options({ outsideGroundHeight: NaN }))).toThrow(/finite/);
    normal.dispose(); ocean.dispose();
  });
});

describe('water surface: time', () => {
  it('gives the same frame for the same time, whether reached forward, by seeking back or fresh', () => {
    const surface = createWaterSurface(options());
    surface.update(frame(50));
    const at50 = motion(surface);
    expect(at50.pillars).toBeGreaterThan(0);
    surface.update(frame(10));
    const at10 = motion(surface);
    expect(at10.wind).not.toEqual(at50.wind);
    surface.update(frame(50));
    expect(motion(surface)).toEqual(at50);

    const fresh = createWaterSurface(options());
    fresh.update(frame(50));
    expect(motion(fresh)).toEqual(at50);
    // Every material reads the same shared motion, so a basin and a course never drift apart.
    const course = surface.root.children.find(m => m.name === 'water:mill-stream') as THREE.Mesh;
    expect((course.material as THREE.ShaderMaterial).uniforms.uWind).toBe(uniformsOf(surface).uWind);
    surface.dispose(); fresh.dispose();
  });

  it('restarts each flow layer only while that layer carries no weight', () => {
    const step = FLOW_PERIOD / 200;
    const weights = (time: number) => {
      const phases = waterPhases(time);
      const w0 = 1 - Math.abs(1 - 2 * phases.flow[0]);
      return { phases, w: [w0, 1 - w0] };
    };
    // From the start of a stream and ten hours into one: no precision loss at long times either.
    for (const start of [0, 36_000]) {
      const restarts = [0, 0];
      let before = weights(start);
      for (let k = 1; k <= 1000; k++) {
        const after = weights(start + k * step);
        for (const layer of [0, 1]) {
          if (after.phases.offsets[layer]!.join() === before.phases.offsets[layer]!.join()) continue;
          restarts[layer]!++;
          expect(before.w[layer]).toBeLessThan(0.02);
          expect(after.w[layer]).toBeLessThan(0.02);
        }
        before = after;
      }
      // Five periods: each layer restarted (with a fresh pattern) about once per period.
      expect(restarts[0]).toBeGreaterThanOrEqual(4);
      expect(restarts[1]).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('water surface: reflection', () => {
  it('invalidates the last reflection on every update until the next pass', () => {
    const surface = createWaterSurface(options()), renderer = new RecordingRenderer(), scene = new THREE.Scene();
    scene.add(surface.root);
    const view = lakeCamera();
    surface.update(frame(1, view));
    expect(uniformsOf(surface).uReflectValid!.value).toBe(0);
    expect(surface.reflect({ renderer, scene, camera: view, frame: 1 })).toEqual({ rendered: true, valid: true, reason: null });
    expect(uniformsOf(surface).uReflectValid!.value).toBe(1);
    expect(uniformsOf(surface).uReflection!.value).toBe(renderer.renders[0]!.target!.texture);
    expect(uniformsOf(surface).uReflectLevel!.value).toBe(0);

    surface.update(frame(1.016, view));
    expect(uniformsOf(surface).uReflectValid!.value).toBe(0);
    expect(surface.reflect({ renderer, scene, camera: view, frame: 2 }).valid).toBe(true);
    expect(uniformsOf(surface).uReflectValid!.value).toBe(1);
    expect(renderer.renders).toHaveLength(2);
    expect(surface.diagnostics().bytes.reflection).toBeGreaterThan(0);
    // Leaving for the reduced path frees the target and its bytes at once.
    surface.setQuality('reduced');
    expect(surface.diagnostics()).toMatchObject({ quality: 'reduced', bytes: { reflection: 0 }, reflection: { size: [0, 0] } });
    expect(uniformsOf(surface).uReflectValid!.value).toBe(0);
    surface.dispose();
  });

  it('never renders a pass at reduced quality', () => {
    const surface = createWaterSurface(options({ quality: 'reduced' })), renderer = new RecordingRenderer();
    const view = lakeCamera();
    surface.update(frame(3, view));
    expect(surface.reflect({ renderer, scene: new THREE.Scene(), camera: view, frame: 1 })).toEqual({ rendered: false, valid: false, reason: 'reduced' });
    expect(renderer.renders).toHaveLength(0);
    expect(uniformsOf(surface).uReflectValid!.value).toBe(0);
    expect(surface.diagnostics()).toMatchObject({ quality: 'reduced', bytes: { reflection: 0 }, reflection: { mode: 'reduced' } });
    surface.dispose();
  });

  it('falls back to the reduced path with a recorded failure when the target is incomplete', () => {
    const surface = createWaterSurface(options()), renderer = new RecordingRenderer();
    renderer.status = 0x8cd6;
    const view = lakeCamera();
    surface.update(frame(3, view));
    expect(surface.reflect({ renderer, scene: new THREE.Scene(), camera: view, frame: 1 }).reason).toBe('unavailable');
    expect(renderer.renders).toHaveLength(0);
    expect(uniformsOf(surface).uReflectValid!.value).toBe(0);
    const diagnostics = surface.diagnostics();
    expect(diagnostics.reflection.mode).toBe('reduced');
    expect(diagnostics.reflection.failure).toMatch(/incomplete/);
    expect(diagnostics.bytes.reflection).toBe(0);
    // Later frames stay reduced rather than retrying a target the device cannot render to.
    surface.update(frame(4, view));
    expect(surface.reflect({ renderer, scene: new THREE.Scene(), camera: view, frame: 2 }).reason).toBe('reduced');
    expect(uniformsOf(surface).uReflectValid!.value).toBe(0);
    surface.dispose();
  });

  it('serves the plane of the water in view: the lake from its shore, the stream from its bank', () => {
    const surface = createWaterSurface(options());
    surface.update(frame(5, lakeCamera()));
    expect(surface.diagnostics().plane).toEqual({ id: 'lake', level: 0 });
    surface.update(frame(5, streamCamera()));
    expect(surface.diagnostics().plane).toEqual({ id: 'mill-stream', level: STREAM_LEVEL });
    // And the pass mirrors about that plane.
    const renderer = new RecordingRenderer();
    surface.reflect({ renderer, scene: new THREE.Scene(), camera: streamCamera(), frame: 1 });
    expect(uniformsOf(surface).uReflectLevel!.value).toBe(STREAM_LEVEL);
    expect(renderer.renders[0]!.camera.position.y).toBeCloseTo(2 * STREAM_LEVEL - 10, 9);
    surface.dispose();
  });
});

describe('water surface: ownership', () => {
  it('disposes only what it made and leaves the caller scene, mesh and ground alone', () => {
    const opts = options(), groundCopy = Float32Array.from(opts.ground.data);
    const surface = createWaterSurface(opts);
    const scene = new THREE.Scene();
    const callerGeometry = new THREE.BoxGeometry(), callerMaterial = new THREE.MeshBasicMaterial();
    const callerMesh = new THREE.Mesh(callerGeometry, callerMaterial);
    let callerDisposals = 0;
    callerMaterial.addEventListener('dispose', () => callerDisposals++);
    callerGeometry.addEventListener('dispose', () => callerDisposals++);
    scene.add(surface.root, callerMesh);

    const view = lakeCamera();
    surface.update(frame(7, view));
    surface.reflect({ renderer: new RecordingRenderer(), scene, camera: view, frame: 1 });

    const owned = new Map<THREE.EventDispatcher<{ dispose: object }>, number>();
    surface.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      owned.set(object.geometry, 0);
      owned.set(object.material as THREE.ShaderMaterial, 0);
    });
    // One basin and one course: two meshes, two geometries, two materials.
    expect(owned.size).toBe(4);
    for (const thing of owned.keys()) thing.addEventListener('dispose', () => owned.set(thing, owned.get(thing)! + 1));
    const heights = uniformsOf(surface).uHeight!.value as THREE.DataTexture;
    let heightDisposals = 0;
    heights.addEventListener('dispose', () => heightDisposals++);
    const before = motion(surface);

    surface.dispose();
    expect(surface.root.parent).toBeNull();
    expect(scene.children).toEqual([callerMesh]);
    expect(callerMesh.material).toBe(callerMaterial);
    expect(callerDisposals).toBe(0);
    expect(opts.ground.data).toEqual(groundCopy);
    expect([...owned.values()]).toEqual([1, 1, 1, 1]);
    expect(heightDisposals).toBe(1);

    // A second dispose is harmless; later frames do nothing.
    surface.dispose();
    expect([...owned.values()]).toEqual([1, 1, 1, 1]);
    expect(heightDisposals).toBe(1);
    surface.update(frame(99, view));
    expect(motion(surface)).toEqual(before);
    const renderer = new RecordingRenderer();
    expect(surface.reflect({ renderer, scene, camera: view, frame: 2 }).rendered).toBe(false);
    expect(renderer.renders).toHaveLength(0);
    expect(callerDisposals).toBe(0);
  });
});

describe('water surface: contacts and inputs', () => {
  const pile = (x: number): WaterContact => ({ a: [x, 1], radius: 0.2, strength: 0.4 });

  it('bounds contacts and refuses non-finite ones', () => {
    const surface = createWaterSurface(options());
    surface.setContacts(Array.from({ length: CONTACT_CAP }, (_, i) => pile(i * 0.1)));
    expect(surface.diagnostics().contacts).toEqual({ cap: CONTACT_CAP, count: CONTACT_CAP });
    expect(uniformsOf(surface).uContactCount!.value).toBe(CONTACT_CAP);
    expect(() => surface.setContacts(Array.from({ length: CONTACT_CAP + 1 }, (_, i) => pile(i)))).toThrow(RangeError);
    expect(surface.diagnostics().contacts.count).toBe(CONTACT_CAP);
    expect(() => surface.setContacts([{ a: [Number.NaN, 0], radius: 0.3, strength: 1 }])).toThrow(RangeError);
    // A rejected set never half-writes: a good first contact followed by a bad one leaves the previous set whole.
    const firstBefore = uniformsOf(surface).uContactA!.value[0].toArray();
    expect(() => surface.setContacts([{ a: [9, 9], radius: 0.7, strength: 1 }, { a: [Number.NaN, 0], radius: 0.2, strength: 1 }])).toThrow(RangeError);
    expect(uniformsOf(surface).uContactA!.value[0].toArray()).toEqual(firstBefore);
    expect(uniformsOf(surface).uContactCount!.value).toBe(CONTACT_CAP);
    expect(() => surface.setContacts([{ a: [0, 0], b: [Number.POSITIVE_INFINITY, 0], radius: 0.3, strength: 1 }])).toThrow(RangeError);
    expect(() => surface.setContacts([{ a: [0, 0], radius: -0.1, strength: 1 }])).toThrow(RangeError);
    expect(() => createWaterSurface(options({ contacts: Array.from({ length: CONTACT_CAP + 1 }, (_, i) => pile(i)) }))).toThrow(RangeError);
    surface.setContacts([]);
    expect(surface.diagnostics().contacts.count).toBe(0);
    surface.dispose();
  });

  it('refuses to build without water, without a whole ground grid or with an unknown quality', () => {
    expect(() => createWaterSurface(options({ bodies: [], reaches: [] }))).toThrow(RangeError);
    const ground = landGround();
    expect(() => createWaterSurface(options({ ground: { ...ground, data: ground.data.subarray(1) } }))).toThrow(RangeError);
    expect(() => createWaterSurface(options({ ground: { ...ground, width: 1, height: ground.data.length } }))).toThrow(RangeError);
    expect(() => createWaterSurface(options({ ground: { ...ground, step: 0 } }))).toThrow(RangeError);
    expect(() => createWaterSurface(options({ quality: 'ultra' as never }))).toThrow(RangeError);
    // A lake alone, or a stream alone, is enough water.
    expect(() => createWaterSurface(options({ reaches: [] })).dispose()).not.toThrow();
    expect(() => createWaterSurface(options({ bodies: [] })).dispose()).not.toThrow();
  });
});
