import type { KingdomPresenceFrame, PresenceFeed } from '@chatdom/shared';
import { createKingdomScene } from '../kingdom/scene';
import { createKingdomSound } from '../kingdom/sound';
import { readDurableChronicle, type DurableChronicle } from './durable';
import { createCandidateLifetime } from './candidate';
import { mountChronicle } from './view';
import type { ReplayBinding } from './replay';
import './native-overlay.css';

type Engine = Awaited<ReturnType<typeof createKingdomScene>>;
export interface NativeChronicleOptions {
  readonly kingdomId: string;
  readonly host?: HTMLElement;
  /** Retained live engine; used only to suspend local controls/dock and share UI sound. */
  readonly liveEngine?: Pick<Engine, 'selectWalk' | 'walkSelected' | 'activateDock' | 'inspect' | 'sound' | 'suspendRendering'>;
  readonly onOpen?: () => void;
  readonly onClose?: (error?: unknown) => void;
}

/** A read-only product overlay, using the same renderer/terrain/assets/light compiler as the live kingdom. */
export function openDurableChronicle(options: NativeChronicleOptions) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const root = document.createElement('section'); root.className = 'chronicle-native'; root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Kingdom Chronicle');
  root.innerHTML = '<div class="chronicle-native-stage"></div><p class="chronicle-native-note">Reading recorded kingdom geometry. Historical lights and chat were not recorded.</p><p class="chronicle-native-loading" role="status">Opening the kingdom’s Chronicle…</p><button class="chronicle-native-dismiss" type="button" aria-label="Close Chronicle">×</button><div class="chronicle-native-panel"></div>';
  const stage = root.querySelector<HTMLElement>('.chronicle-native-stage')!, panel = root.querySelector<HTMLElement>('.chronicle-native-panel')!;
  const note = root.querySelector<HTMLElement>('.chronicle-native-note')!, loading = root.querySelector<HTMLElement>('.chronicle-native-loading')!;
  const dismiss = root.querySelector<HTMLButtonElement>('.chronicle-native-dismiss')!;
  const abort = new AbortController(), pending = new Set<Engine>();
  const lightStatus = setInterval(() => { root.dataset.lightingReady = String(!!active?.engine.debug.lightingReady); root.dataset.settled = String(!!active?.engine.debug.fieldSettled); }, 250);
  let closed = false, active: { revision: string; engine: Engine; canvas: HTMLCanvasElement; lifetime: ReturnType<typeof createCandidateLifetime> } | undefined;
  let view: ReturnType<typeof mountChronicle> | undefined, data: DurableChronicle | undefined;
  let requestedRevision = '', sceneError: unknown;
  const liveWalk = options.liveEngine?.walkSelected() ?? false, liveDock = options.liveEngine?.inspect().dock.active ?? false;
  const resumeLive = options.liveEngine?.suspendRendering();
  const ownSound = options.liveEngine ? undefined : createKingdomSound(), audio = options.liveEngine?.sound ?? ownSound!;
  const sound = () => { void audio.unlock().catch(() => {}); audio.cue('wood'); };
  const clear = () => { active?.lifetime.dispose(); active?.engine.dispose(); active?.canvas.remove(); active = undefined; root.dataset.ready = 'false'; root.dataset.worldRevision = ''; };
  const close = (error?: unknown) => {
    if (closed) return; closed = true; abort.abort(); clearInterval(lightStatus);
    try { view?.dispose(); } catch (failure) { error ??= failure; }
    for (const engine of pending) engine.dispose(); pending.clear(); clear(); root.remove(); ownSound?.dispose();
    options.liveEngine?.selectWalk(liveWalk); options.liveEngine?.activateDock(liveDock); resumeLive?.();
    try { options.onClose?.(error); } finally { if (previousFocus?.isConnected) previousFocus.focus(); }
  };
  const trap = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => !element.hidden && element.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  root.addEventListener('keydown', trap); dismiss.addEventListener('click', () => { sound(); close(); });
  (options.host ?? document.body).append(root); dismiss.focus();
  options.liveEngine?.selectWalk(false); options.liveEngine?.activateDock(false); options.onOpen?.();

  const ready = (async () => {
    try {
      data = await readDurableChronicle(options.kingdomId, { signal: abort.signal });
      abort.signal.throwIfAborted();
      note.textContent = `${data.origin === 'simulated' ? 'SIMULATED · ' : ''}Recorded kingdom geometry. Historical lights and chat were not recorded.`;
      const focusPlot = changingPlot(data);
      const binding: ReplayBinding = {
        async replace(snapshot, signal) {
          signal?.throwIfAborted(); abort.signal.throwIfAborted();
          requestedRevision = snapshot.worldRevision; root.dataset.loading = 'true';
          if (active?.revision === snapshot.worldRevision) { loading.textContent = ''; root.dataset.loading = 'false'; return; }
          const world = data!.worlds.find(item => item.revision === snapshot.worldRevision);
          if (!world) throw new Error('The selected night has no complete kingdom geometry.');
          loading.textContent = 'Remembering the shape of this night…'; root.dataset.settled = 'false'; root.dataset.lightingReady = 'false';
          const canvas = document.createElement('canvas'); canvas.style.visibility = 'hidden'; canvas.setAttribute('aria-label', 'Recorded kingdom'); stage.append(canvas);
          const lifetime = createCandidateLifetime(signal, abort.signal);
          let engine: Engine | undefined, candidateError: unknown;
          try {
            const selected = world.scene.plan.homes.find(home => home.id === focusPlot);
            engine = await createKingdomScene(canvas, {
              replay: true, founded: world.scene, kingdomId: world.scene.kingdomId, tier: world.scene.plan.config.tier,
              seed: world.scene.plan.config.seed, firstYear: world.scene.plan.config.firstYear, year: world.scene.plan.config.year,
              hour: 17.8, time: 30, camera: selected ? 'window' : 'hero', ...(selected ? { focusSlot: selected.slot } : {}),
              source: world.scene.origin === 'simulated' ? 'simulated' : 'herald', presenceOrigin: world.scene.origin,
              presenceFeed: unrecordedPresence(world.scene.kingdomId, world.scene.origin, snapshot.frame.asOf),
              signal: lifetime.signal, onProgress: text => { if (!lifetime.signal.aborted && !closed) root.dataset.stage = text; }, onNames: () => {}, onSource: () => {}, onError: message => {
                candidateError = new Error(message);
                if (!lifetime.signal.aborted && !closed) {
                  sceneError = candidateError;
                  if (active?.engine === engine) { loading.textContent = 'The recorded kingdom could not render.'; view?.replay.load(null); }
                }
              },
            });
            pending.add(engine);
            await waitForDraw(engine, lifetime.signal, () => candidateError);
            signal?.throwIfAborted(); abort.signal.throwIfAborted();
            if (closed || requestedRevision !== snapshot.worldRevision) throw new DOMException('A newer night was selected.', 'AbortError');
            lifetime.promote(); clear(); active = { revision: snapshot.worldRevision, engine, canvas, lifetime }; pending.delete(engine);
            canvas.style.visibility = 'visible'; loading.textContent = ''; sceneError = undefined;
            root.dataset.ready = 'true'; root.dataset.loading = 'false'; root.dataset.worldRevision = snapshot.worldRevision;
          } catch (error) { lifetime.dispose(); if (engine) { pending.delete(engine); engine.dispose(); } canvas.remove(); throw error; }
        },
        clear,
        dispose() { clear(); },
      };
      loading.textContent = '';
      view = mountChronicle(panel, { binding, history: data.history, presentationLabel: data.history.label,
        simulationNote: data.origin === 'simulated' ? 'A simulated kingdom, reconstructed from its durable witnessed facts.' : '',
        sound, onClose: error => close(error) });
      dismiss.hidden = true;
      // Initial preparation is asynchronous. `ready` resolves only once its first actual engine frame is visible.
      if (data.history.snapshots.length) await waitUntil(() => !!active || view?.replay.state().status === 'unavailable', abort.signal);
      if (view.replay.state().status === 'unavailable') throw new Error('The kingdom’s recorded geometry is unavailable.');
    } catch (error) {
      if (closed || abort.signal.aborted) return;
      loading.textContent = 'The kingdom’s Chronicle is unavailable right now.';
      dismiss.hidden = !!view; sceneError = error;
    }
  })();
  return { close, ready, inspect: () => ({ closed, origin: data?.origin, state: view?.replay.state(), worldRevision: active?.revision, scene: active?.engine.inspect(), debug: active?.engine.debug, error: sceneError instanceof Error ? sceneError.message : null }) };
}

