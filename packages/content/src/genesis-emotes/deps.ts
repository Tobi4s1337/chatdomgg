// The one place this lane reaches the emote compiler. `@chatdom/content` does not list `@chatdom/emotes` in its
// manifest (main owns manifests), so the sibling source is imported directly. Main swaps these paths for the
// package specifier when it registers the dependency; nothing else in this folder names the emotes package.
export { compileEmote } from '../../../emotes/src/compile';
export { EMOTE_COMPILER_VERSION, EMOTE_PROFILES, EMOTE_SOURCE_LIMITS } from '../../../emotes/src/profiles';
export { createSha256 } from '../../../emotes/src/sha256';
export { decodeEmoteBytes } from '../../../emotes/src/decode/index';
export { toadWaveGifBytes, TOAD_WAVE_FRAMES } from '../../../emotes/src/fixtures/toad-wave-animated';
export type {
  CompiledEmote, DecodedEmote, DecodedEmoteFrame, EmoteCompileFailureCode, EmoteMask, EmotePurpose, EmoteRendition, EmoteVoxelFrame,
} from '../../../emotes/src/types';
