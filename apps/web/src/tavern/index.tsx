import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createTavernStage, type TavernFraming } from './stage';
import '@chatdom/ui/kit.css';
import './tavern.css';
import { TavernRoomSurface } from './Surface';
import { requestBenchGameInput } from './bench-input';
import { openLocalTestTavern } from './test-entry';

export { mountTavern, type TavernMount } from './mount';
export { TavernRoomSurface } from './Surface';
export { connectTavern, type TavernClient } from './client';

/** A room inspection route. No staged people or pretend games enter this surface. */
export default function TavernBench() {
  const params = new URLSearchParams(location.search);
  if (params.get('testWalker') === '1') return <TavernRoomSurface open={() => openLocalTestTavern(params)} requestInput={(surface, reason) => requestBenchGameInput(surface, reason)}
    {...(params.get('seat') ? { benchSeat: params.get('seat')! } : {})} />;
  const initial = params.get('view');
  const [framing, setFraming] = createSignal<TavernFraming>(initial === 'bar' || initial === 'table' ? initial : 'room');
  const [ready, setReady] = createSignal(false), [error, setError] = createSignal(false);
  let host: HTMLDivElement | undefined, stage: ReturnType<typeof createTavernStage> | undefined;
  onMount(() => {
    stage = createTavernStage(host!, { framing: framing(), style: params.get('style') === 'tide' ? 'tide' : 'hearth',
      hour: Number(params.get('hour')) || 19, still: params.get('still') === '1' });
    void stage.ready.then(async () => { await document.fonts.ready; setReady(true); (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }, () => setError(true));
  });
  onCleanup(() => stage?.dispose());
  const choose = (next: TavernFraming) => { setFraming(next); stage?.framing(next); };
  return <div class="gather-tavern cd-kit" data-gather="tavern">
    <div class="gather-tavern-stage" ref={element => { host = element; }} />
    <header class="gather-tavern-title"><p class="cd-label">A place by the hearth</p><h1>The tavern</h1></header>
    <Show when={!ready() || error()}><p class="gather-tavern-status cd-slip" role="status">{error() ? 'The tavern could not be opened. Try the door again shortly.' : 'Warming the hearth…'}</p></Show>
    <nav class="gather-tavern-views cd-plate" aria-label="Inspect the tavern">
      <button class="cd-crest cd-focus" aria-pressed={framing() === 'bar'} onClick={() => choose('bar')}>At the bar</button>
      <button class="cd-crest cd-focus" aria-pressed={framing() === 'room'} onClick={() => choose('room')}>By the hearth</button>
      <button class="cd-crest cd-focus" aria-pressed={framing() === 'table'} onClick={() => choose('table')}>At the table</button>
    </nav>
    <p class="gather-tavern-inspection">Room study · Empty chairs stay empty</p>
  </div>;
}
