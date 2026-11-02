// The final narration: every line of the final script in the chosen voice, three takes each (three seeds,
// the same settings), each measured, one picked per line by a written rule, and an edit copy of every take
// trimmed to the speech and matched in loudness. Writes apps/studio/voice/final.json, which the edit reads.
// Take A uses the scratch seed and context, so a line whose text and neighbours did not change comes from the
// cache and costs nothing.
//
// node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/final.mjs
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { batch, getVoice, MEDIA_ROOT, place, tts, VOICE_DIR } from './eleven.mjs';
import { measure, normalise, pace, probe, round, voiceStats, wordsFromAlignment } from './measure.mjs';
import { CHOSEN_MODEL, MODELS, SEED } from './settings.mjs';

/** The voice (see work/lanes/teaser/VOICE.md). Override with TEASER_VOICE_ID. */
const VOICE_ID = process.env.TEASER_VOICE_ID || 'kLhAstPcnnPxqzk6gS5i';
const TARGET_LUFS = -16;
const PRE_ROLL = 0.05;
const POST_ROLL = 0.25;
/** Three takes: the scratch seed first, then two more. */
export const TAKE_SEEDS = [SEED, 2207, 3307];

/**
 * The final script. `slot` is the time the line has in the cut, from its entry to the end of its shot (seconds);
 * a take longer than its slot plus a quarter second is never picked.
 */
export const FINAL_LINES = [
  { shot: 'S01', text: 'Every stream has a chat.', slot: 3.3 },
  { shot: 'S02', text: 'Every chat… is a people.', slot: 2.5 },
  { shot: 'S04', text: 'And every people deserves a kingdom.', slot: 4.8 },
  { shot: 'S05', text: 'Show up…', slot: 3.4 },
  { shot: 'S06', text: '…and the road leads home.', slot: 3.6 },
  { shot: 'S08', text: 'Every minute in chat… a light in the window.', slot: 4.1 },
  { shot: 'S09', text: 'Even the quiet ones.', slot: 2.1 },
  { shot: 'S10', text: 'Speak it…', slot: 1.7 },
  { shot: 'S11', text: '…and the Forge makes it real.', slot: 3.6 },
  { shot: 'S13', text: 'Come back… and it grows with you.', slot: 4.0 },
  { shot: 'S15', text: 'Friends arrive under their own banners.', slot: 3.4 },
  { shot: 'S17', text: 'And when the night ends…', slot: 3.2 },
  { shot: 'S18', text: '…ride out.', slot: 2.4 },
  { shot: 'S19', text: 'Every raid leaves a road.', slot: 4.1 },
  { shot: 'S21', text: 'Thousands of chats. Thousands of kingdoms.', slot: 3.4 },
  { shot: 'S22', text: 'Your chat is waiting.', slot: 3.0 },
  // The close lands with a beat after "chat" (VOICES.md: without it the line is over in 1.5 s).
  { shot: 'CARD', text: 'Every chat… deserves a kingdom.', slot: 3.6 },
];

/**
 * The pick, per line, from measurements alone (Tobias's ear has the last word; VOICE.md lists every take):
 * 1. A take is out if its captions would be wrong (first or last word more than 0.12 s off the audio), if it starts
 *    with sound at the file's edge or clips, if it does not breathe where the text does (at least 0.35 s after a
 *    word ending in an ellipsis, 0.25 s after a full stop inside the line), or if it overruns its slot by more
 *    than 0.25 s.
 * 2. Of the rest, the one with the most light and shade: the widest pitch range plus the loudness range,
 *    because the voice's measured risk is gentleness where the film rallies.
 */
export function pick(takes, slot) {
  const ok = takes.filter((t) => !t.defects.length && t.speech <= slot + 0.25);
  const pool = ok.length ? ok : takes;
  return [...pool].sort((a, b) => b.shade - a.shade)[0];
}

/**
 * What would survive into the edit copy. A line that opens on an ellipsis ("…and the road") gives the ellipsis
 * time in the alignment before the voice starts, so its first word is pinned to the audio onset instead (see
 * captionWords). A breath after the last word is cut by the trim at the speech end, so the last word is
 * checked against that end, not the file's.
 */
function defects(m, v, words, text, alignment) {
  const out = [];
  const a = m.alignment ?? {};
  if (!text.startsWith('…') && a.onsetError != null && Math.abs(a.onsetError) > 0.12) out.push(`first word ${a.onsetError} s off`);
  const lastEnd = words.at(-1)?.end;
  if (lastEnd != null && Math.abs(lastEnd - m.speechEnd) > 0.12) out.push(`last word ${round(lastEnd - m.speechEnd, 3)} s off the speech end`);
  if (m.clippedStart) out.push('sound at the start of the file');
  if (v.clippedSamples > 0) out.push(`${v.clippedSamples} clipped samples`);
  const gaps = new Map(pace(alignment).wordGaps.map((g) => [g.after, g.gap]));
  for (const [i, w] of words.entries()) {
    if (i === words.length - 1) continue;
    const need = w.text.endsWith('…') ? 0.35 : /[.!?]$/.test(w.text) ? 0.25 : 0;
    if (need && (gaps.get(w.text) ?? 0) < need) out.push(`only ${gaps.get(w.text) ?? 0} s after "${w.text}"`);
  }
  return out;
}

