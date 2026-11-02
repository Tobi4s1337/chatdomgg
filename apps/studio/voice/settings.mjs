// The voice settings every teaser render uses, per model, so all candidates are compared on equal terms.
// Changing any value here changes the cache key, which means new (paid) renders.

export const SEED = 1207;

export const MODELS = {
  // The steadier model. No audio tags: delivery comes from punctuation and settings.
  eleven_multilingual_v2: {
    voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true, speed: 0.94 },
    tags: false,
  },
  // The expressive model that reads audio tags such as [warm]. Its stability takes 0.0 (creative),
  // 0.5 (natural) or 1.0 (robust).
  eleven_v3: {
    voiceSettings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
    tags: true,
  },
};

/** Remove [audio tags] for a model that would read them aloud. */
export function forModel(modelId, text) {
  if (MODELS[modelId]?.tags) return text;
  return text.replace(/\[[^\]]*\]\s*/g, '').trim();
}

/** The model the teaser committed to after the comparison (see work/lanes/teaser/VOICES.md). */
export const CHOSEN_MODEL = process.env.TEASER_VOICE_MODEL || 'eleven_multilingual_v2';
