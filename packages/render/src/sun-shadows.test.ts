import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSunShadows, fitSunShadowCamera } from './sun-shadows';

const bounds = new THREE.Box3(new THREE.Vector3(-180, -4, -115), new THREE.Vector3(180, 55, 280));
const vertex = 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
const fragment = 'out vec4 colour; void main(){vec3 vWorld=vec3(0.0), n=vec3(0.0,1.0,0.0); float sun=1.0 /* sun-visibility */; colour=vec4(vec3(sun),1.0);}';

function fakeRenderer() {
  const savedTarget = new THREE.WebGLRenderTarget(2, 2);
  let target: THREE.WebGLRenderTarget | null = savedTarget, face = 3, mip = 2, scissorTest = true;
  const viewport = new THREE.Vector4(7, 9, 300, 200), scissor = new THREE.Vector4(2, 4, 160, 90);
  const render = { frame: 17, calls: 7, triangles: 99, points: 2, lines: 3 };
  const mock = {
    autoClear: true, xr: { enabled: true }, info: { autoReset: true, render },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (value: THREE.WebGLRenderTarget | null, nextFace = 0, nextMip = 0) => { target = value; face = nextFace; mip = nextMip; },
    getViewport: (value: THREE.Vector4) => value.copy(viewport),
    setViewport: (value: THREE.Vector4 | number, y?: number, w?: number, h?: number) => {
      if (value instanceof THREE.Vector4) viewport.copy(value); else viewport.set(value, y!, w!, h!);
    },
    getScissor: (value: THREE.Vector4) => value.copy(scissor), setScissor: (value: THREE.Vector4) => { scissor.copy(value); },
    getScissorTest: () => scissorTest, setScissorTest: (value: boolean) => { scissorTest = value; },
    clear: vi.fn(), render: vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      expect(scene.isScene && camera.isCamera).toBe(true);
      render.frame++; render.calls += 3; render.triangles += 120;
    }),
  };
  const renderer = mock as unknown as THREE.WebGLRenderer;
  return { renderer, mock, savedTarget, viewport, scissor };
}

