// A sub shared in chat, written by Twitch CLI (channel.subscribe, or channel.subscription.message with months) and
// read as the chat notice production reads: the subscriber's banner unfurls at home, and someone with no home yet is
// settled first on their tenure street (more months, a street nearer the castle).
//   node scripts/live/sub.mjs [--id 990000301] [--name Maren_Holt] [--months 14] [--tier 1000]
//   node scripts/live/sub.mjs --live [--minutes 30]   LIVE: subscribe or share a resub on twitch.tv/tobi4s_; this waits for it.
import { randomUUID } from 'node:crypto';
import { args, BENCH, cliEvent, deliver, fireAndWatch, flag, label, momentOf, payloadSource, report, waitLive } from './lib.mjs';

if (flag('live')) {
  const fact = await waitLive('subscription', 'subscribe, or share a resub, on twitch.tv/tobi4s_');
  report([`sub · LIVE · ${fact.body.credit?.displayName ?? 'a quiet subscriber'} · ${fact.body.months} month(s) · tier ${fact.body.tier} · moment #${fact.seq}`]);
  process.exit(0);
}
const id = args('id', '990000301'), name = args('name', 'Maren_Holt'), months = Math.max(1, Number(args('months', '14'))), tier = args('tier', '1000');
const type = months > 1 ? 'channel.subscription.message' : 'channel.subscribe';
const payload = cliEvent(type, ['-t', BENCH.kingdomId, '-f', id]);
Object.assign(payload.event, { user_id: id, user_login: name.toLowerCase(), user_name: name, tier, broadcaster_user_login: 'tobi4s_', broadcaster_user_name: 'tobi4s_',
  ...(months > 1 ? { cumulative_months: months, streak_months: months, duration_months: 1, message: { text: '', emotes: [] } } : { is_gift: false }) });

const { found: fact, ms } = await fireAndWatch(() => deliver(payload, { messageId: randomUUID() }), momentOf('subscription', f => f.body.credit?.displayName === name));
report([
  `sub · ${label(fact)} · ${name} · ${fact.body.months} month(s) · tier ${fact.body.tier} · written by ${payloadSource.value} (as the shared chat notice)`,
  `  reached kingdom ${fact.kingdomId} as moment #${fact.seq} in ${ms} ms · ${fact.body.credit?.slot != null ? `banner at home, slot ${fact.body.credit.slot}` : 'no home to hang a banner on'}`,
  `  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`,
]);
