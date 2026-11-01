import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSoulPresentation, createSoulWeatherSurfaces } from './presentation';
import { soulAt } from '../../../../packages/world/src/soul';

describe('soul weather surfaces', () => {
  it('keeps a whole district of lamps in two batches and releases their instance buffers', () => {
    const topology = { routes: { lamplighter: [[0, 0, 0], [32, 0, 0]] as const }, lamps: Array.from({ length: 64 }, (_, i) => ({ position: [i * 32 / 63, 0, 0] as const, routeProgress: i / 63 })) };
    const context = { fillRect() {}, strokeRect() {}, fillText() {} };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
    try {
      const scene = new THREE.Scene();
      const picture = createSoulPresentation(scene, { topology });
      const frame = soulAt({ seed: 42, population: 0, biome: 'meadow', topology }, Date.UTC(2026, 5, 20, 19));
      const instances: THREE.InstancedMesh[] = [];
      scene.traverse(object => { if (object instanceof THREE.InstancedMesh) instances.push(object); });
      const lamps = instances.filter(object => object.count === 64);
      expect(lamps).toHaveLength(2);
      const textures=new Set<THREE.Texture>();
      scene.traverse(object=>{if(object instanceof THREE.Mesh || object instanceof THREE.Sprite){
        const owned=Array.isArray(object.material)?object.material:[object.material];
        for(const material of owned)if('map' in material && material.map instanceof THREE.Texture)textures.add(material.map);
      }});
      const releaseTexture=vi.fn();
      textures.forEach(texture=>texture.addEventListener('dispose',releaseTexture));
      const release = vi.fn();
      instances.forEach(object => object.addEventListener('dispose', release));
      for (let i = 0; i < 20; i++) picture.update(frame, i / 60);
      expect(scene.children).toHaveLength(1);
      expect(lamps.every(mesh => mesh.count === 64)).toBe(true);
      picture.dispose();
      expect(scene.children).toHaveLength(0);
      expect(release).toHaveBeenCalledTimes(instances.length);
      expect(textures.size).toBeGreaterThan(0);
      expect(releaseTexture).toHaveBeenCalledTimes(textures.size);
      expect(() => createSoulPresentation(scene, { topology: { ...topology, lamps: [...topology.lamps, topology.lamps[0]!] } })).toThrow(RangeError);
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not compound wetting and restores caller-owned material and visibility state', () => {
    const roof = new THREE.MeshStandardMaterial({ color: '#ad694d', roughness: .9 });
    const frost = new THREE.MeshStandardMaterial({ color: '#e4e8df', opacity: .8 });
    const puddleMaterial = new THREE.MeshStandardMaterial({ transparent: true, opacity: .6 });
    const geometry = new THREE.BoxGeometry();
    const snow = new THREE.Mesh(geometry, frost), puddle = new THREE.Mesh(geometry, puddleMaterial);
    const colour = roof.color.clone();
    const surfaces = createSoulWeatherSurfaces({ roofs: [roof], snow: [snow], puddles: [puddle] });
    const frame = soulAt({ seed: 42, population: 0, biome: 'highland' }, Date.UTC(2026, 11, 24));
    frame.weather.wetness = .6; frame.weather.snowCover = .2;
    surfaces.update(frame);
    const wet = roof.color.clone();
    surfaces.update(frame);
    expect(roof.color).toEqual(wet);
    expect(roof.roughness).toBeLessThan(.9);
    expect(snow.visible).toBe(true);
    expect(frost.opacity).toBeCloseTo(.32);
    expect(frost.transparent).toBe(true);
    frame.weather.wetness = 0; frame.weather.snowCover = 0;
    surfaces.update(frame);
    expect(roof.color).toEqual(colour);
    expect(snow.visible).toBe(false);
    expect(puddle.visible).toBe(false);
    surfaces.dispose();
    expect(roof.color).toEqual(colour);
    expect(roof.roughness).toBe(.9);
    expect(snow.visible).toBe(true);
    expect(frost.opacity).toBe(.8);
    expect(frost.transparent).toBe(false);
    expect(puddleMaterial.opacity).toBe(.6);
    expect(puddleMaterial.transparent).toBe(true);
    roof.dispose(); frost.dispose(); puddleMaterial.dispose(); geometry.dispose();
  });
});
