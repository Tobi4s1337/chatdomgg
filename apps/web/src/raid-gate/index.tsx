/**
 * The Raid Gate in the browser (spec 23). Hosts compose `createRaidGateController` with their own ports and mount
 * `RaidGatePane`; the default export is the `/-/raid-gate` route, which stands the gate board beside a real
 * kingdom. Without a bound authority the board says the gate is shut here. `?bench=simulated` runs the real
 * application in the page, labelled SIMULATED throughout.
 */
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import { createKingdomScene } from '../kingdom/scene';
import type { GateBench } from './bench';
import { createRaidGateController, type RaidGateController } from './controller';
import type { GateKingdom, RaidGatePorts } from './ports';
import { GateDefs, RaidGatePane } from './RaidGatePane';
import { Seal } from './Seal';
import './raid-gate.css';

export { createRaidGateController, RaidGatePane };
export type { GateFarewell, GatePhase, GateSnapshot, RaidGateController } from './controller';
export type { AtlasGateEvent, AtlasGateHost, GateAccount, GateKingdom, GateLand, RaidGateApi, RaidGatePorts } from './ports';

type GateWindow = Window & { __chatdomReady?: boolean; __chatdomRaidGate?: unknown };
const AUTHORITIES = ['ready', 'offline', 'not-connected', 'revoked', 'disabled', 'unavailable'] as const;

/** Willowmere is the kingdom route's own simulated realm; the board stands at its gate. */
const UNBOUND_SOURCE: GateKingdom = { kingdomId: '41000001' as KingdomId, name: 'Willowmere', login: 'willowmere' };

export default function RaidGateRoute() {
  const query = new URLSearchParams(location.search);
  const benchMode = query.get('bench') === 'simulated';
  const viewer = query.get('viewer') === 'walker' ? 'walker' : 'monarch';
  const authority = AUTHORITIES.find(each => each === query.get('authority')) ?? 'ready';
  const backdrop = query.get('backdrop') !== '0';
  const clock = () => Date.now();
  const [controller, setController] = createSignal<RaidGateController | null>(null);
  const [bench, setBench] = createSignal<GateBench | null>(null);
  const [kingdomReady, setKingdomReady] = createSignal(!backdrop);
  const [kingdomFailed, setKingdomFailed] = createSignal(false);
  const [finderOpen, setFinderOpen] = createSignal(false);
  const [staged, setStaged] = createSignal(false);
  const life = new AbortController();
  let canvas!: HTMLCanvasElement;
  let dispose: (() => void) | undefined;

  onMount(() => {
    const gateWindow = window as GateWindow;
    gateWindow.__chatdomReady = false;
    document.body.classList.add('rg-page');
    if (backdrop) {
      void createKingdomScene(canvas, {
        signal: life.signal, tier: query.get('tier') === 'town' ? 'town' : 'hamlet', seed: 'willowmere', realmName: 'Willowmere', hour: 19.5, time: 40, camera: 'hero', source: 'simulated',
        onProgress: () => undefined, onNames: () => undefined, onSource: () => undefined,
        onError: () => setKingdomFailed(true),
      }).then(scene => {
        if (life.signal.aborted) { scene.dispose(); return; }
        dispose = () => scene.dispose();
        // Wait for the window light to settle, as the kingdom's own captures do, so warm windows read as people.
        const settle = () => { if (life.signal.aborted) return; if (scene.debug.ready && scene.debug.fieldSettled) setKingdomReady(true); else requestAnimationFrame(settle); };
        settle();
      }, () => setKingdomFailed(true));
    }
    void (async () => {
      let ports: RaidGatePorts = { api: null, atlas: null, source: UNBOUND_SOURCE, clock };
      let made: GateBench | null = null;
      if (benchMode) {
        const { createGateBench } = await import('./bench');
        const twitch = (['accept', 'lose', 'refuse'] as const).find(each => each === query.get('twitch')) ?? 'accept';
        made = createGateBench({ viewer, authority, clock, twitch });
        made.finder.onChange(() => setFinderOpen(made!.finder.open()));
        ports = { api: made.api, atlas: made.atlas, source: made.source, clock, account: { reconnect: () => made!.reconnect() } };
      }
      if (life.signal.aborted) return;
      const gate = createRaidGateController(ports);
      setBench(made); setController(gate);
      await waitFor(gate, snapshot => snapshot.phase !== 'loading');
      const pick = query.get('pick') as KingdomId | null, walkers = Math.max(0, Math.min(7, Number(query.get('walkers')) || 0));
      if (made && pick && authority === 'ready') {
        if (viewer === 'monarch') {
          made.finder.pick(pick);
          await waitFor(gate, snapshot => snapshot.phase === 'preview' || snapshot.notice !== null);
        } else {
          await made.monarchPreview(pick);
          await gate.refresh();
        }
        const requestId = gate.snapshot().requestId;
        if (requestId && walkers > 0) { await made.walkersJoin(walkers, requestId); await gate.refresh(); }
        if (query.get('join') === '1') await gate.join();
        if (requestId && query.get('start') === '1') {
          if (viewer === 'monarch') await gate.start();
          else { await made.monarchStart(requestId); await gate.refresh(); }
        }
        if (requestId && query.get('witness') === '1') { await made.witness(requestId); await gate.refresh(); }
        if (requestId && query.get('close') === '1') {
          if (viewer === 'monarch') await gate.cancel();
          else { await made.monarchClose(requestId); await gate.refresh(); }
        }
      }
      gateWindow.__chatdomRaidGate = { snapshot: () => gate.snapshot(), controller: gate, bench: made, ready: false };
      setStaged(true);
    })();
  });

  const ready = () => kingdomReady() || kingdomFailed();
  /** The kingdom has drawn and the gate shows the authority's answer. The scene raises `__chatdomReady` on its own. */
  const markReady = () => {
    const gateWindow = window as GateWindow & { __chatdomRaidGate?: { ready: boolean } };
    if (!staged() || !ready() || !gateWindow.__chatdomRaidGate) return false;
    requestAnimationFrame(() => requestAnimationFrame(() => { gateWindow.__chatdomRaidGate!.ready = true; gateWindow.__chatdomReady = true; }));
    return true;
  };
  onMount(() => {
    const poll = window.setInterval(() => { if (markReady()) window.clearInterval(poll); }, 100);
    onCleanup(() => window.clearInterval(poll));
  });
  onCleanup(() => {
    life.abort(); controller()?.dispose(); dispose?.();
    (window as GateWindow).__chatdomReady = false; document.body.classList.remove('rg-page');
  });

  return <div class="rg-route" classList={{ 'rg-no-backdrop': !backdrop }}>
    <GateDefs />
    <Show when={backdrop}><canvas ref={element => { canvas = element; }} class="rg-kingdom" aria-label="Willowmere at dusk, seen from above its gate" /></Show>
    <div class="rg-shade" aria-hidden="true" />
    <header class="rg-realm">
      <Seal kingdomId={UNBOUND_SOURCE.kingdomId} size={44} />
      <div><p>A kingdom at dusk</p><h1>Willowmere</h1></div>
      <span class="rg-ribbon"><span class="rg-pip" />SIMULATED citizens</span>
    </header>
    <Show when={!ready()}><div class="rg-veil" role="status"><p>Unfolding the valley…</p></div></Show>
    <Show when={bench() && finderOpen()}>
      <BenchFinder bench={bench()!} />
    </Show>
    <Show when={controller()}>{gate => <RaidGatePane controller={gate()} clock={clock} />}</Show>
  </div>;
}

