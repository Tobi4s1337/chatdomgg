import {
  createKingdomAudio, playKingdomPhrase,
  type AudioCue, type AudioCueOptions, type KingdomPhrase, type KingdomPhraseOptions,
} from '@chatdom/audio';

/** The scene's one sound owner. Context, sources and the master stay inside the shared engine. */
export function createKingdomSound() {
  const audio = createKingdomAudio();
  let requested = false, disposed = false, explicitlyMuted = false;

  function unlock(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (!explicitlyMuted) requested = true;
    return audio.unlock().then(ready => ready && !audio.getState().settings.muted);
  }

  return {
    unlock,
    get enabled() {
      const { status, settings } = audio.getState();
      return status === 'ready' && !settings.muted && settings.volume > 0;
    },
    toggle(): boolean {
      if (disposed) return false;
      if (requested) {
        requested = false; explicitlyMuted = true;
        audio.setSettings({ muted: true });
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
      audio.dispose();
    },
  };
}
