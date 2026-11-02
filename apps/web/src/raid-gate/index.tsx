/**
 * The Raid Gate in the browser (spec 23). Hosts compose `createRaidGateController` with their own ports and mount
 * `RaidGatePane`; the default export is the `/-/raid-gate` route, which stands the gate board beside a real
 * kingdom. Without a bound authority the board says the gate is shut here. `?bench=simulated` runs the real
 * application with private fixtures and internal simulated provenance; no visible provenance chip.
 */
import { createSignal, For, lazy, onCleanup, onMount, Show } from 'solid-js';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import { createKingdomScene } from '../kingdom/scene';
import type { GateBench } from './bench';
import { createRaidGateController, type GateSnapshot, type RaidGateController } from './controller';
import { GuestArrivalPane } from './GuestArrival';
import type { GateKingdom, RaidGatePorts } from './ports';
import { GateDefs, RaidGatePane } from './RaidGatePane';
import { Seal } from './Seal';
import { VisitorGiftPane } from './VisitorGifts';
import { createGuestWelcomeController } from './welcome';
import './raid-gate.css';
import './welcome.css';

export { createGuestWelcomeController, createRaidGateController, GuestArrivalPane, RaidGatePane, VisitorGiftPane };
export type { GiftActions } from './VisitorGifts';
export type { GuestWelcomeController, WelcomePorts, WelcomeSnapshot } from './welcome';
export type { GateFarewell, GatePhase, GateSnapshot, JourneySnapshot, RaidGateController } from './controller';
export type { AtlasGateEvent, AtlasGateHost, AtlasTravelStage, GateAccount, GateKingdom, GateLand, RaidGateApi, RaidGatePorts } from './ports';

type GateWindow = Window & { __chatdomReady?: boolean; __chatdomRaidGate?: unknown };
const AUTHORITIES = ['ready', 'offline', 'not-connected', 'revoked', 'disabled', 'unavailable'] as const;

/** Willowmere is the kingdom route's own simulated realm; the board stands at its gate. */
const UNBOUND_SOURCE: GateKingdom = { kingdomId: '41000001' as KingdomId, name: 'Willowmere', login: 'willowmere' };
/** The bench's founded destination, whose valley the welcome is staged in. */
const WELCOME_HOST = { kingdomId: '41000002' as KingdomId, name: 'Fernhollow', seed: 'fernhollow' } as const;

/**
 * `/-/raid-gate?bench=simulated&road=1` is the raid road: the whole journey from this gate along the Atlas road to the
 * destination's welcome, between two real holdings, with the raid itself SIMULATED (see `road/RaidRoad.tsx`).
 */
const RaidRoad = lazy(() => import('./road/RaidRoad'));
const IncomingRaid = lazy(() => import('./incoming'));
const NoticeBench = lazy(() => import('./entry/notice-bench'));
const GuestInsigniaBench = lazy(() => import('./guest-insignia-bench'));

export default function RaidGatePage() {
  const query = new URLSearchParams(location.search);
  if (query.get('guestInsignia') === '1') return <GuestInsigniaBench />;
  if (query.get('entryNotice') === '1') return <NoticeBench />;
  if (query.get('incoming') === '1') return <IncomingRaid />;
  return <Show when={query.get('road') === '1' && query.get('bench') === 'simulated'} fallback={<RaidGateRoute />}><RaidRoad /></Show>;
}

