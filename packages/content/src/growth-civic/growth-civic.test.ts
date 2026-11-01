import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { rasterizeBlueprint } from '../../../voxel/src/index';
import { createGrowthCivicForm, GROWTH_CIVIC_PLACES, type CivicStyle } from './index';

describe.each(['hearth', 'tide'] as const)('%s civic growth', style => {
  it.each(GROWTH_CIVIC_PLACES)('%s has four valid distinct forward forms and a stable mature form', place => {
    const forms = [1, 2, 3, 4].map(level => createGrowthCivicForm(place, style, level, { water: 6, bank: 14 }));
    for (const [index, form] of forms.entries()) {
      expect(VoxelBlueprintSchema.safeParse(form).success).toBe(true);
      expect(form.id).toContain(`-${index + 1}`);
      for (const box of form.boxes) for (let axis = 0; axis < 3; axis++) {
        expect(box.from[axis]).toBeGreaterThanOrEqual(0);
        expect(box.to[axis]).toBeLessThanOrEqual(form.size[axis]!);
      }
    }
    const solids = forms.map(form => rasterizeBlueprint(form).voxels);
    expect(new Set(solids.map(cells => Array.from(cells).join(','))).size).toBe(4);
    expect(createGrowthCivicForm(place, style, 9, { water: 6, bank: 14 }).boxes).toEqual(forms[3]!.boxes);
    expect(createGrowthCivicForm(place, style, 9, { water: 6, bank: 14 }).id).toMatch(/-9$/);
  });
});

it('rejects invalid inputs rather than inventing a level or kit', () => {
  for (const level of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createGrowthCivicForm('market', 'hearth', level)).toThrow();
  }
  expect(() => createGrowthCivicForm('market', 'grove' as CivicStyle, 1)).toThrow();
  expect(() => createGrowthCivicForm('bridge', 'hearth', 1)).toThrow(/heights/);
});

it('exposes civic light locations separately from citizen presence at every growth level', async () => {
  const { growthCivicLights } = await import('./index');
  expect([1, 2, 3, 4].map(level => growthCivicLights('tavern', level).length)).toEqual([2, 4, 7, 7]);
  expect([1, 2, 3, 4].map(level => growthCivicLights('bridge', level, { water: 6, bank: 14 }).length)).toEqual([2, 4, 6, 8]);
  expect(growthCivicLights('bridge', 8, { water: 6, bank: 14 })).toEqual(growthCivicLights('bridge', 4, { water: 6, bank: 14 }));
  expect(growthCivicLights('forge', 1)[0]?.kind).toBe('hearth');
  expect(growthCivicLights('castle-court', 4)).toHaveLength(2);
});

it.each(['hearth', 'tide'] as const)('%s puts the defining additions on exposed surfaces', style => {
  const at = (place: Parameters<typeof createGrowthCivicForm>[0], level: number, x: number, y: number, z: number) => {
    const { voxels, size: [sx, sy] } = rasterizeBlueprint(createGrowthCivicForm(place, style, level, { water: 6, bank: 14 }));
    return voxels[x + sx * (y + sy * z)];
  };
  // Awning, upper window, widened hearth, fountain water, and a newly added bridge lantern.
  for (const [place, before, after, x, y, z] of [
    ['market', 2, 3, 3, 22, 2], ['tavern', 1, 2, 18, 33, 23],
    ['forge', 1, 4, 12, 5, 10], ['castle-court', 2, 3, 23, 7, 12],
    ['bridge', 1, 2, 21, 35, 29],
  ] as const) {
    expect(at(place, before, x, y, z)).toBe(0);
    expect(at(place, after, x, y, z)).not.toBe(0);
  }
  // The upper window and the tavern's wall lamps face the open forecourt.
  expect(at('tavern', 3, 18, 28, 24)).toBe(0);
  expect(at('tavern', 3, 22, 19, 26)).not.toBe(0);
  expect(at('tavern', 3, 22, 19, 27)).toBe(0);
});

it('places bridge light anchors at the supplied bridge site and provides the fountain surface only when built', async () => {
  const { growthCivicLights, growthCivicWater } = await import('./index');
  const low = { water: 6, bank: 14 }, high = { water: 10, bank: 20 };
  const lowLight = growthCivicLights('bridge', 4, low)[0]!;
  const highLight = growthCivicLights('bridge', 4, high)[0]!;
  expect(highLight.centre[1]).toBeGreaterThan(lowLight.centre[1]);
  const bp = createGrowthCivicForm('bridge', 'hearth', 4, high);
  const { voxels, size: [sx, sy] } = rasterizeBlueprint(bp);
  const [x, y, z] = highLight.centre;
  expect(voxels[x + sx * (y + sy * z)]).not.toBe(0);
  expect(growthCivicWater('castle-court', 2)).toBeNull();
  expect(growthCivicWater('castle-court', 3)).toEqual({ from: [22, 8, 11], to: [42, 8, 21] });
});

