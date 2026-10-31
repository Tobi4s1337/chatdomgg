import {
  createForgeAudio, createKingdomAudio, kingdomAudioHost, playKingdomPhrase,
  type AudioCue, type AudioCueOptions, type ForgeAudio, type KingdomPhrase, type KingdomPhraseOptions,
} from '@chatdom/audio';
import type { ForgeRitualFrame } from '@chatdom/shared';

/** The scene's one sound owner. Context, sources and the master stay inside the shared engine. */
export function createKingdomSound() {
  const audio = createKingdomAudio();
  let requested = false, disposed = false, explicitlyMuted = false;
  let forge: ForgeAudio | undefined, forgeContext: AudioContext | undefined;
  let forgeAudible = false, catchUp = true;

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
  function onVisibility() { if (document.hidden) silenceForge(); }
  function onContextState() { if (forgeContext?.state !== 'running') silenceForge(); }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

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
        return false;
      }
      explicitlyMuted = false; audio.setSettings({muted:false});
      void unlock();
      return true;
    },
    cue(kind: AudioCue, options?: AudioCueOptions): boolean {
      return audio.cue(kind, options);
    },
    phrase(phrase: KingdomPhrase, options?: KingdomPhraseOptions): boolean {
      return playKingdomPhrase(audio, phrase, options);
    },
    dispose() {
      disposed = true;
      requested = false;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      forgeContext?.removeEventListener('statechange', onContextState);
      forge?.dispose();
      audio.dispose();
    },
  };
}
