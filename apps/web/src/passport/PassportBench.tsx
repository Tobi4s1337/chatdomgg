import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import {
  PASSPORT_FIXTURE_NAMES, PASSPORT_FIXTURE_TITLES, PassportReading, createPassportReading,
  type BookLayout, type PassportFixtureName, type PassportTransport,
} from '@chatdom/ui/passport';
import { projectCard } from '../../../api/src/citizen-card/project';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities, type SimulatedScenario } from '../../../api/src/passport/simulated';
import { CardPassport } from './CardPassport';
import { passportLocalTransport } from './transport';
import './bench.css';

/**
 * The passport bench. Each SIMULATED book is read the way a real surface reads one: SIMULATED authorities (a card
 * source with disclosure, the Gate's minimal stamps, a kingdom directory, witnessed roads, accepted gift receipts)
 * feed the real read application, the reply crosses a serialised wire, the boundary reader checks it, and a session
 * shows it. `?fixture=none|few|many`, `?state=shown|unsigned|hidden|revised|malformed|pending`,
 * `?layout=spread|page`, `?view=<n>` (0 is the cover) and `?chrome=0` for a frame without the bench header.
 * `?surface=card` shows the book as the citizen card's page carries it, with the share shelf; its picture comes from
 * `/-/passport/share.png`, which only the capture runner serves (through the real share handler and renderer).
 */
type BenchState = 'shown' | 'unsigned' | 'hidden' | 'revised' | 'malformed' | 'pending';
const STATES: readonly BenchState[] = ['shown', 'unsigned', 'hidden', 'revised', 'malformed', 'pending'];
const STATE_TITLES: Readonly<Record<BenchState, string>> = {
  shown: 'Signed in, travels shown',
  unsigned: 'Never signed in',
  hidden: 'Travels hidden',
  revised: 'A journey lands while reading',
  malformed: 'A corrupt reply',
  pending: 'Still opening',
};
const SCENARIO: Readonly<Record<BenchState, SimulatedScenario>> = {
  shown: { signedIn: true, travelsHidden: false },
  unsigned: { signedIn: false, travelsHidden: false },
  hidden: { signedIn: true, travelsHidden: true },
  revised: { signedIn: true, travelsHidden: false, revisedWhileReading: true },
  malformed: { signedIn: true, travelsHidden: false },
  pending: { signedIn: true, travelsHidden: false },
};

/** A book reply whose as-of is no longer a moment: the boundary refuses it, so the surface shows unavailable. */
const corrupt = (json: unknown) => {
  const reply = json as { kind?: string; book?: Record<string, unknown> };
  return reply.kind === 'book' && reply.book ? { ...reply, book: { ...reply.book, asOf: 'yesterday' } } : json;
};

const param = (key: string) => new URLSearchParams(window.location.search).get(key);
const isFixture = (value: string | null): value is PassportFixtureName => PASSPORT_FIXTURE_NAMES.includes(value as PassportFixtureName);
const isState = (value: string | null): value is BenchState => STATES.includes(value as BenchState);

/** One SIMULATED reading as a surface would have it: a checked transport and the card's disclosed homes. */
function benchSource(fixture: PassportFixtureName, bench: BenchState): { transport: PassportTransport; places: ReadonlyMap<string, string>; kingdom: string } {
  const authorities = simulatedPassportAuthorities(fixture, SCENARIO[bench]);
  const reader = createPassportReader(authorities.ports);
  const transport: PassportTransport = bench === 'pending'
    // A read that is genuinely still out: it settles only when the session aborts it.
    ? (_request, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    : passportLocalTransport(reader, { key: authorities.key, now: authorities.now }, bench === 'malformed' ? corrupt : undefined);
  // The card the book sits beside: its disclosed homes let a road name where it began. Nothing more is taken from it.
  const card = projectCard(authorities.card());
  const places = new Map([[card.key.kingdomId as string, card.kingdomName], ...card.homes.map(home => [home.kingdomId as string, home.kingdomName] as const)]);
  return { transport, places, kingdom: card.kingdomName };
}

/** The capture waits for this: fonts in and the first settled state painted (or the deliberately pending one). */
function markReady(settled: () => boolean): void {
  createEffect(() => {
    if (!settled()) return;
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
    })));
  });
}

