import '../kit.css';
import './passport.css';
import { createRenderEffect, createSignal, Match, onCleanup, Show, Switch, type Accessor, type JSX } from 'solid-js';
import { ProvenanceSeal } from '../ProvenanceSeal';
import { CoverEmblem, PassportBook } from './Book';
import type { BookLayout, PageDensity } from './pages';
import {
  createPassportSession, followDisclosure,
  type PassportDisclosureView, type PassportReadState, type PassportSession, type PassportTransport,
} from './session';
import type { PassportCollection } from './types';

export interface PassportReadingProps {
  readonly state: PassportReadState;
  readonly layout?: BookLayout;
  readonly density?: PageDensity;
  readonly initialView?: number;
  /** Kingdom names this surface already shows publicly beside the book, such as the card's disclosed homes. */
  readonly places?: ReadonlyMap<string, string>;
  readonly onMore?: (collection: PassportCollection) => void;
  /** Read again after an unavailable answer. Without it, the closed book only says so. */
  readonly onRetry?: () => void;
  readonly class?: string;
}

/**
 * A passport as a surface shows it, in whichever state the read is in. Only a visible book is opened. Every other
 * state is the same closed leather book with no holder, no count and nothing derived from travel on it: opening
 * while the read is pending, strapped and clasped when the travels are kept private, and quiet with a way to try
 * again when the passport could not be read. Hidden and before-first-sign-in look identical on purpose.
 */
export function PassportReading(props: PassportReadingProps): JSX.Element {
  const visible = () => (props.state.kind === 'visible' ? props.state : undefined);
  return <Switch>
    <Match when={visible()}>{read => <PassportBook book={read().book} shelf={read().shelf} layout={props.layout ?? 'spread'}
      {...(props.density ? { density: props.density } : {})} {...(props.initialView === undefined ? {} : { initialView: props.initialView })} {...(props.places ? { places: props.places } : {})}
      {...(props.onMore ? { onMore: props.onMore } : {})} {...(props.class ? { class: props.class } : {})} />}</Match>
    <Match when={props.state.kind === 'hidden' ? props.state : undefined}>{hidden =>
      <ClosedPassport state="private" layout={props.layout ?? 'spread'} simulated={hidden().origin === 'simulated'} class={props.class} />}</Match>
    <Match when={props.state.kind === 'unavailable'}>
      <ClosedPassport state="unavailable" layout={props.layout ?? 'spread'} class={props.class} onRetry={props.onRetry} />
    </Match>
    <Match when={true}><ClosedPassport state="pending" layout={props.layout ?? 'spread'} class={props.class} /></Match>
  </Switch>;
}

const CLOSED_WORDS = {
  private: { label: 'A private passport', note: 'Travels kept private' },
  pending: { label: 'A passport, opening', note: 'Opening the passport…' },
  unavailable: { label: 'A passport that could not be read', note: 'This passport could not be read just now' },
} as const;

function ClosedPassport(props: { state: keyof typeof CLOSED_WORDS; layout: BookLayout; simulated?: boolean; class?: string | undefined; onRetry?: (() => void) | undefined }): JSX.Element {
  const words = () => CLOSED_WORDS[props.state];
  return <section class={`pp-book cd-kit${props.class ? ` ${props.class}` : ''}`} data-layout={props.layout} data-view="closed" data-state={props.state}
    aria-roledescription="passport" aria-label={words().label} aria-busy={props.state === 'pending' ? 'true' : undefined}>
    <div class="pp-cover-wrap">
      <div class="pp-cover pp-cover-still" data-state={props.state}>
        <span class="pp-cover-tooling" aria-hidden="true" />
        <CoverEmblem />
        <span class="pp-cover-title" aria-hidden="true">Passport</span>
        <span class="pp-cover-rule" aria-hidden="true" />
        <p class="pp-cover-note" role="status">{words().note}</p>
        <Show when={props.state === 'private'}>
          {/* A leather strap wrapped round the fore-edge and fastened with a brass clasp: the book stays shut. */}
          <span class="pp-strap" aria-hidden="true"><span class="pp-clasp"><span class="pp-keyhole" /></span></span>
        </Show>
      </div>
      <Show when={props.state === 'unavailable' && props.onRetry}>{retry =>
        <button type="button" class="pp-more-action pp-retry" onClick={() => retry()()}>Try again</button>}</Show>
      <Show when={props.simulated}><ProvenanceSeal class="pp-provenance pp-provenance-cover" state="simulated" detail="an illustrative passport" /></Show>
    </div>
  </section>;
}

/**
 * A Solid reading of one passport through a session: opened on creation, closed with its owner. Hosts that change
 * subject create a new reading (or call `session.open()` after their transport points at the new subject); the
 * session drops every late reply from the previous one.
 *
 * With `disclosure` (the card's current `passportDisclosure`), the reading follows it (`followDisclosure`): hidden
 * closes the book without a read, a newer shown reads a fresh snapshot, and a stale shown is ignored.
 */
export function createPassportReading(transport: PassportTransport, options: { disclosure?: Accessor<PassportDisclosureView | undefined> } = {}): { state: Accessor<PassportReadState>; session: PassportSession } {
  const session = createPassportSession(transport);
  const [state, setState] = createSignal<PassportReadState>(session.state(), { equals: false });
  const stop = session.subscribe(setState);
  const follow = followDisclosure(session);
  const disclosure = options.disclosure;
  // A render effect runs now, before anything is sent: a book the card already hides is never even asked for.
  if (disclosure) createRenderEffect(() => follow(disclosure()));
  else follow(undefined);
  onCleanup(() => { stop(); session.close(); });
  return { state, session };
}
