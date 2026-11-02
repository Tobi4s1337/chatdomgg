import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createProgramWarmer, programSignature, type WarmRenderer } from './program-warm';

function geometry(type: 'float' | 'short' = 'float') {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', type === 'float' ? new THREE.BufferAttribute(new Float32Array(9), 3) : new THREE.BufferAttribute(new Int16Array(9), 3));
  g.setIndex([0, 1, 2, 0, 2, 1]);
  return g;
}

interface Drawn { object: THREE.Object3D; drawCount: number; instances: number | null; layer: boolean; visible: boolean; target: THREE.WebGLRenderTarget | null; viewport: number[]; lights: number }

function fakeRenderer(signal: { complete: boolean }) {
  let target: THREE.WebGLRenderTarget | null = null;
  const viewport = new THREE.Vector4(0, 0, 640, 360), drawn: Drawn[] = [], compiled: THREE.Object3D[] = [];
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, SYNC_STATUS: 2, SIGNALED: 3,
    fenceSync: () => ({}), flush() {}, deleteSync() {},
    getSyncParameter: () => (signal.complete ? 3 : 0),
  };
  const renderer: WarmRenderer & { drawn: Drawn[]; compiled: THREE.Object3D[] } = {
    autoClear: true, drawn, compiled,
    render(scene, camera) {
      // What three would draw: visible chains on the camera's layers.
      const visible = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
      let lights = 0;
      scene.traverse(o => { if ((o as THREE.Light).isLight && visible(o) && o.layers.test(camera.layers)) lights++; });
      scene.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !visible(o) || !o.layers.test(camera.layers)) return;
        const instanced = o as THREE.InstancedMesh;
        drawn.push({ object: o, drawCount: mesh.geometry.drawRange.count, instances: instanced.isInstancedMesh ? instanced.count : null, layer: true, visible: true, target,
          viewport: target ? target.viewport.toArray() : viewport.toArray(), lights });
      });
      expect((scene as THREE.Scene).matrixWorldAutoUpdate).toBe(false);
      expect(this.autoClear).toBe(false);
    },
    async compileAsync(object) { compiled.push(object); return object; },
    getRenderTarget: () => target,
    setRenderTarget(next) { target = next; },
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getViewport: out => out.copy(viewport),
    setViewport(x, y, w, h) { viewport.set(x, y, w, h); },
    getContext: () => gl as unknown as WebGL2RenderingContext,
  };
  return renderer;
}

const until = async (test: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!test()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); }
};

describe('program signatures', () => {
  it('name what picks a program and its draw state', () => {
    const material = new THREE.MeshBasicMaterial(), other = new THREE.MeshBasicMaterial();
    const a = programSignature(new THREE.Mesh(geometry(), material)), b = programSignature(new THREE.Mesh(geometry(), material));
    expect(a).not.toBeNull(); expect(a).toBe(b);
    expect(programSignature(new THREE.Mesh(geometry('short'), material))).not.toBe(a);
    expect(programSignature(new THREE.Mesh(geometry(), other))).not.toBe(a);
    expect(programSignature(new THREE.InstancedMesh(geometry(), material, 2))).not.toBe(a);
    material.needsUpdate = true;
    expect(programSignature(new THREE.Mesh(geometry(), material))).not.toBe(a);
  });
  it('cover packed voxel geometry, which has an index and integer attributes but no position', () => {
    const g = new THREE.BufferGeometry(), packed = new THREE.BufferAttribute(new Uint32Array(4), 1); packed.gpuType = THREE.IntType;
    g.setAttribute('aPacked', packed); g.setIndex([0, 1, 2]);
    const key = programSignature(new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), 3));
    expect(key).toContain('aPacked:1:Uint32Array:int');
  });
  it('leave multi-material, empty and non-drawable objects to the first frame', () => {
    const material = new THREE.MeshBasicMaterial();
    expect(programSignature(new THREE.Mesh(geometry(), [material, material]))).toBeNull();
    expect(programSignature(new THREE.Mesh(new THREE.BufferGeometry(), material))).toBeNull();
    expect(programSignature(new THREE.InstancedMesh(geometry(), material, 0))).toBeNull();
    expect(programSignature(new THREE.Group())).toBeNull();
  });
});

