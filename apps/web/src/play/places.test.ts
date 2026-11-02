import { describe, expect, it, vi } from 'vitest';
import type { InteractionPlaces } from '../interactions/ports';
import { withRegisteredPlaces } from './places';
import { placeCameraAt, registerPlace } from './slots';

const accepted = (action: string, kind: string) => ({ action, record: { target: { kind } } }) as unknown as Parameters<InteractionPlaces['open']>[0];

describe('registered places', () => {
  it('open the tavern and the campfire, and leave the forge and benches to the page', () => {
    const forgeView = { close() {} }, tavernView = { close() {} };
    const base: InteractionPlaces = { open: vi.fn(() => forgeView), home: vi.fn(() => null) };
    const places = withRegisteredPlaces(base);
    expect(places.open(accepted('tavern', 'tavern-seat'), () => {})).toBe(forgeView);
    const tavern = vi.fn(() => tavernView);
    const stop = registerPlace({ id: 'tavern', openers: { tavern }, zoneOf: feet => feet[0] > 0 ? 'tavern:t1' : null,
      camera: zone => zone === 'tavern:t1' ? { maxDistance: 2.4, tilt: [.2, .7], seeThrough: [] } : null });
    try {
      expect(places.open(accepted('tavern', 'tavern-seat'), () => {})).toBe(tavernView);
      expect(places.open(accepted('sit', 'campfire-seat'), () => {})).toBe(forgeView);
      expect(places.open(accepted('forge', 'anvil'), () => {})).toBe(forgeView);
      places.home?.({ plotId: 'p', door: null });
      expect(base.home).toHaveBeenCalled();
      expect(placeCameraAt([1, 0, 0])?.maxDistance).toBe(2.4);
      expect(placeCameraAt([-1, 0, 0])).toBeNull();
      expect(() => registerPlace({ id: 'tavern', openers: {}, zoneOf: () => null, camera: () => null })).toThrow();
    } finally { stop(); }
    expect(places.open(accepted('tavern', 'tavern-seat'), () => {})).toBe(forgeView);
  });

  it('never let a broken place steer the camera', () => {
    const stop = registerPlace({ id: 'broken', openers: {}, zoneOf: () => { throw new Error('no'); }, camera: () => null });
    const odd = registerPlace({ id: 'odd', openers: {}, zoneOf: () => 'z', camera: () => ({ maxDistance: Number.NaN, tilt: [0, 1], seeThrough: [] }) });
    try { expect(placeCameraAt([0, 0, 0])).toBeNull(); } finally { stop(); odd(); }
  });
});
