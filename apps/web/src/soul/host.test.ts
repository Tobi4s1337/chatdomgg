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
  it('accepts witnessed arrivals after mounting and rings once for each latest overlapping arrival', () => {
    vi.clearAllMocks();
    const at = Date.UTC(2026, 5, 20, 13);
    const audio = { context: {} as AudioContext, destination: {} as AudioNode };
    const host = createSoulSceneHost({} as Scene, {
      config: { seed: 42, biome: 'coastal', topology: DEFAULT_SOUL_TOPOLOGY },
    }, () => audio);
    const tick = (epochMs: number, shipArrivals: readonly number[]) => host.update({
      epochMs, shipArrivals, population: 0, seconds: epochMs / 1000,
      listener: { position: [0, 1, 0], right: [1, 0, 0] },
    });
    tick(at - 100, []);
    const sound = vi.mocked(createSoulAudio).mock.results.at(-1)!.value;
    expect(tick(at, [at])!.shipBell).toBe(true);
    tick(at + 50, []);
    tick(at + 100, [at]); // a temporarily missing snapshot does not replay
    tick(at + 200, [at + 200, at]);
    tick(at + 300, [at + 200, at]);
    tick(at + 400, [at]); // dropping the newer arrival does not replay the older one
    expect(sound.cue).toHaveBeenCalledTimes(2);
    tick(at + 60_000, [at + 60_000]); // seek consumes the arrival
    tick(at + 60_100, [at + 60_000]);
    expect(sound.cue).toHaveBeenCalledTimes(2);
    host.dispose();
  });

  it('does not ring inland or replay an arrival heard while muted', () => {
    vi.clearAllMocks();
    const at = Date.UTC(2026, 5, 20, 13);
    let audio: SoulAudioHost | null = null;
    const inland = { ...DEFAULT_SOUL_TOPOLOGY, harbour: false };
    const makeHost = (topology: typeof DEFAULT_SOUL_TOPOLOGY) => createSoulSceneHost({} as Scene, {
      config: { seed: 42, biome: 'coastal', topology },
    }, () => audio);
    const host = makeHost(DEFAULT_SOUL_TOPOLOGY);
    const tick = (target: typeof host, epochMs: number) => target.update({
      epochMs, shipArrivals: [at], population: 0, seconds: epochMs / 1000,
      listener: { position: [0, 1, 0], right: [1, 0, 0] },
    });
    tick(host, at - 100); tick(host, at);
    audio = { context: {} as AudioContext, destination: {} as AudioNode };
    tick(host, at + 100);
    const sound = vi.mocked(createSoulAudio).mock.results.at(-1)!.value;
    expect(sound.cue).not.toHaveBeenCalled();
    const inlandHost = makeHost(inland);
    tick(inlandHost, at - 100);
    expect(tick(inlandHost, at)!.shipBell).toBe(false);
    expect(vi.mocked(createSoulAudio).mock.results.at(-1)!.value.cue).not.toHaveBeenCalled();
    host.dispose(); inlandHost.dispose();
  });

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

it('updates and disposes an externally rendered keeper rig', () => {
  vi.clearAllMocks();
  const keeperRenderer = { update: vi.fn(), dispose: vi.fn() };
  const host = createSoulSceneHost({} as Scene, {
    config: { seed: 42, biome: 'woodland', topology: DEFAULT_SOUL_TOPOLOGY },
  }, () => null, keeperRenderer);
  expect(vi.mocked(createSoulPresentation)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ externalKeepers: true }));
  const input = { epochMs: Date.UTC(2026, 5, 20, 10), seconds: 3, population: 0,
    listener: { position: [0, 1, 0] as const, right: [1, 0, 0] as const } };
  const frame = host.update(input);
  expect(keeperRenderer.update).toHaveBeenCalledWith(frame, 3);
  host.dispose(); host.dispose();
  expect(keeperRenderer.dispose).toHaveBeenCalledOnce();
});
