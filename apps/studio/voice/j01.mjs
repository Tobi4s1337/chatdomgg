// J01: the same five Voice of the Realm lines in each candidate voice, with the chosen model and
// the same settings and seed, then measured.
// node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/j01.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { batch, candidateVoices, getVoice, place, tts, VOICE_DIR } from './eleven.mjs';
import { measure, normalise, pace, round, voiceStats, wordsFromAlignment } from './measure.mjs';
import { CHOSEN_MODEL, forModel, MODELS, SEED } from './settings.mjs';

// Short, present tense, warm, never explaining a mechanic. Names are written as they are spoken.
export const J01_LINES = [
  { id: 'welcome', label: 'A welcome (a citizen arriving home)', text: '[warm] Four years of quiet evenings… and tonight, your window is lit. Welcome home.' },
  { id: 'forge', label: 'A forge reveal (the dragon chimney)', text: '[hushed] The forge cools. On a roof in the old quarter, a dragon sleeps… and smoke curls from its nose.' },
  { id: 'raid', label: 'A raid (PinkKittyRose arrives)', text: "[rallying] Lanterns on the road. Pink Kitty Rose's people arrive under their own banner. Open the gate… make room at the fire." },
  { id: 'crowning', label: 'A crowning', text: '[proud, slow] The season ends. Every light that held, every road you rode… tonight, the crown is yours.' },
  { id: 'teaser', label: 'The teaser line', text: '[warm, final] Every chat deserves a kingdom.' },
];

const modelId = CHOSEN_MODEL;
const settings = MODELS[modelId].voiceSettings;
const out = { model: modelId, settings, seed: SEED, voices: [] };

for (const voiceId of candidateVoices()) {
  const voice = await getVoice(voiceId);
  const short = voice.name.split(' - ')[0] + (voice.name.includes('Trailer') ? ' (Trailer)' : voice.name.includes('VOG') ? ' (VOG)' : '');
  const slug = voice.name.split(' - ')[0].toLowerCase() + '-' + voiceId.slice(0, 6);
  const estimate = J01_LINES.reduce((n, l) => n + l.text.length, 0) * 2;
  const { result } = await batch({ purpose: 'J01 voice comparison, five lines', voice: short, model: modelId, estimate }, async (count) => {
    const rendered = [];
    for (const [i, line] of J01_LINES.entries()) {
      const text = forModel(modelId, line.text);
      rendered.push({ line, text, r: count(await tts({ voiceId, text, modelId, voiceSettings: settings, seed: SEED }), text.length) });
    }
    return rendered;
  });
  const lines = result.map(({ line, text, r }, i) => {
    const base = join(VOICE_DIR, 'j01', slug, `${String(i + 1).padStart(2, '0')}-${line.id}`);
    const mp3 = place(r.mp3, `${base}.mp3`);
    place(r.json, `${base}.alignment.json`);
    const align = r.meta.alignment;
    const m = measure(mp3, align);
    // A level-matched copy (-16 LUFS, trimmed to the speech with short handles) so the voices are
    // compared by ear at equal loudness: a louder voice otherwise wins by default.
    const matched = join(VOICE_DIR, 'j01', slug, 'matched', `${String(i + 1).padStart(2, '0')}-${line.id}.mp3`);
    normalise(mp3, matched, { target: -16, trimStart: round(Math.max(0, m.speechStart - 0.05)), trimEnd: round(Math.min(m.duration, m.speechEnd + 0.25)) });
    return { id: line.id, label: line.label, text, mp3, matched, billed: r.meta.response['character-cost'] ?? null, measure: m, voice: voiceStats(mp3), pace: pace(align), words: wordsFromAlignment(align) };
  });
  out.voices.push({ voice, lines });
}

writeFileSync(join(VOICE_DIR, 'j01', 'j01.json'), JSON.stringify(out, null, 1));
for (const v of out.voices) {
  console.log(`\n${v.voice.name} (${v.voice.voice_id})`);
  for (const l of v.lines) {
    const m = l.measure;
    console.log(
      `  ${l.id.padEnd(9)} dur ${m.duration.toFixed(2)}s  speech ${m.speechStart}-${m.speechEnd}  I ${m.integratedLufs} LUFS  TP ${m.truePeakDbtp}  LRA ${m.lraLu}  cps ${l.pace.cps}  gaps ${l.pace.wordGaps.map((g) => `${g.after}${g.gap}`).join(' ')}  onsetErr ${m.alignment?.onsetError}  trailing ${m.trailingNoise ? JSON.stringify(m.trailingNoise) : '-'}  billed ${l.billed}`,
    );
  }
}
