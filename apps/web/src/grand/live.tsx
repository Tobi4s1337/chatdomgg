import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { createGrandLiveController, type GrandLiveState } from './live-controller';
import './live.css';
import { mountOpeningLoader, type OpeningLoader } from '../kingdom/grand-land/opening/loader';
import type { OpeningJournal } from '../kingdom/grand-land/opening/journal';

const HOURS = [
  { label: 'Dawn', hour: 6.4 }, { label: 'Morning', hour: 9.5 },
  { label: 'Noon', hour: 12.5 }, { label: 'Golden hour', hour: 17.6 },
  { label: 'Dusk', hour: 19.6 }, { label: 'Night', hour: 22.5 },
];

const initial: GrandLiveState = {
  phase: 'checking', title: 'Your kingdom', biome: null, hour: 17.6,
  progress: null, error: null, source: null, canRetry: false,
};

function clock(hour: number) {
  const minutes = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export default function GrandLiveView() {
  const [state, setState] = createSignal<GrandLiveState>(initial);
  const still = new URLSearchParams(window.location.search).get('still') === '1';
  let host!: HTMLDivElement;
  let controller: ReturnType<typeof createGrandLiveController> | undefined;
  // The same parchment opening as the kingdom and the stream, fed only by this scene's real steps.
  let openingHost: HTMLDivElement | undefined, opener: OpeningLoader | undefined;
  const [opening, setOpening] = createSignal(false);
  function follow(journal: OpeningJournal) {
    if (!openingHost) return;
    opener ??= mountOpeningLoader(openingHost, { variant: 'page', ...(state().title && state().title !== 'Your kingdom' ? { name: state().title } : {}),
      onGone: () => { opener = undefined; setOpening(false); } });
    setOpening(true); opener.follow(journal);
  }
  onCleanup(() => opener?.dispose());
  onMount(() => {
    controller = createGrandLiveController({ host: () => host, onState: setState, onOpening: follow });
    controller.start();
  });
  onCleanup(() => controller?.dispose());
  const ready = () => state().phase === 'ready';
  const waiting = () => state().phase === 'checking' || state().phase === 'loading';
  const failed = () => state().phase === 'unavailable' || state().phase === 'hidden';

  return <main class="grand-live" data-grand-phase={state().phase}>
    <div class="grand-live__scene" ref={element => { host = element; }} aria-label="Kingdom view" />
    <Show when={!(still && ready())}>
      <div class="grand-live__shade" aria-hidden="true" />
      <header class="grand-live__heading">
        <span class="grand-live__eyebrow">A kingdom on the map</span>
        <h1>{state().title || 'Your kingdom'}</h1>
        <Show when={state().biome}><p>{state().biome}</p></Show>
      </header>
      <a class="grand-live__map" href="/map"><span aria-hidden="true">←</span> The map</a>
      <section class="grand-live__controls" aria-label="View controls">
          <div class="grand-live__time-row">
            <label for="grand-live-hour">Time of day <span>{clock(state().hour)}</span></label>
            <button class="grand-live__reset" type="button" disabled={!ready()} onClick={() => controller?.resetView()}>Reset view</button>
          </div>
          <input id="grand-live-hour" type="range" min="0" max="24" step="0.1" disabled={!ready()} value={state().hour} onInput={event => controller?.setHour(Number(event.currentTarget.value))} />
          <div class="grand-live__hours"><For each={HOURS}>{item =>
            <button type="button" disabled={!ready()} classList={{ 'is-current': Math.abs(state().hour - item.hour) < 0.15 }} onClick={() => controller?.setHour(item.hour)}>{item.label}</button>
          }</For></div>
        </section>
      <div class="grand-live__opening" classList={{ hidden: failed() }} ref={element => { openingHost = element; }} />
      <Show when={failed() || waiting() && !opening()}>
        <section class="grand-live__veil" aria-live="polite">
          <div class="grand-live__paper">
            <div class="grand-live__ornament" aria-hidden="true">✦</div>
            <p class="grand-live__paper-kicker">Chatdom · The kingdom</p>
            <Show when={waiting()} fallback={<>
              <h2>{state().phase === 'hidden' ? 'The view is resting' : 'The road is quiet'}</h2>
              <p>{state().error || (state().phase === 'hidden' ? 'Return to this window to continue watching.' : 'We could not open this kingdom just now. Please try again.')}</p>
              <Show when={state().canRetry && state().phase !== 'hidden'}><button type="button" class="grand-live__retry" onClick={() => controller?.retry()}>Try again</button></Show>
            </>}>
              <h2>Opening the kingdom</h2>
              <p>{state().progress?.text || 'Finding the way to your kingdom…'}</p>
              <svg class="grand-live__engraving" viewBox="0 0 320 64" fill="none" aria-hidden="true">
                <path class="grand-live__engraving-base" d="M8 48 C56 47 59 15 109 29 S176 56 217 30 S272 13 312 16" />
                <path class="grand-live__engraving-ink" d="M8 48 C56 47 59 15 109 29 S176 56 217 30 S272 13 312 16" />
                <path d="M8 43v10 M312 11v10 M5 48h6 M309 16h6" />
              </svg>
              <Show when={state().progress}>{progress => <div class="grand-live__progress" role="progressbar" aria-label={progress().text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, progress().fraction)) * 100)}><span style={{ width: `${Math.max(0, Math.min(1, progress().fraction)) * 100}%` }} /></div>}</Show>
            </Show>
          </div>
        </section>
      </Show>
    </Show>
  </main>;
}
