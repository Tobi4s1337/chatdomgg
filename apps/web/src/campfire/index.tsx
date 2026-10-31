import { Match, Switch, onCleanup, onMount } from 'solid-js';
import { SIMULATED_SCENARIOS, createSimulatedCampfireSession, type SimulatedScenario } from './fixture';
import { publicSource, CampfireStream } from './public';
import { CampfireSurface } from './Surface';
import './campfire.css';

export { CampfireSurface } from './Surface';
export { CampfireStream, publicSource, type CampfirePublicSource } from './public';
export { mountCampfireClearing, type CampfireClearing, type ClearingMaterials } from './clearing';
export { decodeCampfirePublicView, type CampfirePublicView, type CampfireSessionPort, type CampfireVoicePort, type CampfireAudioPort, type CampfireScenePort } from './ports';

/** A fixed evening so captures of the development cast compare run to run. */
const BENCH_START = Date.UTC(2026, 9, 30, 20, 30, 0);

/**
 * `/-/campfire`: the development surface. It drives the real clearing and UI from the SIMULATED
 * session; it is never an authenticated game. `?source=live` stays unavailable until the campfire's
 * own host is bound to the kingdom's sign-in and storage.
 *   ?state=waiting|playing|text-only|closed  &seats=6..12  &surface=circle|stream  &at=<ms>  &still=1  &guide=open|closed
 */
export default function CampfireBench() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('state') ?? 'playing';
  const scenario: SimulatedScenario = (SIMULATED_SCENARIOS as readonly string[]).includes(requested) ? requested as SimulatedScenario : 'playing';
  const seats = Math.max(6, Math.min(12, Number(params.get('seats')) || 6));
  const still = params.get('still') === '1';
  const offset = Math.max(0, Number(params.get('at')) || 0);
  const started = performance.now();
  const clock = { now: () => BENCH_START + offset + (still ? 0 : performance.now() - started) };
  const timer = { now: clock.now, every: (ms: number, tick: () => void) => { if (still) return () => {}; const id = window.setInterval(tick, ms); return () => window.clearInterval(id); } };
  const guide = params.get('guide');
  const live = params.get('source') === 'live';
  const session = live ? null : createSimulatedCampfireSession({ scenario, seats, seed: params.get('seed') ?? 'hearthmoor', startMs: BENCH_START }, timer);
  onCleanup(() => session?.dispose());
  // The unbound notice has no scene to wait for.
  if (!session) onMount(() => { window.__chatdomReady = true; });
  return <Switch>
    <Match when={!session}>
      <div class="campfire campfire--page campfire--unbound" data-campfire-surface="unbound">
        <div class="campfire-failure" role="status"><strong>This campfire isn't connected yet</strong><p>Live games need the kingdom's own campfire host, sign-in and storage. Until they are bound, only the labelled development cast can sit here.</p></div>
      </div>
    </Match>
    <Match when={params.get('surface') === 'stream'}><CampfireStream source={publicSource(session!)} clock={clock} still={still} /></Match>
    <Match when={true}><CampfireSurface session={session!} clock={clock} still={still} {...(guide === 'open' || guide === 'closed' ? { guide } : {})} /></Match>
  </Switch>;
}
