import { GrowthSceneFrameSchema, type GrowthSceneFrame } from '@chatdom/shared';

/** Published geometry is a separate fact from a citizen's earned growth entitlement. */
export interface HomeRevision { readonly plotId: string; readonly assetRevision: string }
export interface HistoricalSnapshot {
  readonly frame: GrowthSceneFrame;
  readonly homes: readonly HomeRevision[];
  /** Opaque host-owned, complete scene revision, including civic places, streets and castle. */
  readonly worldRevision: string;
  readonly caption: string;
  /** Optional presentation focus; the host still applies the entire snapshot. */
  readonly focus?: 'home' | 'market';
}
export interface History {
  readonly label: 'LIVE' | 'SIMULATED';
  readonly snapshots: readonly HistoricalSnapshot[];
}
/** A separate replay presentation: replace is a full replacement, never an event or ceremony. */
export interface ReplayBinding {
  replace(snapshot: HistoricalSnapshot): void;
  clear(): void;
  dispose(): void;
}

export type ReplayState =
  | { readonly status: 'unavailable'; readonly playing: false }
  | { readonly status: 'empty'; readonly label: History['label']; readonly playing: false }
  | { readonly status: 'ready'; readonly label: History['label']; readonly index: number; readonly count: number;
      readonly snapshot: HistoricalSnapshot; readonly playing: boolean };

/** Validated snapshots are owned by the replay, including nested frame data. */
function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** Validate the entire history before it can affect the engine; never infer it from a frame's recent beats. */
export function validateHistory(input: History): History {
  if (input.label !== 'LIVE' && input.label !== 'SIMULATED') throw new Error('History provenance is missing.');
  let previous: GrowthSceneFrame | undefined;
  const snapshots = input.snapshots.map(item => {
    const frame = GrowthSceneFrameSchema.parse(item.frame);
    if (frame.origin !== (input.label === 'LIVE' ? 'live' : 'simulated')) throw new Error('History provenance does not match its label.');
    if (previous && (frame.kingdomId !== previous.kingdomId || frame.sequence <= previous.sequence || frame.asOf < previous.asOf)) throw new Error('History must be ordered within one kingdom.');
    const framePlots = new Set(frame.homes.map(home => home.plotId));
    if (item.focus !== undefined && item.focus !== 'home' && item.focus !== 'market' || !item.worldRevision.trim() || !item.caption.trim() || item.homes.some(home => !home.plotId.trim() || !home.assetRevision.trim()) || new Set(item.homes.map(home => home.plotId)).size !== item.homes.length || item.homes.length !== frame.homes.length || item.homes.some(home => !framePlots.has(home.plotId))) throw new Error('History needs complete scene revisions and a factual caption.');
    previous = frame;
    // A room frame's recent beats are presentation tail, not a historical fact log.
    // Never hand them to a replay binding where they could become live ceremonies.
    return { frame: { ...frame, beats: [] }, homes: item.homes.map(home => ({ ...home })), worldRevision: item.worldRevision, caption: item.caption, ...(item.focus ? { focus: item.focus } : {}) };
  });
  return freezeSnapshot({ label: input.label, snapshots });
}

export function createReplay(binding: ReplayBinding, onChange: (state: ReplayState) => void = () => {}) {
  let history: History | undefined, index = 0, playing = false, disposed = false;
  const assertOpen = () => { if (disposed) throw new Error('Chronicle is closed.'); };
  const state = (): ReplayState => history ? history.snapshots.length
    ? { status: 'ready', label: history.label, index, count: history.snapshots.length, snapshot: history.snapshots[index]!, playing }
    : { status: 'empty', label: history.label, playing: false } : { status: 'unavailable', playing: false };
  const emit = () => onChange(state());
  const clearAndEmit = () => {
    try { binding.clear(); } catch (error) { history = undefined; playing = false; throw error; } finally { emit(); }
  };
  const apply = (snapshot: HistoricalSnapshot) => {
    try { binding.replace(snapshot); } catch (error) {
      history = undefined; playing = false; clearAndEmit(); throw error;
    }
  };
  return {
    state,
    load(input: History | null) {
      assertOpen();
      // Invalid data is unavailable, not a stale successful replay.
      let next: History | undefined;
      try { next = input ? validateHistory(input) : undefined; } catch (error) {
        history = undefined; playing = false; clearAndEmit(); throw error;
      }
      history = next; index = 0; playing = false;
      if (history?.snapshots.length) { apply(history.snapshots[0]!); emit(); } else clearAndEmit();
    },
    seek(next: number) {
      assertOpen();
      if (!history?.snapshots.length || !Number.isFinite(next)) return;
      index = Math.max(0, Math.min(history.snapshots.length - 1, Math.round(next)));
      apply(history.snapshots[index]!); emit();
    },
    play() { assertOpen(); if (history && index < history.snapshots.length - 1) playing = true; emit(); },
    pause() { assertOpen(); playing = false; emit(); },
    step() {
      assertOpen(); if (!playing || !history) return;
      index = Math.min(index + 1, history.snapshots.length - 1);
      apply(history.snapshots[index]!);
      if (index === history.snapshots.length - 1) playing = false;
      emit();
    },
    dispose() { if (disposed) return; disposed = true; playing = false; try { binding.clear(); } finally { binding.dispose(); } },
  };
}
