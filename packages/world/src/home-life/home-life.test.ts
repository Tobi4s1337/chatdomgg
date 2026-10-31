import { expect, it } from 'vitest';
import { createHearthHome, createHome, createTideHome, STYLES } from '../../../content/src/index';
import type { VoxelBlueprint } from '@chatdom/shared';
import { homeLifeAnchors } from './index';

it('finds authored home portals and real pot/cap mouths without turning facade windows or a plain custom roof into house life', () => {
  const hearth = createHearthHome('hut', 0), tide = createTideHome('hut', 0), grove = createHome('house', 'grove', 0);
  const before = JSON.stringify([hearth, tide, grove]);
  const warm = homeLifeAnchors(hearth), coastal = homeLifeAnchors(tide), woodland = homeLifeAnchors(grove);
  expect(warm.door).not.toBeNull();
  expect(coastal.door).not.toBeNull();
  expect(woodland.door).toEqual({ from: [24, 4, 88], to: [34, 22, 92] });
  expect(warm.chimneys).toEqual([[6.5, 68, 88.5], [7.5, 67, 93.5]]); // Both actual terracotta pots survive.
  expect(coastal.chimneys).toEqual([[23, 74, 84]]);
  expect(woodland.chimneys).toEqual([[50.5, 81, 33.5]]);
  expect(homeLifeAnchors(hearth)).toEqual(warm);
  expect(JSON.stringify([hearth, tide, grove])).toBe(before);

  const custom: VoxelBlueprint = { version: 1, id: 'citizen-authored-house', styleId: STYLES.grove.id, kind: 'home', lattice: 'build',
    size: [64, 80, 96], windows: [], boxes: [
      { from: [4, 0, 4], to: [60, 4, 92], material: 1 },
      { from: [4, 4, 88], to: [60, 40, 92], material: 1 },
      { from: [4, 40, 4], to: [60, 44, 92], material: 1 },
      { from: [10, 16, 87], to: [18, 32, 93], material: 0 }, // High front window.
      { from: [24, 4, 4], to: [34, 22, 8], material: 0 }, // Rear opening is not the front portal.
      { from: [40, 2, 87], to: [42, 5, 93], material: 0 }, // Narrow low drain.
    ] };
  expect(homeLifeAnchors(custom)).toEqual({ door: null, chimneys: [] });
  expect(homeLifeAnchors({ ...hearth, id: custom.id }).chimneys).toEqual(warm.chimneys);
  // Final occupancy wins over a nominal carved flue, and a custom ID cannot inherit Grove's capped chimney rule.
  const filled: VoxelBlueprint = { ...hearth, id: custom.id, boxes: [...hearth.boxes,
    { from: [6, 65, 88], to: [7, 68, 89], material: 1 }, { from: [7, 65, 93], to: [8, 67, 94], material: 1 }] };
  expect(homeLifeAnchors(filled).chimneys).toEqual([]);
  expect(homeLifeAnchors({ ...grove, id: custom.id }).chimneys).toEqual([]);
});
