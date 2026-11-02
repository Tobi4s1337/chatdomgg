// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { KEY_ITEMS } from './Legend';

const words = (text: string) => text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) ?? [];

describe('the map key', () => {
  it('names every mark the map draws in words: arms, pennant, live glow, pencil flag, kingdom, realms and roads', () => {
    expect(KEY_ITEMS.map(item => item.id)).toEqual(['holding', 'live', 'glow', 'waiting', 'kingdom', 'realms', 'road']);
  });

  it('gives each mark a short name and one plain line, nothing that needs a hover', () => {
    for (const item of KEY_ITEMS) {
      expect(words(item.name).length).toBeGreaterThan(0);
      expect(words(item.name).length).toBeLessThanOrEqual(3);
      expect(words(item.line).length).toBeGreaterThanOrEqual(5);
      expect(words(item.line).length).toBeLessThanOrEqual(12);
      expect(item.line).toMatch(/\.$/);
    }
  });

  it('never names a nation, a survey draft or a simulation', () => {
    for (const item of KEY_ITEMS) expect(`${item.name} ${item.line}`).not.toMatch(/simulat|draft|preview|country|nation/i);
  });
});
