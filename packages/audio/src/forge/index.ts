import { createForgeAudioGraph, type ForgeAudio } from './audio';

export type { ForgeAudio, ForgeAudioMix, RefusalBeat } from './audio';

/**
 * The Forge's sound on the host's graph: every ritual stage and the refusal's cough, driven only by observed frames
 * and admitted public beats. Never creates, resumes or closes a context and never touches `context.destination`.
 * Defaults `{ muted: false, volume: 0.65 }`.
 */
export function createForgeAudio(options: { context: AudioContext; destination: AudioNode }): ForgeAudio {
  return createForgeAudioGraph(options);
}
