// The passport panel bench: SIMULATED only, never part of the Extension build. Each book is read the way the panel
// will read a real one: SIMULATED authorities (card source with disclosure, the Gate's minimal stamps, a kingdom
// directory, witnessed roads, accepted gift receipts) feed the real passport reader, the reply crosses a serialised
// wire and the boundary reader, and the panel view shows it in a 318 x 496 frame.
//   ?fixture=none|few|many  ?state=shown|unsigned|hidden|malformed|pending  ?view=<n> (0 is the cover)
import { render } from 'solid-js/web';
import { createSignal, For, Show, type JSX } from 'solid-js';
import { PASSPORT_FIXTURE_NAMES, PASSPORT_FIXTURE_TITLES, type PassportFixtureName, type PassportTransport } from '@chatdom/ui/passport';
import { projectCard } from '../../../api/src/citizen-card/project';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities, type SimulatedScenario } from '../../../api/src/passport/simulated';
import { passportLocalTransport } from '../../../web/src/passport/transport';
import { PanelPassport } from './PanelPassport';
import './bench.css';

type BenchState = 'shown' | 'unsigned' | 'hidden' | 'malformed' | 'pending';
const STATES: readonly BenchState[] = ['shown', 'unsigned', 'hidden', 'malformed', 'pending'];
const SCENARIO: Readonly<Record<BenchState, SimulatedScenario>> = {
  shown: { signedIn: true, travelsHidden: false },
  unsigned: { signedIn: false, travelsHidden: false },
  hidden: { signedIn: true, travelsHidden: true },
  malformed: { signedIn: true, travelsHidden: false },
  pending: { signedIn: true, travelsHidden: false },
};

const query = new URLSearchParams(location.search);
const fixtureParam = query.get('fixture'), stateParam = query.get('state');
const fixture: PassportFixtureName = PASSPORT_FIXTURE_NAMES.includes(fixtureParam as PassportFixtureName) ? fixtureParam as PassportFixtureName : 'many';
const state: BenchState = STATES.includes(stateParam as BenchState) ? stateParam as BenchState : 'shown';
const initialView = Math.max(0, Number(query.get('view') ?? 0) || 0);

/** A book reply whose as-of is no longer a moment: the boundary refuses it, so the panel shows unavailable. */
const corrupt = (json: unknown) => {
  const reply = json as { kind?: string; book?: Record<string, unknown> };
  return reply.kind === 'book' && reply.book ? { ...reply, book: { ...reply.book, asOf: 'yesterday' } } : json;
};

function Bench(): JSX.Element {
  const authorities = simulatedPassportAuthorities(fixture, SCENARIO[state]);
  const reader = createPassportReader(authorities.ports);
  const transport: PassportTransport = state === 'pending'
    // A read that is genuinely still out: it settles only when the reading closes and aborts it.
    ? (_request, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    : passportLocalTransport(reader, { key: authorities.key, now: authorities.now }, state === 'malformed' ? corrupt : undefined);
  // The viewer's card beside the book: its disclosed homes let a road name where it began, and nothing more.
  const card = projectCard(authorities.card());
  const places = new Map([[card.key.kingdomId as string, card.kingdomName], ...card.homes.map(home => [home.kingdomId as string, home.kingdomName] as const)]);
  const [closed, setClosed] = createSignal(false);
  const settled = (kind: string) => {
    if (kind === 'pending' && state !== 'pending') return;
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
    })));
  };
  const link = (next: Record<string, string>) => `?${new URLSearchParams({ fixture, state, view: String(initialView), ...next })}`;
  return <main class="cppb">
    <div class="cppb-frame" data-closed={closed() ? 'true' : undefined}>
      <Show when={!closed()} fallback={<button type="button" class="cppb-reopen" onClick={() => setClosed(false)}>Open the passport again</button>}>
        <PanelPassport transport={transport} places={places} initialView={initialView} onClose={() => setClosed(true)}
          onState={next => settled(next.kind)} />
      </Show>
    </div>
    <nav class="cppb-picks" aria-label="SIMULATED bench">
      <p><b>SIMULATED</b> passport bench: invented citizens and kingdoms, read through the passport reader.</p>
      <p><For each={PASSPORT_FIXTURE_NAMES}>{name => <a href={link({ fixture: name })} aria-current={name === fixture ? 'true' : undefined}>{PASSPORT_FIXTURE_TITLES[name]}</a>}</For></p>
      <p><For each={STATES}>{name => <a href={link({ state: name })} aria-current={name === state ? 'true' : undefined}>{name}</a>}</For></p>
    </nav>
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('The bench has no root element');
render(() => <Bench />, root);
