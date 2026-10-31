import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createPostStack, POST_QUALITY, postStackSize, type PostQuality } from './post-stack';
import { getEnvironment } from './atmosphere';

function fakeRenderer(hdr = true) {
  const savedTarget = new THREE.WebGLRenderTarget(3, 4);
  let target: THREE.WebGLRenderTarget | null = savedTarget, face = 2, mip = 1, scissorTest = true, clearAlpha = .4;
  const viewport = new THREE.Vector4(3, 5, 200, 100), scissor = new THREE.Vector4(2, 4, 190, 90), clear = new THREE.Color('#123456');
  const draws: { object: THREE.Object3D; target: THREE.WebGLRenderTarget | null; material?: THREE.Material; depth?: THREE.Texture; tone: THREE.ToneMapping }[] = [];
  const render = { calls: 0, triangles: 0, frame: 0, points: 0, lines: 0 };
  const mock = {
    extensions: { has: () => hdr }, capabilities: { maxSamples: 4 },
    toneMapping: THREE.AgXToneMapping as THREE.ToneMapping, outputColorSpace: THREE.LinearSRGBColorSpace, toneMappingExposure: .87,
    autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: false, xr: { enabled: true },
    info: { autoReset: true, render, reset: () => { render.calls = 0; render.triangles = 0; } },
    getPixelRatio: () => 1.5, getSize: (out: THREE.Vector2) => out.set(1440, 900),
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (value: THREE.WebGLRenderTarget | null, nextFace = 0, nextMip = 0) => { target = value; face = nextFace; mip = nextMip; },
    getViewport: (out: THREE.Vector4) => out.copy(viewport), setViewport: (value: THREE.Vector4) => { viewport.copy(value); },
    getScissor: (out: THREE.Vector4) => out.copy(scissor), setScissor: (value: THREE.Vector4) => { scissor.copy(value); },
    getScissorTest: () => scissorTest, setScissorTest: (value: boolean) => { scissorTest = value; },
    getClearColor: (out: THREE.Color) => out.copy(clear), getClearAlpha: () => clearAlpha,
    setClearColor: (value: THREE.Color | number, alpha?: number) => { clear.set(value); if (alpha != null) clearAlpha = alpha; },
    clear: vi.fn(),
    render: vi.fn((object: THREE.Object3D) => {
      render.calls++; render.frame++;
      const material = object instanceof THREE.Mesh ? object.material as THREE.Material : undefined;
      const depth = material instanceof THREE.ShaderMaterial ? material.uniforms.tDepth?.value as THREE.Texture | undefined : undefined;
      draws.push({ object, target, tone: mock.toneMapping, ...(material ? { material } : {}), ...(depth ? { depth } : {}) });
    }),
  };
  return { renderer: mock as unknown as THREE.WebGLRenderer, mock, draws, savedTarget, viewport, scissor, clear };
}

function fixture(hdr = true, quality: PostQuality = 'balanced') {
  const fake = fakeRenderer(hdr), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1.6, .15, 2200);
  camera.position.set(0, 2, 10); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const post = createPostStack(fake.renderer, scene, camera, { quality });
  post.update({ environment: getEnvironment(20.5) });
  return { ...fake, scene, camera, post };
}

