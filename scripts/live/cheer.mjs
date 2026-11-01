// A cheer, sent by Twitch CLI to Herald's SIMULATED door, rising as the sky beat at its rung.
//   node scripts/live/cheer.mjs [--bits 5000] [--from 990000101] [--anonymous] [--again]
// --again resends the very same delivery (same Twitch-Eventsub-Message-Id) and checks that nothing fires twice.
import { randomUUID } from 'node:crypto';
import { args, BENCH, cliForward, fireAndWatch, flag, label, momentOf, payloadSource, report, sleep, watchFor } from './lib.mjs';

const bits = Number(args('bits', '5000')), from = args('from', '990000101'), messageId = randomUUID();
const RUNGS = [[10000, 'kites'], [5000, 'skyfire'], [1000, 'hearthbeast'], [500, 'castle-volley'], [100, 'street-fireworks'], [1, 'spark']];
const rung = RUNGS.find(([min]) => bits >= min)?.[1] ?? 'spark';
const forward = () => cliForward('channel.cheer', ['-t', BENCH.kingdomId, '-f', from, '-C', String(bits), '-I', messageId, ...(flag('anonymous') ? ['-a'] : [])]);

const { found: fact, ms } = await fireAndWatch(forward, momentOf('cheer', f => f.body.bits === bits));
report([
  `cheer · ${label(fact)} · ${fact.body.bits} Bits → the ${rung} rung · sent by ${payloadSource.value}`,
  `  reached kingdom ${fact.kingdomId} as moment #${fact.seq} (${fact.body.key}) in ${ms} ms`,
  `  credit: ${fact.body.credit ? `${fact.body.credit.displayName}${fact.body.credit.slot !== null ? ` · their window, slot ${fact.body.credit.slot}` : ''}` : 'unnamed (anonymous, or a quiet citizen)'}`,
  `  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`,
]);
if (flag('again')) {
  const again = watchFor(momentOf('cheer', f => f.body.key === fact.body.key || f.seq > fact.seq), { timeoutMs: 8_000 }).then(f => f, () => null);
  await sleep(500);
  await forward();
  const twice = await again;
  if (twice) { console.error(`  retry FIRED AGAIN as moment #${twice.seq}`); process.exit(1); }
  report(['  retry of the same delivery: nothing new reached the kingdom in 8 s (deduplicated)']);
}
