// A Hype Train climbs (Twitch CLI's payloads, sequenced level by level); at level 3 it summons the dragon, chat
// fights it with !strike, and the realm's own clock decides the fight.
//   node scripts/live/hype.mjs [--level 5] [--fighters 16] [--stop-at summoning|active|victory|end]
// --stop-at active leaves the dragon circling over the town (for a still); `--stop-at end` (default) runs it all.
import { randomUUID } from 'node:crypto';
import { args, BENCH, chatMessage, cliEvent, deliver, fireAndWatch, label, momentOf, payloadSource, report, sleep, SIMULATED_CHATTERS, watchFor } from './lib.mjs';

const top = Number(args('level', '5')), fighters = SIMULATED_CHATTERS.slice(0, Number(args('fighters', '16')));
const stopAt = args('stop-at', 'end'), trainId = randomUUID(), startedAt = new Date();
const contributors = fighters.slice(0, 3).map(p => ({ user_id: p.personId, user_login: p.login, user_name: p.name, type: 'bits', total: 500 }));
const train = (phase, level) => {
  const payload = cliEvent(`channel.hype_train.${phase}`, ['-t', BENCH.kingdomId]);
  const goal = 1600 + level * 800, now = Date.now();
  Object.assign(payload.event, { id: trainId, level, total: 2400 * level, top_contributions: contributors, started_at: startedAt.toISOString() },
    phase === 'end' ? { ended_at: new Date(now).toISOString(), cooldown_ends_at: new Date(now + 3_600_000).toISOString() }
      : { progress: Math.round(goal * 0.35), goal, expires_at: new Date(now + 300_000).toISOString() });
  return deliver(payload);
};
const battle = test => momentOf('battle', f => f.body.battleKey && test(f.body));
const done = phase => { if (stopAt === phase) { report([`  stopped at ${phase}; the realm keeps the fight's clock`]); process.exit(0); } };

const first = await fireAndWatch(() => train('begin', 1), momentOf('hype', f => f.body.phase === 'begin'));
report([`hype · ${label(first.found)} · the train leaves the station at level 1 (moment #${first.found.seq}, ${first.ms} ms) · written by ${payloadSource.value}`]);
await sleep(1_500);
await train('progress', 2);
const summoned = await fireAndWatch(() => train('progress', 3), battle(b => b.phase === 'summoning'));
report([`  level 3: the dragon is summoned · ${summoned.found.body.form} · ${summoned.ms} ms from the train to the sky`]);
for (let level = 4; level <= top; level++) { await sleep(1_200); await train('progress', level); }
done('summoning');
const active = await watchFor(battle(b => b.phase === 'active'), { timeoutMs: 30_000 });
report([`  the fight begins · ${active.body.form} dragon · vitality for the crowd that comes`]);
done('active');

// Chat fights: each fighter strikes about once a second (the realm takes one per person per 800 ms).
const victory = watchFor(battle(b => b.phase === 'victory' || b.phase === 'retreat'), { timeoutMs: 200_000 });
let sent = 0, over = false;
victory.finally(() => { over = true; });
while (!over && sent < 4_000) {
  for (const fighter of fighters) {
    if (over) break;
    await deliver(chatMessage({ ...fighter, text: sent % 5 === 0 ? '!strike for the lantern street' : '!strike', messageId: randomUUID() }));
    sent++;
  }
  await sleep(900);
}
const outcome = await victory;
report([`  ${outcome.body.phase} · ${outcome.body.acceptedStrikes} strikes from ${outcome.body.fighters} fighters (${sent} sent) · health ${outcome.body.healthPermille / 10}%`]);
done('victory');
await sleep(3_000);
const ended = await fireAndWatch(() => train('end', top), momentOf('hype', f => f.body.phase === 'end'));
report([`  the train arrives at level ${ended.found.body.level} · ${label(ended.found)}`,
  `  watch it: http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`]);
