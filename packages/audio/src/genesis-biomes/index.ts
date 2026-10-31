import { createGenesisSoundscapeGraph, type GenesisSoundHost, type GenesisSoundInput, type GenesisSoundscape } from './soundscape';

export type {
  GenesisListener, GenesisRecipe, GenesisSoundFrame, GenesisSoundMix, GenesisSoundProfile, GenesisWeather, GenesisWeatherKind,
} from './types';
export type { GenesisSoundHost, GenesisSoundInput, GenesisSoundscape, GenesisSoundInspection, GenesisSoundEvent } from './soundscape';
export { CALL_LIMITS, inspectGenesisSoundscape } from './soundscape';
export { BED_SOURCE_LIMIT } from './beds';
export { describeGenesisSoundscape, type SoundScene } from './scene';
export { dayParts, genesisWeatherAt, weatherKind } from './weather';
export { renderGenesisSoundscape, type GenesisRender, type GenesisRenderOptions } from './offline';

/**
 * The sound of a chosen Genesis land on the kingdom's graph: pass `kingdomAudioHost(audio)` (null until the first
 * unlock gesture, so no context is ever made early) and the recipe with the explicitly selected landscape id.
 * Never creates, resumes or closes a context and never connects to `context.destination`.
 */
export function createGenesisSoundscape(host: GenesisSoundHost, input: GenesisSoundInput): GenesisSoundscape {
  return createGenesisSoundscapeGraph(host, input);
}
