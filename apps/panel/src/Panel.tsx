// The Chatdom panel: the kingdom under the video. A warm picture, your own window,
// a little of tonight, and one drawer at a time. It is a window into belonging,
// never a second game client.
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { createPassportReading, type PassportReadState } from '@chatdom/ui/passport';
import { Dynamic } from 'solid-js/web';
import { selectAdapter } from './adapters/select';
import { CardSheet, PassportCorner } from './card/CardSheet';
import type { CardPortrait, CitizenCard, Connection, Earned, Home, Light, LightChoice, PanelAdapter, PanelSnapshot, PassportSource, Picture } from './model';
import { PanelPassport } from './passport/PanelPassport';
import { createPanelSound, type PanelCue } from './sound';
import { ActSlip } from './ui/act';
import { BackGlyph, BellGlyph, ForgeGlyph, HomeGlyph, PanelDefs, Seal, Shutters, TavernGlyph, TonightGlyph, WindowGlyph } from './ui/art';
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
/** How long the card page takes to lift away from the passport, and to be laid back over it. */
const TURN_MS = 560, RETURN_MS = 520;
/** A finger drawn this far to the left across the card turns the page. */
const SWIPE_PX = 44;

/** Turning to the passport: the card page lifts away, the book lies open, and the page is laid back. */
type Book = 'shut' | 'opening' | 'open' | 'closing';
type Readable = Extract<PassportSource, { kind: 'readable' }>;

/** The viewer's card and passport, when the home card authority supplied a card. */
function cardOf(home: Home): { card: CitizenCard; passport: PassportSource } | null {
  return (home.kind === 'citizen' || home.kind === 'guest') && home.card ? { card: home.card, passport: home.passport } : null;
}

const DRAWERS: readonly { id: Exclude<Drawer, 'light' | 'shelf'>; label: string; glyph: () => JSX.Element }[] = [
  { id: 'home', label: 'Home', glyph: HomeGlyph },
  { id: 'tonight', label: 'Tonight', glyph: TonightGlyph },
  { id: 'tavern', label: 'Tavern', glyph: TavernGlyph },
  { id: 'forge', label: 'Forge', glyph: ForgeGlyph },
];

/**
 * The sound an adapter's answer makes, if the viewer's own gesture led to it. Waiting ticks,
 * a refusal or a closed window knocks dully, and only a confirmed light or a counted tap rings.
 */
function answerCue(before: PanelSnapshot, after: PanelSnapshot): PanelCue | null {
  const was = before.light, now = after.light;
  if (now.kind === 'lit' && was.kind === 'pending') return 'kindle';
  if (now.kind === 'pending' && (was.kind !== 'pending' || was.step !== now.step)) return 'pending';
  if (was.kind === 'pending' && now.kind !== 'pending') return 'dull';
  const actWas = before.act?.status.kind, actNow = after.act?.status.kind;
  if (actNow && actNow !== actWas) {
    if (actNow === 'accepted') return 'counted';
    if (actNow === 'limited') return 'dull';
  }
  const askedWas = before.shelf.kind === 'offered' ? before.shelf.request.kind : 'idle';
  const askedNow = after.shelf.kind === 'offered' ? after.shelf.request.kind : 'idle';
  if (askedNow !== askedWas) return askedNow === 'confirming' ? 'pending' : askedNow === 'cancelled' ? 'dull' : null;
  return null;
}

/**
 * `embedded` mounts the panel inside another page (the streamer's preview): it then sizes to
 * its own frame and leaves the page's scrolling, keys and readiness alone.
 */
