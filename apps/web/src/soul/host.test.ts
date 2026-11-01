import { describe, expect, it, vi } from 'vitest';
import type { Scene } from 'three';
import { createSoulSceneHost, type SoulAudioHost } from './host';
import { DEFAULT_SOUL_TOPOLOGY } from '../../../../packages/world/src/soul';
import { createSoulAudio } from '../../../../packages/audio/src/soul';
import { createSoulPresentation, createSoulWeatherSurfaces } from './presentation';

vi.mock('./presentation', () => ({
  createSoulPresentation: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
  createSoulWeatherSurfaces: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
}));
vi.mock('../../../../packages/audio/src/soul', () => ({
  createSoulAudio: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn(), cue: vi.fn(), inspect: vi.fn() })),
}));

describe('kingdom soul host', () => {
  it('shares the existing audio context, consumes missed arrivals and releases only its own resources', () => {
    vi.clearAllMocks();
    const at = Date.UTC(2026, 5, 20, 13);
    let audio: SoulAudioHost | null = null;
    const binding = {
      config: { seed: 42, biome: 'coastal' as const, topology: DEFAULT_SOUL_TOPOLOGY, shipArrivals: [at] },
      surfaces: { roofs: [], snow: [], puddles: [] },
      profile: 'stream' as const,
    };
    const host = createSoulSceneHost({} as Scene, binding, () => audio);
    const tick = (epochMs: number, population = 0) => host.update({ epochMs, population, seconds: epochMs / 1000, listener: { position: [0, 1, 0], right: [1, 0, 0] } });
    tick(at - 200);
    expect(createSoulAudio).not.toHaveBeenCalled();
    audio = { context: {} as AudioContext, destination: {} as AudioNode };
    tick(at - 100);
    const firstSound = vi.mocked(createSoulAudio).mock.results.at(-1)!.value;
    tick(at); tick(at + 100);
    expect(firstSound.cue).toHaveBeenCalledExactlyOnceWith('arrival');
    expect(createSoulAudio).toHaveBeenCalledTimes(1);
    expect(firstSound.update).toHaveBeenLastCalledWith(expect.objectContaining({ profile: 'stream', presence: 0 }));
    expect(tick(at + 200, 20)!.keepers.every(keeper => !keeper.visible)).toBe(true);
    audio = null;
    tick(at + 300);
    expect(firstSound.dispose).toHaveBeenCalledTimes(1);
    audio = { context: {} as AudioContext, destination: {} as AudioNode };
    tick(at + 86_400_000); tick(at + 500);
    const resumed = vi.mocked(createSoulAudio).mock.results.at(-1)!.value;
    expect(resumed.cue).not.toHaveBeenCalled();
    tick(Date.UTC(2026, 5, 20, 19));
    expect(host.sources()).toHaveLength(3);
    expect(host.sources().every(source => !('slot' in source) && source.strength > 0)).toBe(true);
    host.dispose(); host.dispose();
    expect(resumed.dispose).toHaveBeenCalledTimes(1);
    const picture = vi.mocked(createSoulPresentation).mock.results.at(-1)!.value;
    const surfaces = vi.mocked(createSoulWeatherSurfaces).mock.results.at(-1)!.value;
    expect(picture.dispose).toHaveBeenCalledTimes(1);
    expect(surfaces.dispose).toHaveBeenCalledTimes(1);
    expect(tick(at + 600)).toBeUndefined();
    expect(host.sources()).toEqual([]);
  });
});
