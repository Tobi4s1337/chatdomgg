// The teaser's hero sound effects from the ElevenLabs sound-effects endpoint: short and cheap.
// Writes the files to media/teaser/audio/sfx/ and the manifest apps/studio/voice/sfx.json.
// node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/sfx.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { batch, place, SFX_DIR, soundEffect } from './eleven.mjs';
import { measure, round } from './measure.mjs';

const MODEL = 'eleven_text_to_sound_v2';
const PROMPT_INFLUENCE = 0.5;

export const SFX = [
  {
    id: 'forge-hammer',
    shot: 'S11',
    prompt: "A single heavy blacksmith's hammer strike on an iron anvil in a stone forge: a bright metallic clang with a long, clear ringing tail that slowly fades away.",
    seconds: 3.5,
  },
  {
    id: 'gate-creak',
    shot: 'S05, S15, S17',
    prompt: 'A heavy old wooden castle gate creaking slowly open on iron hinges outdoors: deep groaning timber, a long creak, ending with a soft wooden thud.',
    seconds: 4,
  },
  {
    id: 'raid-horn',
    shot: 'S14, S17',
    prompt: 'A medieval war horn call: one long, deep, rallying horn blast echoing across a wide valley at dusk.',
    seconds: 4,
  },
  {
    id: 'crowd-cheer',
    shot: 'S08, S12, S15',
    prompt: 'A warm crowd of townsfolk cheering, clapping and laughing together in a stone town square at night, joyful, with a soft echo off the stone walls.',
    seconds: 5,
  },
  {
    id: 'screen-whoosh',
    shot: 'S03',
    prompt: 'A soft magical whoosh with a gentle shimmer, airy and smooth, like a camera gliding through a glowing screen into another world.',
    seconds: 2,
  },
];

const MANIFEST = new URL('./sfx.json', import.meta.url);
const ABOUT = 'Hero sound effects for the teaser, from the ElevenLabs sound-effects endpoint. Raw renders, not normalised; levels are set in the mix.';

const estimate = SFX.reduce((n, s) => n + s.seconds * 60, 0);
let rendered;
try {
  rendered = await batch({ purpose: 'Hero sound effects (5)', voice: '-', model: MODEL, estimate }, async (count) => {
    const out = [];
    for (const s of SFX) {
      out.push(count(await soundEffect({ text: s.prompt, durationSeconds: s.seconds, promptInfluence: PROMPT_INFLUENCE, modelId: MODEL }), s.prompt.length));
    }
    return out;
  });
} catch (err) {
  if (err.status !== 401 && err.status !== 403) throw err;
  // The key may not render sound effects. Keep the plan in the manifest so a re-run completes it.
  const reason = /sound_generation/.test(err.body ?? '') ? 'the API key lacks the sound_generation permission' : `HTTP ${err.status}`;
  writeFileSync(
    MANIFEST,
    `${JSON.stringify({ about: ABOUT, status: `blocked: ${reason}. needs: tobias enable sound effects on the teaser's ElevenLabs key, then re-run apps/studio/voice/sfx.mjs`, checked: new Date().toISOString(), items: SFX.map((x) => ({ id: x.id, shot: x.shot, file: null, prompt: x.prompt, duration: null, requestedSeconds: x.seconds, model: MODEL, promptInfluence: PROMPT_INFLUENCE })) }, null, 1)}\n`,
  );
  console.error(`Sound effects blocked: ${reason}. The manifest lists the planned prompts.`);
  process.exit(2);
}
const { result } = rendered;

const items = SFX.map((s, i) => {
  const r = result[i];
  const file = place(r.mp3, join(SFX_DIR, `${String(i + 1).padStart(2, '0')}-${s.id}.mp3`));
  const m = measure(file);
  return {
    id: s.id,
    shot: s.shot,
    file,
    prompt: s.prompt,
    duration: round(m.duration, 3),
    requestedSeconds: s.seconds,
    model: MODEL,
    promptInfluence: PROMPT_INFLUENCE,
    integratedLufs: m.integratedLufs,
    truePeakDbtp: m.truePeakDbtp,
    soundStart: m.speechStart,
    soundEnd: m.speechEnd,
    channels: m.channels,
    billed: r.cached ? null : r.meta.response['character-cost'] ?? null,
  };
});

writeFileSync(
  MANIFEST,
  `${JSON.stringify({ about: ABOUT, status: 'rendered', generated: new Date().toISOString(), items }, null, 1)}\n`,
);
for (const it of items) console.log(`${it.id.padEnd(14)} ${it.duration}s  ${it.integratedLufs} LUFS  TP ${it.truePeakDbtp}  ch ${it.channels}  sound ${it.soundStart}-${it.soundEnd}  billed ${it.billed}`);
