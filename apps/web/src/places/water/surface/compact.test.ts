import * as THREE from 'three';
import { getEnvironment } from '@chatdom/render';
import { describe, expect, it, vi } from 'vitest';
import { assertGround, groundAt, type WaterGround } from './coverage';
import { assertRaster, rasterGeometry, rasterLevel, rasterSamples, rasterWaterAt, type WaterRaster } from './raster';
import { createWaterSurface } from './surface';

function fixture() {
  // Odd row width exercises the R16UI upload alignment, with dry, equal-height, and two wet levels.
  const data = new Uint16Array([2, 3, 4, 4, 5, 2, 3, 4, 5, 5, 2, 3, 4, 4, 5]);
  const levels = new Uint16Array([8, 8, 10, 0, 10, 8, 3, 10, 10, 10, 8, 8, 10, 4, 10]);
  const scale = 0.5, offset = -3;
  const grid = { width: 5, height: 3, origin: [-2, -1] as const, step: 2 };
  const ground: WaterGround = { ...grid, data, encoding: 'quantized', scale, offset };
  const raster: WaterRaster = { levels, encoding: 'quantized', scale, offset, dryGround: data, seaLevel: 0 };
  const floatGround: WaterGround = { ...grid, data: Float32Array.from(data, value => value * scale + offset) };
  const floatRaster: WaterRaster = { levels: Float32Array.from(levels, (value, index) => value > data[index]! ? value * scale + offset : NaN), seaLevel: 0 };
  return { ground, raster, floatGround, floatRaster, data, levels };
}
function geometryData(geometry: THREE.BufferGeometry) {
  return { positions: Array.from(geometry.getAttribute('position').array), flows: Array.from(geometry.getAttribute('aFlow').array),
    indices: Array.from(geometry.index!.array) };
}

describe('compact native water', () => {
  it('matches float geometry, flow, samples and queries at interiors and boundaries', () => {
    const { ground, raster, floatGround, floatRaster, data, levels } = fixture();
    const beforeGround = data.slice(), beforeWater = levels.slice();
    assertGround(ground); assertRaster(raster, ground);
    const compact = rasterGeometry(raster, ground), legacy = rasterGeometry(floatRaster, floatGround);
    expect(compact.index!.count).toBeGreaterThan(0);
    expect(geometryData(compact)).toEqual(geometryData(legacy));
    expect(rasterSamples(raster, ground)).toEqual(rasterSamples(floatRaster, floatGround));
    for (let i = 0; i < levels.length; i++) {
      const expected = floatRaster.levels[i]!;
      const actual = rasterLevel(raster, i);
      if (Number.isNaN(expected)) expect(actual).toBeNaN(); else expect(actual).toBe(expected);
    }
    for (const [x, z] of [[-2, -1], [-1.5, -0.5], [0, 1], [4.75, 2.75], [6, 3], [7.999, 4.999], [8, 5], [-2.001, -1]] as const) {
      expect(groundAt(ground, x, z)).toBe(groundAt(floatGround, x, z));
      expect(rasterWaterAt(raster, ground, x, z)).toEqual(rasterWaterAt(floatRaster, floatGround, x, z));
    }
    expect(rasterWaterAt(raster, ground, -2, -1)).toMatchObject({ id: 'raster', level: 1 });
    expect(rasterWaterAt(raster, ground, 0, 1)).toBeNull();
    compact.dispose(); legacy.dispose();
    expect(data).toEqual(beforeGround); expect(levels).toEqual(beforeWater);
  });

  it('retains the supplied ground buffers without padding and selects the same reflection plane and pillars', () => {
    const { ground, raster, floatGround, floatRaster, data } = fixture();
    const compact = createWaterSurface({ ground, raster, bodies: [], reaches: [], quality: 'reduced' });
    const legacy = createWaterSurface({ ground: floatGround, raster: floatRaster, bodies: [], reaches: [], quality: 'reduced' });
    const mesh = compact.root.children[0] as THREE.Mesh, oldMesh = legacy.root.children[0] as THREE.Mesh;
    const texture = ((mesh.material as THREE.ShaderMaterial).uniforms.uHeight!.value as THREE.DataTexture);
    const oldTexture = ((oldMesh.material as THREE.ShaderMaterial).uniforms.uHeight!.value as THREE.DataTexture);
    expect(texture.image.data).toBe(data);
    expect(oldTexture.image.data).toBe(floatGround.data);
    expect(texture.image.width).toBe(5); expect(texture.image.height).toBe(3);
    expect(texture.unpackAlignment).toBe(2);
    expect(texture.format).toBe(THREE.RedIntegerFormat); expect(texture.type).toBe(THREE.UnsignedShortType);
    expect(texture.internalFormat).toBe('R16UI');
    expect(compact.diagnostics().bytes.ground).toBe(data.length * 2);
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
    camera.position.set(1, 10, 8); camera.lookAt(1, 0, 1); camera.updateMatrixWorld();
    const frame = { time: 8, environment: getEnvironment(22), camera,
      sources: [{ position: [-1, 5, -3] as [number, number, number], strength: 1, kind: 'beacon' as const }] };
    compact.update(frame); legacy.update(frame);
    expect(compact.diagnostics().plane).not.toBeNull();
    expect(compact.diagnostics().pillars.drawn).toBeGreaterThan(0);
    expect(compact.diagnostics().plane).toEqual(legacy.diagnostics().plane);
    expect(compact.diagnostics().pillars).toEqual(legacy.diagnostics().pillars);
    const disposed = vi.fn(); texture.addEventListener('dispose', disposed);
    compact.dispose(); legacy.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(data.length).toBe(15);
  });

  it('rejects incompatible or invalid quantization and never mutates caller arrays', () => {
    const { ground, raster, data, levels } = fixture();
    if (ground.encoding !== 'quantized' || raster.encoding !== 'quantized') throw new Error('Fixture must be quantized');
    const beforeGround = data.slice(), beforeWater = levels.slice();
    for (const scale of [0, -1, NaN, Infinity]) expect(() => assertGround({ ...ground, scale })).toThrow();
    for (const offset of [NaN, Infinity]) expect(() => assertGround({ ...ground, offset })).toThrow();
    expect(() => assertRaster({ ...raster, scale: raster.scale * 2 }, ground)).toThrow();
    expect(() => assertRaster({ ...raster, offset: raster.offset + 1 }, ground)).toThrow();
    expect(() => assertRaster({ ...raster, dryGround: data.slice() }, ground)).toThrow();
    expect(() => assertRaster(raster, { ...ground, data: Float32Array.from(data), encoding: undefined } as WaterGround)).toThrow();
    expect(data).toEqual(beforeGround); expect(levels).toEqual(beforeWater);
  });
});
