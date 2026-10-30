import { expect, it } from 'vitest';
import { generateKingdom } from '@chatdom/world';
import { inhabitedLightBounds } from './light-bounds';
import { resolveLightFieldConfig } from './light-field-worker';

it('covers all occupied reservations and spill without making the lake determine field resolution', () => {
  const town = generateKingdom({ seed: 'lanternmere', tier: 'town', firstYear: 2022, year: 2026 });
  const expanded = { ...town, bounds: { minX: -208, maxX: 208, minZ: -144, maxZ: 288 } };
  const bounds = inhabitedLightBounds(town.homes);
  expect(resolveLightFieldConfig(expanded, { mode: 'kingdom' }).cellSize).toBe(4);
  const field = resolveLightFieldConfig(expanded, { mode: 'kingdom', bounds });
  expect(field.cellSize).toBe(2);
  for (const { lot } of town.homes) {
    expect(lot.minX - bounds.minX).toBeGreaterThanOrEqual(16);
    expect(bounds.maxX - lot.maxX).toBeGreaterThanOrEqual(16);
    expect(lot.minZ - bounds.minZ).toBeGreaterThanOrEqual(16);
    expect(bounds.maxZ - lot.maxZ).toBeGreaterThanOrEqual(16);
  }
});

it('rejects empty or invalid light domains', () => {
  expect(() => inhabitedLightBounds([])).toThrow();
  expect(() => inhabitedLightBounds([{ lot: { minX: 1, maxX: 0, minZ: 0, maxZ: 1 } }])).toThrow();
});
