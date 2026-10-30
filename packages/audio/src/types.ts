export type AudioCue = 'wood' | 'light' | 'wave' | 'beacon'
  | 'step' | 'place' | 'remove' | 'material';
export type AudioMaterial = 'wood' | 'stone' | 'earth' | 'metal' | 'glass' | 'fabric';
export type AudioControlSurface = 'wood' | 'brass' | 'parchment';
export interface AudioSettings { muted: boolean; volume: number }
export interface AudioCueOptions {
  material?: AudioMaterial;
  ui?: AudioControlSurface; // used only by the legacy wood/control family
  pan?: number; // listener-relative [-1, 1]
  distance?: number; // listener-relative metres
}
export interface KingdomAudioState {
  status: 'locked' | 'ready' | 'suspended' | 'unavailable' | 'disposed';
  settings: Readonly<AudioSettings>;
}
export interface KingdomAudio {
  unlock(): Promise<boolean>; // true only if the live context is running
  cue(kind: AudioCue, options?: AudioCueOptions): boolean; // true if scheduled for audible playback
  setSettings(settings: Partial<AudioSettings>): void;
  getState(): KingdomAudioState; // current snapshot, not mutable internal objects
  dispose(): void;
}

export const AUDIO_CUES: readonly AudioCue[] = ['wood', 'light', 'wave', 'beacon', 'step', 'place', 'remove', 'material'];
export const AUDIO_MATERIALS: readonly AudioMaterial[] = ['wood', 'stone', 'earth', 'metal', 'glass', 'fabric'];
export const AUDIO_CONTROL_SURFACES: readonly AudioControlSurface[] = ['wood', 'brass', 'parchment'];
