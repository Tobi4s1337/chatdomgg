// LIVE: watch the running realm (read only) for real Twitch moments on tobi4s_ as they land.
//   node scripts/live/live-watch.mjs [--realm http://127.0.0.1:5197] [--minutes 30]
// Cheer, start a Hype Train or raid on twitch.tv/tobi4s_; each LIVE fact prints here as the kingdom receives it.
import { args, BENCH, LIVE, report, watchFor } from './lib.mjs';

const realm = args('realm', LIVE.realm), minutes = Number(args('minutes', '30'));
report([`watching ${realm} · kingdom ${BENCH.kingdomId} · LIVE facts only · ${minutes} min`]);
await watchFor((event, value) => {
  if (event === 'checkpoint') {
    const current = value.checkpoint?.current?.find(m => m?.type === 'moments.current');
    report([`  checkpoint · ${current?.facts?.length ?? 0} current moment(s)`]);
  }
  if (event === 'world' && value?.message?.type === 'moment') {
    const fact = value.message.fact;
    if (fact.origin !== 'live') return null;
    const b = fact.body, detail = b.kind === 'cheer' ? `${b.bits} Bits` : b.kind === 'hype' ? `level ${b.level} · ${b.phase}`
      : b.kind === 'battle' ? `${b.form} dragon · ${b.phase} · ${b.acceptedStrikes} strikes` : b.kind === 'raid' ? `${b.from.displayName} · ${b.viewers} guests` : b.kind;
    report([`  LIVE · ${new Date(fact.occurredAt).toISOString()} · ${b.kind} · ${detail} · moment #${fact.seq} (${Date.now() - fact.occurredAt} ms after Twitch)`]);
  }
  return null;
}, { realm, timeoutMs: minutes * 60_000 }).catch(error => { if (!/nothing reached/.test(error.message)) throw error; });
