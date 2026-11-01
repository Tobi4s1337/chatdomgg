// An incoming raid, written by Twitch CLI and signed like Twitch's webhook, waking the Raid Gate for its guests.
//   node scripts/live/raid.mjs [--viewers 48] [--from 990000777] [--login hollowbrook] [--name Hollowbrook] [--again]
import { randomUUID } from 'node:crypto';
import { args, BENCH, cliEvent, deliver, fireAndWatch, flag, label, momentOf, report, sleep, watchFor } from './lib.mjs';

const viewers = Number(args('viewers', '48')), from = args('from', '990000777');
const login = args('login', 'hollowbrook'), name = args('name', 'Hollowbrook'), messageId = randomUUID();
// The CLI picks a random viewer count and a fixed test name; this bench sets both so the arrival is legible.
const payload = cliEvent('channel.raid', ['-t', BENCH.kingdomId, '-f', from]);
Object.assign(payload.event, { viewers, from_broadcaster_user_login: login, from_broadcaster_user_name: name,
  to_broadcaster_user_login: 'tobi4s_', to_broadcaster_user_name: 'tobi4s_' });

const { found: fact, ms } = await fireAndWatch(() => deliver(payload, { messageId }), momentOf('raid', f => f.body.from.kingdomId === from));
report([
  `raid · ${label(fact)} · ${fact.body.from.displayName} brings ${fact.body.viewers} guests to the Raid Gate`,
  `  reached kingdom ${fact.kingdomId} as moment #${fact.seq} in ${ms} ms · the caravan ${fact.body.founded ? 'comes from their own kingdom' : 'comes up the road (no founded kingdom)'}`,
  `  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`,
]);
if (flag('again')) {
  const again = watchFor(momentOf('raid', f => f.seq > fact.seq), { timeoutMs: 8_000 }).then(f => f, () => null);
  await sleep(500);
  await deliver(payload, { messageId });
  if (await again) { console.error('  retry FIRED AGAIN'); process.exit(1); }
  report(['  retry of the same delivery: nothing new reached the kingdom in 8 s (deduplicated)']);
}