describe('bounded cached sun shadows', () => {
  it('fits all settlement corners at low and high sun and keeps a fixed texel scale', () => {
    const camera = new THREE.OrthographicCamera();
    let scale: number | undefined;
    for (const direction of [new THREE.Vector3(-1, .06, -.35), new THREE.Vector3(0, 1, -.35), new THREE.Vector3(1, .3, -.35)]) {
      const fitted = fitSunShadowCamera(camera, bounds, direction, 2048);
      scale ??= fitted.metresPerTexel;
      expect(fitted.metresPerTexel).toBe(scale);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new THREE.Vector3(x, y, z).applyMatrix4(fitted.matrix);
        for (const value of projected.toArray()) { expect(value).toBeGreaterThan(0); expect(value).toBeLessThan(1); }
      }
      const origin = new THREE.Vector3().applyMatrix4(fitted.matrix).multiplyScalar(2048);
      expect(origin.x).toBeCloseTo(Math.round(origin.x), 8);
      expect(origin.y).toBeCloseTo(Math.round(origin.y), 8);
    }
    expect(() => fitSunShadowCamera(camera, new THREE.Box3(), new THREE.Vector3(0, 1, 0), 2048)).toThrow('Invalid');
    expect(() => fitSunShadowCamera(camera, bounds, new THREE.Vector3(), 2048)).toThrow('Invalid');
    expect(() => fitSunShadowCamera(camera, new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1e100, 1e100, 1e100)), new THREE.Vector3(0, 1, 0), 2048)).toThrow('bounded');
  });

  it('holds original instance placements when view culling rewrites the source', () => {
    const { renderer, mock } = fakeRenderer();
    const shadows = createSunShadows(renderer, { bounds, resolution: 1024 });
    const geometry = new THREE.BoxGeometry(), material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment });
    const mesh = new THREE.InstancedMesh(geometry, material, 2);
    mesh.position.set(12, 3, -9); mesh.name = 'houses';
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, 2));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 0, 5));
    const remove = shadows.register(mesh);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(500, 0, 0)); mesh.count = 0; mesh.visible = false;
    shadows.updateSunDirection([1, 1, -.35]);
    const caster = mock.render.mock.calls[0]![0].children[0] as THREE.InstancedMesh;
    expect(caster.geometry).toBe(geometry);
    expect(caster.count).toBe(2); expect(caster.visible).toBe(true);
    expect(caster.matrix.elements.slice(12, 15)).toEqual([12, 3, -9]);
    const matrix = new THREE.Matrix4(); caster.getMatrixAt(0, matrix);
    expect(matrix.elements.slice(12, 15)).toEqual([1, 0, 2]);
    expect((caster.material as THREE.ShaderMaterial).vertexShader).toBe(vertex);
    expect((caster.material as THREE.ShaderMaterial).uniforms).toBe(material.uniforms);
    expect(shadows.stats).toMatchObject({ casters: 1, transformBytes: 128, textureBytes: 5 * 1024 * 1024 });
    const geometryDispose = vi.fn(); geometry.addEventListener('dispose', geometryDispose);
    remove(); remove(); shadows.dispose(); shadows.dispose();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(shadows.stats.casters).toBe(0); expect(shadows.stats.transformBytes).toBe(0);
    geometry.dispose(); material.dispose(); mesh.dispose();
  });

  it('caches unchanged sun, invalidates actual edits and disables below-horizon shadows', () => {
    const { renderer, mock } = fakeRenderer();
    const shadows = createSunShadows(renderer, { bounds });
    const geometry = new THREE.BoxGeometry(), material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment });
    shadows.bindReceiver(material); const injected = material.fragmentShader; shadows.bindReceiver(material);
    expect(material.fragmentShader).toBe(injected);
    // The horizon copies the bound ground shader/uniforms rather than receiving it twice.
    const horizon = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: injected, uniforms: material.uniforms });
    expect(() => shadows.bindReceiver(horizon)).not.toThrow();
    const mesh = new THREE.Mesh(geometry, material); shadows.register(mesh);
    expect(shadows.updateSunDirection([1, 1, -.35])).toBe(true);
    expect(shadows.updateSunDirection([2, 2, -.7])).toBe(false);
    expect(shadows.updateSunDirection([1.000001, 1, -.35])).toBe(false);
    const mapUniform = material.uniforms.uSunShadowMap;
    shadows.setResolution(1024);
    expect(material.uniforms.uSunShadowMap).toBe(mapUniform);
    expect(material.uniforms.uSunShadowTexel!.value.toArray()).toEqual([1 / 1024, 1 / 1024]);
    expect(shadows.stats.textureBytes).toBe(5 * 1024 * 1024);
    expect(shadows.updateSunDirection([1, 1, -.35])).toBe(true);
    shadows.invalidate(); expect(shadows.updateSunDirection([1, 1, -.35])).toBe(true);
    expect(shadows.updateSunDirection([-1, .5, -.35])).toBe(true);
    expect(shadows.updateSunDirection([0, -1, -.35])).toBe(false);
    expect(material.uniforms.uSunShadowEnabled!.value).toBe(0);
    expect(mock.render).toHaveBeenCalledTimes(4);
    expect(shadows.stats).toMatchObject({ updates: 4, drawCalls: 3, triangles: 120, enabled: false });
    shadows.dispose(); geometry.dispose(); material.dispose(); horizon.dispose();
  });

  it('restores renderer state and logical counts even if the depth render throws', () => {
    const { renderer, mock, savedTarget, viewport, scissor } = fakeRenderer();
    const shadows = createSunShadows(renderer, { bounds });
    const geometry = new THREE.BoxGeometry(), material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment });
    shadows.register(new THREE.Mesh(geometry, material));
    mock.render.mockImplementationOnce(() => {
      mock.info.render.frame++; mock.info.render.calls = 900; throw new Error('shader failed');
    });
    expect(() => shadows.updateSunDirection([1, 1, -.35])).toThrow('shader failed');
    expect(mock.getRenderTarget()).toBe(savedTarget); expect(mock.getActiveCubeFace()).toBe(3); expect(mock.getActiveMipmapLevel()).toBe(2);
    expect(viewport.toArray()).toEqual([7, 9, 300, 200]); expect(scissor.toArray()).toEqual([2, 4, 160, 90]);
    expect(mock.getScissorTest()).toBe(true); expect(mock.autoClear).toBe(true); expect(mock.xr.enabled).toBe(true); expect(mock.info.autoReset).toBe(true);
    expect(mock.info.render).toEqual({ frame: 18, calls: 7, triangles: 99, points: 2, lines: 3 });
    expect(shadows.stats.updates).toBe(0);
    expect(shadows.updateSunDirection([1, 1, -.35])).toBe(true);
    expect(mock.clear).toHaveBeenCalledWith(false, true, false);
    shadows.dispose(); geometry.dispose(); material.dispose();
  });
});