/** Word timings in the edit copy's time; a leading ellipsis word starts with the voice. */
function captionWords(words, text, m, trimStart) {
  return words.map((w, i) => {
    const start = i === 0 && text.startsWith('…') ? Math.max(w.start, m.speechStart) : w.start;
    return { text: w.text, start: round(Math.max(0, start - trimStart), 3), end: round(Math.max(0, w.end - trimStart), 3) };
  });
}

const modelId = CHOSEN_MODEL;
const settings = MODELS[modelId].voiceSettings;
const voice = await getVoice(VOICE_ID);
const slug = `${voice.name.split(' - ')[0].toLowerCase()}-${VOICE_ID.slice(0, 6)}`;
const root = join(VOICE_DIR, 'final', slug);

const estimate = FINAL_LINES.reduce((n, l) => n + l.text.length, 0) * TAKE_SEEDS.length * 2;
const { result, used } = await batch({ purpose: 'Final narration, three takes per line', voice: voice.name.split(' - ')[0], model: modelId, estimate }, async (count) => {
  const out = [];
  for (const [i, line] of FINAL_LINES.entries()) {
    const previousText = FINAL_LINES[i - 1]?.text;
    const nextText = FINAL_LINES[i + 1]?.text;
    const takes = [];
    for (const seed of TAKE_SEEDS) takes.push(count(await tts({ voiceId: VOICE_ID, text: line.text, modelId, voiceSettings: settings, seed, previousText, nextText }), line.text.length));
    out.push(takes);
  }
  return out;
});

const lines = FINAL_LINES.map((line, i) => {
  const name = `${String(i + 1).padStart(2, '0')}-${line.shot}`;
  const takes = result[i].map((r, k) => {
    const letter = 'ABC'[k];
    const raw = place(r.mp3, join(root, 'raw', `${name}-${letter}.mp3`));
    place(r.json, join(root, 'raw', `${name}-${letter}.alignment.json`));
    const align = r.meta.alignment;
    const m = measure(raw, align);
    const v = voiceStats(raw);
    const trimStart = round(Math.max(0, m.speechStart - PRE_ROLL), 3);
    const trimEnd = round(Math.min(m.duration, m.speechEnd + POST_ROLL), 3);
    const edit = join(root, 'edit', `${name}-${letter}.mp3`);
    const n = normalise(raw, edit, { target: TARGET_LUFS, trimStart, trimEnd });
    const em = measure(edit);
    const aligned = wordsFromAlignment(align);
    const words = captionWords(aligned, line.text, m, trimStart);
    return {
      take: letter,
      seed: TAKE_SEEDS[k],
      audio: edit,
      duration: round(probe(edit).duration, 3),
      speech: round(m.speechEnd - m.speechStart, 3),
      loudness: { integratedLufs: em.integratedLufs, truePeakDbtp: em.truePeakDbtp, mode: n.normalizationType, limitedDb: n.limitedDb },
      raw: { audio: raw, alignment: raw.replace(/\.mp3$/, '.alignment.json'), duration: m.duration, integratedLufs: m.integratedLufs, lraLu: m.lraLu, onsetError: m.alignment?.onsetError ?? null, offsetError: m.alignment?.offsetError ?? null },
      pitch: { medianHz: v.medianF0Hz, rangeSemitones: v.f0RangeSemitones },
      pace: pace(align).cps,
      gaps: pace(align).wordGaps,
      shade: round((v.f0RangeSemitones ?? 0) + (m.lraLu ?? 0), 2),
      defects: defects(m, v, aligned, line.text, align),
      breathAfter: m.trailingNoise ? { from: m.trailingNoise.from, to: m.trailingNoise.to, trimmed: true } : null,
      trim: { start: trimStart, end: trimEnd },
      words,
      billed: r.cached ? 0 : Number(r.meta.response['character-cost'] ?? 0),
    };
  });
  const chosen = pick(takes, line.slot);
  return { shot: line.shot, text: line.text, slot: line.slot, picked: chosen.take, takes };
});

const manifest = {
  about:
    'The final teaser narration: three takes per line (seeds in TAKE_SEEDS), each trimmed to the speech (50 ms before, 250 ms after), faded, and two-pass loudness-normalised to -16 LUFS integrated, true peak at or under -1.5 dBTP. "picked" is the take chosen by the rule in final.mjs (pick). Word timings are in the edit copy\'s time and come from the character alignment.',
  voice: { id: VOICE_ID, name: voice.name },
  model: modelId,
  settings,
  seeds: TAKE_SEEDS,
  mediaRoot: MEDIA_ROOT,
  generated: new Date().toISOString(),
  billedThisRun: used,
  lines,
};
writeFileSync(new URL('./final.json', import.meta.url), `${JSON.stringify(manifest, null, 1)}\n`);
for (const l of lines) {
  console.log(`${l.shot.padEnd(4)} slot ${l.slot}  picked ${l.picked}`);
  for (const t of l.takes) console.log(`   ${t.take} speech ${t.speech}s  ${t.loudness.integratedLufs} LUFS  TP ${t.loudness.truePeakDbtp}  range ${t.pitch.rangeSemitones} st  LRA ${t.raw.lraLu}  shade ${t.shade}  ${t.defects.join('; ') || 'clean'}  ${relative(MEDIA_ROOT, t.audio)}`);
}