describe('the program warmer', () => {
  it('draws one object per program alone, through one pixel, and puts everything back', async () => {
    const signal = { complete: true }, renderer = fakeRenderer(signal);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const light = new THREE.DirectionalLight(); scene.add(light);
    const shared = new THREE.MeshBasicMaterial(), lone = new THREE.MeshBasicMaterial();
    const a = new THREE.Mesh(geometry(), shared), twin = new THREE.Mesh(geometry(), shared);
    const hiddenParent = new THREE.Group(); hiddenParent.visible = false;
    const instanced = new THREE.InstancedMesh(geometry('short'), lone, 40); hiddenParent.add(instanced);
    scene.add(a, twin, hiddenParent);
    const target = new THREE.WebGLRenderTarget(640, 360);
    const hook = () => {}; scene.onBeforeRender = hook;
    const warmer = createProgramWarmer({ renderer, scene, camera, target: () => target, live: () => true, patienceMs: 200 });
    let posted = 0; warmer.task(() => { posted++; });
    warmer.request();
    await until(() => warmer.stats().warmed === 2 && warmer.stats().queued === 0 && posted === 1);
    expect(renderer.drawn.map(d => d.object)).toEqual([a, instanced]);
    for (const d of renderer.drawn) { expect(d.target).toBe(target); expect(d.viewport).toEqual([0, 0, 1, 1]); expect(d.lights).toBe(1); }
    expect(renderer.drawn[0]!.drawCount).toBe(3);
    expect(renderer.drawn[1]!.instances).toBe(1);
    // Restored: visibility, layers, ranges, counts, culling, the target's viewport, the renderer and the scene.
    expect(hiddenParent.visible).toBe(false); expect(instanced.count).toBe(40);
    expect(a.geometry.drawRange.count).toBe(Infinity); expect(a.layers.mask).toBe(1); expect(camera.layers.mask).toBe(1);
    expect(light.layers.mask).toBe(1); expect(a.frustumCulled).toBe(true);
    expect(target.viewport.toArray()).toEqual([0, 0, 640, 360]);
    expect(renderer.getRenderTarget()).toBeNull(); expect(renderer.autoClear).toBe(true);
    expect(scene.onBeforeRender).toBe(hook); expect(scene.matrixWorldAutoUpdate).toBe(true);
    // A second look finds nothing new.
    warmer.request(); await new Promise(r => setTimeout(r, 150));
    expect(renderer.drawn).toHaveLength(2);
    // A new program is warmed when it arrives.
    scene.add(new THREE.Mesh(geometry(), new THREE.MeshBasicMaterial()));
    warmer.request(); await until(() => warmer.stats().warmed === 3);
  });

  it('waits for the GPU before the next draw, and stops when the scene opens', async () => {
    const signal = { complete: false }, renderer = fakeRenderer(signal);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    for (let i = 0; i < 3; i++) scene.add(new THREE.Mesh(geometry(), new THREE.MeshBasicMaterial()));
    let open = false;
    const warmer = createProgramWarmer({ renderer, scene, camera, target: () => null, live: () => !open, patienceMs: 5000 });
    warmer.request();
    await until(() => renderer.drawn.length === 1);
    await new Promise(r => setTimeout(r, 60));
    expect(renderer.drawn).toHaveLength(1);
    // The canvas path draws through a one-pixel viewport and restores the renderer's own.
    expect(renderer.drawn[0]!.viewport).toEqual([0, 0, 1, 1]);
    expect(renderer.getViewport(new THREE.Vector4()).toArray()).toEqual([0, 0, 640, 360]);
    signal.complete = true;
    await until(() => renderer.drawn.length === 3);
    signal.complete = false; open = true;
    scene.add(new THREE.Mesh(geometry(), new THREE.MeshBasicMaterial()));
    warmer.request(); await new Promise(r => setTimeout(r, 150));
    expect(renderer.drawn).toHaveLength(3);
  });

  it('drops an object that left the scene while its program linked', async () => {
    const signal = { complete: true }, renderer = fakeRenderer(signal);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const leaving = new THREE.Mesh(geometry(), new THREE.MeshBasicMaterial()); scene.add(leaving);
    renderer.compileAsync = async object => { leaving.removeFromParent(); return object; };
    const warmer = createProgramWarmer({ renderer, scene, camera, target: () => null, live: () => true });
    warmer.request();
    await until(() => warmer.stats().queued === 0);
    await new Promise(r => setTimeout(r, 20));
    expect(renderer.drawn).toHaveLength(0); expect(warmer.stats().warmed).toBe(0);
  });
});
