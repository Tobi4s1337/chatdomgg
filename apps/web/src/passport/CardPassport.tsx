// The passport on the citizen card's page: the book lying open on a lamp-lit desk under the card, the same book the
// panel carries, and beside it the picture this spread makes when it is shared. The adapter decides nothing about
// whose book it is; main binds the transport (the card's own subject), the disclosed homes, the card's current
// disclosure, the share route and, for the holder themselves, the existing authority behind "Hide my travels".
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import {
  PassportReading, acknowledgesDisclosure, createPassportReading, curateShareSpread, newerDisclosure, shareAlt,
  type BookLayout, type PageDensity, type PassportDisclosureView, type PassportReadState, type PassportTransport, type VisiblePassportView,
} from '@chatdom/ui/passport';
import { pictureOf } from './picture';
import './card-passport.css';

export interface CardPassportShare {
  /** Main's share-image route for this card's subject (served by `createPassportShareHttp`), same-origin. */
  readonly imageUrl: string;
}

/** The holder's own choice, through main's existing person authority. Only the card's own holder is given one. */
export interface CardPassportOwner {
  /**
   * Asks the authority to show or hide the travels. Resolves with the card's disclosure once the change is committed
   * (`passportDisclosure` of the card projected again), or rejects. Nothing on the page claims the change before then.
   */
  setTravels(travels: 'shown' | 'hidden', signal: AbortSignal): Promise<PassportDisclosureView>;
}

export interface CardPassportProps {
  /**
   * Reads this card's passport. A different transport is a different subject: the reading closes, drops every late
   * reply and starts again, so nothing of the previous holder stays on the page.
   */
  readonly transport: PassportTransport;
  /** Kingdom names the card already shows publicly (its disclosed homes), so a road can name where it began. */
  readonly places?: ReadonlyMap<string, string>;
  /**
   * The card's current disclosure (`passportDisclosure(projectCard(source))`). Hidden closes the book without a read;
   * a newer revision reads a fresh snapshot; an older one is ignored. Without it the book is read once.
   */
  readonly disclosure?: PassportDisclosureView;
  /** The holder's own control over their travels. Absent for every other reader. */
  readonly owner?: CardPassportOwner;
  /** Where the spread's picture is served. Without it there is no share shelf: nothing pretends to share. */
  readonly share?: CardPassportShare;
  /** Private-fixture provenance retained for host compatibility; never rendered as a label. */
  readonly simulated?: boolean;
  /** 0 is the closed cover; the card page opens the book on its flyleaf (1) by default. */
  readonly initialView?: number;
  /** Every state the reading passes through, for a host that waits on the first settled one. */
  readonly onState?: (state: PassportReadState) => void;
}

export function CardPassport(props: CardPassportProps): JSX.Element {
  // Keyed by transport: a new subject is a new reading, never the old one with new words poured in.
  return <Show when={props.transport} keyed>{transport => <CardReading {...props} transport={transport} />}</Show>;
}

/** Two facing pages when the section is wide enough to give each page room for a stamp and its words. */
const SPREAD_FROM = 760;
/** And the share shelf stands beside the book, rather than under it, when there is room for both. */
const BESIDE_FROM = 1180;
/** A spread narrower than this keeps two journeys to a page, so every stamp keeps its whole caption and room around it. */
const ROOMY_FROM = 1000;
const SHELF = 280, GAP = 30, TABS = 104;
/** Two journeys to a page: the card page's book breathes rather than tightening its type. */
export const CARD_DENSITY = { stamps: 2, entries: 5 } as const satisfies PageDensity;