describe('linear HDR post stack', () => {
  it('bounds every device tier independently of retina or huge viewports', () => {
    for (const quality of Object.keys(POST_QUALITY) as PostQuality[]) {
      for (const [width, height, ratio] of [[1440, 900, 1.5], [390, 844, 3], [1920, 1080, 2], [16384, 16384, 4]]) {
        const size = postStackSize(width!, height!, ratio!, quality);
        expect(size.width * size.height).toBeLessThanOrEqual(POST_QUALITY[quality].maxPixels);
        expect(size.width).toBeGreaterThan(0); expect(size.height).toBeGreaterThan(0);
        expect(size.width / size.height).toBeCloseTo(width! / height!, 2);
      }
    }
    expect(() => postStackSize(NaN, 400, 1, 'low')).toThrow('finite');
    expect(() => postStackSize(400, 0, 1, 'low')).toThrow('finite');
  });

  it('draws the original geometry into HDR, consumes its actual depth, then outputs exactly once', () => {
    const { post, scene, mock, draws } = fixture();
    post.render(1 / 60);
    const sceneDraw = draws[0]!;
    expect(sceneDraw.object).toBe(scene); expect(scene.overrideMaterial).toBeNull();
    expect(sceneDraw.target?.texture.type).toBe(THREE.HalfFloatType);
    expect(sceneDraw.target?.texture.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(sceneDraw.target?.samples).toBe(2);
    const contact = draws.find(draw => draw.material?.name === 'Chatdom contact and air')!;
    expect(contact.depth).toBe(sceneDraw.target?.depthTexture);
    expect(contact.target).not.toBe(sceneDraw.target);
    const screen = draws.filter(draw => draw.target === null);
    expect(screen).toHaveLength(1);
    expect(screen[0]?.material?.name).toBe('OutputShader');
    expect((screen[0]?.material as THREE.RawShaderMaterial).defines).toEqual({ SRGB_TRANSFER: '', ACES_FILMIC_TONE_MAPPING: '' });
    expect(mock.info.render.calls).toBe(draws.length);
    // A second frame must bind its actual source depth even if composer buffers swap.
    const firstCount = draws.length; post.render();
    expect(draws[firstCount + 1]?.depth).toBe(draws[firstCount]?.target?.depthTexture);
    post.dispose();
  });

  it('restores target, exposure, colour, viewport, XR and clipping even after a failed pass', () => {
    const { post, mock, savedTarget, viewport, scissor, clear } = fixture();
    const oldColour = clear.clone();
    mock.render.mockImplementationOnce(() => { throw new Error('shader failure'); });
    expect(() => post.render()).toThrow('shader failure');
    expect(mock.getRenderTarget()).toBe(savedTarget); expect(mock.getActiveCubeFace()).toBe(2); expect(mock.getActiveMipmapLevel()).toBe(1);
    expect(mock.toneMapping).toBe(THREE.AgXToneMapping); expect(mock.outputColorSpace).toBe(THREE.LinearSRGBColorSpace); expect(mock.toneMappingExposure).toBe(.87);
    expect(mock.autoClear).toBe(true); expect(mock.xr.enabled).toBe(true); expect(mock.getScissorTest()).toBe(true); expect(mock.info.autoReset).toBe(true);
    expect(viewport.toArray()).toEqual([3, 5, 200, 100]); expect(scissor.toArray()).toEqual([2, 4, 190, 90]); expect(clear).toEqual(oldColour); expect(mock.getClearAlpha()).toBe(.4);
    post.dispose();
  });

  it('degrades cost while keeping real bloom, guards focus and releases every owned target', () => {
    const { post, draws } = fixture(true, 'high');
    post.update({ environment: getEnvironment(20.5), focusDistance: 8 }); post.render();
    expect(post.diagnostics()).toMatchObject({ hdr: true, bloom: true, aoSamples: 12, focusDistance: 8, fog: 'material' });
    const highBytes = post.diagnostics().textureBytes;
    post.setQuality('low'); post.update({ environment: getEnvironment(20.5), focusDistance: 8 });
    expect(post.diagnostics()).toMatchObject({ bloom: true, aoSamples: 0, focusDistance: 0 });
    expect(post.diagnostics().textureBytes).toBeLessThan(highBytes / 3);
    post.setQuality('balanced'); post.update({ environment: getEnvironment(20.5), focusDistance: 80 });
    expect(post.diagnostics().focusDistance).toBe(0);
    post.setQuality('capture'); post.render();
    const targets = [...new Set(draws.map(draw => draw.target).filter(target => target !== null))];
    const disposals = targets.map(target => { const listener = vi.fn(); target.addEventListener('dispose', listener); return listener; });
    post.dispose(); post.dispose();
    for (const disposed of disposals) expect(disposed).toHaveBeenCalledTimes(1);
    const count = draws.length; post.render(); expect(draws).toHaveLength(count);
  });

  it('uses a single direct output when float render targets are unavailable', () => {
    const { post, draws, scene } = fixture(false);
    expect(post.diagnostics()).toMatchObject({ hdr: false, bloom: false, textureBytes: 0, aoSamples: 0 });
    post.render();
    expect(draws).toHaveLength(1); expect(draws[0]?.object).toBe(scene); expect(draws[0]?.target).toBeNull();
    post.dispose();
  });
});
