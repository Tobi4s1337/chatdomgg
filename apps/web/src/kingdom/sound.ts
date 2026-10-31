import {
  createForgeAudio, createKingdomAudio, kingdomAudioHost, playKingdomPhrase,
  type AudioCue, type AudioCueOptions, type ForgeAudio, type KingdomPhrase, type KingdomPhraseOptions,
} from '@chatdom/audio';
import type { ForgeRitualFrame } from '@chatdom/shared';
import { createKingdomAmbience } from './ambience';
import type { AmbienceTarget } from './ambience/types';
import { createProceduralMomentSound, CUE_LENGTH_MS } from '../twitch-moments/sound';
import type { MomentSoundPort } from '../twitch-moments/view';

/** The scene's one sound owner. Context, sources and the master stay inside the shared engine. */
export function createKingdomSound() {
  const audio = createKingdomAudio();
  const ambience = createKingdomAmbience(phrase => playKingdomPhrase(audio, phrase));
  let requested = false, disposed = false, explicitlyMuted = false;
  let forge: ForgeAudio | undefined, forgeContext: AudioContext | undefined;
  let forgeAudible = false, catchUp = true;
  let hiddenMuted = false;
  const momentVoices = new Set<() => void>();
  const momentCues = createProceduralMomentSound({ context: () => !disposed && canSound() ? kingdomAudioHost(audio) : null,
    now: Date.now, gain: () => canSound() ? 1 : 0 });
  const moments: MomentSoundPort = { play(cue, atMs, gain) {
    const stop = momentCues.play(cue, atMs, gain);
    const cancel = () => { clearTimeout(timer); momentVoices.delete(cancel); stop(); };
    momentVoices.add(cancel);
    // Each cue has a finite tail. Retain cancellation only while that tail can still be sounding.
    const timer = setTimeout(() => momentVoices.delete(cancel), Math.max(0, atMs - Date.now()) + CUE_LENGTH_MS[cue] + 200);
    return cancel;
  } };
  function silenceMoments() { for (const stop of momentVoices) stop(); momentVoices.clear(); }

  function canSound() {
    const { status, settings } = audio.getState();
    return status === 'ready' && !settings.muted && settings.volume > 0
      && (typeof document === 'undefined' || !document.hidden);
  }
  function silenceForge() {
    catchUp = true;
    if (forgeAudible) forge?.setMix({ muted: true, volume: 1 });
    forgeAudible = false;
  }
  function onVisibility() {
    hiddenMuted = document.hidden;
    // The shared mixer drains every voice and its room tail, including environmental phrases.
    // Restoring visibility preserves the user's explicit mute choice and starts only fresh observations.
    audio.setSettings({ muted: hiddenMuted || explicitlyMuted });
    if (hiddenMuted) silenceForge();
    if (hiddenMuted) silenceMoments();
  }
  function onContextState() { if (forgeContext?.state !== 'running') silenceForge(); }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    if (document.hidden) onVisibility();
  }

  function forgeUpdate(frame: ForgeRitualFrame | null) {
    if (disposed) return;
    const host = kingdomAudioHost(audio);
    if (!host || host.context !== forgeContext) {
      forgeContext?.removeEventListener('statechange', onContextState);
      forge?.dispose(); forge = undefined; forgeContext = undefined; forgeAudible = false; catchUp = true;
      if (!host) return;
      forge = createForgeAudio(host); forgeContext = host.context;
      forgeContext.addEventListener('statechange', onContextState);
      forge.setMix({ muted: true, volume: 1 });
    }
    const audible = canSound();
    if (!audible) silenceForge();
    // Consume the first observation after an interruption before reopening the layer: no missed attack replays.
    if (audible && !catchUp && !forgeAudible) { forge!.setMix({ muted: false, volume: 1 }); forgeAudible = true; }
    forge!.update(frame);
    if (audible && catchUp) { catchUp = false; forge!.setMix({ muted: false, volume: 1 }); forgeAudible = true; }
  }

  function unlock(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (!explicitlyMuted) requested = true;
    return audio.unlock().then(ready => ready && !audio.getState().settings.muted);
  }

  return {
    unlock,
    moments,
    ...({ forgeUpdate } as { forgeUpdate?: typeof forgeUpdate }),
    get enabled() {
      const { status, settings } = audio.getState();
      return status === 'ready' && !settings.muted && settings.volume > 0;
    },
    toggle(): boolean {
      if (disposed) return false;
      if (requested) {
        requested = false; explicitlyMuted = true;
        audio.setSettings({ muted: true });
        silenceForge();
        silenceMoments();
        return false;
      }
      explicitlyMuted = false; audio.setSettings({muted:hiddenMuted});
      void unlock();
      return true;
    },
    cue(kind: AudioCue, options?: AudioCueOptions): boolean {
      return audio.cue(kind, options);
    },
    phrase(phrase: KingdomPhrase, options?: KingdomPhraseOptions): boolean {
      return playKingdomPhrase(audio, phrase, options);
    },
    ambienceUpdate(now: number, target: AmbienceTarget): void {
      ambience.update(now, target, !disposed && canSound());
    },
    dispose() {
      disposed = true;
      requested = false;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      forgeContext?.removeEventListener('statechange', onContextState);
      forge?.dispose();
      silenceMoments();
      ambience.dispose();
      audio.dispose();
    },
  };
}
