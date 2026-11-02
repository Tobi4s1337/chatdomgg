// Step 1 of the voice: render one short line in one voice with eleven_v3 and eleven_multilingual_v2,
// then measure both (duration, loudness, lead and tail silence, pauses, pace from the alignment).
// node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/model-compare.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { batch, candidateVoices, getVoice, place, tts, VOICE_DIR } from './eleven.mjs';
import { measure, pace, wordsFromAlignment } from './measure.mjs';
import { forModel, MODELS, SEED } from './settings.mjs';

/** Each [tag] in an alignment with the time span the model gave it. */
function tagSpans(align) {
  if (!align) return [];
  const out = [];
  let cur = null;
  align.characters.forEach((c, i) => {
    if (c === '[') cur = { tag: '', start: align.character_start_times_seconds[i] };
    if (cur) cur.tag += c;
    if (c === ']' && cur) {
      cur.end = align.character_end_times_seconds[i];
      out.push(cur);
      cur = null;
    }
  });
  return out;
}

const LINE = '[warm] Every stream has a chat. [softly] And every chat… is a people.';
// Rowan (narrative_story) is the comparison voice: the model choice should not ride on the trailer read.
const voiceId = candidateVoices()[2];
const voice = await getVoice(voiceId);
const outDir = join(VOICE_DIR, 'model-compare');
const results = [];

for (const modelId of Object.keys(MODELS)) {
  const text = forModel(modelId, LINE);
  let entry;
  try {
    const { result } = await batch({ purpose: 'Model comparison, one line', voice: voice.name.split(' - ')[0], model: modelId, estimate: text.length * 2 }, async (count) =>
      count(await tts({ voiceId, text, modelId, voiceSettings: MODELS[modelId].voiceSettings, seed: SEED }), text.length),
    );
    const base = join(outDir, `${modelId}__${voiceId}`);
    const mp3 = place(result.mp3, `${base}.mp3`);
    place(result.json, `${base}.alignment.json`);
    const m = measure(mp3);
    const align = result.meta.alignment;
    const norm = result.meta.normalized_alignment;
    entry = {
      modelId,
      text,
      mp3,
      cached: result.cached,
      billed: result.meta.response['character-cost'] ?? null,
      measure: m,
      pace: pace(align),
      words: wordsFromAlignment(align),
      alignmentChars: align?.characters?.length ?? 0,
      normalizedChars: norm?.characters?.length ?? 0,
      // Does the alignment carry the tag characters with time, or skip them?
      tagTiming: MODELS[modelId].tags ? tagSpans(align) : null,
    };
  } catch (err) {
    entry = { modelId, text, error: err.message };
  }
  results.push(entry);
}

writeFileSync(join(outDir, 'compare.json'), JSON.stringify({ voice: { id: voiceId, name: voice.name }, line: LINE, results }, null, 1));
for (const r of results) {
  if (r.error) console.log(r.modelId, 'ERROR', r.error);
  else console.log(r.modelId, JSON.stringify({ cached: r.cached, billed: r.billed, ...r.measure, pace: r.pace, words: r.words }, null, 0));
}
