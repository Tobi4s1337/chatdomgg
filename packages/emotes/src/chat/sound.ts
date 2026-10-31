import type { EmoteChatSound } from './presentation';

/**
 * The slice of the shared kingdom sound port (`KingdomAudio.cue` in `@chatdom/audio`) chat emotes use.
 * Mute, volume and the stream mix stay with that port; this only chooses the cue.
 */
export interface EmoteChatSoundPort {
  cue(kind: 'material' | 'wave', options?: { material?: 'glass' | 'stone'; pan?: number; distance?: number }): boolean;
}

/**
 * A pop is the small material tap of a carved token, glass or stone in turn so a run of pops does not
 * repeat one sample, from where the sender stands. A chant's weather is the street's travelling chord,
 * once. One cue per burst, never one per particle.
 */
export function playEmoteChatSound(port: EmoteChatSoundPort, sound: EmoteChatSound, placement: { pan?: number; distance?: number } = {}): boolean {
  const pan = placement.pan === undefined || !Number.isFinite(placement.pan) ? undefined : Math.max(-1, Math.min(1, placement.pan));
  const distance = placement.distance === undefined || !Number.isFinite(placement.distance) ? undefined : Math.max(0, placement.distance);
  if (sound.kind === 'weather') return port.cue('wave', pan === undefined ? {} : { pan });
  return port.cue('material', { material: sound.variant % 2 ? 'glass' : 'stone', ...(pan === undefined ? {} : { pan }), ...(distance === undefined ? {} : { distance }) });
}
