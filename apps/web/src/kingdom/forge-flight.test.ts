import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { forgeRitualFrame } from '@chatdom/forge';
import { createForgeFlight } from './forge-flight';

const capture = vi.hoisted(() => ({ update: vi.fn(), dispose: vi.fn() }));
vi.mock('@chatdom/render/effects', async importOriginal => ({
  ...await importOriginal<typeof import('@chatdom/render/effects')>(),
  createEffects: () => capture,
}));

it('sends one timed roof-contact burst from the actual SIM or room pose, and clears it on rewind', () => {
  const flight = createForgeFlight(new THREE.Scene(), new THREE.PerspectiveCamera(), false);
  const roof = [12, 18, -6] as const;
  const frame = (t: number) => forgeRitualFrame('wish', t);
  flight.simulated(frame(18.6), [12, 21, -6], roof); flight.update();
  expect(capture.update.mock.lastCall![0].sparks).toEqual([]);
  flight.simulated(frame(18.85), [12, 21, -6], roof); flight.update();
  const burst = capture.update.mock.lastCall![0].sparks[0];
  expect(burst.position).toEqual(roof);
  expect(burst.burstId).toBe('forge:wish:landing');
  expect(burst.startedAt).toBeCloseTo(18.65);
  flight.simulated(frame(19.2), [12, 21, -6], roof); flight.update();
  expect(capture.update.mock.lastCall![0].sparks[0].startedAt).toBeCloseTo(burst.startedAt);
  flight.realm(frame(18.9), [90, 27, 2], [90, 24, 2]); flight.update();
  expect(capture.update.mock.lastCall![0].sparks[0].position).toEqual([90, 24, 2]);
  flight.realm(null, null); flight.simulated(frame(17), roof); flight.update();
  expect(capture.update.mock.lastCall![0].sparks).toEqual([]);
  flight.simulated(null, null); flight.update();
  expect(capture.update.mock.lastCall![0]).toMatchObject({ flight: null, sparks: [] });
  flight.dispose();
});

it('prioritizes the room reaction and retires a landed cue on its own clock', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000);
  try {
    const flight = createForgeFlight(new THREE.Scene(), new THREE.PerspectiveCamera(), false);
    const simulatedPosition = [1, 2, 3] as const;
    const roomPosition = [4, 5, 6] as const;
    flight.simulated(forgeRitualFrame('sim', 20), simulatedPosition);
    flight.realm(forgeRitualFrame('room', 22), roomPosition);
    expect(flight.reaction(50_000)).toMatchObject({ position: roomPosition, elapsed: 22, phase: 'landed' });

    flight.realm(null, null);
    expect(flight.reaction(1_500)).toMatchObject({ position: roomPosition, elapsed: 22.5 });
    expect(flight.reaction(2_000)).toMatchObject({ position: simulatedPosition, elapsed: 20 });
    flight.simulated(null, null);
    expect(flight.reaction(4_000)).toBeNull();
    flight.realm(forgeRitualFrame('room', 22), roomPosition);
    flight.dispose();
    expect(flight.reaction(1_000)).toBeNull();
  } finally {
    clock.mockRestore();
  }
});
