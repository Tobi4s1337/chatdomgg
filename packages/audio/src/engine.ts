import { resolveFamily } from './families';
import { createMix, masterLevel, rampMaster, RAMP_SECONDS, type Mix } from './mix';
import { Mixer, noiseBuffer } from './mixer';
import { fetchSample, SampleBank, type SampleBankReport, type SampleLoader } from './samples';
import type { AudioCue, AudioCueOptions, AudioSettings, KingdomAudio, KingdomAudioState } from './types';

const DEFAULTS: AudioSettings = { muted: false, volume: 0.65 };
/** How long an unlock waits for the browser before answering false. A later resume still makes the sound ready. */
const UNLOCK_WAIT_MS = 2500;

export interface AudioEngineDeps {
  createContext?: () => AudioContext | undefined;
  loadSample?: SampleLoader;
  random?: () => number;
}

export interface KingdomAudioInspection {
  contextState: string | null;
  samples: SampleBankReport;
  voices: number;
  sources: number;
  /** The variation each family played last, by family key. */
  variations: Readonly<Record<string, number>>;
  /** Absolute peak of the master output right now, read from the live graph. */
  level(): number;
}

const inspections = new WeakMap<KingdomAudio, () => KingdomAudioInspection>();

/** Diagnostics for the bench and checks. Not part of what consumers need to play sound. */
export function inspectKingdomAudio(audio: KingdomAudio): KingdomAudioInspection {
  const inspect = inspections.get(audio);
  if (!inspect) throw new TypeError('kingdom audio: not an instance created by createKingdomAudio');
  return inspect();
}

function defaultContext(): AudioContext | undefined {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  return Context ? new Context({ latencyHint: 'interactive' }) : undefined;
}

export function normalizeSettings(current: AudioSettings, next: Partial<AudioSettings>): AudioSettings {
  const result = { ...current };
  if (next.muted !== undefined) {
    if (typeof next.muted !== 'boolean') throw new TypeError('kingdom audio: muted must be a boolean');
    result.muted = next.muted;
  }
  if (next.volume !== undefined) {
    if (typeof next.volume !== 'number' || !Number.isFinite(next.volume)) throw new RangeError('kingdom audio: volume must be a finite number');
    result.volume = Math.min(1, Math.max(0, next.volume));
  }
  return result;
}

/**
 * One instance: one context, made and resumed inside the first unlock gesture. Status is `ready` only after a
 * resume has resolved and the context is actually running; a browser suspension or interruption afterwards reads
 * `suspended` and stops every voice, so nothing replays when it comes back.
 */
