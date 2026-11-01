// A poll, the town deciding together (channel.poll.begin → progress → end, written by Twitch CLI): the decree board
// rises in the plaza and each pennant climbs to its share. A poll whose every choice is one of the town's colours
// (Ember, Gold, Rose, Tide, Meadow, Dusk, Snow, Night) is a decree: the winner flies on every standard from then on.
// One person, one vote: votes bought with channel points are counted apart. A tie decides nothing.
//   node scripts/live/poll.mjs [--title "Our colours"] [--choices Ember,Tide,Meadow] [--votes 3,7,2] [--paid 0,1,0] [--seconds 20]
//   node scripts/live/poll.mjs --live [--minutes 30]   LIVE: start a poll on twitch.tv/tobi4s_ (Ember / Tide / Meadow); this waits for its result.
import { randomUUID } from 'node:crypto';
import { args, BENCH, cliEvent, deliver, flag, label, momentOf, payloadSource, report, sleep, waitLive, watchFor } from './lib.mjs';

if (flag('live')) {
  const fact = await waitLive('poll', 'start a poll on twitch.tv/tobi4s_ (choices: Ember, Tide, Meadow) and let it end', f => f.body.phase === 'end');
  const winner = fact.body.choices.find(c => c.id === fact.body.winnerId);
  report([`poll · LIVE · "${fact.body.title}" · ${winner ? `the town chose ${winner.title}` : fact.body.cancelled ? 'set aside' : 'divided'} · moment #${fact.seq}`]);
  process.exit(0);
}
const title = args('title', 'Our colours'), titles = args('choices', 'Ember,Tide,Meadow').split(',').map(t => t.trim()).filter(Boolean).slice(0, 5);
const votes = args('votes', '3,7,2').split(',').map(Number), paid = args('paid', '0,1,0').split(',').map(Number);
const seconds = Math.max(6, Number(args('seconds', '20')));
const pollId = randomUUID(), started = new Date(), ends = new Date(started.getTime() + seconds * 1000);
const choices = titles.map(choiceTitle => ({ id: randomUUID(), title: choiceTitle }));
const tally = share => choices.map((c, i) => {
  const all = Math.round((votes[i] ?? 0) * share), cp = Math.min(all, Math.round((paid[i] ?? 0) * share));
  return { ...c, votes: all, channel_points_votes: cp, bits_votes: 0 };
});
function phase(type, event) {
  const payload = cliEvent(type, ['-t', BENCH.kingdomId]);
  Object.assign(payload.event, { id: pollId, title, broadcaster_user_login: 'tobi4s_', broadcaster_user_name: 'tobi4s_', started_at: started.toISOString(), ...event });
  return deliver(payload, { messageId: randomUUID() });
}
// One watch for the whole poll, open (its checkpoint read) before anything is sent, so no fact can slip past it.
const seen = [];
let opened, done;
const ready = new Promise(resolve => { opened = resolve; }), ended = new Promise(resolve => { done = resolve; });
const watching = watchFor((event, value) => {
  const fact = momentOf('poll', f => f.body.pollKey.endsWith(pollId))(event, value) ?? momentOf('decree')(event, value);
  if (fact) { seen.push(fact); if (fact.body.kind === 'poll' && fact.body.phase === 'end') done(fact); }
  return null;
}, { timeoutMs: (seconds + 60) * 1000, onCheckpoint: () => opened() });
watching.catch(error => { if (!/nothing reached/.test(error.message)) throw error; });
await ready;
const arrived = async (test, ms = 20_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const fact = seen.find(test); if (fact) return fact; await sleep(150); }
  throw new Error('nothing reached the kingdom in time');
};

await phase('channel.poll.begin', { choices: choices.map(c => ({ ...c })), ends_at: ends.toISOString() });
const begun = await arrived(f => f.body.kind === 'poll' && f.body.phase === 'begin');
report([`poll · ${label(begun)} · "${title}" · ${titles.join(' / ')} · the decree board rises · written by ${payloadSource.value}`]);
for (const share of [0.35, 0.7]) {
  await sleep(seconds * 300);
  await phase('channel.poll.progress', { choices: tally(share), ends_at: ends.toISOString() });
  report([`  progress · ${tally(share).map(c => `${c.title} ${c.votes}`).join(' · ')}`]);
}
await sleep(Math.max(0, ends.getTime() - Date.now()));
await phase('channel.poll.end', { choices: tally(1), status: 'completed', ended_at: ends.toISOString() });
const end = await Promise.race([ended, sleep(20_000).then(() => { throw new Error('the poll\'s end never reached the kingdom'); })]);
const winner = end.body.choices.find(c => c.id === end.body.winnerId);
report([`  end · ${end.body.choices.map(c => `${c.title} ${c.votes}`).join(' · ')} (one person, one vote) · moment #${end.seq}`,
  `  ${winner ? `the town chose ${winner.title}` : end.body.cancelled ? 'the decree was set aside' : 'the town is divided: nothing changes'}`]);
if (winner) {
  const carried = await arrived(f => f.body.kind === 'decree' && f.seq > end.seq, 4_000).catch(() => null);
  report([carried ? `  decree · the town flies ${carried.body.choice} from now on · moment #${carried.seq}`
    : '  decided; nothing to carry out (not a colours poll, or the town already flies it)']);
}
report([`  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`]);
process.exit(0);