function CardReading(props: CardPassportProps): JSX.Element {
  // The newest of what the host says and what the authority acknowledged to the holder here.
  const [acknowledged, setAcknowledged] = createSignal<PassportDisclosureView>();
  const disclosure = createMemo(() => newerDisclosure(props.disclosure, acknowledged()));
  const { state, session } = createPassportReading(props.transport, { disclosure });
  createEffect(() => props.onState?.(state()));
  let root: HTMLElement | undefined;
  const [width, setWidth] = createSignal(0);
  onMount(() => {
    if (!root) return;
    setWidth(root.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  const layout = (): BookLayout => (width() === 0 || width() >= SPREAD_FROM ? 'spread' : 'page');
  const book = createMemo(() => (state().kind === 'visible' ? (state() as Extract<PassportReadState, { kind: 'visible' }>).book : undefined));
  const beside = () => !!props.share && !!book() && width() >= BESIDE_FROM;
  // The width the open book actually gets: the section, less the shelf beside it and the thumb tabs on its fore-edge.
  const bookWidth = () => width() - (beside() ? SHELF + GAP : 0) - TABS;
  const density = (): PageDensity | undefined => (layout() === 'spread' && width() > 0 && bookWidth() < ROOMY_FROM ? CARD_DENSITY : undefined);

  return <section ref={element => (root = element)} class="cpc" data-state={state().kind} data-layout={layout()} data-beside={beside() ? 'true' : undefined}
    aria-labelledby="cpc-title">
    <header class="cpc-head">
      <Rule />
      <h2 id="cpc-title" class="cpc-title">Passport</h2>
      <Rule flip />
    </header>
    <Show when={props.owner}>{owner =>
      <TravelChoice owner={owner()} disclosure={disclosure()} state={state()} onAcknowledged={setAcknowledged} />}</Show>
    <div class="cpc-room">
      <div class="cpc-desk">
        <Lamp />
        <PassportReading state={state()} layout={layout()} {...(density() ? { density: density()! } : {})} initialView={props.initialView ?? 1} class="cpc-book"
          {...(props.places ? { places: props.places } : {})} onMore={collection => session.more(collection)} onRetry={() => session.open()} />
      </div>
      {/* Only a visible book is ever drawn as a picture; every other state has nothing to share. */}
      <Show when={props.share && book() ? { share: props.share, book: book()! } : undefined} keyed>
        {shelf => <ShareShelf share={shelf.share} book={shelf.book} />}
      </Show>
    </div>
  </section>;
}

function Rule(props: { flip?: boolean }): JSX.Element {
  return <svg class="cpc-rule" data-flip={props.flip ? 'true' : undefined} viewBox="0 0 120 16" aria-hidden="true">
    <path d="M2 8h86" /><path d="M96 8c4-4 9-5.5 14-5.5-3 2-4.5 3.6-4.5 5.5s1.5 3.5 4.5 5.5c-5 0-10-1.5-14-5.5Z" /><circle cx="91" cy="8" r="2" />
  </svg>;
}

/** The lamp the book is read under: a warm pool over the desk and a few motes turning in it. Still under reduced motion. */
function Lamp(): JSX.Element {
  return <div class="cpc-lamp" aria-hidden="true">
    <span class="cpc-pool" />
    <span class="cpc-motes"><For each={Array.from({ length: 10 }, (_, i) => i)}>{i => <i style={{ '--i': i }} />}</For></span>
  </div>;
}

type Travels = 'shown' | 'hidden';
type Ask =
  | { readonly kind: 'idle' }
  | { readonly kind: 'asking' | 'done' | 'failed'; readonly travels: Travels };

const ASKING: Readonly<Record<Travels, string>> = {
  hidden: 'Asking Chatdom to keep your travels private…',
  shown: 'Asking Chatdom to show your travels…',
};
const DONE: Readonly<Record<Travels, string>> = {
  hidden: 'Done. Your book and its picture are no longer shown or served. Copies already saved elsewhere stay where they are.',
  shown: 'Done. Your travels are on your card again.',
};
const RESTING: Readonly<Record<Travels, string>> = {
  hidden: 'No one can open this book or its picture. Your homes stay on your card.',
  shown: 'Anyone who opens your card can read this book.',
};

/**
 * The holder's own "Keep my travels private", as a brass clasp on a leather strap. The switch shows what the
 * authority last acknowledged, never what was just asked: while the change is out the book stays as it was and
 * the clasp says it is asking; only an acknowledged answer (`acknowledgesDisclosure`) moves the clasp and closes or
 * opens the book. A refused or failed change says that nothing changed.
 */
function TravelChoice(props: {
  owner: CardPassportOwner; disclosure: PassportDisclosureView | undefined; state: PassportReadState;
  onAcknowledged: (disclosure: PassportDisclosureView) => void;
}): JSX.Element {
  const [ask, setAsk] = createSignal<Ask>({ kind: 'idle' });
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  // What is true now: the disclosure, or failing that what the reading itself settled on. Unknown while it opens.
  const travels = (): Travels | undefined => props.disclosure?.travels
    ?? (props.state.kind === 'visible' ? 'shown' : props.state.kind === 'hidden' ? 'hidden' : undefined);
  const asking = () => ask().kind === 'asking';

  const change = async () => {
    const now = travels();
    if (asking() || !now) return;
    const wanted: Travels = now === 'shown' ? 'hidden' : 'shown';
    const from = props.disclosure;
    controller = new AbortController();
    const signal = controller.signal;
    setAsk({ kind: 'asking', travels: wanted });
    try {
      const answer = await props.owner.setTravels(wanted, signal);
      if (signal.aborted) return;
      if (!acknowledgesDisclosure(from, wanted, answer)) throw new Error('The change was not acknowledged');
      props.onAcknowledged(answer);
      setAsk({ kind: 'done', travels: wanted });
    } catch {
      if (!signal.aborted) setAsk({ kind: 'failed', travels: wanted });
    }
  };

  const message = () => {
    const a = ask(), now = travels();
    if (a.kind === 'asking') return ASKING[a.travels];
    if (a.kind === 'done' && now === a.travels) return DONE[a.travels];
    if (a.kind === 'failed' && now) return `Nothing changed: Chatdom could not answer just now. Your travels are still ${now === 'hidden' ? 'private' : 'shown'}.`;
    return now ? RESTING[now] : '';
  };

  return <Show when={travels()}>{now =>
    <div class="cpc-owner" data-ask={ask().kind} data-travels={now()}>
      <button type="button" class="cpc-clasp" role="switch" aria-checked={now() === 'hidden' ? 'true' : 'false'}
        aria-describedby="cpc-owner-status" aria-busy={asking() ? 'true' : undefined} aria-disabled={asking() ? 'true' : undefined}
        onClick={() => void change()}>
        <span class="cpc-clasp-strap" aria-hidden="true"><span class="cpc-clasp-buckle"><span class="cpc-clasp-hole" /></span></span>
        <span class="cpc-clasp-label">Keep my travels private</span>
      </button>
      <p id="cpc-owner-status" class="cpc-owner-status" role="status" aria-live="polite" data-tone={ask().kind === 'failed' ? 'failed' : undefined}>{message()}</p>
    </div>}
  </Show>;
}

type Copy = { readonly kind: 'idle' } | { readonly kind: 'copying' } | { readonly kind: 'copied' } | { readonly kind: 'failed' };

/**
 * The picture this spread makes when it is shared: the image main's share route serves right now, pinned beside
 * the book like a print. Copying the link is acknowledged only once the clipboard says it worked; if it cannot,
 * the link is laid out to select by hand.
 */
function ShareShelf(props: { share: CardPassportShare; book: VisiblePassportView }): JSX.Element {
  const alt = createMemo(() => shareAlt(curateShareSpread(props.book)));
  // The print is fetched for this snapshot only: a document may reuse an image it already holds for the same URL,
  // so a book read afresh never shows the picture of the one before it. The link to copy stays the clean one.
  const print = pictureOf(props.share.imageUrl, props.book);
  const absolute = () => new URL(props.share.imageUrl, window.location.href).href;
  const [copy, setCopy] = createSignal<Copy>({ kind: 'idle' });
  const [picture, setPicture] = createSignal<'loading' | 'shown' | 'failed'>('loading');
  let field: HTMLInputElement | undefined;
  let alive = true;
  onCleanup(() => { alive = false; });

  const copyLink = async () => {
    if (copy().kind === 'copying') return;
    setCopy({ kind: 'copying' });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard here');
      await navigator.clipboard.writeText(absolute());
      if (alive) setCopy({ kind: 'copied' });
    } catch {
      if (!alive) return;
      setCopy({ kind: 'failed' });
      queueMicrotask(() => { field?.focus(); field?.select(); });
    }
  };

  return <aside class="cpc-share" aria-labelledby="cpc-share-title">
    <figure class="cpc-print" data-picture={picture()}>
      <div class="cpc-print-frame">
        <Show when={picture() !== 'failed'} fallback={<p class="cpc-print-missing">The picture could not be drawn just now.</p>}>
          <img src={print} alt={alt()} width="1200" height="800" decoding="async"
            onLoad={() => setPicture('shown')} onError={() => setPicture('failed')} />
        </Show>
      </div>
      <figcaption class="cpc-print-caption">The picture this spread makes</figcaption>
    </figure>
    <div class="cpc-share-words">
      <h3 id="cpc-share-title" class="cpc-share-title">Share this spread</h3>
      <p class="cpc-share-note">The newest journeys, drawn fresh each time the picture is opened. Kept private, it stops being served at once; copies already saved stay where they are.</p>
      <div class="cpc-share-actions">
        <button type="button" class="cpc-button" data-busy={copy().kind === 'copying' ? 'true' : undefined} onClick={() => void copyLink()}>
          <LinkGlyph /><span>{copy().kind === 'copied' ? 'Link copied' : 'Copy picture link'}</span>
        </button>
        <a class="cpc-button cpc-button-quiet" href={props.share.imageUrl} target="_blank" rel="noopener">Open the picture</a>
      </div>
      <p class="cpc-share-status" role="status" aria-live="polite">
        <Switch>
          <Match when={copy().kind === 'copied'}>The picture’s link is on your clipboard.</Match>
          <Match when={copy().kind === 'failed'}>Copying was not allowed here. Select the link below and copy it yourself.</Match>
        </Switch>
      </p>
      <Show when={copy().kind === 'failed'}>
        <label class="cpc-share-field"><span class="cpc-visually-hidden">The picture’s link</span>
          <input ref={element => (field = element)} readonly value={absolute()} onFocus={event => event.currentTarget.select()} />
        </label>
      </Show>
    </div>
  </aside>;
}

function LinkGlyph(): JSX.Element {
  return <svg class="cpc-glyph" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8.4 11.6a3.2 3.2 0 0 0 4.5 0l2.6-2.6a3.2 3.2 0 0 0-4.5-4.5l-1.1 1.1" />
    <path d="M11.6 8.4a3.2 3.2 0 0 0-4.5 0L4.5 11a3.2 3.2 0 0 0 4.5 4.5l1.1-1.1" />
  </svg>;
}