/** Stand-in for Atlas gate mode on the bench. The real finder belongs to the Atlas and orders by its own rules. */
function BenchFinder(props: { bench: GateBench }) {
  let first: HTMLButtonElement | undefined;
  onMount(() => first?.focus());
  const groups = [['road', 'Along your roads'], ['realm', 'Live in your realm']] as const;
  return <section class="rg-finder" aria-label="Choose a destination (SIMULATED map)">
    <p class="rg-finder-label"><span class="rg-pip" />SIMULATED · stands in for the Atlas finder</p>
    <For each={groups}>{([group, label]) => <>
      <h3>{label}</h3>
      <ul>
        <For each={props.bench.finder.entries.filter(entry => entry.group === group)}>{entry => <li>
          <button ref={element => { first ??= element; }} disabled={!entry.live} onClick={() => props.bench.finder.pick(entry.channel.kingdomId)}>
            <Seal kingdomId={entry.channel.kingdomId} size={40} wax={entry.land === 'founded' ? 'crimson' : 'umber'} />
            <span><b>{entry.channel.kingdomName ?? entry.channel.displayName}</b><small>{entry.live ? (entry.land === 'founded' ? 'Live · founded kingdom' : 'Live · waiting land') : 'Not live'}</small></span>
          </button>
        </li>}</For>
      </ul>
    </>}</For>
    <button class="rg-button" onClick={() => props.bench.finder.close()}>Close the map</button>
  </section>;
}

function waitFor(gate: RaidGateController, done: (snapshot: ReturnType<RaidGateController['snapshot']>) => boolean): Promise<void> {
  if (done(gate.snapshot())) return Promise.resolve();
  return new Promise(resolve => {
    const stop = gate.subscribe(snapshot => { if (done(snapshot)) { stop(); resolve(); } });
  });
}
