import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createTavernStage, type TavernFraming } from './stage';
import '@chatdom/ui/kit.css';
import './tavern.css';
import { TavernRoomSurface } from './Surface';
import { requestBenchGameInput } from './bench-input';
import { openLocalTestTavern } from './test-entry';
import { createKingdomAudio } from '@chatdom/audio';
import { Vector3 } from 'three';
import { createTavernSound, type TavernSound } from './audio';
import { audibleTavernHost, bindTavernSoundGesture, toggleTavernSound } from './audio-host';

export { mountTavern, type TavernMount } from './mount';
export { TavernRoomSurface } from './Surface';
export { connectTavern, type TavernClient } from './client';
export { tavernPortalFor } from './portal';

/** A room inspection route. No staged people or pretend games enter this surface. */
export default function TavernBench() {
  const params = new URLSearchParams(location.search);
  // Only this standalone route owns a mixer. An integrated destination receives the caller's existing one.
  const audio = createKingdomAudio(); onCleanup(() => audio.dispose());
  if (params.get('testWalker') === '1') return <TavernRoomSurface audio={audio} audioControls open={() => openLocalTestTavern(params)} requestInput={(surface, reason) => requestBenchGameInput(surface, reason)}
    {...(params.get('seat') ? { benchSeat: params.get('seat')! } : {})} />;
  const initial = params.get('view');
  const [framing, setFraming] = createSignal<TavernFraming>(initial === 'bar' || initial === 'table' ? initial : 'room');
  const [ready, setReady] = createSignal(false), [error, setError] = createSignal(false);
  const [soundOn, setSoundOn] = createSignal(false);
  let root: HTMLDivElement | undefined, host: HTMLDivElement | undefined, stage: ReturnType<typeof createTavernStage> | undefined;
  let sound: TavernSound | undefined, offSound: (() => void) | undefined, offGesture: (() => void) | undefined;
  onMount(() => {
    offGesture = bindTavernSoundGesture(audio, root!);
    stage = createTavernStage(host!, { framing: framing(), style: params.get('style') === 'tide' ? 'tide' : 'hearth',
      hour: Number(params.get('hour')) || 19, still: params.get('still') === '1' });
    sound = createTavernSound(() => audibleTavernHost(audio), stage.tavern.kit);
    const forward = new Vector3();
    offSound = stage.onFrame((_dt, now) => {
      stage!.camera.getWorldDirection(forward);
      sound!.update({ frame: { at: Date.now(), tables: [] }, now, connected: true, visible: !document.hidden, walkers: 0,
        seated: null, listener: { feet: [7, .125, 5], forward: [forward.x, forward.y, forward.z] } });
      const state = audio.getState(); setSoundOn(state.status === 'ready' && !state.settings.muted && state.settings.volume > 0);
    });
    void stage.ready.then(async () => { await document.fonts.ready; setReady(true); (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }, () => setError(true));
  });
  const quiet = () => { if (document.hidden) sound?.quiet(); }; document.addEventListener('visibilitychange', quiet);
  onCleanup(() => { offGesture?.(); document.removeEventListener('visibilitychange', quiet); offSound?.(); sound?.dispose(); stage?.dispose(); });
  const choose = (next: TavernFraming) => { sound?.affordance(null); setFraming(next); stage?.framing(next); };
  return <div class="gather-tavern cd-kit" data-gather="tavern" ref={element => { root = element; }}>
    <div class="gather-tavern-stage" ref={element => { host = element; }} />
    <header class="gather-tavern-title"><p class="cd-label">A place by the hearth</p><h1>The tavern</h1></header>
    <button class="gather-tavern-sound cd-crest cd-focus" aria-label={soundOn() ? 'Mute sound' : 'Enable sound'} aria-pressed={soundOn()}
      onClick={() => { sound?.quiet(); void toggleTavernSound(audio).then(setSoundOn); }}>Sound</button>
    <Show when={!ready() || error()}><p class="gather-tavern-status cd-slip" role="status">{error() ? 'The tavern could not be opened. Try the door again shortly.' : 'Warming the hearth…'}</p></Show>
    <nav class="gather-tavern-views cd-plate" aria-label="Inspect the tavern">
      <button class="cd-crest cd-focus" aria-pressed={framing() === 'bar'} onClick={() => choose('bar')}>At the bar</button>
      <button class="cd-crest cd-focus" aria-pressed={framing() === 'room'} onClick={() => choose('room')}>By the hearth</button>
      <button class="cd-crest cd-focus" aria-pressed={framing() === 'table'} onClick={() => choose('table')}>At the table</button>
    </nav>
    <p class="gather-tavern-inspection">Room study · Empty chairs stay empty</p>
  </div>;
}
