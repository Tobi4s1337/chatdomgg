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
  let client: TavernClient | undefined, walk: Awaited<ReturnType<typeof mountTavernWalk>> | undefined;
  let disposed = false, off: (() => void) | undefined;
  const [failed, setFailed] = createSignal(false), [frame, setFrame] = createSignal(EMPTY);
  const [state, setState] = createSignal<TavernWalkState>({ ready: false, connected: false, seated: null, names: [] });
  const table = createMemo(() => frame().tables.find(t => t.table === state().seated));
  const running = () => table()?.pong?.phase === 'rally' || table()?.pong?.phase === 'serve';
  const start = () => { const current = table(); if (current) client?.start(current.table); stage?.canvas.focus(); };
  const aim = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement, bounds = target.getBoundingClientRect();
    if (event.type === 'pointerdown') target.setPointerCapture(event.pointerId);
    if (event.type === 'pointermove' && !target.hasPointerCapture(event.pointerId)) return;
    const sign = client?.self.seat === 0 ? -1 : 1;
    client?.aim(((event.clientX - bounds.left) / bounds.width * 2 - 1) * sign, performance.now());
    event.preventDefault();
  };
  onMount(() => {
    stage = createTavernStage(host!, { framing: 'room', style: 'hearth', hour: 19, still: false });
    stage.canvas.tabIndex = 0;
    const install = async () => {
      const opened = await props.open();
      if (disposed) { opened.dispose(); return; }
      client = opened; setFrame(client.tables);
      off = client.subscribe(() => setFrame(client!.tables));
      await stage!.ready;
      await document.fonts.ready;
      if (disposed) return;
      walk = await mountTavernWalk(stage!, client, { host: host!, requestInput: reason => props.requestInput(stage!.canvas, reason),
        ...(props.benchSeat ? { benchSeat: props.benchSeat } : {}),
        onState(next) {
          setState(next);
          if (next.ready) (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
        } });
      if (disposed) { walk.dispose(); return; }
    };
    void install().catch(error => {
      if (disposed) return;
      setFailed(true); client?.dispose();
      (window as Window & { __chatdomTavernError?: string }).__chatdomTavernError = error instanceof Error ? error.message : 'The tavern could not be opened.';
    });
  });
  onCleanup(() => { disposed = true; off?.(); walk?.dispose(); client?.dispose(); stage?.dispose(); });
  return <div class="gather-tavern gather-tavern--live cd-kit" data-gather="tavern-live">
    <div class="gather-tavern-stage" ref={element => { host = element; }} />
    <Show when={!state().seated}><header class="gather-tavern-title"><p class="cd-label">By the hearth</p><h1>The tavern</h1></header></Show>
    <Show when={!state().ready || failed()}><p class="gather-tavern-status cd-slip" role="status">{failed() ? 'The tavern could not be opened. Return to the door and try again.' : 'Opening the door…'}</p></Show>
    <Show when={state().ready && !state().connected}><p class="gather-tavern-status cd-slip" role="status">The road is quiet. Reconnecting to your chair…</p></Show>
    <For each={state().names}>{name => <span class="gather-citizen-name" style={{ left: `${name.x}px`, top: `${name.y}px` }}>{name.name}</span>}</For>
    <Show when={table()}>{current => <Show when={!current().game || current().game === 'pong'} fallback={<TurnGameHud table={current} seat={() => client?.self.playerIndex ?? null}
      connected={() => state().connected} now={() => client?.serverNow() ?? Date.now()} onStart={start} onMove={(action, column) => client?.move(action, column)} onLeave={() => walk?.interactions.leave()} />}><section class="gather-game-hud cd-plate" aria-label="Pong table" data-pong-hud>
      <p class="cd-label">Pong · First to seven</p>
      <div class="gather-game-score">
        <span>{current().players?.[0] ?? current().seats[0] ?? 'Open chair'}</span><strong aria-label="score">{current().pong?.score[0] ?? 0} <i>:</i> {current().pong?.score[1] ?? 0}</strong>
        <span>{current().players?.[1] ?? current().seats[1] ?? 'Open chair'}</span>
      </div>
      <p class="gather-game-words" role="status">{result(current())}</p>
      <Show when={running()}><p class="gather-game-help">Mouse, A / D or arrows · Click the tabletop to focus</p></Show>
      <Show when={!running() && current().seats.every(Boolean)}><button class="cd-crest cd-focus" onClick={start} disabled={!state().connected}>Play Pong</button></Show>
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
