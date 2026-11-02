// Free reads only: the account's usage, the models that speak (when the key may read them),
// and each candidate voice's library name, labels and description.
// node --env-file=$HOME/.config/chatdom/elevenlabs.env apps/studio/voice/probe.mjs [--refresh]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateVoices, getVoice, listModels, readUsage, VOICE_DIR } from './eleven.mjs';

const usage = await readUsage();
let models;
try {
  models = (await listModels()).filter((m) => m.can_do_text_to_speech);
} catch (err) {
  models = { unavailable: err.status === 401 ? 'the key has no models_read permission' : `HTTP ${err.status ?? '?'}` };
}
const voices = [];
for (const id of candidateVoices()) voices.push(await getVoice(id, { refresh: process.argv.includes('--refresh') }));

const report = { usage, models, voices };
writeFileSync(join(VOICE_DIR, 'probe.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