export default function Panel(props: { adapter?: PanelAdapter; embedded?: boolean; onReady?: () => void }) {
  const adapter = props.adapter ?? selectAdapter();
  const embedded = props.embedded === true;
  const sound = createPanelSound();
  const [muted, setMuted] = createSignal(sound.muted());
  onCleanup(sound.subscribe(setMuted));
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
    const cue = answerCue(snap(), next);
    if (cue) sound.play(cue);
    setSnap(next);
  });
  let frameEl: HTMLDivElement | undefined, drawerEl: HTMLElement | undefined, lightEl: HTMLElement | undefined, actEl: HTMLElement | undefined, pictureEl: HTMLImageElement | undefined, disposed = false;
  // Who opened each drawer, so Back returns focus there. A nested drawer keeps its parent's opener.
  const openers = new Map<Drawer, HTMLElement | null>();

  // The passport under the card. It is read once the card has been opened (the card shows the keepsakes it carries),
  // through one reading for as long as the same source stands, shared by the card and the turned-to book.
  const [book, setBook] = createSignal<Book>('shut');
  const [cardSeen, setCardSeen] = createSignal(false);
  let bookTimer: ReturnType<typeof setTimeout> | undefined, cornerEl: HTMLButtonElement | undefined;
  const readable = createMemo<Readable | null>(() => {
    const passport = cardOf(snap().home)?.passport;
    return passport?.kind === 'readable' ? passport : null;
  }, null, { equals: (a, b) => a?.transport === b?.transport });
  const reading = createMemo(() => {
    const source = readable();
    if (!source || !cardSeen()) return null;
    return createPassportReading(source.transport, source.disclosure ? { disclosure: () => readable()?.disclosure ?? undefined } : {});
  });
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const focusBook = () => queueMicrotask(() => frameEl?.querySelector<HTMLElement>('.cp-book-layer [data-autofocus]')?.focus());
  const openBook = () => {
    if (book() !== 'shut' || !reading()) return;
    clearTimeout(bookTimer);
    sound.play('leaf');
    if (reduced()) { setBook('open'); focusBook(); return; }
    setBook('opening');
    bookTimer = setTimeout(() => { setBook('open'); focusBook(); }, TURN_MS);
  };
  const closeBook = () => {
    if (book() !== 'open') return;
    clearTimeout(bookTimer);
    sound.play('leaf');
    const back = () => { setBook('shut'); queueMicrotask(() => cornerEl?.focus()); };
    if (reduced()) { back(); return; }
    setBook('closing');
    bookTimer = setTimeout(back, RETURN_MS);
  };
  // The book's own turns: the cover opening or shutting sounds like hide and board, every other leaf like paper.
  const onBookTurn = (turn: { dir: 'next' | 'prev'; view: number }) => sound.play(turn.view === 0 || (turn.view === 1 && turn.dir === 'next') ? 'cover' : 'leaf');
  // A finger drawn to the left across the card turns to the passport, as a leaf would turn.
  let swipe: { x: number; y: number; id: number } | null = null;
  const onCardDown = (event: PointerEvent) => { if (event.pointerType !== 'mouse') swipe = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
  const onCardUp = (event: PointerEvent) => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null;
    if (dx < -SWIPE_PX && Math.abs(dy) < Math.abs(dx) * 0.6) openBook();
  };

  const open = (next: Drawer, from: EventTarget | null) => {
    if (next === 'home') setCardSeen(true);
    if (drawer() !== PARENT[next]) openers.clear();
    openers.set(next, from instanceof HTMLElement ? from : null);
    sound.play('page');
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
    if (current) sound.play('page');
    setDrawer(parent ?? null);
    const page = drawerEl?.querySelector<HTMLElement>('.cp-drawer-page');
    if (page) page.scrollTop = 0;
    // A chosen light replaces the button that opened the drawer; focus then rests on the window's status.
    // The parent drawer redraws its page, so its signpost is found again by what it opens.
    queueMicrotask(() => (back?.isConnected ? back
      : parent ? drawerEl?.querySelector<HTMLElement>(`[data-opens="${current}"]`) ?? drawerEl?.querySelector<HTMLElement>('[data-autofocus]')
      : lightEl)?.focus());
  };
  const choose = (choice: LightChoice) => { sound.play('tap'); adapter.requestLight(choice); close(); };
  // The tapped button gives way to the kingdom's answer; focus waits on the act, where the answer is read out.
  const act = (option: string) => { sound.play('tap'); adapter.requestAct(option); queueMicrotask(() => actEl?.focus()); };
  const useProduct = (sku: string) => { sound.play('tap'); adapter.requestProduct(sku); };
  const toggleSound = () => {
    const next = !muted();
    sound.setMuted(next);
    // Turning sound on is itself a gesture: answer it with the press, so the choice is heard.
    if (!next) { sound.gesture(); sound.play('tap'); }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // The open book lays the card back over itself, wherever focus sits (a leaf that turned away takes focus with it);
    // while a page is turning, Escape waits for it to land.
    if (book() !== 'shut') { event.preventDefault(); if (book() === 'open') closeBook(); return; }
    if (drawer()) { event.preventDefault(); close(); }
  };
  // Only a gesture inside the panel may wake its sound. Captured first, so the press that wakes it is heard.
  const onGesture = () => sound.gesture();

  // The streamer's sections can change while a drawer is open; a drawer that is no longer offered closes.
  createEffect(() => {
    const current = drawer(), now = snap();
    if (current === 'shelf' && now.shelf.kind !== 'offered') setDrawer(now.sections.night ? 'tonight' : null);
    else if ((current === 'home' && !now.sections.home) || (current === 'tonight' && !now.sections.night)) setDrawer(null);
  });
  // The book belongs to the card: if the card goes (its drawer closed, the streamer hid it, the card withdrawn), so does the book.
  createEffect(() => {
    if (book() !== 'shut' && (drawer() !== 'home' || !reading())) { clearTimeout(bookTimer); setBook('shut'); }
  });
  const tabs = () => DRAWERS.filter(item => item.id === 'home' ? snap().sections.home : item.id === 'tonight' ? snap().sections.night : true);

  onMount(() => {
    const testWindow = window as ReadyWindow;
    if (!embedded) {
      testWindow.__chatdomReady = false;
      document.documentElement.classList.add('cp-document');
    }
    (embedded ? frameEl! : window).addEventListener('keydown', onKey as EventListener);
    for (const type of ['pointerdown', 'keydown', 'click']) frameEl!.addEventListener(type, onGesture, true);
    // Ready means the first view is really drawn: faces loaded and the picture decoded,
    // or a settled connection state. A knock still waiting for Twitch is not ready.
    const settle = async () => {
      await document.fonts.ready;
      if (snap().picture.kind === 'still' && pictureEl) await pictureEl.decode().catch(() => undefined);
      if (disposed) return;
      if (snap().connection.kind === 'knocking') return;
      setReady(true);
      requestAnimationFrame(() => {
        if (disposed) return;
        if (embedded) props.onReady?.();
        else testWindow.__chatdomReady = true;
      });
    };
    void settle();
    onCleanup(adapter.subscribe(next => { if (!ready() && next.connection.kind !== 'knocking') void settle(); }));
  });
  onCleanup(() => {
    disposed = true;
    clearTimeout(kindleTimer);
    clearTimeout(bookTimer);
    unsubscribe();
    adapter.dispose();
    sound.dispose();
    (embedded ? frameEl : window)?.removeEventListener('keydown', onKey as EventListener);
    for (const type of ['pointerdown', 'keydown', 'click']) frameEl?.removeEventListener(type, onGesture, true);
    if (!embedded) {
      document.documentElement.classList.remove('cp-document');
      (window as ReadyWindow).__chatdomReady = false;
    }
  });

  const kingdomName = () => snap().kingdom?.name ?? 'The kingdom';
  const motto = () => snap().kingdom?.motto ?? connectionMotto(snap().connection);

  return <div class="cp-frame" classList={{ embedded }} ref={element => { frameEl = element; }}><div class="cp" data-chatdom-panel data-source={snap().source.kind} data-connection={snap().connection.kind}
    data-light={snap().light.kind} data-stream={snap().stream} data-home={snap().home.kind} data-drawer={drawer() ?? 'none'} data-ready={ready() ? 'true' : 'false'}
    data-view={snap().picture.kind === 'still' ? 'kingdom' : 'connection'} data-muted={muted() ? 'true' : 'false'}
    data-act={snap().act?.status.kind ?? 'none'} data-shelf={snap().shelf.kind} data-book={book()}>
    <PanelDefs />
    <header class="cp-head">
      <Seal blank={!snap().kingdom} />
      <div class="cp-title" classList={{ long: kingdomName().length > 15, longer: kingdomName().length > 26 }}>
        <h1 class="cp-name" title={kingdomName().length > 26 ? kingdomName() : undefined}>{kingdomName()}</h1>
        <p class="cp-motto">{motto()}</p>
      </div>
      <Show when={snap().source.kind === 'simulated'} fallback={<span class="cp-tag quiet">{snap().connection.kind === 'knocking' ? 'Connecting' : 'Not connected'}</span>}>
        <span class="cp-tag simulated" title={snap().source.kind === 'simulated' ? (snap().source as { detail: string }).detail : undefined}>Simulated</span>
      </Show>
      <button type="button" class="cp-sound" aria-label="Panel sounds" aria-pressed={!muted()} title={muted() ? 'Sounds off: tap to hear the panel' : 'Sounds on: tap to silence the panel'} onClick={toggleSound}>
        <BellGlyph muted={muted()} />
      </button>
    </header>

    <main class="cp-main" aria-hidden={drawer() || book() !== 'shut' ? 'true' : undefined} inert={drawer() || book() !== 'shut' ? true : undefined}>
      <PictureFrame picture={snap().picture} connection={snap().connection} embedded={embedded} ref={element => { pictureEl = element; }} />
      <LightAction snap={snap()} kindling={kindling()} portrait={cardOf(snap().home)?.card.portrait ?? null} ref={element => { lightEl = element; }} onChoose={event => open('light', event.currentTarget)}
        onHome={snap().sections.home ? event => open('home', event.currentTarget) : null} />
      <Show when={snap().act} fallback={<Show when={snap().sections.night}><TonightSlip snap={snap()} /></Show>}>{current =>
        <div class="cp-act-wrap" ref={element => { actEl = element; }} tabindex="-1">
          <ActSlip snap={snap()} act={current()} onAct={act} onLight={event => open('light', event.currentTarget)} />
        </div>}
      </Show>
    </main>

    <Show when={book() !== 'open' ? drawer() : null}>{current =>
      <section class="cp-drawer" ref={element => { drawerEl = element; }} role="dialog" aria-modal="false" aria-labelledby="cp-drawer-title" data-drawer={current()}
        data-card={current() === 'home' && cardOf(snap().home) ? 'true' : undefined} data-book={book() === 'shut' ? undefined : book()}
        inert={book() !== 'shut' ? true : undefined}
        on:pointerdown={event => { if (current() === 'home') onCardDown(event); }} on:pointerup={event => { if (current() === 'home') onCardUp(event); }}>
        <div class="cp-drawer-head">
          <button class="cp-back" type="button" onClick={close} data-autofocus><BackGlyph /><span>{PARENT[current()] === 'tonight' ? 'Tonight' : 'The kingdom'}</span></button>
          <h2 id="cp-drawer-title" class="cp-drawer-title">{drawerTitle(current(), snap())}</h2>
        </div>
        <div class="cp-drawer-page" tabindex="-1">
          <Switch>
            <Match when={current() === 'light'}><LightChoiceSheet snap={snap()} onChoose={choose} /></Match>
            <Match when={current() === 'home'}><HomeSheet snap={snap()} passport={reading()?.state() ?? null} onLight={event => open('light', event.currentTarget)} /></Match>
            <Match when={current() === 'tonight'}><TonightSheet snap={snap()} onShelf={event => open('shelf', event.currentTarget)} /></Match>
            <Match when={current() === 'tavern'}><TavernSheet snap={snap()} empty={reason => <Empty text={reason} detail="When it does, its tables and who sits at them show here." />} /></Match>
            <Match when={current() === 'forge'}><ForgeSheet snap={snap()} empty={reason => <Empty text={reason} detail="When it does, its fire, its anvils and your coals show here." />} /></Match>
            <Match when={current() === 'shelf'}><ShelfSheet snap={snap()} onUse={useProduct} /></Match>
          </Switch>
        </div>
        <Show when={current() === 'home' && reading()}>
          <PassportCorner ref={element => { cornerEl = element; }} private={reading()?.state().kind === 'hidden'} onTurn={() => openBook()} />
        </Show>
      </section>}
    </Show>

    <Show when={book() !== 'shut' ? readable() : null}>{source =>
      <div class="cp-book-layer" data-book={book()} inert={book() !== 'open' ? true : undefined}>
        <PanelPassport transport={source().transport} places={source().places} simulated={source().simulated}
          {...(reading() ? { reading: reading()! } : {})} onClose={closeBook} backLabel="Your card" onTurn={onBookTurn} />
      </div>}
    </Show>

    <nav class="cp-nav" aria-label="Panel" style={{ '--tabs': tabs().length }}>
      <For each={tabs()}>{item =>
        <button type="button" class="cp-tab" aria-pressed={drawer() === item.id || PARENT[drawer() ?? 'home'] === item.id} onClick={event => open(item.id, event.currentTarget)}>
          {item.glyph()}<span>{item.label}</span>
        </button>}
      </For>
    </nav>
  </div></div>;
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
  if (drawer === 'home' && cardOf(snap.home)) return 'Your card';
  if (drawer === 'home' && snap.home.kind === 'guest') return 'Your light here';
  if (drawer === 'tonight' && snap.stream === 'resting') return 'Last night';
  return { light: 'Light your window', home: 'Your home', tonight: 'Tonight', tavern: 'The tavern', forge: 'The forge', shelf: 'The shelf' }[drawer];
}


