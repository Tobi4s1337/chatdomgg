import { describe, expect, it } from 'vitest';
import { automaticSceneQuality, isSceneQuality, SCENE_QUALITIES, sceneQualityBudget } from './scene-quality';

describe('the kingdom scene quality setting', () => {
  it('keeps the automatic behaviour until a person chooses', () => {
    expect(automaticSceneQuality(1440)).toBe('high');
    expect(automaticSceneQuality(390)).toBe('low');
    expect(sceneQualityBudget(null, 'high', 1440)).toEqual({ choice: null, post: 'high', water: 'full', landDetail: null, landBudget: { quads: 850_000, maxPixels: 3 } });
    // A desktop window narrowed after opening keeps its post size and follows the width for water, as before.
    expect(sceneQualityBudget(null, 'high', 500)).toEqual({ choice: null, post: 'high', water: 'reduced', landDetail: null, landBudget: { quads: 850_000, maxPixels: 3 } });
  });

  it('follows the governed automatic tier until a person chooses', () => {
    expect(sceneQualityBudget(null, 'balanced', 1920)).toEqual({ choice: null, post: 'balanced', water: 'full', landDetail: 2, landBudget: { quads: 400_000, maxPixels: 4.5 } });
    expect(sceneQualityBudget(null, 'low', 1920)).toEqual({ choice: null, post: 'low', water: 'reduced', landDetail: 3, landBudget: { quads: 300_000, maxPixels: 6 } });
  });

  it('applies a chosen quality to the post stack and the water, whatever the width', () => {
    expect(sceneQualityBudget('low', 'high', 1920)).toEqual({ choice: 'low', post: 'low', water: 'reduced', landDetail: 3, landBudget: { quads: 300_000, maxPixels: 6 } });
    expect(sceneQualityBudget('balanced', 'low', 390)).toEqual({ choice: 'balanced', post: 'balanced', water: 'full', landDetail: 2, landBudget: { quads: 400_000, maxPixels: 4.5 } });
    expect(sceneQualityBudget('high', 'low', 390)).toEqual({ choice: 'high', post: 'high', water: 'full', landDetail: null, landBudget: { quads: 850_000, maxPixels: 3 } });
  });

  it('offers exactly three choices and refuses anything else', () => {
    expect(SCENE_QUALITIES).toEqual(['high', 'balanced', 'low']);
    expect(isSceneQuality('capture')).toBe(false);
    expect(() => sceneQualityBudget('capture' as never, 'high', 1440)).toThrow(/Unknown scene quality/);
  });
});
