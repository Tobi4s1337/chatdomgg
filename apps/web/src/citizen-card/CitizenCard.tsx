import { Match, Show, Switch, createEffect, createSignal, createUniqueId, on, onCleanup, onMount, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CitizenKey } from '@chatdom/shared';
import type { CardAssetRef, CitizenCardDocument } from '../../../api/src/citizen-card/contracts';
import type { CardHost, CardLight, CardLoad } from './host';
import { PaintedCrest, WaxSeal } from './Crest';
import { BrassCorner, Flourish, Mark, type MarkName } from './marks';
import { followFact, nameStyle, showLogin, standing, subscriptionFact, type Fact } from './format';
import './plaque.css';

export type CardMode = 'dialog' | 'page';

type View =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly key: CitizenKey }
  | (CardLoad & { readonly key: CitizenKey });

const sameKey = (a: CitizenKey, b: CitizenKey) => a.personId === b.personId && a.kingdomId === b.kingdomId;

/**
 * A citizen's card. The host binds the subject; the card reads it, and every new subject replaces the last one
 * whole: the old document is dropped before the new read starts, and a reply for anyone else is ignored.
 *
 *   <CitizenCard mode="dialog" subject={picked()} host={host} />
 */
export function CitizenCard(props: { mode: CardMode; subject: CitizenKey | null; host: CardHost; light?: CardLight }): JSX.Element {
  const [view, setView] = createSignal<View>({ status: 'idle' });
  let controller: AbortController | undefined;
  let ticket = 0;

  const read = (key: CitizenKey) => {
    controller?.abort();
    const current = controller = new AbortController();
    const mine = ++ticket;
    setView({ status: 'loading', key });
    const settle = (result: CardLoad) => {
      if (mine !== ticket || current.signal.aborted) return;
      // A document for anybody but the requested subject is never shown.
      if (result.status === 'ready' && !sameKey(result.document.key, key)) result = { status: 'unavailable' };
      setView({ ...result, key });
    };
    props.host.load(key, current.signal).then(settle, () => settle({ status: 'unavailable' }));
  };

  createEffect(on(() => props.subject ? `${props.subject.kingdomId}:${props.subject.personId}` : null, id => {
    if (id === null || !props.subject) {
      controller?.abort(); ticket++;
      setView({ status: 'idle' });
      return;
    }
    read({ personId: props.subject.personId, kingdomId: props.subject.kingdomId });
  }));
  onCleanup(() => { controller?.abort(); ticket++; });

  const retry = () => {
    const current = view();
    if (current.status !== 'idle') { props.host.cue?.('press'); read(current.key); }
  };

  const body = () => <CardBody view={view()} mode={props.mode} host={props.host} onRetry={retry} />;
  return <Show when={view().status !== 'idle'}>
    <Show when={props.mode === 'dialog'} fallback={<PageFrame light={props.light ?? 'dusk'} view={view()}>{body()}</PageFrame>}>
      <Dialog host={props.host} light={props.light ?? 'dusk'} view={view()}>{body()}</Dialog>
    </Show>
  </Show>;
}

// ---------------------------------------------------------------------------------------------------------------
// Dialog and page