/** The log does not retain people or speech; an empty presentation must never fabricate a historic crowd. */
function unrecordedPresence(kingdomId: KingdomPresenceFrame['kingdomId'], origin: KingdomPresenceFrame['origin'], at: number): PresenceFeed {
  return { label: origin === 'live' ? 'LIVE' : 'SIMULATED', subscribe(receive) {
    receive({ version: 1, kingdomId, origin, epoch: 'chronicle-no-presence', sequence: 0, asOf: at, streamLive: false, connection: 'offline', windows: [] });
    return () => {};
  } };
}
function changingPlot(data: DurableChronicle): string | undefined {
  const previous = new Map<string, string>(), changes = new Map<string, number>();
  for (const snapshot of data.history.snapshots) for (const home of snapshot.homes) {
    if (previous.has(home.plotId) && previous.get(home.plotId) !== home.assetRevision) changes.set(home.plotId, (changes.get(home.plotId) ?? 0) + 1);
    previous.set(home.plotId, home.assetRevision);
  }
  return [...changes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
function waitUntil(check: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const tick = () => { if (signal.aborted) { cleanup(); reject(signal.reason); } else if (check()) { cleanup(); resolve(); } };
    const timer = setInterval(tick, 100);
    const cleanup = () => { clearInterval(timer); signal.removeEventListener('abort', tick); };
    signal.addEventListener('abort', tick, { once: true }); tick();
  });
}
async function waitForDraw(engine: Engine, signal: AbortSignal, failure: () => unknown) {
  await waitUntil(() => engine.debug.ready || !!failure(), signal);
  if (failure()) throw failure();
}
