import type * as THREE from 'three';
import { createSoulSampler, type SoulConfig, type SoulFrame, type SoulPoint, type SoulTopology } from '../../../../packages/world/src/soul';
import { createSoulAudio, type SoulListener, type SoulProfile } from '../../../../packages/audio/src/soul';
import { createSoulPresentation, createSoulWeatherSurfaces } from './presentation';

/** Main supplies installed civic sites and public, collision-checked street routes. */
export interface SoulSceneBinding {
  config: Omit<SoulConfig, 'population' | 'topology'> & { topology: SoulTopology };
  chimney?: SoulPoint;
  surfaces?: Parameters<typeof createSoulWeatherSurfaces>[0];
  profile?: SoulProfile;
}
export interface SoulHostFrame {
  /** Absolute kingdom clock, never performance.now() or elapsed view time. */
  epochMs: number;
  seconds: number;
  population: number;
  listener: SoulListener;
}
export interface SoulAudioHost { context: AudioContext; destination: AudioNode }

/** One scene-owned lifecycle for walk and stream; never owns the host's context, camera or people. */
export function createSoulSceneHost(
  scene: THREE.Scene,
  binding: SoulSceneBinding,
  /** Null before unlock, while hidden/muted, or after the kingdom sound owner closes. */
  audioHost: () => SoulAudioHost | null,
) {
  const picture = createSoulPresentation(scene, { topology: binding.config.topology, chimney: binding.chimney });
  const surfaces = binding.surfaces && createSoulWeatherSurfaces(binding.surfaces);
  let sample = createSoulSampler({ ...binding.config, population: 0 });
  let population = 0;
  let sound: ReturnType<typeof createSoulAudio> | undefined;
  let context: AudioContext | undefined;
  let frame: SoulFrame | undefined;
  let disposed = false;
  let lastArrival: number | undefined;
  let lastEpoch: number | undefined;
  return {
    update(input: SoulHostFrame): SoulFrame | undefined {
      if (disposed) return undefined;
      if (input.population !== population) {
        population = input.population;
        sample = createSoulSampler({ ...binding.config, population });
      }
      frame = sample(input.epochMs);
      picture.update(frame, input.seconds);
      surfaces?.update(frame);
      const host = audioHost();
      if (host?.context !== context) {
        sound?.dispose(); sound = undefined; context = host?.context;
        if (host) sound = createSoulAudio(host.context, host.destination, { seed: String(binding.config.seed) });
      }
      sound?.update({ frame, biome: binding.config.biome, presence: population, listener: input.listener, profile: binding.profile ?? 'walk' });
      // A new mount or a seek consumes a current arrival without replaying its attack.
      const fresh = lastEpoch !== undefined && input.epochMs >= lastEpoch && input.epochMs - lastEpoch < 1000;
      const arrival = binding.config.shipArrivals?.find(at => input.epochMs >= at && input.epochMs < at + 12_000);
      if (frame.shipBell && arrival !== undefined && arrival !== lastArrival && fresh) sound?.cue('arrival');
      lastArrival = arrival;
      lastEpoch = input.epochMs;
      return frame;
    },
    inspect: () => ({ frame, sound: sound?.inspect(), disposed }),
    duck: (options?: { depthDb?: number; seconds?: number }) => sound?.duck(options),
    /** Civic emitters for the existing voxel light field; never a citizen window or viewer count. */
    sources: (): { position: SoulPoint; normal: SoulPoint; strength: number }[] => disposed ? [] : frame?.lamps.flatMap(lamp => lamp.lit ? [{
      position: [lamp.position[0], lamp.position[1] + 2.1, lamp.position[2]] as SoulPoint,
      normal: [0, -1, 0] as SoulPoint, strength: 0.7,
    }] : []) ?? [],
    dispose() {
      if (disposed) return;
      disposed = true;
      sound?.dispose(); sound = undefined; context = undefined;
      surfaces?.dispose(); picture.dispose();
    },
  };
}
