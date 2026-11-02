import { createSignal, Show } from 'solid-js';
import KingdomEntry from '../../kingdom-entry';
import { createLiveKingdomEntrySource } from '../../kingdom-entry/live';
import { createRaidWelcomeEntry, type RaidWelcomeStatus } from './adapter';
import WelcomeNotice from './WelcomeNotice';

export default function RaidWelcomeEntry() {
  const [status, setStatus] = createSignal<RaidWelcomeStatus>();
  const [attempt, setAttempt] = createSignal(1);
  const entry = createRaidWelcomeEntry({ pathname: location.pathname, fetcher: (input, init) => fetch(input, init),
    status: setStatus, openKingdom: info => createLiveKingdomEntrySource({ ...info, endpoint: `${location.origin}/live-realm-data` }) });
  const enterOrdinarily = () => { entry.enterOrdinarily(); setStatus(undefined); setAttempt(value => value + 1); };
  return <>
    <Show keyed when={attempt()}>{value => { void value; return <KingdomEntry open={entry.open} />; }}</Show>
    <WelcomeNotice status={status()} enterOrdinarily={enterOrdinarily} />
  </>;
}