it.each(['hearth', 'tide'] as const)('%s bridge lamps sit above the existing masonry and leave the walk clear', async style => {
  const { createHumpbackBridge } = await import('../places/water/bridge/bridge');
  for (const site of [{ water: 2, bank: 3 }, { water: 6, bank: 14 }, { water: 10, bank: 20 }, { water: 12, bank: 24 }]) {
    const base = rasterizeBlueprint(createHumpbackBridge(style, site.water, site.bank).blueprint);
    const added = rasterizeBlueprint(createGrowthCivicForm('bridge', style, 4, site));
    const [sx, sy, sz] = added.size;
    const { growthCivicLights } = await import('./index');
    const { MAT } = await import('../materials');
    for (const light of growthCivicLights('bridge', 4, site)) {
      const [x, y, z] = light.centre;
      expect(added.voxels[x + sx * (y + sy * z)]).toBe(MAT.glass);
    }
    // Every lamp and standard has four feet resting on the existing coping; hanging cloth need not touch it.
    for (const z of [0, 28]) for (const x of [20, 40, 54, 86, 100, 120]) for (let dx = 0; dx < 4; dx++) {
      const y = Array.from({ length: sy }, (_, h) => h).find(h => added.voxels[x + dx + sx * (h + sy * z)] !== 0)!;
      expect(base.voxels[x + dx + sx * (y - 1 + base.size[1] * z)]).not.toBe(0);
    }
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      if (!added.voxels[x + sx * (y + sy * z)]) continue;
      expect(z < 4 || z >= 28).toBe(true);
      if (y < base.size[1]) expect(base.voxels[x + sx * (y + base.size[1] * z)]).toBe(0);
    }
  }
});

it.each(['hearth', 'tide'] as const)('%s forge additions preserve the original hearth and dragon envelope', async style => {
  const { FORGE_EXTENSION_HEARTH_OFFSET } = await import('./forge-extension');
  const { createForgeHearth } = await import('../forge-square');
  const size = createForgeHearth(style).size;
  for (const level of [1, 2, 3, 4]) {
    for (const box of createGrowthCivicForm('forge', style, level).boxes) {
      const overlaps = box.from.every((v, axis) => v < FORGE_EXTENSION_HEARTH_OFFSET[axis]! + size[axis]!
        && box.to[axis]! > FORGE_EXTENSION_HEARTH_OFFSET[axis]!);
      expect(overlaps).toBe(false);
    }
  }
});

it.each(['hearth', 'tide'] as const)('%s mature court lanterns remain exposed in front of the arcade', async style => {
  const { growthCivicLights } = await import('./index');
  const { MAT } = await import('../materials');
  const { voxels, size: [sx, sy] } = rasterizeBlueprint(createGrowthCivicForm('castle-court', style, 4));
  const at = (x: number, y: number, z: number) => voxels[x + sx * (y + sy * z)];
  for (const { centre: [x, y, z] } of growthCivicLights('castle-court', 4)) {
    expect(at(x, y, z)).toBe(MAT.glass);
    expect(at(x, y, z + 2)).toBe(0);
    expect(at(x, y, z - 2)).toBe(0);
  }
});

it.each(['hearth', 'tide'] as const)('%s adds the defining large silhouettes at successive stages', style => {
  for (const [place, level, x, y, z] of [
    ['tavern', 3, 30, 52, 20], // dormer roof above the original ridge
    ['tavern', 4, 10, 21, 30], // projecting porch canopy
    ['forge', 3, 32, 39, 10], // smithy roof spanning the hearth
    ['forge', 4, 53, 45, 5], // tall side chimney
    ['castle-court', 4, 32, 30, 5], // arcade above the fountain
  ] as const) {
    const sample = (stage: number) => {
      const { voxels, size: [sx, sy] } = rasterizeBlueprint(createGrowthCivicForm(place, style, stage));
      return voxels[x + sx * (y + sy * z)];
    };
    expect(sample(level - 1)).toBe(0);
    expect(sample(level)).not.toBe(0);
  }
});

it.each(['hearth', 'tide'] as const)('%s mature bridge raises four distinct standards', style => {
  const site = { water: 6, bank: 14 };
  const before = rasterizeBlueprint(createGrowthCivicForm('bridge', style, 3, site));
  const after = rasterizeBlueprint(createGrowthCivicForm('bridge', style, 4, site));
  const [sx, sy] = after.size;
  for (const z of [1, 29]) for (const x of [55, 87]) {
    const at = (cells: typeof after.voxels, y: number) => cells[x + sx * (y + sy * z)];
    expect(at(before.voxels, 60)).toBe(0);
    expect(at(after.voxels, 60)).not.toBe(0);
  }
});


it('sizes mature bridge additions from the actual deep site and preserves the full walking width', () => {
  const form = createGrowthCivicForm('bridge', 'tide', 4, { water: 20, bank: 28 });
  expect(form.size[1]).toBeGreaterThan(80);
  for (const box of form.boxes) {
    expect(box.to[1]).toBeLessThanOrEqual(form.size[1]);
    expect(box.to[2] <= 4 || box.from[2] >= 28).toBe(true);
  }
});