function RaidGateRoute() {
  const query = new URLSearchParams(location.search);
  const benchMode = query.get('bench') === 'simulated';
  const viewer = query.get('viewer') === 'walker' ? 'walker' : 'monarch';
  const authority = AUTHORITIES.find(each => each === query.get('authority')) ?? 'ready';
  const backdrop = query.get('backdrop') !== '0';
  // The welcome is staged where it happens: in the destination's valley, under its own name.
  const welcoming = benchMode && query.get('welcome') === '1';
  const valley = welcoming ? { seed: WELCOME_HOST.seed, name: WELCOME_HOST.name, kingdomId: WELCOME_HOST.kingdomId } : { seed: 'willowmere', name: 'Willowmere', kingdomId: UNBOUND_SOURCE.kingdomId };
  const clock = () => Date.now();
  const [controller, setController] = createSignal<RaidGateController | null>(null);
  const [snap, setSnap] = createSignal<GateSnapshot | null>(null);
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
        signal: life.signal, tier: query.get('tier') === 'town' ? 'town' : 'hamlet', seed: valley.seed, realmName: valley.name, hour: 19.5, time: 40, camera: 'hero', source: 'simulated',
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
        const rooms = (['ready', 'slow', 'hold', 'lose', 'deny'] as const).find(each => each === query.get('rooms')) ?? 'ready';
        made = createGateBench({ viewer, authority, clock, twitch, rooms });
        made.finder.onChange(() => setFinderOpen(made!.finder.open()));
        ports = { api: made.api, atlas: made.atlas, source: made.source, clock, account: { reconnect: () => made!.reconnect() } };
      }
      if (life.signal.aborted) return;
      const gate = createRaidGateController(ports);
      setBench(made); setController(gate);
      setSnap(gate.snapshot());
      gate.subscribe(setSnap);
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
        if (requestId && query.get('go') === '1') {
          // The marcher follows the party; the board shows each stage as the SIMULATED rooms answer it.
          void gate.travel();
          await waitFor(gate, snapshot => {
            const journey = snapshot.journey;
            return journey !== null && (journey.overrun || journey.refusal !== null || !['asking', 'reserved', 'preparing', 'ready', 'committing'].includes(journey.state));
          });
          const arrived = gate.snapshot().journey;
          if (welcoming && arrived?.state === 'committed' && gate.snapshot().raid) {
            // SIMULATED: the rest of the party follows through the gate, and Fernhollow's hosts come to greet them.
            const raid = gate.snapshot().raid!;
            await made.partyTravel(requestId, raid.id, walkers);
            const gift = query.get('gift');
            if (gift === 'both') {
              const bread = await made.hostOffer('monarch');
              await gate.refreshWelcome();
              if (bread.kind === 'gift') await gate.acceptGift(bread.value.offerId);
            }
            if (gift === 'offer' || gift === 'both') await made.hostOffer('ash');
            if (query.get('leave') === '1') {
              await gate.refreshWelcome();
              const view = gate.snapshot().welcome?.view;
              if (view?.shelf[0]) await gate.leaveGift(view.shelf[0].itemId, view.monarch.personId);
            }
            await gate.refreshWelcome();
          }
          if (query.get('home') === '1' && gate.snapshot().journey?.state === 'committed') {
            void gate.returnHome();
            await waitFor(gate, snapshot => snapshot.journey?.kind === 'return' && ['committed', 'denied', 'expired', 'cancelled'].includes(snapshot.journey.state));
          }
        }
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

  /** The welcome is drawn once the destination acknowledged this viewer as a visitor and the authority answered. */
  const welcome = () => {
    const s = snap();
    return s?.journey?.kind === 'raid' && s.journey.state === 'committed' && s.welcome?.view ? { snap: s, welcome: s.welcome } : null;
  };
  const here = () => welcome() ? { name: WELCOME_HOST.name, kingdomId: WELCOME_HOST.kingdomId } : { name: valley.name, kingdomId: valley.kingdomId };

  return <div class="rg-route" classList={{ 'rg-no-backdrop': !backdrop, 'rg-welcoming': welcome() !== null }}>
    <GateDefs />
    <Show when={backdrop}><canvas ref={element => { canvas = element; }} class="rg-kingdom" aria-label={`${valley.name} at dusk, seen from above its gate`} /></Show>
    <div class="rg-shade" aria-hidden="true" />
    <header class="rg-realm">
      <Seal kingdomId={here().kingdomId} size={44} />
      <div><p>{welcome() ? 'Guests at the gate' : 'A kingdom at dusk'}</p><h1>{here().name}</h1></div>
    </header>
    <Show when={welcome()}>{state => <GuestArrivalPane welcome={state().welcome} homeName={state().snap.source.name} homeKingdomId={state().snap.source.kingdomId}
      hostName={state().snap.journey?.destination?.channel?.kingdomName ?? WELCOME_HOST.name} hostKingdomId={state().snap.journey!.to} />}</Show>
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
  return <section class="rg-finder" aria-label="Choose a destination">
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
