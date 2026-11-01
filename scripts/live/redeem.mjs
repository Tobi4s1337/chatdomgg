// A kingdom reward redeemed with channel points (channel.channel_points_custom_reward_redemption.add, written by
// Twitch CLI). Herald reads the reward's title only, never what the viewer typed: Ring the Bell, Call a Festival,
// Plant a Tree and Show My Home act in the town; every other reward is the streamer's own.
//   node scripts/live/redeem.mjs [--reward "Call a Festival"] [--id 990000100] [--name Wrenna]
//   node scripts/live/redeem.mjs --live [--minutes 30]   LIVE: redeem one of the four on twitch.tv/tobi4s_; this waits for it.
import { randomUUID } from 'node:crypto';
import { args, BENCH, cliEvent, deliver, fireAndWatch, flag, label, momentOf, payloadSource, report, waitLive } from './lib.mjs';

if (flag('live')) {
  const fact = await waitLive('redemption', 'redeem Ring the Bell, Call a Festival, Plant a Tree or Show My Home on twitch.tv/tobi4s_');
  report([`reward · LIVE · ${fact.body.credit?.displayName ?? 'a friend of the realm'} · ${fact.body.mappingKey} · moment #${fact.seq}`]);
  process.exit(0);
}
const reward = args('reward', 'Call a Festival'), id = args('id', '990000100'), name = args('name', 'Wrenna');
const payload = cliEvent('channel.channel_points_custom_reward_redemption.add', ['-t', BENCH.kingdomId, '-f', id]);
Object.assign(payload.event, { user_id: id, user_login: name.toLowerCase(), user_name: name, user_input: '', broadcaster_user_login: 'tobi4s_', broadcaster_user_name: 'tobi4s_' });
Object.assign(payload.event.reward, { title: reward, prompt: '' });
// The town credits a redeemer it knows by name; one it cannot name (no home in this kingdom's layout) is credited to a
// friend of the realm, so an uncredited fact of this very reward counts too.
const mapping = reward.toLowerCase().replace(/[^a-z]+/g, '-');
const ours = f => f.body.credit?.displayName === name || (f.body.credit == null && f.body.mappingKey === mapping);
const { found: fact, ms } = await fireAndWatch(() => deliver(payload, { messageId: randomUUID() }), momentOf('redemption', ours),
  { timeoutMs: 15_000 }).catch(error => { report([`reward · "${reward}" · nothing happened in the town (${error.message}): it is not one of the kingdom's rewards, or it needs a home its redeemer cannot have`]); process.exit(1); });
report([
  `reward · ${label(fact)} · ${fact.body.credit ? name : `${name} (credited to a friend of the realm)`} redeems "${reward}" → ${fact.body.mappingKey} · written by ${payloadSource.value}`,
  `  reached kingdom ${fact.kingdomId} as moment #${fact.seq} in ${ms} ms${fact.body.credit?.slot != null ? ` · their home, slot ${fact.body.credit.slot}` : ''}`,
  `  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`,
]);
