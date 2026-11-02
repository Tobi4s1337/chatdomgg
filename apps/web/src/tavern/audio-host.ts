import { kingdomAudioHost, type KingdomAudio } from '@chatdom/audio';

/** The caller keeps the kingdom's one mixer and its settings across room transfers. */
export function audibleTavernHost(audio: KingdomAudio) {
  const { status, settings } = audio.getState();
  return status === 'ready' && !settings.muted && settings.volume > 0 && !document.hidden ? kingdomAudioHost(audio) : null;
}

/** A local inspection control; integrated play keeps its own shared sound settings. */
export function toggleTavernSound(audio: KingdomAudio): Promise<boolean> {
  const { status, settings } = audio.getState();
  if (status === 'ready' && !settings.muted) { audio.setSettings({ muted: true }); return Promise.resolve(false); }
  audio.setSettings({ muted: false });
  return audio.unlock().then(ready => ready && audio.getState().settings.volume > 0);
}

/** No context is created until a real gesture in the active destination. Failed unlocks retry on the next one. */
export function bindTavernSoundGesture(audio: KingdomAudio, surface: HTMLElement): () => void {
  const wake = (raw: Event) => {
    if (!raw.isTrusted || document.hidden) return;
    const event = raw as KeyboardEvent;
    // This control chooses its desired state in click. Do not race its first enable with a capture-phase unlock.
    if (raw.target instanceof Element && raw.target.closest('.gather-tavern-sound')) return;
    if (raw.type === 'keydown' && (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey)) return;
    if (raw.target instanceof HTMLElement && (raw.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(raw.target.tagName))) return;
    if (!(raw.target instanceof Node && surface.contains(raw.target)) && !surface.contains(document.pointerLockElement)) return;
    const { status, settings } = audio.getState();
    if (status !== 'ready' && !settings.muted && settings.volume > 0) void audio.unlock();
  };
  window.addEventListener('pointerdown', wake, true); window.addEventListener('keydown', wake, true);
  return () => { window.removeEventListener('pointerdown', wake, true); window.removeEventListener('keydown', wake, true); };
}
