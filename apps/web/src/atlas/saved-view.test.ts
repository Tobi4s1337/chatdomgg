// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { savedView } from './saved-view';

const view = { x: 1200.5, y: -340.25, scale: 0.42, selected: '141981764', mapId: 'world-abc' };

describe('savedView', () => {
  it('returns the camera and selection of a view from the same map', () => {
    expect(savedView(view, 'world-abc')).toEqual({ camera: { x: 1200.5, y: -340.25, scale: 0.42 }, selected: '141981764' });
  });

  it('keeps a view without a selection', () => {
    expect(savedView({ ...view, selected: null }, 'world-abc')?.selected).toBeNull();
  });

  it('falls back for a view from another survey revision', () => {
    expect(savedView(view, 'world-def')).toBeNull();
    expect(savedView({ ...view, mapId: '' }, '')).toBeNull();
  });

  it('falls back for malformed or forged values without throwing', () => {
    for (const bad of [null, undefined, 'view', 7, [], {}, { ...view, x: '1' }, { ...view, x: Number.NaN }, { ...view, y: Number.POSITIVE_INFINITY },
      { ...view, scale: 0 }, { ...view, scale: -1 }, { ...view, scale: 1e9 }, { ...view, x: 1e12 }]) {
      expect(savedView(bad, 'world-abc')).toBeNull();
    }
  });

  it('drops a selection that is not a channel ID but keeps the camera', () => {
    for (const selected of ['waiting:1', 'dab:abc', '<img>', '1'.repeat(40), 42]) {
      const read = savedView({ ...view, selected }, 'world-abc');
      expect(read?.camera).toEqual({ x: 1200.5, y: -340.25, scale: 0.42 });
      expect(read?.selected).toBeNull();
    }
  });
});
