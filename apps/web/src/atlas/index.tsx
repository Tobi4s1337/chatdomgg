import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import './atlas.css';
import { adoptPreview, loadPreview, type LoadedPreview } from './data/load';
import { geographyOf, SettlerStore, type Settler } from './data/model';
import { fetchChunk, fetchNames, PreviewError, type PreviewSource } from './data/preview';
import { MAX_SCALE, type Distance } from './map/camera';
import { MapView } from './map/view';
import { Card, type NamesState } from './ui/Card';
import { Cartouche, Compass, Controls, Notice, ScaleBar } from './ui/chrome';
import { formatMoment } from './ui/format';
import { LegendBody } from './ui/Legend';

type State = 'loading' | 'ready' | 'empty' | 'unavailable' | 'invalid' | 'unsupported';

declare global {
  interface Window { __chatdomReady?: boolean }
}

const SOURCE: PreviewSource = { base: '/map-data', fetch: (input, init) => fetch(input, init) };
/** Open maps re-read the names projection this often, so withholding and refreshed names reach them. */
const NAMES_REFRESH_MS = 5 * 60_000;
const FACES = ['16px "IM Fell English"', 'italic 16px "IM Fell English"', '16px "IM Fell English SC"', '16px "Alegreya"', 'italic 16px "Alegreya"'];

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Fonts are part of the drawing: labels are set only once the faces are in (or after a short grace). */
async function loadFaces(): Promise<void> {
  if (!('fonts' in document)) return;
  const all = Promise.all(FACES.map((face) => document.fonts.load(face, 'Atlas Кириллица'))).then(() => undefined);
  await Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * The Atlas of Kingdoms: a survey preview of real Twitch channels drawn as draft land. One root element carries
 * `data-chatdom-atlas` and the state; `window.__chatdomReady` turns true when the first view is fully drawn (or
 * when the page has settled on a designed failure state).
 */
export default function Atlas() {
  let host: HTMLDivElement | undefined;
  let view: MapView | null = null;
  let controller: AbortController | null = null;
  let store: SettlerStore | null = null;
  let namesTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const [state, setState] = createSignal<State>('loading');
  const [loaded, setLoaded] = createSignal<LoadedPreview | null>(null);
  const [selected, setSelected] = createSignal<Settler | null>(null);
  const [scale, setScale] = createSignal(1);
  const [minScale, setMinScale] = createSignal(0);
  const [distance, setDistance] = createSignal<Distance>('world');
  const [keyOpen, setKeyOpen] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [phone, setPhone] = createSignal(false);
  const [names, setNames] = createSignal<NamesState>('loading');
  /** Bumped whenever names change on the same holdings, so the card follows them. */
  const [namesTick, setNamesTick] = createSignal(0);

  const settle = () => {
    window.__chatdomReady = true;
  };

  const measure = () => setPhone(window.innerWidth < 720);
  const onKey = (event: KeyboardEvent) => {
    // The open key is the top surface on a phone when no card is showing; the card handles its own Escape.
    if (event.key === 'Escape' && keyOpen() && !selected()) {
      setKeyOpen(false);
      host?.focus({ preventScroll: true });
    }
  };

  const choose = (settler: Settler | null) => {
    setSelected(settler);
    if (settler) setKeyOpen(false);
    const sheet = phone() ? Math.min(window.innerHeight * 0.5, 420) : 0;
    view?.select(settler, { right: phone() ? 0 : 380, bottom: sheet });
  };

  const closeCard = () => {
    choose(null);
    host?.focus({ preventScroll: true });
  };

  /** Names changed under the open map (the view redraws on the store's version): follow them on the card, and drop a withheld selection. */
  const namesChanged = () => {
    setNamesTick(namesTick() + 1);
    if (selected()?.withheld) closeCard();
  };

  /** Drop each name the moment it goes stale, even if the service cannot be reached to say so. */
  const scheduleExpiry = (target: SettlerStore) => {
    clearTimeout(expiryTimer);
    const next = target.expireNames();
    if (Number.isFinite(next)) expiryTimer = setTimeout(() => {
      if (store !== target) return;
      scheduleExpiry(target);
      namesChanged();
    }, Math.min(2_147_000_000, Math.max(1_000, next - Date.now() + 50)));
  };

  /** Read the names projection; a failure keeps the names already held (they still expire on time). */
  async function readNames(target: SettlerStore, worldId: string, signal: AbortSignal): Promise<void> {
    clearTimeout(namesTimer);
    try {
      target.applyNames(await fetchNames(SOURCE, { id: worldId }, signal));
      if (signal.aborted || store !== target) return;
      setNames('ready');
      if (notice()?.startsWith('Channel names')) setNotice(null);
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError' || store !== target) return;
      if (!target.named) {
        setNames('failed');
        setNotice('Channel names could not be read. The land and each channel’s arms are drawn; names return when the Atlas service answers.');
      }
    }
    scheduleExpiry(target);
    namesChanged();
    namesTimer = setTimeout(() => void readNames(target, worldId, signal), NAMES_REFRESH_MS);
  }

  async function start(): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    clearTimeout(namesTimer);
    clearTimeout(expiryTimer);
    window.__chatdomReady = false;
    setState('loading');
    setNames('loading');
    try {
      if (!webglAvailable()) {
        setState('unsupported');
        settle();
        return;
      }
      const [preview] = await Promise.all([loadPreview(SOURCE, sessionStore(), signal), loadFaces()]);
      if (signal.aborted) return;
      setLoaded(preview);
      const { world } = preview;
      const settlers = new SettlerStore(world);
      store = settlers;
      const geo = geographyOf(world);
      // Names travel beside the land: the first view waits for both (or for the names to fail on their own).
      let mapDrawn = false;
      let namesSettled = false;
      const reveal = () => {
        if (!mapDrawn || !namesSettled || signal.aborted) return;
        setState('ready');
        settle();
      };
      void readNames(settlers, world.id, signal).then(() => {
        namesSettled = true;
        reveal();
      });
      view?.dispose();
      if (!host) return;
      view = await MapView.create(host, {
        world,
        geo,
        store: settlers,
        loadChunk: async (region) => settlers.addChunk(await fetchChunk(SOURCE, world, region, signal)),
      }, {
        ready: () => {
          mapDrawn = true;
          reveal();
        },
        select: choose,
        camera: (camera) => {
          setScale(camera.scale);
          setMinScale(camera.minScale);
          setDistance(camera.distance);
        },
        chunkFailed: (region) => {
          const name = world.regions[region]?.name ?? 'one land';
          setNotice(`The towns and villages of ${name} could not be read. The land and its cities are still drawn.`);
        },
      }, (size) => {
        if (size.width < 720) return { left: 0, right: 0, top: 76, bottom: 60 };
        if (size.width >= 1100) return { left: 370, right: 0, top: 0, bottom: 0 };
        return { left: 0, right: 0, top: 0, bottom: 0 };
      });
      if (signal.aborted) return;
      if (preview.newer) setNotice(`A newer survey is ready (observed to ${formatMoment(preview.newer.asOf)}).`);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      if (error instanceof PreviewError) setState(error.reason === 'mismatch' ? 'invalid' : error.reason);
      else if (/webgl|context/i.test(String((error as Error).message))) setState('unsupported');
      else setState('unavailable');
      settle();
    }
  }

  onMount(() => {
    document.title = 'The Atlas of Kingdoms · Chatdom';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#e2d3ae');
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('keydown', onKey);
    void start();
  });
  onCleanup(() => {
    window.removeEventListener('resize', measure);
    window.removeEventListener('keydown', onKey);
    clearTimeout(namesTimer);
    clearTimeout(expiryTimer);
    store = null;
    controller?.abort();
    view?.dispose();
    view = null;
  });

  const adoptNewer = () => {
    const newer = loaded()?.newer;
    if (!newer) return;
    adoptPreview(sessionStore(), newer);
    setNotice(null);
    setSelected(null);
    void start();
  };

  const world = () => loaded()?.world ?? null;
  const asOf = () => {
    const w = world();
    return w ? new Date(w.asOf).toISOString() : undefined;
  };

  return (
    <div
      class="atlas"
      data-chatdom-atlas=""
      data-state={state()}
      data-preview={world()?.id}
      data-revision={world()?.revision}
      data-as-of={asOf()}
      data-distance={distance()}
      data-layout={phone() ? 'phone' : 'laptop'}
      data-names={names()}
    >
      <div
        ref={(element) => (host = element)}
        class="atlas-map"
        tabindex="0"
        role="application"
        aria-roledescription="map"
        aria-label="The Atlas of Kingdoms, a survey preview. Arrow keys pan, plus and minus zoom, 0 shows the whole map."
      />

      <Show when={world()}>
        {(w) => (
          <>
            <Cartouche world={w()} />
            <Show when={!phone()}><Compass size={92} /></Show>
            <Show when={phone()}><Compass size={46} /></Show>
            <aside class="atlas-key" data-open={keyOpen() ? 'true' : 'false'} aria-label="Key">
              <button type="button" class="atlas-key-toggle" aria-expanded={!phone() || keyOpen()} onClick={() => setKeyOpen(!keyOpen())}>
                Key
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5L6 4.5l3 3" /></svg>
              </button>
              <div class="atlas-key-body"><LegendBody world={w()} /></div>
            </aside>
            <div class="atlas-bottom">
              <ScaleBar scale={scale()} />
              <Controls
                onZoomIn={() => view?.zoomBy(1.8)}
                onZoomOut={() => view?.zoomBy(1 / 1.8)}
                onHome={() => view?.home()}
                canZoomIn={scale() < MAX_SCALE * 0.999}
                canZoomOut={scale() > minScale() * 1.001}
              />
            </div>
            <Show when={selected()}>
              {(settler) => (
                <Card
                  settler={settler()}
                  name={(namesTick(), settler().name)}
                  login={(namesTick(), settler().login)}
                  names={names()}
                  world={w()}
                  onClose={closeCard}
                />
              )}
            </Show>
            <Show when={notice()}>
              {(text) => (
                <Notice action={loaded()?.newer ? { label: 'Open it', run: adoptNewer } : undefined} onDismiss={() => void setNotice(null)}>
                  {text()}
                </Notice>
              )}
            </Show>
          </>
        )}
      </Show>

      <Switch>
        <Match when={state() === 'loading'}>
          <div class="atlas-veil" aria-live="polite">
            <div class="atlas-veil-inner">
              <p class="atlas-eyebrow">Chatdom</p>
              <p class="atlas-veil-title">The Atlas of Kingdoms</p>
              <svg class="atlas-quill" viewBox="0 0 240 40" aria-hidden="true">
                <path d="M6 26c22-14 38 6 58-4s26-16 44-6 30 10 46 2 30-14 48-4 22 8 32 4" />
              </svg>
              <p class="atlas-veil-text">Inking the coasts…</p>
            </div>
          </div>
        </Match>
        <Match when={state() !== 'ready'}>
          <div class="atlas-veil atlas-failure" role="alert">
            <div class="atlas-veil-inner">
              <p class="atlas-eyebrow">The Atlas of Kingdoms</p>
              <Switch>
                <Match when={state() === 'empty'}>
                  <h1 class="atlas-veil-title">The surveyors are still out</h1>
                  <p class="atlas-veil-text">No survey has been published yet. The first preview is drawn as soon as one arrives.</p>
                </Match>
                <Match when={state() === 'invalid'}>
                  <h1 class="atlas-veil-title">This copy failed its seal</h1>
                  <p class="atlas-veil-text">The survey files did not match the hashes they were published with, so nothing was drawn from them.</p>
                </Match>
                <Match when={state() === 'unsupported'}>
                  <h1 class="atlas-veil-title">This browser cannot draw the map</h1>
                  <p class="atlas-veil-text">The Atlas paints with WebGL, which is switched off or missing here. A current Chrome, Edge, Firefox or Safari will draw it.</p>
                </Match>
                <Match when={true}>
                  <h1 class="atlas-veil-title">The map room is closed</h1>
                  <p class="atlas-veil-text">The Atlas service could not be reached. Nothing has been lost; try again in a moment.</p>
                </Match>
              </Switch>
              <Show when={state() !== 'unsupported'}>
                <button type="button" class="atlas-button" onClick={() => void start()}>Try again</button>
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