export function createAudioEngine(initial: Partial<AudioSettings> = {}, deps: AudioEngineDeps = {}): KingdomAudio {
  const random = deps.random ?? Math.random;
  const samples = new SampleBank(deps.loadSample ?? fetchSample);
  let settings = normalizeSettings(DEFAULTS, initial);
  let status: KingdomAudioState['status'] = 'locked';
  let context: AudioContext | undefined, mix: Mix | undefined, mixer: Mixer | undefined;
  let pending: Promise<boolean> | undefined, unlockedOnce = false;
  // Whether a resume() on the current context has resolved, and how many are still in flight.
  let resumed = false, inFlight = 0;
  const waiters = new Set<() => void>();

  function syncStatus(): void {
    if (status === 'disposed' || !context || pending) return;
    const state = context.state as string;
    if (state === 'running') { if (unlockedOnce) status = 'ready'; }
    else if (state === 'closed') status = 'unavailable';
    else if (unlockedOnce) status = 'suspended';
  }

  function onStateChange(event: Event): void {
    if (status === 'disposed' || event.target !== context || !context) return;
    if ((context.state as string) !== 'running') mixer?.silence(0);
    syncStatus();
    notify();
  }

  function open(): AudioContext | undefined {
    if (context && context.state !== 'closed') return context;
    // A context the browser closed under us is gone with its voices; start again cleanly.
    mixer?.close();
    context?.removeEventListener('statechange', onStateChange);
    let created: AudioContext | undefined;
    try { created = (deps.createContext ?? defaultContext)(); } catch { created = undefined; }
    if (!created) { status = 'unavailable'; return undefined; }
    context = created; resumed = false; inFlight = 0;
    mix = createMix(created, settings, random);
    mixer = new Mixer(created, mix, { noise: noiseBuffer(created, random), samples, random });
    created.addEventListener('statechange', onStateChange);
    return created;
  }

  /** Wakes everything waiting on this instance's unlock: a resume settled, or the context changed state. */
  function notify(): void { for (const waiter of [...waiters]) waiter(); }

  /**
   * Asks the context to run. Called synchronously from every unlock, so a later gesture still counts even when an
   * earlier, gesture-less request is parked by the browser (Chrome keeps such a resume pending indefinitely).
   */
  function requestResume(live: AudioContext): void {
    let request: Promise<void>;
    try { request = live.state === 'running' ? Promise.resolve() : live.resume(); }
    catch (error) { request = Promise.reject(error); }
    inFlight++;
    request.then(() => {
      inFlight--;
      if (live !== context || status === 'disposed') return;
      resumed = true;
      // A resume that resolves after its unlock gave up is still a real, successful resume.
      if (!pending && live.state === 'running') unlockedOnce = true;
      syncStatus();
      notify();
    }, () => { inFlight--; notify(); });
  }

  async function settle(live: AudioContext): Promise<boolean> {
    const running = await new Promise<boolean>(resolve => {
      const timer = globalThis.setTimeout(() => done(false), UNLOCK_WAIT_MS);
      const check = () => {
        if (status === 'disposed' || live !== context) done(false);
        else if (resumed && live.state === 'running') done(true);
        else if (inFlight === 0) done(false);
      };
      function done(value: boolean) { globalThis.clearTimeout(timer); waiters.delete(check); resolve(value); }
      waiters.add(check);
      check();
    });
    await samples.load(live);
    pending = undefined;
    if ((status as string) === 'disposed' || live !== context) return false;
    if (running && live.state === 'running') { unlockedOnce = true; status = 'ready'; return true; }
    status = (live.state as string) === 'closed' ? 'unavailable' : unlockedOnce ? 'suspended' : 'locked';
    return false;
  }

  function unlock(): Promise<boolean> {
    if (status === 'disposed') return Promise.resolve(false);
    // Everything up to resume() runs synchronously inside the caller's gesture.
    const live = open();
    if (!live) return Promise.resolve(false);
    if (live.state !== 'running' || !resumed) requestResume(live);
    void samples.load(live);
    pending ??= settle(live);
    return pending;
  }

  function cue(kind: AudioCue, options: AudioCueOptions = {}): boolean {
    const family = resolveFamily(kind, options);
    syncStatus();
    if (status !== 'ready' || !context || !mixer || context.state !== 'running') return false;
    if (masterLevel(settings) === 0) return false;
    return mixer.play(family, options);
  }

  function setSettings(next: Partial<AudioSettings>): void {
    const previous = settings;
    settings = normalizeSettings(settings, next);
    if (status === 'disposed' || !context || !mix || !mixer) return;
    rampMaster(mix, context, settings);
    // Muted means silent: ringing tails stop under the fade instead of waiting to come back on unmute.
    if (masterLevel(settings) === 0 && masterLevel(previous) > 0) mixer.silence(context.currentTime + RAMP_SECONDS + 0.005);
  }

  function getState(): KingdomAudioState {
    syncStatus();
    return { status, settings: Object.freeze({ ...settings }) };
  }

  function dispose(): void {
    if (status === 'disposed') return;
    status = 'disposed';
    pending = undefined;
    notify();
    mixer?.close();
    const closing = context;
    if (closing) {
      closing.removeEventListener('statechange', onStateChange);
      if (closing.state !== 'closed') closing.close().catch(() => undefined);
    }
    context = undefined; mix = undefined; mixer = undefined;
  }

  const audio: KingdomAudio = { unlock, cue, setSettings, getState, dispose };
  inspections.set(audio, () => ({
    contextState: context?.state ?? null,
    samples: samples.report(),
    voices: mixer?.voiceCount ?? 0,
    sources: mixer?.sourceCount ?? 0,
    variations: mixer?.variations ?? {},
    level: () => mixer?.level() ?? 0,
  }));
  return audio;
}
