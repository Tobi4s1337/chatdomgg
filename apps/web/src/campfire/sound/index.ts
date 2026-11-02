import type { CampfireFrame, Vec3 } from '@chatdom/shared';
import { createCampfireSoundGraph, type CampfireListener, type CampfirePlace, type CampfireSoundGraph, type CampfireSoundInspection } from './graph';
import { CampfireObserver } from './observer';

export { campfireDarkness, campfireReach, createCampfireSoundGraph, CAMPFIRE_SOUND_LIMITS } from './graph';
export type { CampfireListener, CampfirePlace, CampfireSoundGraph, CampfireSoundInspection } from './graph';
export { CAMPFIRE_CUES, type CampfireCue } from './materials';
export { CampfireObserver } from './observer';

export type CampfireSoundHost = Readonly<{ context: BaseAudioContext; destination: AudioNode }>;
export interface CampfireSoundInput {
  /** The host's monotonic `performance.now()`, milliseconds. */
  now: number;
  /** The kingdom's shared hour, 0..24, fractional. */
  hour: number;
  listener: { feet: Vec3; forward: Vec3 };
}
export interface CampfireSound {
  /** Every render frame (and on each public delivery): the raw witnessed public frame, or null when there is none. */
  update(frame: CampfireFrame | null, input: CampfireSoundInput): void;
  /** The local player's own choice was accepted by the fire: a soft click. Never call it for anyone else. */
  confirm(): void;
  quiet(): void;
  dispose(): void;
  inspect(): CampfireSoundInspection;
}

/**
 * Host availability is permission: the getter returns null while locked, muted, hidden or suspended. This layer
 * never creates, resumes, suspends or closes an AudioContext, and connects only to the supplied destination.
 */
export function createCampfireSound(host: () => CampfireSoundHost | null, place: CampfirePlace): CampfireSound {
  const observer = new CampfireObserver();
  let graph: CampfireSoundGraph | null = null, installed: CampfireSoundHost | null = null;
  let disposed = false, listener: CampfireListener | null = null, offState: (() => void) | null = null;
  const totals: CampfireSoundInspection = { disposed: false, audible: false, sources: 0, voices: 0, peakSources: 0, peakVoices: 0,
    played: {}, dropped: 0, beds: { fire: 0, night: 0 } };
  function merge(snapshot: CampfireSoundInspection): CampfireSoundInspection {
    const played = { ...totals.played };
    for (const [cue, count] of Object.entries(snapshot.played)) played[cue as keyof typeof played] = (played[cue as keyof typeof played] ?? 0) + count;
    return { ...snapshot, disposed, played, dropped: totals.dropped + snapshot.dropped,
      peakSources: Math.max(totals.peakSources, snapshot.peakSources), peakVoices: Math.max(totals.peakVoices, snapshot.peakVoices) };
  }
  function uninstall() {
    if (graph) { graph.dispose(); Object.assign(totals, merge(graph.inspect())); graph = null; }
    offState?.(); offState = null; installed = null;
  }
  function quiet() { listener = null; observer.reset(); uninstall(); }
  function current(): CampfireSoundHost | null {
    const found = host();
    return found && found.context.state === 'running' ? found : null;
  }
  return {
    update(frame, input) {
      if (disposed) return;
      const found = current();
      if (!found || !Number.isFinite(input.now) || !Number.isFinite(input.hour)) { quiet(); return; }
      if (installed?.context !== found.context || installed?.destination !== found.destination) {
        quiet();
        graph = createCampfireSoundGraph(found, place); installed = found;
        const onState = () => { if (found.context.state !== 'running') quiet(); };
        found.context.addEventListener('statechange', onState);
        offState = () => found.context.removeEventListener('statechange', onState);
      }
      listener = { feet: input.listener.feet, forward: input.listener.forward };
      // Beds first, so a cue's duck lands on a running fire.
      graph!.update(listener, input.hour);
      for (const cue of observer.step(frame, input.now)) graph!.play(cue, listener);
    },
    confirm() {
      if (disposed || !listener || !installed || !graph) return;
      const found = current();
      if (!found || found.context !== installed.context || found.destination !== installed.destination) { quiet(); return; }
      graph.play('tap', listener);
    },
    quiet,
    dispose() { if (disposed) return; quiet(); disposed = true; },
    inspect() {
      if (graph) return merge(graph.inspect());
      return { ...totals, played: { ...totals.played }, disposed, audible: false, sources: 0, voices: 0, beds: { fire: 0, night: 0 } };
    },
  };
}
