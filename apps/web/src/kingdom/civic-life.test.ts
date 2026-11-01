import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGrowthCivicForm, growthCivicLights } from '@chatdom/content/growth-civic';
import { createHumpbackBridge } from '../../../../packages/content/src/places/water/bridge/bridge';
import { transformCardinalPoint, type RealmFoundedPlacement } from '@chatdom/world';
import { civicLifeMounts, civicLightSources, createCivicLife } from './civic-life';

function fixture() {
  const site = { water: 8, bank: 16 };
  const tavern = createGrowthCivicForm('tavern', 'hearth', 4);
  const court = createGrowthCivicForm('castle-court', 'tide', 4);
  const bridge = createGrowthCivicForm('bridge', 'tide', 3, site);
  const forge = createGrowthCivicForm('forge', 'hearth', 4);
  const span = createHumpbackBridge('tide', site.water, site.bank).blueprint;
  const assets = [tavern, court, bridge, forge, span].map((blueprint, i) => ({ assetHash: `asset${i}`, blueprint }));
  const placement = (id: string, assetHash: string, position: [number, number, number], rotation: 0 | 1 | 2 | 3): RealmFoundedPlacement => ({ id, assetHash, position, rotation });
  const placements = [placement('civic:growth:v1:tavern', 'asset0', [10, 2, 20], 1),
    placement('civic:growth:v1:castle-court', 'asset1', [0, 1, 0], 0),
    placement('civic:growth:v1:bridge', 'asset2', [5, 3, 9], 2),
    placement('civic:growth:v1:forge', 'asset3', [0, 0, 0], 0),
    placement('civic:site:v1:bridge:span', 'asset4', [5, 3, 9], 2)];
  return { assets, placements };
}

describe('installed public civic life', () => {
  it('transforms authored windows and actual bridge heights into world metres, without a second hearth', () => {
    const data = fixture(), sources = civicLightSources(data);
    const tavern = growthCivicLights('tavern', 4)[0]!;
    expect(sources[0]!.position).toEqual(transformCardinalPoint([10, 2, 20], 1, [tavern.centre[0] / 8, tavern.centre[1] / 8, tavern.centre[2] / 8 + .25]));
    expect(sources[0]!.normal).toEqual([1, 0, 0]);
    const bridgeLight = growthCivicLights('bridge', 3, { water: 8, bank: 16 })[0]!;
    const expected = transformCardinalPoint([5, 3, 9], 2, [bridgeLight.centre[0] / 8, bridgeLight.centre[1] / 8, bridgeLight.centre[2] / 8 + .25]);
    expect(sources.some(source => source.position.every((n, i) => n === expected[i]))).toBe(true);
    expect(sources).toHaveLength(7 + 2 + 6);
    expect(sources.every(source => source.strength > 0 && source.strength <= 1)).toBe(true);
  });

  it('drops unbacked or mismatched placements and a bridge without its matching installed span', () => {
    const data = fixture();
    expect(civicLifeMounts({ ...data, assets: data.assets.filter(a => a.assetHash !== 'asset0') }).some(m => m.place === 'tavern')).toBe(false);
    expect(civicLifeMounts({ ...data, placements: data.placements.filter(p => p.id !== 'civic:site:v1:bridge:span') }).some(m => m.place === 'bridge')).toBe(false);
    expect(civicLifeMounts({ ...data, placements: data.placements.map(p => p.id.endsWith(':span') ? { ...p, rotation: 1 as const } : p) }).some(m => m.place === 'bridge')).toBe(false);
    expect(civicLifeMounts({ ...data, assets: data.assets.map(a => a.assetHash === 'asset4' ? { ...a, blueprint: { ...a.blueprint, id: 'water-tide-bridge-0-999' } } : a) }).some(m => m.place === 'bridge')).toBe(false);
  });

  it('keeps the moving water surface inside its authored basin and disposes its scene objects', () => {
    const scene = new THREE.Scene(), life = createCivicLife(scene, fixture());
    const court = scene.getObjectByName('public-civic-life')!.children[1]!;
    const surface = court.children.find(child => child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial && 'uTime' in child.material.uniforms) as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    expect(surface.geometry.parameters.width).toBe(20 / 8);
    expect(surface.geometry.parameters.height).toBe(10 / 8);
    expect(surface.position.toArray()).toEqual([32 / 8, 1.012, 16 / 8]);
    life.update(3); expect(surface.material.uniforms.uTime!.value).toBe(3);
    life.dispose(); expect(scene.getObjectByName('public-civic-life')).toBeUndefined();
  });
});
