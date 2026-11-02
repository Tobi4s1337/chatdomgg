import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { GatherFrame, GatherTableView } from '@chatdom/shared';
import type { GameInputLease } from '../games/input';
import { createTavernStage } from './stage';
import type { TavernClient } from './client';
import { mountTavernWalk, type TavernWalkState } from './walk';
import { TurnGameHud } from '../games/TurnHud';

const EMPTY: GatherFrame = { at: 0, tables: [] };
function result(table: GatherTableView): string {
  const game = table.pong;
  if (!game) return table.seats.every(Boolean) ? 'Ready when you are.' : 'A chair for a friend.';
  if (game.phase === 'interrupted') return 'The game was interrupted. No win was recorded.';
  if (game.phase === 'finished') return `${table.players?.[game.winner ?? 0] ?? table.seats[game.winner ?? 0] ?? 'The other player'} wins${game.reason === 'conceded' ? ' as the other player leaves' : ''}.`;
  if (game.phase === 'serve') return 'The next serve is yours to meet.';
  return 'First to seven.';
}

/** Portal destination surface. Entry/session transfer remains with the caller; this draws the admitted room. */
export function TavernRoomSurface(props: {
  readonly open: () => Promise<TavernClient>;
  readonly requestInput: (surface: HTMLCanvasElement, reason: string) => GameInputLease;
  readonly benchSeat?: string;
}) {
  let host: HTMLDivElement | undefined, stage: ReturnType<typeof createTavernStage> | undefined;
  let gameInput: HTMLCanvasElement | undefined, inputOwner: symbol | undefined;
  let sceneFailed = false;
  let sceneReady: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  let client: TavernClient | undefined, walk: Awaited<ReturnType<typeof mountTavernWalk>> | undefined;
  let disposed = false, installing = false, off: (() => void) | undefined;
  const [failed, setFailed] = createSignal(false), [frame, setFrame] = createSignal(EMPTY);
  const [link, setLink] = createSignal({ connected: false, ended: false });
  const [state, setState] = createSignal<TavernWalkState>({ ready: false, connected: false, seated: null, column: null, names: [] });
  const table = createMemo(() => frame().tables.find(t => t.table === state().seated));
  const running = () => table()?.pong?.phase === 'rally' || table()?.pong?.phase === 'serve';
  const start = () => { const current = table(); if (current) client?.start(current.table); gameInput?.focus(); };
  const requestInput = (reason: string): GameInputLease => {
    const surface = gameInput!, owner = Symbol('seated table');
    inputOwner = owner; surface.hidden = false;
    const lease = props.requestInput(surface, reason);
    let released = false;
    return {
      get active() { return !released && lease.active; },
      onKey: listener => lease.onKey(listener), onPointer: listener => lease.onPointer(listener),
      release() {
        if (released) return; released = true; lease.release();
        if (inputOwner === owner) { inputOwner = undefined; surface.hidden = true; }
      },
    };
  };
  const aim = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement, bounds = target.getBoundingClientRect();
    if (event.type === 'pointerdown') target.setPointerCapture(event.pointerId);
    if (event.type === 'pointermove' && !target.hasPointerCapture(event.pointerId)) return;
    const sign = client?.self.seat === 0 ? -1 : 1;
    client?.aim(((event.clientX - bounds.left) / bounds.width * 2 - 1) * sign, performance.now());
    event.preventDefault();
  };
  const install = async () => {
    if (disposed || installing) return;
    installing = true; setFailed(false); setLink({ connected: false, ended: false });
    setState({ ready: false, connected: false, seated: null, column: null, names: [] });
    off?.(); off = undefined; walk?.dispose(); walk = undefined; client?.dispose(); client = undefined;
    setFrame(EMPTY); stage?.tavern.games(EMPTY);
    const debug = window as Window & { __chatdomReady?: boolean; __chatdomTavernError?: string };
    debug.__chatdomReady = false; delete debug.__chatdomTavernError;
    try {
      if (!stage || sceneFailed) {
        stage?.dispose();
        stage = createTavernStage(host!, { framing: 'room', style: 'hearth', hour: 19, still: false });
        stage.canvas.tabIndex = 0; sceneFailed = false;
        sceneReady = stage.ready.then(() => ({ ok: true as const }), error => {
          sceneFailed = true; return { ok: false as const, error };
        });
      }
      const opened = await props.open();
      if (disposed) { opened.dispose(); return; }
      client = opened;
      const update = () => { setFrame(client!.tables); setLink({ connected: client!.connected, ended: client!.ended }); };
      update(); off = client.subscribe(update);
      const scene = await sceneReady!;
      if (!scene.ok) throw scene.error;
      await document.fonts.ready;
      if (disposed) return;
      walk = await mountTavernWalk(stage!, client, { host: host!, requestInput,
        ...(props.benchSeat ? { benchSeat: props.benchSeat } : {}),
        onState(next) {
          setState(next);
          if (next.ready) (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
        } });
      if (disposed) { walk.dispose(); return; }
    } catch (error) {
      if (disposed) return;
      setFailed(true); client?.dispose();
      (window as Window & { __chatdomTavernError?: string }).__chatdomTavernError = error instanceof Error ? error.message : 'The tavern could not be opened.';
    } finally { installing = false; }
  };
  onMount(() => {
    void install();
  });
  onCleanup(() => { disposed = true; off?.(); walk?.dispose(); client?.dispose(); stage?.dispose(); });
  return <div class="gather-tavern gather-tavern--live cd-kit" data-gather="tavern-live">
    <div class="gather-tavern-stage" ref={element => { host = element; }} />
    <canvas ref={element => { gameInput = element; }} class="gather-game-input" data-gather-game-input hidden tabindex="0" aria-label="Table controls" />
    <Show when={!state().seated}><header class="gather-tavern-title"><p class="cd-label">By the hearth</p><h1>The tavern</h1></header></Show>
    <Show when={!state().ready && !failed() && !link().ended}><p class="gather-tavern-status cd-slip" role="status">Opening the door…</p></Show>
    <Show when={failed() || link().ended}><section class="gather-tavern-status gather-tavern-return cd-plate" role="status">
      <p>{failed() ? 'The tavern could not be opened.' : 'Your connection ended. Your chair could not be restored.'}</p>
      <button class="cd-crest cd-focus" onClick={() => void install()}>Try the door again</button>
    </section></Show>
    <Show when={state().ready && !link().connected && !link().ended && !failed()}><p class="gather-tavern-status cd-slip" role="status">The road is quiet. Reconnecting to your chair…</p></Show>
    <For each={state().names}>{name => <span class="gather-citizen-name" style={{ left: `${name.x}px`, top: `${name.y}px` }}>{name.name}</span>}</For>
    <Show when={table()}>{current => <Show when={!current().game || current().game === 'pong'} fallback={<TurnGameHud table={current} seat={() => client?.self.playerIndex ?? null}
      connected={() => link().connected} column={() => state().column} now={() => client?.serverNow() ?? Date.now()} onStart={start} onMove={(action, column) => client?.move(action, column)} onLeave={() => walk?.interactions.leave()} />}><section class="gather-game-hud cd-plate" aria-label="Pong table" data-pong-hud>
      <p class="cd-label">Pong · First to seven</p>
      <div class="gather-game-score">
        <span>{current().players?.[0] ?? current().seats[0] ?? 'Open chair'}</span><strong aria-label="score">{current().pong?.score[0] ?? 0} <i>:</i> {current().pong?.score[1] ?? 0}</strong>
        <span>{current().players?.[1] ?? current().seats[1] ?? 'Open chair'}</span>
      </div>
      <p class="gather-game-words" role="status">{result(current())}</p>
      <Show when={running()}><p class="gather-game-help">Mouse, A / D or arrows · Click the tabletop to focus</p></Show>
      <Show when={!running() && current().seats.every(Boolean)}><button class="cd-crest cd-focus" onClick={start} disabled={!link().connected}>Play Pong <kbd>Enter</kbd></button></Show>
      <div class="gather-paddle-touch" role="slider" tabindex="0" aria-label="Move your paddle" aria-valuemin={-1} aria-valuemax={1}
        aria-valuenow={client?.presentations.get(current().table)?.aimPosition ?? 0}
        onPointerDown={aim} onPointerMove={aim} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={event => {
          if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
          event.preventDefault(); const currentTarget = client?.presentations.get(current().table)?.aimPosition ?? 0;
          const sign = client?.self.seat === 0 ? -1 : 1;
          client?.aim(currentTarget + (event.code === 'ArrowRight' ? .12 : -.12) * sign, performance.now());
        }}><span>Slide to move your paddle</span></div>
      <button class="gather-game-leave cd-focus" onClick={() => walk?.interactions.leave()}>Stand up <kbd>E</kbd> <kbd>Esc</kbd></button>
    </section></Show>}</Show>
  </div>;
}