function Dialog(props: { host: CardHost; light: CardLight; view: View; children: JSX.Element }) {
  let root: HTMLDivElement | undefined;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => { props.host.cue?.('close'); props.host.close?.(); };
  const focusables = () => [...(root?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
    .filter(element => element.offsetParent !== null || element === document.activeElement);

  onMount(() => {
    props.host.cue?.('open');
    queueMicrotask(() => (root?.querySelector<HTMLElement>('.cc-close') ?? root)?.focus({ preventScroll: true }));
  });
  // Closing hands focus back to whatever opened the card (the host restores camera input itself).
  onCleanup(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });

  const onKey = (event: KeyboardEvent) => {
    // The card owns the keyboard while it is open: nothing reaches the world behind it.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) { event.preventDefault(); root?.focus(); return; }
    const first = items[0]!, last = items[items.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const hold = (event: Event) => event.stopPropagation();

  return <div class="cc-scrim" data-light={props.light} on:keydown={onKey} on:pointerdown={hold} on:pointerup={hold} on:wheel={hold} on:touchstart={hold} on:touchmove={hold}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={element => (root = element)} class="cc-dialog" role="dialog" aria-modal="true" tabindex="-1"
      aria-labelledby={props.view.status === 'ready' ? 'cc-dialog-title' : 'cc-dialog-state'} data-state={props.view.status}>
      {props.children}
      <button type="button" class="cc-close" aria-label="Close card" onClick={close}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
      </button>
    </div>
  </div>;
}

function PageFrame(props: { light: CardLight; view: View; children: JSX.Element }) {
  const kingdom = () => props.view.status === 'ready' ? props.view.document.kingdomName : null;
  return <div class="cc-page" data-light={props.light} data-state={props.view.status}>
    <header class="cc-page-head">
      <span class="cc-page-mark">Chatdom</span>
      <Show when={kingdom()}>{name => <span class="cc-page-kingdom">A citizen of {name()}</span>}</Show>
    </header>
    <main class="cc-page-main">{props.children}</main>
    <footer class="cc-page-foot">Every Twitch chat a kingdom, every viewer a citizen with a home.</footer>
    <div class="cc-page-roofs" aria-hidden="true" />
  </div>;
}

// ---------------------------------------------------------------------------------------------------------------
// The plaque

function CardBody(props: { view: View; mode: CardMode; host: CardHost; onRetry: () => void }) {
  const ready = () => props.view.status === 'ready' ? props.view.document : null;
  return <Switch>
    <Match when={ready()}>{document => <Plaque document={document()} mode={props.mode} host={props.host} />}</Match>
    <Match when={props.view.status === 'loading'}>
      <Frame plate="Citizen card"><StateNote id="cc-dialog-state" mark="quill" busy title="Reading the town ledger" text="Finding their page and their portrait." /></Frame>
    </Match>
    <Match when={props.view.status === 'missing'}>
      <Frame plate="Citizen card"><StateNote id="cc-dialog-state" mark="home" title="No card here" text="Nobody by that mark lives in this kingdom’s ledger." /></Frame>
    </Match>
    <Match when={props.view.status === 'withdrawn'}>
      <Frame plate="Citizen card"><StateNote id="cc-dialog-state" mark="home" title="This card has been withdrawn" text="It is no longer shown anywhere in Chatdom." /></Frame>
    </Match>
    <Match when={props.view.status === 'unavailable'}>
      <Frame plate="Citizen card">
        <StateNote id="cc-dialog-state" mark="quill" title="The ledger can’t be read just now" text="Their card is safe. Try again in a moment.">
          <button type="button" class="cc-button" onClick={() => props.onRetry()}>Try again</button>
        </StateNote>
      </Frame>
    </Match>
  </Switch>;
}

/** Wood, brass corners and a brass nameplate around a parchment sheet. */
function Frame(props: { plate: string; simulated?: boolean; children: JSX.Element }) {
  return <article class="cc-plaque">
    <div class="cc-wood">
      <BrassCorner corner="tl" /><BrassCorner corner="tr" /><BrassCorner corner="bl" /><BrassCorner corner="br" />
      <div class="cc-plate"><span>{props.plate}</span></div>
      <div class="cc-sheet">
        <div class="cc-sheet-paper" aria-hidden="true" />
        <div class="cc-sheet-body">{props.children}</div>
      </div>
    </div>
  </article>;
}

function StateNote(props: { id: string; mark: MarkName; title: string; text: string; busy?: boolean; children?: JSX.Element }) {
  return <div class="cc-state" role={props.busy ? 'status' : undefined} aria-busy={props.busy ? 'true' : undefined}>
    <Mark name={props.mark} class={props.busy ? 'cc-mark--writing' : ''} />
    <h2 id={props.id} class="cc-state-title">{props.title}</h2>
    <p class="cc-state-text">{props.text}</p>
    {props.children}
  </div>;
}

function Plaque(props: { document: CitizenCardDocument; mode: CardMode; host: CardHost }) {
  const d = () => props.document;
  const name = () => nameStyle(d().identity.colour);
  const titleId = props.mode === 'dialog' ? 'cc-dialog-title' : createUniqueId();
  const length = () => [...d().identity.name].length;
  const facts = (): { mark: MarkName; fact: Fact }[] => [
    { mark: 'follow', fact: followFact(d().tenure) },
    { mark: 'subscribed', fact: subscriptionFact(d().tenure) },
  ];
  const home = () => d().address;
  return <Frame plate={d().kingdomName}>
    <div class="cc-hero" data-origin={d().origin}>
      <Portrait document={d()} host={props.host} />
      <div class="cc-who">
        <Show when={d().origin === 'simulated'}>
          <p class="cc-simulated" role="note"><b>SIMULATED</b><span>A labelled fixture, not a real citizen</span></p>
        </Show>
        <Dynamic component={props.mode === 'page' ? 'h1' : 'h2'} id={titleId} class="cc-name"
          data-surface={name().surface} data-length={length() > 24 ? 'long' : length() > 14 ? 'mid' : 'short'}
          style={name().colour ? { '--cc-name-colour': name().colour! } : undefined}>
          <Show when={name().surface === 'ink' && name().colour}>{colour => <span class="cc-swatch" style={{ background: colour() }} aria-hidden="true" />}</Show>
          <bdi>{d().identity.name}</bdi>
        </Dynamic>
        <Show when={showLogin(d().identity)}><p class="cc-login">@{d().identity.login}</p></Show>
        <p class="cc-standing">
          <Show when={d().identity.office === 'monarch'}><Mark name="crown" class="cc-standing-mark" /></Show>
          <span>{standing(d())}</span>
          <Show when={d().citizenNumber !== null}><span class="cc-number">{standing(d()) === 'Citizen' ? 'No.' : 'Citizen No.'} <b>{d().citizenNumber}</b></span></Show>
        </p>
        <Flourish />
        <ul class="cc-facts">
          {facts().map(({ mark, fact }) => <FactRow mark={mark} fact={fact} />)}
          <li class="cc-fact">
            <Mark name="home" />
            <span class="cc-fact-label">Home</span>
            <Show when={home()} fallback={<strong class="cc-fact-value cc-fact-value--quiet">Not settled in {d().kingdomName} yet</strong>}>
              {address => <strong class="cc-fact-value"><bdi>{address().home}</bdi><span class="cc-street">, <bdi>{address().street}</bdi></span></strong>}
            </Show>
          </li>
        </ul>
      </div>
      <div class="cc-seal-slot"><WaxSeal kingdomId={d().key.kingdomId} size={84} /></div>
    </div>
  </Frame>;
}

function FactRow(props: { mark: MarkName; fact: Fact }) {
  return <li class="cc-fact">
    <Mark name={props.mark} />
    <span class="cc-fact-label">{props.fact.label}</span>
    <Show when={props.fact.value} fallback={<strong class="cc-fact-value cc-fact-value--unknown">Not known yet</strong>}>
      {value => <strong class="cc-fact-value">{props.fact.datetime ? <time datetime={props.fact.datetime}>{value()}</time> : value()}</strong>}
    </Show>
    <Show when={props.fact.note}>{note => <span class="cc-fact-note">{note()}</span>}</Show>
  </li>;
}

/** Their actual portrait in an arched window; without one, the kingdom's arms hang there instead. */
function Portrait(props: { document: CitizenCardDocument; host: CardHost }) {
  const [failed, setFailed] = createSignal(false);
  const url = (ref: CardAssetRef) => props.host.assetUrl(ref, props.document.key);
  const portrait = () => {
    const ref = props.document.identity.portrait;
    const src = ref && !failed() ? url(ref) : null;
    return ref && src ? { ref, src } : null;
  };
  return <figure class="cc-portrait">
    <div class="cc-window">
      <Show when={portrait()} fallback={<div class="cc-window-empty">
        <PaintedCrest kingdomId={props.document.key.kingdomId} kingdomName={props.document.kingdomName} width={72} />
        <span>{props.document.identity.portrait ? 'Their portrait could not be shown just now' : 'No portrait painted yet'}</span>
      </div>}>
        {p => <img src={p().src} alt={p().ref.alt} decoding="async" onError={() => setFailed(true)} />}
      </Show>
    </div>
  </figure>;
}
