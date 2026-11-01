import { For, Show, createSignal, onCleanup } from 'solid-js';
import type { GatherTableView } from '@chatdom/shared';
import './turn-games.css';

const diePips: readonly (readonly number[])[] = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

export function TurnGameHud(props: {
  table: () => GatherTableView;
  seat: () => number | null;
  connected: () => boolean;
  now: () => number;
  onStart: () => void;
  onMove: (action: 'drop' | 'roll' | 'hold', column?: number) => void;
  onLeave: () => void;
}) {
  const [clock, setClock] = createSignal(props.now());
  const interval = setInterval(() => setClock(props.now()), 250);
  onCleanup(() => clearInterval(interval));
  const stones = () => props.table().stones;
  const dice = () => props.table().dice;
  const isStones = () => props.table().game === 'stones';
  const game = () => isStones() ? stones() : dice();
  const ready = () => props.connected() && props.table().status !== 'saving';
  const occupied = () => [...props.table().seats, ...(props.table().extraSeats ?? [])].filter(Boolean).length;
  const name = (index: number) => props.table().players?.[index] ?? 'Player';
  const turn = () => isStones() ? stones()?.turn : dice()?.turn;
  const yourTurn = () => game()?.phase === 'playing' && props.seat() !== null && props.seat() === turn();
  const seconds = () => Math.max(0, Math.ceil(((game()?.deadline ?? clock()) - clock()) / 1000));
  const message = () => {
    if (!props.connected()) return 'Reconnecting to your chair…';
    if (props.table().status === 'unavailable') return 'The last save is unconfirmed. Try again shortly.';
    if (props.table().status === 'saving') return 'Saving the move…';
    const current = game();
    if (!current) return occupied() >= 2 ? 'Ready when you are.' : 'A chair for a friend.';
    if (current.phase === 'finished') {
      if (current.reason === 'draw') return 'The game is a draw.';
      if (current.winner === null) return 'The game has ended.';
      return `${name(current.winner)} wins${current.reason === 'conceded' ? ' by concession' : ''}.`;
    }
    return yourTurn() ? 'Your turn' : `${name(turn() ?? 0)}’s turn`;
  };
  const full = (column: number) => stones()?.board[35 + column] !== 0;
  return <section class="gather-game-hud gather-turn-hud cd-plate" aria-label={isStones() ? 'Stones table' : 'Hearth Dice table'} data-turn-hud>
    <div class="gather-turn-heading"><p class="cd-label">{isStones() ? 'Stones' : 'Hearth Dice'}</p>
      <Show when={game()?.phase === 'playing'}><span class="gather-turn-clock" aria-label={`${seconds()} seconds remaining`}>{seconds()}<small> sec</small></span></Show>
    </div>
    <p class="gather-turn-message" role="status" aria-live="polite">{message()}</p>
    <Show when={isStones()} fallback={<>
      <Show when={dice()}>{current => <div class="gather-dice-scores" aria-label="Scores">
        <For each={current().scores}>{(score, index) => <div classList={{ 'gather-dice-player': true, 'is-current': current().phase === 'playing' && current().turn === index(), 'is-own': props.seat() === index() }}>
          <span title={name(index())}>{name(index())}{props.seat() === index() ? ' (you)' : ''}</span><strong>{score}</strong>
        </div>}</For>
      </div>}</Show>
      <Show when={dice()?.phase === 'playing'}><div class="gather-dice-play">
        <span class="gather-die" aria-label={dice()?.die ? `Last die: ${dice()?.die}` : 'No die rolled yet'}>
          <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8]}>{pip => <i aria-hidden="true" classList={{ 'is-pip': (diePips[dice()?.die ?? 0] ?? []).includes(pip) }} />}</For>
        </span>
        <span class="gather-dice-pot"><small>Turn points</small><strong>{dice()?.pot ?? 0}</strong></span>
        <button class="cd-crest cd-focus" disabled={!ready() || !yourTurn()} onClick={() => props.onMove('roll')}>Roll</button>
        <button class="cd-crest cd-focus" disabled={!ready() || !yourTurn() || !dice()?.pot} onClick={() => props.onMove('hold')}>Hold</button>
      </div></Show>
      <p class="gather-turn-rules">A one loses this turn. Hold to bank; first to fifty. At 30 seconds, bank or pass.</p>
    </>}>
      <Show when={stones()?.phase === 'playing'}><div class="gather-stone-columns" aria-label="Choose a column">
        <For each={props.seat() === 0 ? [6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6]}>{column => <button class="cd-crest cd-focus" aria-label={`Drop stone in column ${column + 1}${full(column) ? ', full' : ''}`} disabled={!ready() || !yourTurn() || full(column)} onClick={() => props.onMove('drop', column)}>{column + 1}</button>}</For>
      </div></Show>
      <p class="gather-turn-rules">Four in a row wins. At 30 seconds, a centre stone drops.</p>
    </Show>
    <Show when={!game() || game()?.phase === 'finished'}><Show when={occupied() >= 2}><button class="gather-turn-start cd-crest cd-focus" disabled={!ready()} onClick={props.onStart}>{game() ? 'Play again' : `Play ${isStones() ? 'Stones' : 'Hearth Dice'}`}</button></Show></Show>
    <button class="gather-game-leave cd-focus" onClick={props.onLeave}>Stand up <kbd>E</kbd> <kbd>Esc</kbd></button>
  </section>;
}
