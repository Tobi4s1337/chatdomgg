// The Chatdom panel: the kingdom under the video. A warm picture, your own window,
// a little of tonight, and one drawer at a time. It is a window into belonging,
// never a second game client.
import { createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { selectAdapter } from './adapters/select';
import type { Connection, Earned, Home, Light, LightChoice, PanelAdapter, PanelSnapshot, Picture } from './model';
import { ActSlip } from './ui/act';
import { BackGlyph, ForgeGlyph, HomeGlyph, PanelDefs, Seal, Shutters, TavernGlyph, TonightGlyph, WindowGlyph } from './ui/art';
import { ForgeSheet, RaisingMeter, TavernSheet } from './ui/places';
import { ShelfSheet } from './ui/shelf';
import './panel.css';
import './places.css';

type Drawer = 'home' | 'tonight' | 'tavern' | 'forge' | 'light' | 'shelf';
/** A drawer opened from inside another goes back to it, not to the first view. */
const PARENT: Partial<Record<Drawer, Drawer>> = { shelf: 'tonight' };
type ReadyWindow = Window & { __chatdomReady?: boolean };

/** How long the confirmed window takes to kindle: panes one by one, then the glow settles. */
const KINDLE_MS = 2600;

const DRAWERS: readonly { id: Exclude<Drawer, 'light' | 'shelf'>; label: string; glyph: () => JSX.Element }[] = [
  { id: 'home', label: 'Home', glyph: HomeGlyph },
  { id: 'tonight', label: 'Tonight', glyph: TonightGlyph },
  { id: 'tavern', label: 'Tavern', glyph: TavernGlyph },
  { id: 'forge', label: 'Forge', glyph: ForgeGlyph },
];

export default function Panel(props: { adapter?: PanelAdapter }) {
  const adapter = props.adapter ?? selectAdapter();
  const [snap, setSnap] = createSignal<PanelSnapshot>(adapter.get());
  const [drawer, setDrawer] = createSignal<Drawer | null>(null);
  const [ready, setReady] = createSignal(false);
  // The moment a pending light is confirmed, the window kindles once. Never for an unavailable answer.
  const [kindling, setKindling] = createSignal(false);
  let kindleTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = adapter.subscribe(next => {
    if (next.light.kind === 'lit' && snap().light.kind === 'pending') {
      setKindling(true);
      clearTimeout(kindleTimer);
      kindleTimer = setTimeout(() => setKindling(false), KINDLE_MS);
    }
    setSnap(next);
  });
  let drawerEl: HTMLElement | undefined, lightEl: HTMLElement | undefined, actEl: HTMLElement | undefined, pictureEl: HTMLImageElement | undefined, disposed = false;
  // Who opened each drawer, so Back returns focus there. A nested drawer keeps its parent's opener.
  const openers = new Map<Drawer, HTMLElement | null>();

  const open = (next: Drawer, from: EventTarget | null) => {
    if (drawer() !== PARENT[next]) openers.clear();
    openers.set(next, from instanceof HTMLElement ? from : null);
    setDrawer(current => current === next ? null : next);
    // Every drawer opens at its head; the page element is shared, so its scroll would carry over.
    const page = drawerEl?.querySelector<HTMLElement>('.cp-drawer-page');
    if (page) page.scrollTop = 0;
    queueMicrotask(() => drawerEl?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
  };
  const close = () => {
    const current = drawer();
    const back = current ? openers.get(current) ?? null : null;
    const parent = current ? PARENT[current] : undefined;
    if (current) openers.delete(current);
    setDrawer(parent ?? null);
    const page = drawerEl?.querySelector<HTMLElement>('.cp-drawer-page');
    if (page) page.scrollTop = 0;
    // A chosen light replaces the button that opened the drawer; focus then rests on the window's status.
    // The parent drawer redraws its page, so its signpost is found again by what it opens.
    queueMicrotask(() => (back?.isConnected ? back
      : parent ? drawerEl?.querySelector<HTMLElement>(`[data-opens="${current}"]`) ?? drawerEl?.querySelector<HTMLElement>('[data-autofocus]')
      : lightEl)?.focus());
  };
  const choose = (choice: LightChoice) => { adapter.requestLight(choice); close(); };
  // The tapped button gives way to the kingdom's answer; focus waits on the act, where the answer is read out.
  const act = (option: string) => { adapter.requestAct(option); queueMicrotask(() => actEl?.focus()); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && drawer()) { event.preventDefault(); close(); } };

  onMount(() => {
    const testWindow = window as ReadyWindow;
    testWindow.__chatdomReady = false;
    document.documentElement.classList.add('cp-document');
    window.addEventListener('keydown', onKey);
    // Ready means the first view is really drawn: faces loaded and the picture decoded,
    // or a settled connection state. A knock still waiting for Twitch is not ready.
    const settle = async () => {
      await document.fonts.ready;
      if (snap().picture.kind === 'still' && pictureEl) await pictureEl.decode().catch(() => undefined);
      if (disposed) return;
      if (snap().connection.kind === 'knocking') return;
      setReady(true);
      requestAnimationFrame(() => { if (!disposed) testWindow.__chatdomReady = true; });
    };
    void settle();
    onCleanup(adapter.subscribe(next => { if (!ready() && next.connection.kind !== 'knocking') void settle(); }));
  });
  onCleanup(() => {
    disposed = true;
    clearTimeout(kindleTimer);
    unsubscribe();
    adapter.dispose();
    window.removeEventListener('keydown', onKey);
    document.documentElement.classList.remove('cp-document');
    (window as ReadyWindow).__chatdomReady = false;
  });

  const kingdomName = () => snap().kingdom?.name ?? 'The kingdom';
  const motto = () => snap().kingdom?.motto ?? connectionMotto(snap().connection);

  return <div class="cp" data-chatdom-panel data-source={snap().source.kind} data-connection={snap().connection.kind}
    data-light={snap().light.kind} data-stream={snap().stream} data-home={snap().home.kind} data-drawer={drawer() ?? 'none'} data-ready={ready() ? 'true' : 'false'}
    data-view={snap().picture.kind === 'still' ? 'kingdom' : 'connection'}>
    <PanelDefs />
    <header class="cp-head">
      <Seal blank={!snap().kingdom} />
      <div class="cp-title">
        <h1 class="cp-name" classList={{ long: kingdomName().length > 15 }}>{kingdomName()}</h1>
        <p class="cp-motto">{motto()}</p>
      </div>
      <Show when={snap().source.kind === 'simulated'} fallback={<span class="cp-tag quiet">{snap().connection.kind === 'knocking' ? 'Connecting' : 'Not connected'}</span>}>
        <span class="cp-tag simulated" title={snap().source.kind === 'simulated' ? (snap().source as { detail: string }).detail : undefined}>Simulated</span>
      </Show>
    </header>

    <main class="cp-main" aria-hidden={drawer() ? 'true' : undefined} inert={drawer() ? true : undefined}>
      <PictureFrame picture={snap().picture} connection={snap().connection} ref={element => { pictureEl = element; }} />
      <LightAction snap={snap()} kindling={kindling()} ref={element => { lightEl = element; }} onChoose={event => open('light', event.currentTarget)} onHome={event => open('home', event.currentTarget)} />
      <Show when={snap().act} fallback={<TonightSlip snap={snap()} />}>{current =>
        <div class="cp-act-wrap" ref={element => { actEl = element; }} tabindex="-1">
          <ActSlip snap={snap()} act={current()} onAct={act} onLight={event => open('light', event.currentTarget)} />
        </div>}
      </Show>
    </main>

    <Show when={drawer()}>{current =>
      <section class="cp-drawer" ref={element => { drawerEl = element; }} role="dialog" aria-modal="false" aria-labelledby="cp-drawer-title" data-drawer={current()}>
        <div class="cp-drawer-head">
          <button class="cp-back" type="button" onClick={close} data-autofocus><BackGlyph /><span>{PARENT[current()] === 'tonight' ? 'Tonight' : 'The kingdom'}</span></button>
          <h2 id="cp-drawer-title" class="cp-drawer-title">{drawerTitle(current(), snap())}</h2>
        </div>
        <div class="cp-drawer-page" tabindex="-1">
          <Switch>
            <Match when={current() === 'light'}><LightChoiceSheet snap={snap()} onChoose={choose} /></Match>
            <Match when={current() === 'home'}><HomeSheet snap={snap()} onLight={event => open('light', event.currentTarget)} /></Match>
            <Match when={current() === 'tonight'}><TonightSheet snap={snap()} onShelf={event => open('shelf', event.currentTarget)} /></Match>
            <Match when={current() === 'tavern'}><TavernSheet snap={snap()} empty={reason => <Empty text={reason} detail="When it does, its tables and who sits at them show here." />} /></Match>
            <Match when={current() === 'forge'}><ForgeSheet snap={snap()} empty={reason => <Empty text={reason} detail="When it does, its fire, its anvils and your coals show here." />} /></Match>
            <Match when={current() === 'shelf'}><ShelfSheet snap={snap()} onUse={sku => adapter.requestProduct(sku)} /></Match>
          </Switch>
        </div>
      </section>}
    </Show>

    <nav class="cp-nav" aria-label="Panel">
      <For each={DRAWERS}>{item =>
        <button type="button" class="cp-tab" aria-pressed={drawer() === item.id || PARENT[drawer() ?? 'home'] === item.id} onClick={event => open(item.id, event.currentTarget)}>
          {item.glyph()}<span>{item.label}</span>
        </button>}
      </For>
    </nav>
  </div>;
}

function connectionMotto(connection: Connection): string {
  switch (connection.kind) {
    case 'outside-twitch': return 'Opens on Twitch';
    case 'knocking': return 'Knocking at the gate';
    case 'no-answer': return 'No answer yet';
    default: return 'Not reached yet';
  }
}

function drawerTitle(drawer: Drawer, snap: PanelSnapshot): string {
  if (drawer === 'home' && snap.home.kind === 'guest') return 'Your light here';
  if (drawer === 'tonight' && snap.stream === 'resting') return 'Last night';
  return { light: 'Light your window', home: 'Your home', tonight: 'Tonight', tavern: 'The tavern', forge: 'The forge', shelf: 'The shelf' }[drawer];
}


type Lit = Extract<Light, { kind: 'lit' }>;
type Still = Extract<Picture, { kind: 'still' }>;
type Click = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;

function PictureFrame(props: { picture: Picture; connection: Connection; ref: (element: HTMLImageElement) => void }) {
  const lost = () => props.connection.kind === 'lost' ? props.connection : null;
  return <figure class="cp-picture" classList={{ stale: !!lost() }}>
    <Show when={props.picture.kind === 'still' ? props.picture : null} fallback={<ClosedShutters connection={props.connection} />}>{still =>
      <>
        <picture>
          <Show when={still().portrait}>{portrait => <source media="(min-width: 340px) and (max-aspect-ratio: 4/5)" srcset={portrait().url} width={portrait().width} height={portrait().height} />}</Show>
          <img ref={props.ref} src={still().url} alt={still().alt} width={still().width} height={still().height} decoding="async" />
        </picture>
        <Show when={lost()}>{gone =>
          <p class="cp-stale" role="status"><strong>Out of reach</strong><span>Picture from {gone().asOf}</span></p>}
        </Show>
        <figcaption class="cp-picture-caption">{still().provenance.caption}</figcaption>
      </>}
    </Show>
  </figure>;
}

function ClosedShutters(props: { connection: Connection }) {
  const words = () => {
    switch (props.connection.kind) {
      case 'outside-twitch': return { title: 'The shutters open on Twitch', body: 'This panel lives under a channel’s video. Open it there to see the kingdom.' };
      case 'knocking': return { title: 'Knocking at the gate', body: 'Waiting for Twitch to open the panel.' };
      case 'no-answer': return { title: 'Twitch has not answered', body: 'The panel could not reach Twitch. Reload to knock again.' };
      case 'lost': return { title: 'The kingdom is out of reach', body: `Nothing has arrived since ${props.connection.asOf}.` };
      default: return { title: 'The shutters are closed', body: 'Twitch is connected, but this kingdom is not sharing its picture with the panel yet.' };
    }
  };
  return <div class="cp-closed" role="status">
    <Shutters />
    <div class="cp-notice">
      <p class="cp-notice-title">{words().title}</p>
      <p class="cp-notice-body">{words().body}</p>
      <Show when={props.connection.kind === 'no-answer'}>
        <button type="button" class="cp-inline-action" onClick={() => location.reload()}>Knock again</button>
      </Show>
      <Show when={props.connection.kind === 'outside-twitch'}>
        <a class="cp-inline-action" href="?source=simulated">See a simulated night</a>
      </Show>
    </div>
  </div>;
}

/** The words on the window plate for every state that is not a button. */
function lightNote(snap: PanelSnapshot): { title: string; detail: string; glyph: 'dark' | 'pending' | 'ember' } | null {
  const light = snap.light, simulated = snap.source.kind === 'simulated';
  switch (light.kind) {
    case 'pending': return light.step === 'sharing'
      ? { title: 'Asking Twitch who you are…', detail: simulated ? 'Simulated: Twitch’s own prompt would open here.' : 'Answer Twitch’s prompt to go on.', glyph: 'pending' }
      : { title: 'Lighting your window…', detail: 'Waiting for the kingdom to answer.', glyph: 'pending' };
    case 'logged-out': return { title: 'Log in to light your window', detail: 'On Twitch. Your window is free, always.', glyph: 'dark' };
    case 'outside-twitch': return { title: 'Your window lights from Twitch', detail: 'Open this panel under the channel’s video.', glyph: 'dark' };
    case 'out-of-reach': return { title: 'The kingdom is out of reach', detail: `Your light is unconfirmed since ${light.asOf}.`, glyph: 'ember' };
    case 'unavailable': return light.twitch === 'shared'
      ? { title: 'Twitch connected', detail: 'The kingdom has not confirmed your light. Chat still counts.', glyph: 'dark' }
      : { title: 'Your window cannot be lit from the panel yet', detail: 'Chat still counts.', glyph: 'dark' };
    default: return null;
  }
}

function LightAction(props: { snap: PanelSnapshot; kindling: boolean; ref: (element: HTMLElement) => void; onChoose: Click; onHome: Click }) {
  const light = () => props.snap.light;
  const home = () => props.snap.home;
  const homeName = () => { const h = home(); return h.kind === 'citizen' || h.kind === 'guest' ? h.displayName : null; };
  const street = () => { const h = home(); return h.kind === 'citizen' ? h.street : null; };
  const lit = () => light().kind === 'lit' ? light() as Lit : null;
  return <div class="cp-light" data-state={light().kind} ref={props.ref} tabindex="-1">
    <Switch fallback={<Show when={lightNote(props.snap)}>{note =>
      <div class="cp-light-note" role={light().kind === 'pending' ? 'status' : undefined} classList={{ ember: note().glyph === 'ember' }}>
        <WindowGlyph lit={false} pending={note().glyph === 'pending'} ember={note().glyph === 'ember'} />
        <span class="cp-light-words"><strong>{note().title}</strong><small>{note().detail}</small></span>
      </div>}
    </Show>}>
      <Match when={light().kind === 'unshared'}>
        <button type="button" class="cp-light-button" onClick={props.onChoose}>
          <WindowGlyph lit={false} />
          <span class="cp-light-words"><strong>Light your window</strong><small>With your name, or unnamed. Always free.</small></span>
        </button>
      </Match>
      <Match when={light().kind === 'refused'}>
        <button type="button" class="cp-light-button" onClick={props.onChoose}>
          <WindowGlyph lit={false} />
          <span class="cp-light-words"><strong>Light your window</strong><small>You kept who you are private. Ask again any time.</small></span>
        </button>
      </Match>
      <Match when={lit()}>{current =>
        <button type="button" class="cp-light-button lit" classList={{ kindling: props.kindling, guest: current().as === 'guest' }} onClick={props.onHome}>
          <WindowGlyph lit kindling={props.kindling} />
          <span class="cp-light-words">
            <strong>{current().as === 'guest' ? 'Your light burns here' : 'Your window is lit'}</strong>
            <small>{current().as === 'guest'
              ? `As a guest${homeName() ? ` · ${homeName()}` : ''}`
              : `${current().choice === 'named' ? homeName() ?? 'With your name' : 'Unnamed'} · ${street() ?? 'Your home'}`}</small>
          </span>
          <Show when={props.kindling}><span class="cp-kindle" aria-hidden="true"><i /><i /><i /></span></Show>
        </button>}
      </Match>
      <Match when={light().kind === 'resting'}>
        <button type="button" class="cp-light-button resting" onClick={props.onHome}>
          <WindowGlyph lit={false} ember />
          <span class="cp-light-words"><strong>Your window is resting</strong><small>It lights again with the next stream.</small></span>
        </button>
      </Match>
    </Switch>
  </div>;
}

function TonightSlip(props: { snap: PanelSnapshot }) {
  const label = () => {
    if (props.snap.connection.kind === 'lost') return `Tonight, as of ${props.snap.connection.asOf}`;
    return props.snap.stream === 'resting' ? 'Last night' : 'Tonight';
  };
  return <section class="cp-slip" aria-label={label()}>
    <p class="cp-label">{label()}</p>
    <Show when={props.snap.tonight.kind === 'supplied' ? props.snap.tonight : null} fallback={<p class="cp-slip-text muted">{(props.snap.tonight as { reason: string }).reason} Chat still counts on stream.</p>}>
      {tonight => <>
        <p class="cp-slip-text">{tonight().summary}</p>
        <ol class="cp-moments cp-slip-more" aria-label="Moments">
          <For each={tonight().moments.slice(-3)}>{moment => <li><time>{moment.at}</time><span>{moment.text}</span></li>}</For>
        </ol>
      </>}
    </Show>
  </section>;
}

function LightChoiceSheet(props: { snap: PanelSnapshot; onChoose: (choice: LightChoice) => void }) {
  const simulated = () => props.snap.source.kind === 'simulated';
  return <div class="cp-sheet">
    <p class="cp-lede">Your window in {props.snap.kingdom?.name ?? 'the kingdom'} lights while you watch, as if you had spoken in chat.</p>
    <div class="cp-choices">
      <button type="button" class="cp-choice" onClick={() => props.onChoose('named')}>
        <WindowGlyph lit />
        <span><strong>With my name</strong><small>Your name shows by your window up close.</small></span>
      </button>
      <button type="button" class="cp-choice" onClick={() => props.onChoose('unnamed')}>
        <WindowGlyph lit />
        <span><strong>Mine, but unnamed</strong><small>It counts for you. The town sees an unnamed light.</small></span>
      </button>
    </div>
    <p class="cp-fine">{simulated()
      ? 'Simulated: Twitch is not asked and nothing is sent to a kingdom.'
      : 'Twitch asks you to share who you are with Chatdom first.'}</p>
  </div>;
}

function windowWords(snap: PanelSnapshot): string {
  const light = snap.light;
  switch (light.kind) {
    case 'lit': return 'Lit while you watch';
    case 'resting': return 'Resting until the next stream';
    case 'out-of-reach': return `Unconfirmed since ${light.asOf}`;
    case 'pending': return 'Being lit';
    default: return 'Dark until you light it';
  }
}

function HomeSheet(props: { snap: PanelSnapshot; onLight: Click }) {
  const home = () => props.snap.home;
  const citizen = () => home().kind === 'citizen' ? home() as Extract<Home, { kind: 'citizen' }> : null;
  const guest = () => home().kind === 'guest' ? home() as Extract<Home, { kind: 'guest' }> : null;
  const canLight = () => props.snap.light.kind === 'unshared' || props.snap.light.kind === 'refused';
  return <Switch fallback={
    <Empty text={(home() as { reason: string }).reason} detail={canLight() ? 'Chat still counts: speaking in chat lights your window on stream.' : undefined}>
      <Show when={canLight()}><button type="button" class="cp-inline-action" onClick={props.onLight}>Light your window</button></Show>
    </Empty>}>
    <Match when={citizen()}>{h =>
      <div class="cp-sheet">
        <Show when={h().picture.kind === 'still' ? h().picture as Still : null}>{still =>
          <figure class="cp-home-picture" classList={{ dim: props.snap.light.kind !== 'lit' }}>
            <img src={still().url} alt={still().alt} width={still().width} height={still().height} />
            <figcaption class="cp-picture-caption">{still().provenance.caption}</figcaption>
          </figure>}
        </Show>
        <div class="cp-plaque">
          <span class="cp-rivet" aria-hidden="true" /><span class="cp-rivet" aria-hidden="true" />
          <p class="cp-plaque-name" classList={{ long: (h().displayName ?? '').length > 16 }}>{h().displayName ?? 'Your home'}</p>
          <p class="cp-plaque-street">{h().street}</p>
        </div>
        <p class="cp-place">{h().place}</p>
        <dl class="cp-ledger">
          <div><dt>Window</dt><dd>{windowWords(props.snap)}</dd></div>
          <div><dt>Name</dt><dd>{h().displayName ? 'Shown by your window' : 'Unnamed to the town'}</dd></div>
          <div><dt>Lived here</dt><dd classList={{ muted: h().tenure.kind === 'unknown' }}>{h().tenure.kind === 'known' ? `Since ${(h().tenure as { since: string }).since}` : 'Not known yet'}</dd></div>
        </dl>
        <p class="cp-body">{h().description}</p>
        <History items={h().history} label="Earned here" />
      </div>}
    </Match>
    <Match when={guest()}>{g =>
      <div class="cp-sheet">
        <div class="cp-plaque guest">
          <span class="cp-rivet" aria-hidden="true" /><span class="cp-rivet" aria-hidden="true" />
          <p class="cp-plaque-name">{g().displayName ?? 'A guest’s light'}</p>
          <p class="cp-plaque-street">A guest in {props.snap.kingdom?.name ?? 'this kingdom'}</p>
        </div>
        <p class="cp-body">You already keep three homes, so here your light burns as a guest’s. Your presence still counts.</p>
        <p class="cp-body muted">What you do here is kept. If you ever free a place, your history will be waiting.</p>
        <History items={g().history} label="Kept here" />
      </div>}
    </Match>
  </Switch>;
}

function History(props: { items: readonly Earned[]; label: string }) {
  return <Show when={props.items.length > 0}>
    <section class="cp-history" aria-label={props.label}>
      <p class="cp-label">{props.label}</p>
      <ul>
        <For each={props.items}>{item => <li><span>{item.text}</span><Show when={item.at}>{at => <time>{at()}</time>}</Show></li>}</For>
      </ul>
    </section>
  </Show>;
}

function TonightSheet(props: { snap: PanelSnapshot; onShelf: Click }) {
  return <Show when={props.snap.tonight.kind === 'supplied' ? props.snap.tonight : null} fallback={<Empty text={(props.snap.tonight as { reason: string }).reason} />}>{tonight =>
    <div class="cp-sheet">
      <Show when={tonight().chapter}>{chapter =>
        <header class="cp-chapter"><p class="cp-label">{tonight().night === 'last-night' ? 'Last night’s chapter' : 'Tonight’s chapter'}</p><p class="cp-chapter-title">{chapter()}</p></header>}
      </Show>
      <Show when={tonight().ballad}>{ballad =>
        <figure class="cp-ballad">
          <figcaption><span class="cp-ballad-title">{ballad().title}</span><span class="cp-ballad-sung">{ballad().sung}</span></figcaption>
          <blockquote><For each={ballad().lines}>{line => <p>{line}</p>}</For></blockquote>
        </figure>}
      </Show>
      <Show when={tonight().ballad}><p class="cp-label">The night’s moments</p></Show>
      <ol class="cp-moments">
        <For each={tonight().moments}>{moment => <li><time>{moment.at}</time><span>{moment.text}</span></li>}</For>
      </ol>
      <Show when={tonight().raising}>{raising => <RaisingMeter raising={raising()} />}</Show>
      <Show when={props.snap.shelf.kind === 'offered'}>
        <button type="button" class="cp-signpost" data-opens="shelf" onClick={props.onShelf}>
          <span><strong>The shelf</strong><small>Moments for the whole kingdom, with Bits</small></span>
          <BackGlyph />
        </button>
      </Show>
    </div>}
  </Show>;
}

function Empty(props: { text: string; detail?: string | undefined; children?: JSX.Element }) {
  return <div class="cp-sheet cp-empty">
    <WindowGlyph lit={false} />
    <p class="cp-body">{props.text}</p>
    {props.children}
    <p class="cp-body muted">{props.detail ?? 'Chat still counts: speaking in chat lights your window on stream.'}</p>
  </div>;
}
