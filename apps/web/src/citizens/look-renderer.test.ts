import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { PORTRAIT_FIXTURES, parseLook } from '@chatdom/content/avatar-style';
import { createVoxelMaterial } from '@chatdom/render';
import { createCitizenRenderer, createCitizenLookLibrary, lookTokenFor, type CitizenSample } from './index';

const sample = (id: string, look: string, x = 0): CitizenSample => ({ id, look, position: [x, 0, 0], heading: 0, distance: 0, moving: 0, time: 0 });
const head = (scene: THREE.Scene, look: string) => scene.getObjectByName(`Citizen ${look} head solid`) as THREE.InstancedMesh | undefined;

it('asks for an unknown saved look, skips it without throwing, then draws it with its earned cape', async () => {
  const base = parseLook(PORTRAIT_FIXTURES[5]!.look);
  const recipe = { ...base, earned: { ...base.earned, cape: { kind: 'tier-cloak' as const, id: 'earned', cloth: '#963411' as const, lining: '#78baf1' as const, trim: '#e7d12b' as const } } };
  const token = (await lookTokenFor(recipe))!;
  let answer: (response: Response) => void = () => {};
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(resolve => { answer = resolve; }));
  const library = createCitizenLookLibrary({ fetch });
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, library, capacity: 8 });
  try {
    expect(renderer.ready(token)).toBe(false);
    expect(() => renderer.update([sample('saved', token), sample('starter', 'tide', 2)], undefined, 0)).not.toThrow();
    expect(renderer.grips.has('saved')).toBe(false);
    expect(renderer.grips.has('starter')).toBe(true);
    expect(head(scene, token)).toBeUndefined();
    renderer.update([sample('saved', token)], undefined, 16);
    expect(fetch).toHaveBeenCalledOnce();
    answer(new Response(JSON.stringify({ version: 1, token, look: recipe })));
    await library.load(token);
    expect(renderer.ready(token)).toBe(true);
    renderer.update([sample('saved', token)], undefined, 32);
    expect(renderer.grips.has('saved')).toBe(true);
    expect(head(scene, token)!.count).toBe(1);
    expect(head(scene, token)!.visible).toBe(true);
    expect(head(scene, 'tide')!.visible).toBe(false);
    const cloth = scene.getObjectByName('Citizen cape cloth') as THREE.InstancedMesh;
    expect(cloth.count).toBe(1);
    expect(cloth.geometry.getAttribute('aCapePaintCloth').getX(0)).toBeCloseTo(150 / 255, 6);
  } finally {
    renderer.dispose(); material.dispose();
  }
  expect(scene.children).toHaveLength(0);
});

it('grows a library look for a crowd and releases idle library looks beyond its resident count', async () => {
  const library = createCitizenLookLibrary({ fetch: vi.fn() });
  const tokens = [7, 8, 9].map(i => `lk.${String(i).repeat(40)}`);
  tokens.forEach((token, i) => library.remember(token, PORTRAIT_FIXTURES[10 + i]!.look));
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, library, capacity: 12, libraryLooks: 1 });
  try {
    // Ten people in the same starter, drawn through the library: one look, grown past its first few slots.
    renderer.update(Array.from({ length: 10 }, (_, i) => sample(`p${i}`, 'hearth', i)), undefined, 0);
    expect(head(scene, 'hearth')!.count).toBe(10);
    expect(scene.getObjectByName('Citizen cape cloth') as THREE.InstancedMesh).toMatchObject({ count: 10 });
    renderer.update(tokens.map((token, i) => sample(`s${i}`, token, i)), undefined, 1000);
    const disposed = vi.fn();
    head(scene, tokens[0]!)!.geometry.addEventListener('dispose', disposed);
    // A minute on, only the latest look is still drawn; the idle ones over the resident count go.
    renderer.update([sample('s2', tokens[2]!)], undefined, 62_000);
    expect(head(scene, 'hearth')).toBeUndefined();
    expect(head(scene, tokens[0]!)).toBeUndefined();
    expect(head(scene, tokens[1]!)).toBeUndefined();
    expect(head(scene, tokens[2]!)!.count).toBe(1);
    expect(disposed).toHaveBeenCalledOnce();
    // Evicted looks rebuild on demand.
    renderer.update([sample('s0', tokens[0]!)], undefined, 63_000);
    expect(head(scene, tokens[0]!)!.count).toBe(1);
  } finally {
    renderer.dispose(); material.dispose();
  }
});

it('never evicts looks given up front', async () => {
  const library = createCitizenLookLibrary({ fetch: vi.fn() });
  const token = `lk.${'1'.repeat(40)}`;
  library.remember(token, PORTRAIT_FIXTURES[2]!.look);
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const { createDefaultCitizenLooks } = await import('./default-look');
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, library, looks: createDefaultCitizenLooks(), libraryLooks: 0 });
  try {
    renderer.update([sample('a', 'grove'), sample('b', token)], undefined, 0);
    renderer.update([], undefined, 120_000);
    expect(head(scene, 'grove')).toBeDefined();
    expect(head(scene, token)).toBeUndefined();
  } finally {
    renderer.dispose(); material.dispose();
  }
});
