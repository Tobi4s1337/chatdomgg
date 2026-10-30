// The Chatdom panel: the kingdom under the video. A warm picture, your own window,
// a little of tonight, and one drawer at a time. It is a window into belonging,
// never a second game client.
import { createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { selectAdapter } from './adapters/select';
import type { Connection, LightChoice, PanelAdapter, PanelSnapshot, Picture } from './model';
import { BackGlyph, HomeGlyph, PanelDefs, Seal, Shutters, TavernGlyph, TonightGlyph, WindowGlyph } from './ui/art';
import './panel.css';

type Drawer = 'home' | 'tonight' | 'tavern' | 'light';
type ReadyWindow = Window & { __chatdomReady?: boolean };

const DRAWERS: readonly { id: Exclude<Drawer, 'light'>; label: string; glyph: () => JSX.Element }[] = [
  { id: 'home', label: 'Home', glyph: HomeGlyph },
  { id: 'tonight', label: 'Tonight', glyph: TonightGlyph },
  { id: 'tavern', label: 'Tavern', glyph: TavernGlyph },
];

export default function Panel(props: { adapter?: PanelAdapter }) {
  const adapter = props.adapter ?? selectAdapter();
  const [snap, setSnap] = createSignal<PanelSnapshot>(adapter.get());
  const [drawer, setDrawer] = createSignal<Drawer | null>(null);
  const [ready, setReady] = createSignal(false);
  const unsubscribe = adapter.subscribe(setSnap);
  let opener: HTMLElement | null = null, drawerEl: HTMLElement | undefined, lightEl: HTMLElement | undefined, pictureEl: HTMLImageElement | undefined, disposed = false;

  const open = (next: Drawer, from: EventTarget | null) => {
    opener = from instanceof HTMLElement ? from : null;
    setDrawer(current => current === next ? null : next);
    queueMicrotask(() => drawerEl?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
  };
  const close = () => {
    setDrawer(null);
    const back = opener;
    opener = null;
    // A chosen light replaces the button that opened the drawer; focus then rests on the window's status.
    queueMicrotask(() => (back?.isConnected ? back : lightEl)?.focus());
  };
  const choose = (choice: LightChoice) => { adapter.requestLight(choice); close(); };
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
    unsubscribe();
    adapter.dispose();
    window.removeEventListener('keydown', onKey);
    document.documentElement.classList.remove('cp-document');
    (window as ReadyWindow).__chatdomReady = false;
  });

  const kingdomName = () => snap().kingdom?.name ?? 'The kingdom';
  const motto = () => snap().kingdom?.motto ?? connectionMotto(snap().connection);

  return <div class="cp" data-chatdom-panel data-source={snap().source.kind} data-connection={snap().connection.kind}
    data-light={snap().light.kind} data-drawer={drawer() ?? 'none'} data-ready={ready() ? 'true' : 'false'}
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
      <LightAction snap={snap()} ref={element => { lightEl = element; }} onChoose={event => open('light', event.currentTarget)} onHome={event => open('home', event.currentTarget)} />
      <TonightSlip snap={snap()} />
    </main>

    <Show when={drawer()}>{current =>
      <section class="cp-drawer" ref={element => { drawerEl = element; }} role="dialog" aria-modal="false" aria-labelledby="cp-drawer-title" data-drawer={current()}>
        <div class="cp-drawer-head">
          <button class="cp-back" type="button" onClick={close} data-autofocus><BackGlyph /><span>The kingdom</span></button>
          <h2 id="cp-drawer-title" class="cp-drawer-title">{drawerTitle(current())}</h2>
        </div>
        <div class="cp-drawer-page" tabindex="-1">
          <Switch>
            <Match when={current() === 'light'}><LightChoiceSheet snap={snap()} onChoose={choose} /></Match>
            <Match when={current() === 'home'}><HomeSheet snap={snap()} /></Match>
            <Match when={current() === 'tonight'}><TonightSheet snap={snap()} /></Match>
            <Match when={current() === 'tavern'}><TavernSheet snap={snap()} /></Match>
          </Switch>
        </div>
      </section>}
    </Show>

    <nav class="cp-nav" aria-label="Panel">
      <For each={DRAWERS}>{item =>
        <button type="button" class="cp-tab" aria-pressed={drawer() === item.id} onClick={event => open(item.id, event.currentTarget)}>
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
    default: return 'Not shared yet';
  }
}

function drawerTitle(drawer: Drawer): string {
  return { light: 'Light your window', home: 'Your home', tonight: 'Tonight', tavern: 'The tavern' }[drawer];
}

