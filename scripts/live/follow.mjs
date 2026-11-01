// A follow, written by Twitch CLI (channel.follow v2) and signed like Twitch's webhook: the follower settles in a new
// home on the edge of town, placed by their follow date, and a sapling takes root by the door with their name on it.
//   node scripts/live/follow.mjs [--id 990000300] [--name Hollis_Reed] [--again]
//   node scripts/live/follow.mjs --live [--minutes 30]   LIVE: follow twitch.tv/tobi4s_ from any account; this waits for it.
import { randomUUID } from 'node:crypto';
import { args, BENCH, cliEvent, deliver, fireAndWatch, flag, label, momentOf, payloadSource, report, sleep, waitLive, watchFor } from './lib.mjs';

if (flag('live')) {
  const fact = await waitLive('follow', 'follow twitch.tv/tobi4s_ from any account');
  report([`follow · LIVE · ${fact.body.credit?.displayName ?? 'a quiet follower (unnamed)'} · ${fact.body.homeSlot !== null ? `home on slot ${fact.body.homeSlot}` : 'no home slot'} · moment #${fact.seq}`]);
  process.exit(0);
}
const id = args('id', '990000300'), name = args('name', 'Hollis_Reed'), messageId = randomUUID();
const payload = cliEvent('channel.follow', ['-t', BENCH.kingdomId, '-f', id]);
Object.assign(payload.event, { user_id: id, user_login: name.toLowerCase(), user_name: name, broadcaster_user_login: 'tobi4s_', broadcaster_user_name: 'tobi4s_',
  followed_at: new Date().toISOString() });

const grove = watchFor(momentOf('grove'), { timeoutMs: 30_000 }).then(f => f, () => null);
const { found: fact, ms } = await fireAndWatch(() => deliver(payload, { messageId }), momentOf('follow', f => f.body.credit?.displayName === name));
const planted = await Promise.race([grove, sleep(3_000).then(() => null)]);
const sapling = planted?.body.plantings.find(p => p.slot === fact.body.homeSlot);
report([
  `follow · ${label(fact)} · ${name} follows · written by ${payloadSource.value}`,
  `  reached kingdom ${fact.kingdomId} as moment #${fact.seq} in ${ms} ms · ${fact.body.homeSlot !== null ? `${fact.body.returning ? 'their home' : 'a new home'} on slot ${fact.body.homeSlot}` : 'no home (welcomed at the gate)'}`,
  `  grove: ${sapling ? `a sapling by the door of slot ${sapling.slot} (${planted.body.plantings.length} planting(s) in town)` : 'nothing new planted'}`,
  `  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`,
]);
if (flag('again')) {
  const again = watchFor(momentOf('follow', f => f.seq > fact.seq), { timeoutMs: 8_000 }).then(f => f, () => null);
  await sleep(500);
  await deliver(payload, { messageId });
  if (await again) { console.error('  retry FIRED AGAIN'); process.exit(1); }
  report(['  retry of the same delivery: nothing new reached the kingdom in 8 s (deduplicated)']);
}
