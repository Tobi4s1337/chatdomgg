import { createSignal, Show } from 'solid-js';
import KingdomEntry from '../../kingdom-entry';
import { createLiveKingdomEntrySource } from '../../kingdom-entry/live';
import type { KingdomEntrySource } from '../../kingdom-entry/types';
import { createRaidWelcomeEntry, type RaidWelcomeStatus } from './adapter';
import WelcomeNotice from './WelcomeNotice';

/**
 * The welcome link's page. Production mounts it at `/raid/...` with no props: a live gate only.
 * The private `/-/raid-gate?guestWalk=<welcome path>` bench passes `origin: 'simulated'` so the lane's own mock stack
 * (signed CLI raid, SIMULATED sign-in, recording crier) can be walked into through the same adapter, sign-in, ticket
 * and room. Its provenance stays in the data and every check; nothing on the bench says so (Tobias's decision 25,
 * and the lane decision that staged fixtures live only on `/-/` benches, unlabelled).
 */
export default function RaidWelcomeEntry(props: { pathname?: string; origin?: 'live' | 'simulated' } = {}) {
  const [status, setStatus] = createSignal<RaidWelcomeStatus>();
  const [attempt, setAttempt] = createSignal(1);
  const entry = createRaidWelcomeEntry({ pathname: props.pathname ?? location.pathname, fetcher: (input, init) => fetch(input, init),
    status: setStatus, ...(props.origin ? { origin: props.origin } : {}), openKingdom: info => openKingdom(info) });
  const enterOrdinarily = () => { entry.enterOrdinarily(); setStatus(undefined); setAttempt(value => value + 1); };
  return <>
    <Show keyed when={attempt()}>{value => { void value; return <KingdomEntry open={entry.open} />; }}</Show>
    <WelcomeNotice status={status()} enterOrdinarily={enterOrdinarily} />
  </>;
}

function openKingdom(info: { kingdomId: Parameters<typeof createLiveKingdomEntrySource>[0]['kingdomId']; kingdomName: string; origin: 'live' | 'simulated' }): KingdomEntrySource {
  const endpoint = `${location.origin}/live-realm-data`;
  if (info.origin === 'live') return createLiveKingdomEntrySource({ kingdomId: info.kingdomId, kingdomName: info.kingdomName, endpoint });
  // The kingdom entry requires a rehearsal to carry its SIMULATED description; the bench keeps it out of the picture.
  const source = createLiveKingdomEntrySource({ kingdomId: info.kingdomId, kingdomName: info.kingdomName, endpoint, origin: 'simulated',
    notice: 'SIMULATED lane stack: a mock raid on a private bench.' });
  return async signal => {
    const { notice, ...connection } = await source(signal);
    void notice;
    return connection;
  };
}
