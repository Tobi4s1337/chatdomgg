// Scratch narration for the rough cut, one file per line of the shot list, in the recommended voice
// with the chosen model. Neighbouring lines go in as previous_text / next_text so split thoughts
// ("Show up…" / "…and the road leads home.") are read as one.
// Writes apps/studio/voice/scratch.json and two-pass loudness-normalised, trimmed copies for the edit.
// node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/scratch.mjs
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { batch, getVoice, MEDIA_ROOT, place, tts, VOICE_DIR } from './eleven.mjs';
import { measure, normalise, probe, round, wordsFromAlignment } from './measure.mjs';
import { CHOSEN_MODEL, MODELS, SEED } from './settings.mjs';

/** The recommended J01 candidate (see work/lanes/teaser/VOICES.md). Override with TEASER_VOICE_ID. */
const VOICE_ID = process.env.TEASER_VOICE_ID || 'kLhAstPcnnPxqzk6gS5i';
const TARGET_LUFS = -16;
const PRE_ROLL = 0.05; // seconds kept before the first sound
const POST_ROLL = 0.25; // seconds kept after the last word's sound, so breaths and releases are not cut

export const SCRATCH_LINES = [
  { shot: 'S01', text: 'Every stream has a chat.' },
  { shot: 'S02', text: 'Every chat… is a people.' },
  { shot: 'S04', text: 'And every people deserves a kingdom.' },
  { shot: 'S05', text: 'Show up…' },
  { shot: 'S06', text: '…and the road leads home.' },
  { shot: 'S08', text: 'Every minute in chat… a light in the window.' },
  { shot: 'S09', text: 'Even the quiet ones.' },
  { shot: 'S10', text: 'Speak it…' },
  { shot: 'S11', text: '…and the Forge makes it real.' },
  { shot: 'S13', text: 'Come back… and it grows with you.' },
  { shot: 'S15', text: 'Friends arrive under their own banners.' },
  { shot: 'S17', text: 'And when the night ends…' },
  { shot: 'S18', text: '…ride out.' },
  { shot: 'S19', text: 'Every raid leaves a road.' },
  { shot: 'S21', text: 'Thousands of chats. Thousands of kingdoms.' },
  { shot: 'S22', text: 'Your chat is waiting.' },
  { shot: 'CARD', text: 'Every chat deserves a kingdom.' },
];

const modelId = CHOSEN_MODEL;
const settings = MODELS[modelId].voiceSettings;
const voice = await getVoice(VOICE_ID);
const slug = `${voice.name.split(' - ')[0].toLowerCase()}-${VOICE_ID.slice(0, 6)}`;
const rawDir = join(VOICE_DIR, 'scratch', slug, 'raw');
const editDir = join(VOICE_DIR, 'scratch', slug, 'edit');

const estimate = SCRATCH_LINES.reduce((n, l) => n + l.text.length, 0) * 2;
const { result } = await batch({ purpose: 'Scratch narration for the rough cut', voice: voice.name.split(' - ')[0], model: modelId, estimate }, async (count) => {
  const out = [];
  for (const [i, line] of SCRATCH_LINES.entries()) {
    const previousText = SCRATCH_LINES[i - 1]?.text;
    const nextText = SCRATCH_LINES[i + 1]?.text;
    out.push(count(await tts({ voiceId: VOICE_ID, text: line.text, modelId, voiceSettings: settings, seed: SEED, previousText, nextText }), line.text.length));
  }
  return out;
});

const lines = SCRATCH_LINES.map((line, i) => {
  const r = result[i];
  const name = `${String(i + 1).padStart(2, '0')}-${line.shot}`;
  const raw = place(r.mp3, join(rawDir, `${name}.mp3`));
  place(r.json, join(rawDir, `${name}.alignment.json`));
  const align = r.meta.alignment;
  const m = measure(raw, align);
  const trimStart = round(Math.max(0, m.speechStart - PRE_ROLL), 3);
  const trimEnd = round(Math.min(m.duration, m.speechEnd + POST_ROLL), 3);
  const edit = join(editDir, `${name}.mp3`);
  const n = normalise(raw, edit, { target: TARGET_LUFS, trimStart, trimEnd });
  const em = measure(edit);
  const words = wordsFromAlignment(align);
  return {
    shot: line.shot,
    text: line.text,
    audio: edit,
    duration: round(probe(edit).duration, 3),
    loudness: { integratedLufs: em.integratedLufs, truePeakDbtp: em.truePeakDbtp, mode: n.normalizationType, limitedDb: n.limitedDb },
    raw: {
      audio: raw,
      alignment: raw.replace(/\.mp3$/, '.alignment.json'),
      duration: m.duration,
      integratedLufs: m.integratedLufs,
      leadSilence: m.lead,
      tailSilence: m.tail,
    },
    trim: { start: trimStart, end: trimEnd },
    // Word timings in the edit file's time (raw time minus trim.start), for burned-in captions.
    words: words.map((w) => ({ text: w.text, start: round(Math.max(0, w.start - trimStart), 3), end: round(Math.max(0, w.end - trimStart), 3) })),
    billed: r.cached ? 0 : Number(r.meta.response['character-cost'] ?? 0),
  };
});

const manifest = {
  about:
    'Scratch narration for the teaser rough cut. "audio" is the edit copy: trimmed to the speech (50 ms before the first sound, 250 ms after the last word\'s sound), with a 5 ms fade in and 40 ms fade out, two-pass loudnorm (with a measured lookahead limiter first on lines too peaky for linear gain; loudness.limitedDb says how much) to -16 LUFS integrated and -1.5 dBTP, mp3 44.1 kHz 192 kb/s. Word timings are in the edit copy\'s time. "raw" is the untouched ElevenLabs render with its character alignment; trim.start and trim.end are offsets into it.',
  voice: { id: VOICE_ID, name: voice.name },
  model: modelId,
  settings,
  seed: SEED,
  mediaRoot: MEDIA_ROOT,
  generated: new Date().toISOString(),
  lines,
};
writeFileSync(new URL('./scratch.json', import.meta.url), `${JSON.stringify(manifest, null, 1)}\n`);
for (const l of lines) {
  console.log(`${l.shot.padEnd(4)} ${l.duration.toFixed(2)}s  ${l.loudness.integratedLufs} LUFS  TP ${l.loudness.truePeakDbtp} (${l.loudness.mode}, limited ${l.loudness.limitedDb} dB)  trim ${l.trim.start}-${l.trim.end}/${l.raw.duration}  ${l.words.map((w) => `${w.text}@${w.start}`).join(' ')}  ${relative(MEDIA_ROOT, l.audio)}`);
}