function BenchReading(props: { fixture: PassportFixtureName; state: BenchState; layout: BookLayout; initialView: number }): JSX.Element {
  const { transport, places } = benchSource(props.fixture, props.state);
  const { state, session } = createPassportReading(transport);
  markReady(() => state().kind !== 'pending' || props.state === 'pending');
  return <div class="ppb-reading" data-state={state().kind}>
    <PassportReading state={state()} layout={props.layout} initialView={props.initialView} places={places}
      onMore={collection => session.more(collection)} onRetry={() => session.open()} />
  </div>;
}

/**
 * The citizen card's page as it carries the passport: the card page's dusk over the rooftops, the open book and the
 * print of its shared spread. The picture is the real share handler's answer when the capture runner serves it.
 */
function BenchCard(props: { fixture: PassportFixtureName; state: BenchState; initialView: number }): JSX.Element {
  const { transport, places, kingdom } = benchSource(props.fixture, props.state);
  const [settled, setSettled] = createSignal(props.state === 'pending');
  markReady(settled);
  const imageUrl = `/-/passport/share.png?${new URLSearchParams({ fixture: props.fixture, state: props.state })}`;
  return <div class="ppb-card">
    <header class="ppb-card-head">
      <span class="ppb-card-mark">Chatdom</span>
      <span class="ppb-card-kingdom">A citizen of {kingdom}</span>
    </header>
    <CardPassport transport={transport} places={places} share={{ imageUrl }} simulated initialView={props.initialView}
      onState={state => { if (state.kind !== 'pending') setSettled(true); }} />
    <div class="ppb-card-roofs" aria-hidden="true" />
  </div>;
}

export default function PassportBench(): JSX.Element {
  const initial = param('fixture'), initialState = param('state');
  const [fixture, setFixture] = createSignal<PassportFixtureName>(isFixture(initial) ? initial : 'many');
  const [state, setState] = createSignal<BenchState>(isState(initialState) ? initialState : 'shown');
  const [layout, setLayout] = createSignal<BookLayout>(param('layout') === 'page' || (param('layout') !== 'spread' && window.innerWidth < 760) ? 'page' : 'spread');
  const chrome = param('chrome') !== '0';
  const initialView = Math.max(0, Number(param('view') ?? 1) || 0);
  const reading = createMemo(() => ({ fixture: fixture(), state: state() }));
  const surface = param('surface') === 'card' ? 'card' : 'book';

  return <main class="ppb" data-chrome={chrome ? 'on' : 'off'} data-surface={surface}>
    <Show when={chrome}>
      <header class="ppb-head cd-plate">
        <div class="ppb-title">
          <p class="cd-label ppb-eyebrow">Chatdom · passport bench</p>
          <h1 class="ppb-h1">The raid passport</h1>
          <p class="ppb-sim"><b>SIMULATED</b> invented citizens, kingdoms and authorities, read through the passport reader. No live travel.</p>
        </div>
        <div class="ppb-picks">
          <div class="ppb-pick" role="group" aria-label="Choose a SIMULATED book">
            <For each={PASSPORT_FIXTURE_NAMES}>{name => <button type="button" class="ppb-chip" aria-pressed={fixture() === name}
              onClick={() => setFixture(name)}>{PASSPORT_FIXTURE_TITLES[name]}</button>}</For>
          </div>
          <div class="ppb-pick" role="group" aria-label="What the authorities say">
            <For each={STATES}>{name => <button type="button" class="ppb-chip" aria-pressed={state() === name}
              onClick={() => setState(name)}>{STATE_TITLES[name]}</button>}</For>
          </div>
        </div>
        <div class="ppb-pick" role="group" aria-label="Pages shown at once" hidden={surface === 'card'}>
          <button type="button" class="ppb-chip" aria-pressed={layout() === 'spread'} onClick={() => setLayout('spread')}>Two pages</button>
          <button type="button" class="ppb-chip" aria-pressed={layout() === 'page'} onClick={() => setLayout('page')}>One page</button>
        </div>
      </header>
    </Show>
    {/* A different book or a different answer is a different reading: the previous one closes and drops late replies. */}
    <Show when={reading()} keyed>{r => surface === 'card'
      ? <BenchCard fixture={r.fixture} state={r.state} initialView={initialView} />
      : <BenchReading fixture={r.fixture} state={r.state} layout={layout()} initialView={initialView} />}</Show>
  </main>;
}
