import { createSignal, For, onCleanup, onMount, Show, type Accessor, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import '@chatdom/ui/kit.css';
import '../ledger/ledger.css';
import './hud.css';
import '../providers';
import type { CursorView, PlayHost, PlayHud, WayHome } from '../host';
import { actionBindings, availableHudPieces, onSlotsChanged, type ActionBinding, type HudPieceProvider, type HudRegion, type PlayContext, type PlaySettings } from '../slots';
import { Keycap } from '../ledger/controls';
import { keyName, readKeyLayout, type KeyLayout } from '../ledger/keys';
import { LedgerBook, type LedgerPhase } from '../ledger/Ledger';
import { bookMark, mouseMark } from '../ledger/marks';
import { createLedger, type Ledger, type LedgerState } from '../ledger/model';

const REGIONS: readonly HudRegion[] = ['top-left', 'top-centre', 'top-right', 'bottom-left', 'bottom-centre', 'bottom-right'];
/** How long the shutter swings and the book settles; reduced motion keeps only a short fade. */
const OPEN_MS = 620, CLOSE_MS = 340, FADE_MS = 160;

/** One piece from another lane, mounted into its own host and disposed when it leaves. */
function Piece(props: { piece: HudPieceProvider; ctx: PlayContext }): JSX.Element {
  let host!: HTMLDivElement;
  onMount(() => {
    let dispose: (() => void) | undefined;
    try { dispose = props.piece.mount(host, props.ctx); } catch (error) { console.error(`The HUD piece ${props.piece.id} could not open`, error); }
    onCleanup(() => { try { dispose?.(); } catch (error) { console.error(`The HUD piece ${props.piece.id} could not close`, error); } });
  });
  return <div ref={element => { host = element; }} class="pl-piece" data-piece={props.piece.id} />;
}

/** A HUD region keeps its pieces mounted while they stay available and in the same order. */
function Region(props: { region: HudRegion; ctx: PlayContext; children?: JSX.Element }): JSX.Element {
  const read = () => availableHudPieces(props.ctx, props.region);
  const [pieces, setPieces] = createSignal(read(), { equals: (a, b) => a.length === b.length && a.every((piece, i) => piece === b[i]) });
  const update = () => setPieces(read());
  onCleanup(onSlotsChanged(update));
  // Availability can turn without a registration (the stream going live); a slow look keeps the regions honest.
  const timer = setInterval(update, 1000);
  onCleanup(() => clearInterval(timer));
  return <div class="pl-region" data-region={props.region}>
    <For each={pieces()}>{piece => <Piece piece={piece} ctx={props.ctx} />}</For>
    {props.children}
  </div>;
}

function useCursor(play: PlayHost): Accessor<CursorView> {
  const [cursor, setCursor] = createSignal<CursorView>(play.cursor, { equals: false });
  onCleanup(play.onCursor(next => setCursor(() => next)));
  return cursor;
}

function HudView(props: { play: PlayHost; ledger: Ledger }): JSX.Element {
  const play = props.play;
  const [state, setState] = createSignal<LedgerState>(props.ledger.state, { equals: false });
  onCleanup(props.ledger.subscribe(next => setState(() => next)));
  const [settings, setSettings] = createSignal<Readonly<PlaySettings>>(play.settings.current, { equals: false });
  onCleanup(play.settings.subscribe(next => setSettings(() => next)));
  const cursor = useCursor(play);
  const [layout, setLayout] = createSignal<KeyLayout | null>(null);
  void readKeyLayout().then(map => setLayout(() => map));

  // The book stays drawn while its shutter closes, so closing is seen and heard, not cut.
  const [phase, setPhase] = createSignal<LedgerPhase | 'closed'>(props.ledger.state.open ? 'open' : 'closed');
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;
  const reduced = () => settings().reducedMotion;
  let wasOpen = props.ledger.state.open;
  onCleanup(props.ledger.subscribe(next => {
    if (next.open === wasOpen) return;
    wasOpen = next.open;
    clearTimeout(phaseTimer);
    setPhase(next.open ? 'opening' : 'closing');
    phaseTimer = setTimeout(() => setPhase(next.open ? 'open' : 'closed'), reduced() ? FADE_MS : next.open ? OPEN_MS : CLOSE_MS);
  }));
  onCleanup(() => clearTimeout(phaseTimer));

  // While the book is open: the way home is read four times a second, and the slots once a second.
  const [way, setWay] = createSignal<WayHome | null>(null, { equals: false });
  const readWay = () => { try { setWay(() => play.wayHome()); } catch (error) { console.error('The way home could not be read', error); setWay(null); } };
  let ticks = 0;
  const tick = setInterval(() => {
    if (!state().open) return;
    if (state().page === 'way-home') readWay();
    if (++ticks % 4 === 0) props.ledger.refresh();
  }, 250);
  onCleanup(() => clearInterval(tick));
  onCleanup(props.ledger.subscribe(next => { if (next.open && next.page === 'way-home') readWay(); }));
  if (props.ledger.state.open) readWay();

  const stream = () => play.ctx.mode === 'stream';
  const ledgerShown = () => phase() !== 'closed';
  const calm = () => !stream() && !ledgerShown() && ['idle', 'cooldown', 'requesting'].includes(cursor().state);
  const touch = () => !stream() && !ledgerShown() && cursor().state === 'touch';

  // 'unavailable' is said once, quietly, then left alone for the rest of the visit.
  const [unavailable, setUnavailable] = createSignal(false);
  let toldUnavailable = false, unavailableTimer: ReturnType<typeof setTimeout> | undefined;
  const watchUnavailable = (view: CursorView) => {
    if (view.state !== 'unavailable' || toldUnavailable || stream()) return;
    toldUnavailable = true; setUnavailable(true);
    unavailableTimer = setTimeout(() => setUnavailable(false), 9000);
  };
  watchUnavailable(play.cursor);
  onCleanup(play.onCursor(watchUnavailable));
  onCleanup(() => clearTimeout(unavailableTimer));

  // Other lanes' keys: listed on the keys page and in Help, re-read whenever a lane registers or leaves.
  const [bindings, setBindings] = createSignal<readonly ActionBinding[]>(actionBindings());
  onCleanup(onSlotsChanged(() => setBindings(actionBindings())));

  // The world prompt ("Take a rod"): only while you are on your feet in the world, never over the open ledger.
  const [prompt, setPrompt] = createSignal(play.prompt, { equals: false });
  onCleanup(play.onPrompt(next => setPrompt(() => next)));
  const walking = () => !stream() && !ledgerShown() && (cursor().state === 'locked' || cursor().state === 'touch');
  const useKey = () => keyName(settings().keys.use, layout());

  const pageProps = { ledger: props.ledger, play, state, settings, cursor, layout, way, bindings };
  return <div class="pl-hud cd-kit" data-reduced={reduced() ? 'true' : undefined} data-cursor={cursor().state} data-ledger={ledgerShown() ? 'open' : undefined}>
    <For each={REGIONS}>{region => <Region region={region} ctx={play.ctx}>
      <Show when={region === 'bottom-centre' && walking() && prompt()} keyed>{shown =>
        <Show when={cursor().state === 'touch'} fallback={
          <p class="pl-prompt" role="status" data-prompt={shown.id}>
            <Show when={useKey()}><Keycap name={useKey()} small /></Show><span class="pl-prompt-words">{shown.label}</span>
          </p>}>
          <button type="button" class="pl-prompt pl-prompt-touch" data-prompt={shown.id} onClick={() => { play.cue('wood'); play.usePrompt(); }}>
            <span class="pl-prompt-words">{shown.label}</span>
          </button>
        </Show>}
      </Show>
      <Show when={region === 'bottom-right' && touch()}>
        <button type="button" class="pl-ledger-button" aria-label="Open the ledger" onClick={() => props.ledger.open()}>
          <span class="pl-ledger-button-face">{bookMark()}</span><span class="pl-ledger-button-word" aria-hidden="true">Ledger</span>
        </button>
      </Show>
    </Region>}</For>
    <Show when={calm()}>
      <p class="pl-walk-slip cd-slip" data-state={cursor().state} role="status">{mouseMark()}<span>Click to walk</span></p>
    </Show>
    <Show when={unavailable() && !ledgerShown()}>
      <p class="pl-quiet-line" role="status">This window cannot hold the mouse. Open the kingdom in its own tab to walk.</p>
    </Show>
    <Show when={ledgerShown() && !stream()}>
      <LedgerBook {...pageProps} phase={phase() === 'closed' ? 'closing' : phase() as LedgerPhase} />
    </Show>
  </div>;
}

/**
 * Mount the play HUD and the Esc ledger over the walk. The walk owns the pointer lock, the keys and the camera; the
 * HUD draws them and asks for changes through `play`. Returns the verbs the walk binds (open on the unlock Escape
 * causes, on the ledger key and from the phone's book button; Escape peels the top layer).
 */
export function mountPlayHud(host: HTMLElement, play: PlayHost): PlayHud {
  const container = document.createElement('div');
  container.className = 'pl-root';
  host.appendChild(container);
  const ledger = createLedger(play);
  const listeners = new Set<(open: boolean) => void>();
  let open = ledger.state.open;
  const stop = ledger.subscribe(next => {
    if (next.open === open) return;
    open = next.open;
    for (const listener of [...listeners]) { try { listener(open); } catch (error) { console.error('A ledger listener failed', error); } }
  });
  const unmount = render(() => <HudView play={play} ledger={ledger} />, container);
  let disposed = false;
  return {
    openLedger: page => { if (!disposed) ledger.open(page); },
    closeLedger: () => ledger.close(),
    get ledgerOpen() { return ledger.state.open; },
    onLedger(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    escape: () => ledger.escape(),
    dispose() {
      if (disposed) return;
      disposed = true;
      stop(); ledger.dispose(); unmount(); container.remove(); listeners.clear();
    },
  };
}
