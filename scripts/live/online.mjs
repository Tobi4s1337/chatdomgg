// The channel going live (stream.online, written by Twitch CLI): the night opens, the gate's braziers catch and its
// standard climbs in the town's colours. With --returning, citizens who already have homes speak in chat and each one
// is welcomed home once tonight (the relight). --rest sends stream.offline: the night rests, every home stays.
//   node scripts/live/online.mjs [--returning 4] [--who 990000300:Hollis_Reed,…] | --rest
//   node scripts/live/online.mjs --live [--minutes 60]   LIVE: go live on twitch.tv/tobi4s_; this waits for the night.
import { randomUUID } from 'node:crypto';
import { args, BENCH, chatMessage, cliEvent, deliver, fireAndWatch, flag, label, momentOf, payloadSource, report, sleep, SIMULATED_CHATTERS, waitLive, watchFor } from './lib.mjs';

if (flag('live')) {
  const fact = await waitLive('night', 'go live on twitch.tv/tobi4s_', f => f.body.phase === 'open');
  report([`night · LIVE · Night ${fact.body.number} opens at the gate · moment #${fact.seq}`]);
  process.exit(0);
}
const rest = flag('rest');
const payload = cliEvent(rest ? 'stream.offline' : 'stream.online', ['-t', BENCH.kingdomId]);
Object.assign(payload.event, { broadcaster_user_login: 'tobi4s_', broadcaster_user_name: 'tobi4s_' });
const { found: fact, ms } = await fireAndWatch(() => deliver(payload, { messageId: randomUUID() }), momentOf('night', f => f.body.phase === (rest ? 'rest' : 'open')));
report([
  `${rest ? 'stream.offline' : 'stream.online'} · ${label(fact)} · Night ${fact.body.number} ${rest ? 'rests: the gate closes, every home stays' : 'opens: the gate is lit'} · written by ${payloadSource.value}`,
  `  reached kingdom ${fact.kingdomId} as moment #${fact.seq} in ${ms} ms`,
]);
// --who names the returning citizens (ID:name); otherwise the bench's first SIMULATED chatters.
const who = args('who', '').split(',').filter(Boolean).map(pair => { const [personId, name] = pair.split(':'); return { personId, login: name.toLowerCase(), name }; });
const returning = rest ? 0 : who.length || Number(args('returning', '0'));
if (returning > 0) {
  const people = who.length ? who : SIMULATED_CHATTERS.slice(0, returning), welcomed = [];
  const watching = watchFor((event, value) => {
    const found = momentOf('homecoming')(event, value);
    if (found) { welcomed.push(found); report([`  welcome back · ${found.body.credit?.displayName} · slot ${found.body.credit?.slot}${found.body.awayDays ? ` · ${found.body.awayDays} days away` : ''} · moment #${found.seq}`]); }
    return welcomed.length >= people.length ? true : null;
  }, { timeoutMs: 20_000 }).catch(() => null);
  await sleep(800);
  // Spaced like a chat waking up, so each relight has its moment.
  for (const person of people) { await deliver(chatMessage({ ...person, text: 'evening, all' })); await sleep(1500); }
  await watching;
  report([`  ${welcomed.length} of ${people.length} returning citizen(s) welcomed home (the rest were settled tonight, or have no home)`]);
}
report([`  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`]);