type Lit = Extract<Light, { kind: 'lit' }>;
type Still = Extract<Picture, { kind: 'still' }>;
type Click = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;

function PictureFrame(props: { picture: Picture; connection: Connection; embedded: boolean; ref: (element: HTMLImageElement) => void }) {
  const lost = () => props.connection.kind === 'lost' ? props.connection : null;
  // A picture that does not arrive closes the shutters with a way to ask again; it is never left as a broken image.
  const [failed, setFailed] = createSignal(false);
  const [attempt, setAttempt] = createSignal(0);
  const again = (url: string) => attempt() ? `${url}${url.includes('?') ? '&' : '?'}again=${attempt()}` : url;
  const shown = () => props.picture.kind === 'still' && !failed() ? props.picture : null;
  return <figure class="cp-picture" classList={{ stale: !!lost() }} data-picture={failed() ? 'failed' : props.picture.kind === 'still' ? 'shown' : 'none'}>
    <Show when={shown()} fallback={failed()
      ? <Shut title="The picture did not arrive" body="Your window and tonight are still here. The picture may come on a second knock.">
        <button type="button" class="cp-inline-action" onClick={() => { setAttempt(n => n + 1); setFailed(false); }}>Try again</button>
      </Shut>
      : <ClosedShutters connection={props.connection} />}>{still =>
      <>
        <picture>
          {/* A preview inside a wider page is the 318 px panel, whatever the page's width: it keeps the landscape still. */}
          <Show when={props.embedded ? null : still().portrait}>{portrait => <source media="(min-width: 340px) and (max-aspect-ratio: 4/5)" srcset={again(portrait().url)} width={portrait().width} height={portrait().height} />}</Show>
          <img ref={props.ref} src={again(still().url)} alt={still().alt} width={still().width} height={still().height} decoding="async" onError={() => setFailed(true)} />
        </picture>
        <Show when={lost()}>{gone =>
          <p class="cp-stale" role="status"><strong>Out of reach</strong><span>Picture from {gone().asOf}</span></p>}
        </Show>
        <figcaption class="cp-picture-caption">{still().provenance.caption}</figcaption>
      </>}
    </Show>
  </figure>;
}

