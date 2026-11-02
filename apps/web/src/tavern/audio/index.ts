import type { GatherFrame, Vec3 } from '@chatdom/shared';
import { createTavernSoundGraph, type TavernListener, type TavernSoundGraph, type TavernSoundInspection, type TavernSoundPlaces } from './graph';
import { TavernObserver } from './observer';

export { createTavernSoundGraph, TAVERN_SOUND_LIMITS } from './graph';
export type { TavernListener, TavernSoundGraph, TavernSoundInspection, TavernSoundPlaces } from './graph';
export type { TavernCue } from './observer';
export interface TavernSoundUpdate {
  frame: GatherFrame; connected: boolean; visible: boolean; now: number; walkers: number;
  listener: { feet: Vec3; forward: Vec3 }; seated: string | null;
  /** Read-only mapping from factual contact epoch to the existing presentation clock; returns seconds. */
  pongContactDelay?(table: string, at: number, now: number): number;
}
export interface TavernSound {
  update(observation: TavernSoundUpdate): void;
  /** A real button press: a small wood touch, distinct from the later server-accepted game action. */
  affordance(table: string | null): void;
  quiet(): void;
  dispose(): void;
  inspect(): TavernSoundInspection;
}
export type TavernSoundHost = Readonly<{ context: AudioContext; destination: AudioNode }>;

/** Host availability is permission. This layer neither creates nor resumes/closes an AudioContext. */
export function createTavernSound(host: () => TavernSoundHost | null, places: TavernSoundPlaces): TavernSound {
  const observer = new TavernObserver();
  let graph: TavernSoundGraph | null = null, installed: TavernSoundHost | null = null;
  let disposed = false, admitted = false, listener: TavernListener | null = null;
  let offState: (() => void) | null = null;
  const totals: TavernSoundInspection = { disposed: false, audible: false, activeSources: 0, activeVoices: 0,
    peakSources: 0, peakVoices: 0, played: {}, dropped: 0, murmur: 0 };
  function merge(snapshot: TavernSoundInspection): TavernSoundInspection {
    const played = { ...totals.played };
    for (const [cue, count] of Object.entries(snapshot.played)) played[cue as keyof typeof played] = (played[cue as keyof typeof played] ?? 0) + count!;
    return { ...snapshot, disposed, played, dropped: totals.dropped + snapshot.dropped,
      peakSources: Math.max(totals.peakSources, snapshot.peakSources), peakVoices: Math.max(totals.peakVoices, snapshot.peakVoices) };
  }
  function uninstall() {
    if (graph) {
      graph.dispose(); Object.assign(totals, merge(graph.inspect())); graph = null;
    }
    offState?.(); offState = null; installed = null;
  }
  function quiet() {
    admitted = false; listener = null; observer.reset(); uninstall();
  }
  function position(table: string | null): Vec3 {
    return places.tables.find(place => place.id === table)?.centre ?? places.hearth;
  }
  return {
    update(observation) {
      if (disposed) return;
      const current = host();
      if (!observation.connected || !observation.visible || !Number.isFinite(observation.now)
        || !current || current.context.state !== 'running') { quiet(); return; }
      if (installed?.context !== current.context || installed?.destination !== current.destination) {
        quiet();
        graph = createTavernSoundGraph(current, places); installed = current;
        const onState = () => { if (current.context.state !== 'running') quiet(); };
        current.context.addEventListener('statechange', onState);
        offState = () => current.context.removeEventListener('statechange', onState);
      }
      const events = observer.step(observation.frame, observation.now, observation.seated);
      if (!events.fresh) { graph?.quiet(); admitted = false; return; }
      admitted = true; listener = observation.listener;
      for (const attack of events.attacks) {
        const centre = position(attack.table);
        const at: Vec3 = attack.x === undefined ? centre : [centre[0] + attack.x * .62, centre[1] + .044, centre[2] - (attack.y ?? 0) * .28];
        const delay = attack.at !== undefined && attack.table !== null
          ? observation.pongContactDelay?.(attack.table, attack.at, observation.now) ?? 0 : 0;
        graph?.play(attack.cue, at, observation.listener, delay);
      }
      graph?.update(observation.listener, observation.walkers);
    },
    affordance(table) {
      if (disposed || !admitted || !listener || !installed) return;
      const current = host();
      if (!current || current.context !== installed.context || current.destination !== installed.destination || current.context.state !== 'running') { quiet(); return; }
      graph?.play('wood', position(table), listener);
    },
    quiet,
    dispose() { if (disposed) return; quiet(); disposed = true; },
    inspect() {
      if (graph) return merge(graph.inspect());
      return { ...totals, played: { ...totals.played }, disposed, audible: false, activeSources: 0, activeVoices: 0, murmur: 0 };
    },
  };
}
