/* global performance */
// SIMULATED chatters speak; every one of them settles a home and lights its window, far beyond the old 12.
//   node scripts/live/chatters.mjs [--count 40] [--pace 2500]
// --pace is the gap between first-time speakers in ms (people arriving in chat). Settling a home re-prepares the
// town's whole scene on the realm today; a burst of dozens at once can starve the writer (see the README).
// Round one: each person speaks for the first time and the realm settles their home. Round two: they keep chatting,
// and the kingdom's public watch must show every one of their windows lit at once.
import { randomUUID } from 'node:crypto';
import { args, BENCH, census, chatMessage, deliver, report, sleep, SIMULATED_CHATTERS, watchFor } from './lib.mjs';

const count = Math.min(Number(args('count', '40')), SIMULATED_CHATTERS.length), people = SIMULATED_CHATTERS.slice(0, count);
const pace = Number(args('pace', '2500'));
const LINES = ['evening all', 'hi from the lantern street', 'o/', 'what are we building tonight?', 'the tavern looks warm', 'hello hello', 'good to be back'];
const checkpoint = () => watchFor((event, value) => event === 'checkpoint' ? census(value) : null, { timeoutMs: 120_000 });
const speak = async (round, gap) => {
  for (const [index, person] of people.entries()) {
    await deliver(chatMessage({ ...person, text: LINES[(index + round) % LINES.length], messageId: randomUUID() }));
    await sleep(gap);
  }
};

const before = await checkpoint();
let started = performance.now();
await speak(0, pace);
let settled = before;
for (let tries = 0; tries < 240 && settled.homes < count; tries++) { await sleep(1_000); settled = await checkpoint(); }
const settling = Math.round(performance.now() - started);
started = performance.now();
await speak(1, 100);
let after = settled;
for (let tries = 0; tries < 60 && (after.lit ?? 0) < count; tries++) { await sleep(500); after = await checkpoint(); }
report([
  `chatters · SIMULATED · ${count} people`,
  `  homes in kingdom ${BENCH.kingdomId}: ${before.homes} → ${settled.homes} (${settling} ms for everyone's first message to settle)`,
  `  windows lit at once: ${after.lit ?? 'unknown'} of ${after.homes} · ${Math.round(performance.now() - started)} ms after the second round began`,
  `  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`,
]);
if (settled.homes < count || (after.lit ?? 0) < count) process.exit(1);