function Shut(props: { title: string; body: string; children?: JSX.Element }) {
  return <div class="cp-closed" role="status">
    <Shutters />
    <div class="cp-notice">
      <p class="cp-notice-title">{props.title}</p>
      <p class="cp-notice-body">{props.body}</p>
      {props.children}
    </div>
  </div>;
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
  return <Shut title={words().title} body={words().body}>
    <Show when={props.connection.kind === 'no-answer'}>
      <button type="button" class="cp-inline-action" onClick={() => location.reload()}>Knock again</button>
    </Show>
    <Show when={props.connection.kind === 'outside-twitch'}>
      <a class="cp-inline-action" href="?source=simulated">See a simulated night</a>
    </Show>
  </Shut>;
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

/** The lit or resting plate opens the home card; when the streamer hides that card, the plate is words only. */
function Plate(props: { class: string; classList?: Record<string, boolean>; onHome: Click | null; portrait: CardPortrait | null; children: JSX.Element }) {
  return <Dynamic component={props.onHome ? 'button' : 'div'} class={props.class} classList={{ ...props.classList, 'has-coin': !!props.portrait }}
    {...(props.onHome ? { type: 'button', onClick: props.onHome } : {})}>
    {props.children}
    {/* There you are: your own painted portrait on the plate, opening your card. */}
    <Show when={props.portrait}>{portrait => <span class="cp-coin" aria-hidden="true"><img src={portrait().url} alt="" width={portrait().width} height={portrait().height} decoding="async" /></span>}</Show>
  </Dynamic>;
}

function LightAction(props: { snap: PanelSnapshot; kindling: boolean; portrait: CardPortrait | null; ref: (element: HTMLElement) => void; onChoose: Click; onHome: Click | null }) {
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
        <Plate class="cp-light-button lit" classList={{ kindling: props.kindling, guest: current().as === 'guest', plain: !props.onHome }} onHome={props.onHome} portrait={props.onHome ? props.portrait : null}>
          <WindowGlyph lit kindling={props.kindling} />
          <span class="cp-light-words">
            <strong>{current().as === 'guest' ? 'Your light burns here' : 'Your window is lit'}</strong>
            <small>{current().as === 'guest'
              ? `As a guest${homeName() ? ` · ${homeName()}` : ''}`
              : `${current().choice === 'named' ? homeName() ?? 'With your name' : 'Unnamed'} · ${street() ?? 'Your home'}`}</small>
          </span>
          <Show when={props.kindling}><span class="cp-kindle" aria-hidden="true"><i /><i /><i /></span></Show>
        </Plate>}
      </Match>
      <Match when={light().kind === 'resting'}>
        <Plate class="cp-light-button resting" classList={{ plain: !props.onHome }} onHome={props.onHome} portrait={props.onHome ? props.portrait : null}>
          <WindowGlyph lit={false} ember />
          <span class="cp-light-words"><strong>Your window is resting</strong><small>It lights again with the next stream.</small></span>
        </Plate>
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

function HomeSheet(props: { snap: PanelSnapshot; passport: PassportReadState | null; onLight: Click }) {
  const home = () => props.snap.home;
  const card = () => cardOf(home())?.card ?? null;
  const simulated = () => props.snap.source.kind === 'simulated';
  const citizen = () => home().kind === 'citizen' ? home() as Extract<Home, { kind: 'citizen' }> : null;
  const guest = () => home().kind === 'guest' ? home() as Extract<Home, { kind: 'guest' }> : null;
  const canLight = () => props.snap.light.kind === 'unshared' || props.snap.light.kind === 'refused';
  return <Switch fallback={
    <Empty text={(home() as { reason: string }).reason} detail={canLight() ? 'Chat still counts: speaking in chat lights your window on stream.' : undefined}>
      <Show when={canLight()}><button type="button" class="cp-inline-action" onClick={props.onLight}>Light your window</button></Show>
    </Empty>}>
    <Match when={card() && citizen() ? { h: citizen()!, card: card()! } : null}>{found =>
      <CardSheet card={found().card} street={found().h.street} place={found().h.place} window={windowWords(props.snap)} passport={props.passport} simulated={simulated()}
        homePicture={found().h.picture.kind === 'still' ? { url: (found().h.picture as Still).url, alt: (found().h.picture as Still).alt } : null}>
        <History items={found().h.history} label="Earned here" />
      </CardSheet>}
    </Match>
    <Match when={card() && guest() ? { g: guest()!, card: card()! } : null}>{found =>
      <CardSheet card={found().card} street={null} place={null} window={windowWords(props.snap)} passport={props.passport} simulated={simulated()} homePicture={null}>
        <p class="cp-body">You already keep three homes, so here your light burns as a guest’s. Your presence still counts.</p>
        <History items={found().g.history} label="Kept here" />
      </CardSheet>}
    </Match>
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
