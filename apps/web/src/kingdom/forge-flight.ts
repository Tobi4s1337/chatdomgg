import * as THREE from 'three';
import { FORGE_STAGE_TIMING } from '@chatdom/forge';
import { createEffects, createFlightRecorder, forgeFlightCue, forgeSparks, type FlightCue, type SparkBurst } from '@chatdom/render/effects';
import type { ForgeRitualFrame, Vec3 } from '@chatdom/shared';
import { CONTACT } from '../forge/presentation/stage';

/** One pool, with independent histories and clocks for each presentation. */
export function createForgeFlight(scene: THREE.Scene, camera: THREE.Camera, phone: boolean) {
  const effects = createEffects({ scene, camera, seed: 0xf047e, quality: phone ? 'low' : 'high' });
  function channel() {
    const recorder = createFlightRecorder();
    let cue: FlightCue | null = null, time = 0, ritual = '';
    let sparks: SparkBurst[] = [];
    return {
      receive(frame: ForgeRitualFrame | null, position: Vec3 | null, socket?: Vec3) {
        if (!frame || !position || (frame.phase !== 'flight' && frame.phase !== 'landed')) {
          recorder.clear(); cue = null; sparks = []; ritual = ''; return;
        }
        if (ritual !== frame.ritualId || frame.elapsed < time) recorder.clear();
        ritual = frame.ritualId; time = frame.elapsed;
        if (frame.phase === 'flight') recorder.record(`forge:${ritual}:flight`, time, position);
        cue = forgeFlightCue(frame, position, time, FORGE_STAGE_TIMING, recorder.history());
        // The trail follows the crown; contact sparks belong at the validated roof socket.
        sparks = socket ? forgeSparks(frame, { anvil: socket, landing: socket }, time, FORGE_STAGE_TIMING, CONTACT) : [];
      },
      current() { return cue ? { cue, sparks, time } : null; },
      clear() { recorder.clear(); cue = null; sparks = []; ritual = ''; },
    };
  }
  const simulated = channel(), realm = channel();
  return {
    simulated: simulated.receive, realm: realm.receive,
    update() {
      const active = realm.current() ?? simulated.current();
      effects.update({ time: active?.time ?? 0, wind: [0, 0, 0], flight: active?.cue ?? null, sparks: active?.sparks ?? [] });
    },
    dispose() { simulated.clear(); realm.clear(); effects.dispose(); },
  };
}