function PictureFrame(props: { picture: Picture; connection: Connection; ref: (element: HTMLImageElement) => void }) {
  return <figure class="cp-picture">
    <Show when={props.picture.kind === 'still' ? props.picture : null} fallback={<ClosedShutters connection={props.connection} />}>{still =>
      <>
        <picture>
          <Show when={still().portrait}>{portrait => <source media="(min-width: 340px) and (max-aspect-ratio: 4/5)" srcset={portrait().url} width={portrait().width} height={portrait().height} />}</Show>
          <img ref={props.ref} src={still().url} alt={still().alt} width={still().width} height={still().height} decoding="async" />
        </picture>
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

function LightAction(props: { snap: PanelSnapshot; ref: (element: HTMLElement) => void; onChoose: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void; onHome: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void }) {
  const light = () => props.snap.light;
  const home = () => props.snap.home.kind === 'supplied' ? props.snap.home : null;
  return <div class="cp-light" data-state={light().kind} ref={props.ref} tabindex="-1">
    <Switch>
      <Match when={light().kind === 'unshared'}>
        <button type="button" class="cp-light-button" onClick={props.onChoose}>
          <WindowGlyph lit={false} />
          <span class="cp-light-words"><strong>Light your window</strong><small>With your name, or unnamed. Always free.</small></span>
        </button>
      </Match>
      <Match when={light().kind === 'pending'}>
        <div class="cp-light-note" role="status">
          <WindowGlyph lit={false} pending />
          <span class="cp-light-words"><strong>Lighting your window…</strong><small>Waiting for the kingdom to answer.</small></span>
        </div>
      </Match>
      <Match when={light().kind === 'lit' ? light() as Extract<PanelSnapshot['light'], { kind: 'lit' }> : null}>{lit =>
        <button type="button" class="cp-light-button lit" onClick={props.onHome}>
          <WindowGlyph lit />
          <span class="cp-light-words">
            <strong>Your window is lit</strong>
            <small>{lit().choice === 'named' ? home()?.displayName ?? 'With your name' : 'Unnamed'} · {home()?.street ?? 'Home'}</small>
          </span>
        </button>}
      </Match>
      <Match when={light().kind === 'logged-out'}>
        <div class="cp-light-note">
          <WindowGlyph lit={false} />
          <span class="cp-light-words"><strong>Log in to Twitch to light your window</strong><small>Your window is free, and always will be.</small></span>
        </div>
      </Match>
      <Match when={light().kind === 'outside-twitch'}>
        <div class="cp-light-note">
          <WindowGlyph lit={false} />
          <span class="cp-light-words"><strong>Your window lights from Twitch</strong><small>Open this panel under the channel’s video.</small></span>
        </div>
      </Match>
      <Match when={light().kind === 'unavailable'}>
        <div class="cp-light-note">
          <WindowGlyph lit={false} />
          <span class="cp-light-words"><strong>Your window cannot be lit from the panel yet</strong><small>Chat still counts.</small></span>
        </div>
      </Match>
    </Switch>
  </div>;
}

function TonightSlip(props: { snap: PanelSnapshot }) {
  return <section class="cp-slip" aria-label="Tonight">
    <p class="cp-label">{props.snap.stream === 'resting' ? 'Last night' : 'Tonight'}</p>
    <Show when={props.snap.tonight.kind === 'supplied' ? props.snap.tonight : null} fallback={<p class="cp-slip-text muted">{(props.snap.tonight as { reason: string }).reason} Chat still counts on stream.</p>}>
      {tonight => <>
        <p class="cp-slip-text">{tonight().summary}</p>
        <ol class="cp-moments cp-slip-more" aria-label="Tonight’s moments">
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
      ? 'Simulated: nothing is shared with Twitch or sent to a kingdom.'
      : 'Twitch will ask to share your identity with Chatdom first.'}</p>
  </div>;
}

function HomeSheet(props: { snap: PanelSnapshot }) {
  return <Show when={props.snap.home.kind === 'supplied' ? props.snap.home : null} fallback={<Empty text={(props.snap.home as { reason: string }).reason} />}>{home =>
    <div class="cp-sheet">
      <Show when={home().picture.kind === 'still' ? home().picture as Extract<Picture, { kind: 'still' }> : null}>{still =>
        <figure class="cp-home-picture"><img src={still().url} alt={still().alt} width={still().width} height={still().height} /><figcaption class="cp-picture-caption">{still().provenance.caption}</figcaption></figure>}
      </Show>
      <div class="cp-plaque">
        <p class="cp-plaque-name">{props.snap.light.kind === 'lit' && props.snap.light.choice === 'unnamed' ? 'An unnamed window' : home().displayName ?? 'Your home'}</p>
        <p class="cp-plaque-street">{home().street}</p>
      </div>
      <p class="cp-body">{home().description}</p>
      <p class="cp-body muted">{props.snap.light.kind === 'lit' ? 'Your window is lit for as long as you are here.' : 'Your window is dark until you light it.'}</p>
    </div>}
  </Show>;
}

function TonightSheet(props: { snap: PanelSnapshot }) {
  return <Show when={props.snap.tonight.kind === 'supplied' ? props.snap.tonight : null} fallback={<Empty text={(props.snap.tonight as { reason: string }).reason} />}>{tonight =>
    <div class="cp-sheet">
      <ol class="cp-moments">
        <For each={tonight().moments}>{moment => <li><time>{moment.at}</time><span>{moment.text}</span></li>}</For>
      </ol>
      <Show when={tonight().raising}>{raising =>
        <div class="cp-raising">
          <p class="cp-label">Raised together</p>
          <p class="cp-body"><strong>{raising().building}</strong> · {Math.round(raising().progress * 100)}% raised</p>
          <div class="cp-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(raising().progress * 100)} aria-label={`${raising().building} raised`}><i style={{ width: `${raising().progress * 100}%` }} /></div>
          <p class="cp-body muted">{raising().next}</p>
        </div>}
      </Show>
    </div>}
  </Show>;
}

function TavernSheet(props: { snap: PanelSnapshot }) {
  return <Show when={props.snap.tavern.kind === 'supplied' ? props.snap.tavern : null} fallback={<Empty text={(props.snap.tavern as { reason: string }).reason} />}>{tavern =>
    <div class="cp-sheet">
      <div class="cp-plaque"><p class="cp-plaque-name">{tavern().place}</p><p class="cp-plaque-street">{tavern().table}</p></div>
      <p class="cp-body">{tavern().watching}</p>
      <p class="cp-body muted">You can follow the table from here. Seats are taken inside the kingdom.</p>
    </div>}
  </Show>;
}

function Empty(props: { text: string }) {
  return <div class="cp-sheet cp-empty">
    <WindowGlyph lit={false} />
    <p class="cp-body">{props.text}</p>
    <p class="cp-body muted">Chat still counts: speaking in chat lights your window on stream.</p>
  </div>;
}
