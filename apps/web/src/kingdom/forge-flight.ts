import * as THREE from 'three';
import { FORGE_STAGE_TIMING } from '@chatdom/forge';
import { createEffects, createFlightRecorder, forgeFlightCue, type FlightCue } from '@chatdom/render/effects';
import type { ForgeRitualFrame, Vec3 } from '@chatdom/shared';

/** One pool, with independent histories and clocks for each presentation. */
export function createForgeFlight(scene: THREE.Scene, camera: THREE.Camera, phone: boolean) {
  const effects = createEffects({ scene, camera, seed: 0xf047e, quality: phone ? 'low' : 'high' });
  function channel() {
    const recorder = createFlightRecorder();
    let cue: FlightCue | null = null, time = 0, ritual = '';
    return {
      receive(frame: ForgeRitualFrame | null, position: Vec3 | null) {
        if (!frame || !position || (frame.phase !== 'flight' && frame.phase !== 'landed')) {
          recorder.clear(); cue = null; ritual = ''; return;
        }
        if (ritual !== frame.ritualId || frame.elapsed < time) recorder.clear();
        ritual = frame.ritualId; time = frame.elapsed;
        if (frame.phase === 'flight') recorder.record(`forge:${ritual}:flight`, time, position);
        cue = forgeFlightCue(frame, position, time, FORGE_STAGE_TIMING, recorder.history());
      },
      current() { return cue ? { cue, time } : null; },
      clear() { recorder.clear(); cue = null; ritual = ''; },
    };
  }
  const simulated = channel(), realm = channel();
  return {
    simulated: simulated.receive, realm: realm.receive,
    update() {
      const active = realm.current() ?? simulated.current();
      effects.update({ time: active?.time ?? 0, wind: [0, 0, 0], flight: active?.cue ?? null });
    },
    dispose() { simulated.clear(); realm.clear(); effects.dispose(); },
  };
}
