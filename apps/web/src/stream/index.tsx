import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { CameraName } from '../kingdom/scene';
import { createSceneMount, type KingdomScene, type StreamPhase } from './mount';
import { parseStreamParams, type StreamLayout } from './params';
import { Corner, Crest, StreamDefs } from './fittings';
import './stream.css';

type SourceKind = 'simulated' | 'connecting' | 'live' | 'resting' | 'lost';
interface SourceMark { kind: SourceKind; title: string; note: string }

/** The renderer's own source words, told the way a stream should tell them. A fresh live kingdom needs no mark. */
function sourceMark(label: string): SourceMark {
  switch (label) {
    case 'SIMULATED': return { kind: 'simulated', title: 'SIMULATED', note: 'A demonstration night' };
    case 'LIVE CHAT': return { kind: 'live', title: '', note: '' };
    case 'STREAM RESTING': return { kind: 'resting', title: 'Stream resting', note: 'Every home keeps its place' };
    case 'CONNECTION LOST': return { kind: 'lost', title: 'Connection lost', note: 'Windows return when the kingdom answers' };
    default: return { kind: 'connecting', title: 'Finding the kingdom', note: 'Windows wait for chat' };
  }
}

const OUTPUT_SIZE: Record<StreamLayout, [number, number]> = { stage: [1280, 720], window: [480, 270], strip: [1280, 180] };
const LAYOUT_NAMES: Record<StreamLayout, string> = { stage: 'Stage', window: 'Corner window', strip: 'Bottom street' };
const RETRY_SECONDS = [15, 30, 60, 120];

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomKingdom?: unknown;
    __chatdomStream?: unknown;
    obsstudio?: unknown;
  }
}

export default function StreamView() {
  const params = parseStreamParams(location.search);
  const [layout, setLayout] = createSignal<StreamLayout>(params.layout);
  const [phase, setPhase] = createSignal<StreamPhase>('waking');
  const [progress, setProgress] = createSignal(0);
  const [label, setLabel] = createSignal(params.source === 'simulated' ? 'SIMULATED' : 'CONNECTING');
  const [fonts, setFonts] = createSignal(false);
  const [scale, setScale] = createSignal(1);
  const mark = () => sourceMark(label());
  const camera = (): CameraName => layout() === 'stage' ? params.camera : 'window';
  let hour = params.hour, picture!: HTMLDivElement, holder: HTMLDivElement | undefined, retryTimer = 0, attempts = 0, obsVisible = true;

  const mount = createSceneMount({
    host: () => picture,
    settings: () => ({ tier: params.tier, seed: params.seed, firstYear: params.firstYear, year: params.year, ...(params.kingdomId?{kingdomId:params.kingdomId}:{}), ...(params.focusSlot!==undefined?{focusSlot:params.focusSlot}:{}), hour, time: params.time, camera: camera(), source: params.source, presenceOrigin: params.presenceOrigin }),
    onPhase: next => {
      setPhase(next);
      if (next === 'ready') attempts = 0;
      if (next === 'failed') scheduleRetry();
    },
    onProgress: (_text, fraction) => setProgress(fraction),
    // A remounted real source starts unconfirmed: nothing seen before hiding is presented as fresh.
    onSource: setLabel,
    onScene: publishDebug,
  });

  function publishDebug(scene: KingdomScene | undefined): void {
    if (!scene) { delete window.__chatdomKingdom; return; }
    window.__chatdomKingdom = {
      stats: scene.debug,
      seek: (time: number, view?: CameraName) => scene.seek(time, view),
      hour: (value: number) => { hour = value; scene.setHour(value); },
      capture: (time: number) => scene.capture(time),
    };
  }

  const visible = () => document.visibilityState !== 'hidden' && obsVisible;
  function open(): void {
    window.clearTimeout(retryTimer);
    if (params.source !== 'simulated') setLabel('CONNECTING');
    setProgress(0);
    mount.mount();
  }
  function sync(): void {
    if (visible()) { if (phase() !== 'failed') open(); }
    else { window.clearTimeout(retryTimer); mount.unmount('hidden'); }
  }
  function scheduleRetry(): void {
    const seconds = RETRY_SECONDS[Math.min(attempts++, RETRY_SECONDS.length - 1)]!;
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => { if (visible()) open(); }, seconds * 1000);
  }
  const onObsVisible = (event: Event) => {
    obsVisible = (event as CustomEvent<{ visible?: boolean }>).detail?.visible !== false;
    sync();
  };

  function choose(next: StreamLayout): void {
    setLayout(next);
    mount.scene?.setCamera(camera());
  }

  onMount(() => {
    window.__chatdomReady = false;
    document.documentElement.classList.add('stream-document');
    if (params.preview) document.documentElement.classList.add('stream-preview-document');
    window.__chatdomStream = {
      stats: mount.stats,
      get phase() { return phase(); },
      get layout() { return layout(); },
      get source() { return mark().kind; },
    };
    void Promise.all(['400 30px "IM Fell English"', '400 14px "IM Fell English SC"', '700 14px Alegreya', 'italic 400 14px Alegreya']
      .map(font => document.fonts.load(font))).then(() => setFonts(true), () => setFonts(true));
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('obsSourceVisibleChanged', onObsVisible);
    // The preview shows the output at its real pixel size, scaled down only to fit the bench.
    const bench = holder;
    if (bench) {
      const fit = () => { const [width, height] = OUTPUT_SIZE[layout()]; setScale(Math.min(1, bench.clientWidth / width, bench.clientHeight / height)); };
      const observer = new ResizeObserver(fit);
      observer.observe(bench);
      createEffect(fit);
      onCleanup(() => observer.disconnect());
    }
    sync();
  });
  // Readiness is the renderer's: never a gate, a failure or a hidden source.
  createEffect(() => { window.__chatdomReady = phase() === 'ready' && fonts(); });
  onCleanup(() => {
    window.clearTimeout(retryTimer);
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('obsSourceVisibleChanged', onObsVisible);
    mount.unmount('hidden');
    window.__chatdomReady = false;
    delete window.__chatdomStream;
    document.documentElement.classList.remove('stream-document', 'stream-preview-document');
  });

  const output = <div class={`stream-output layout-${layout()}`} data-chatdom-kingdom data-chatdom-stream
    data-layout={layout()} data-phase={phase()} data-source={mark().kind} data-mood={params.mood} data-seam={params.seam ?? 'none'}
    style={params.preview ? { width: `${OUTPUT_SIZE[layout()][0]}px`, height: `${OUTPUT_SIZE[layout()][1]}px`, transform: `scale(${scale()})` } : undefined}>
    <div class="stream-picture" ref={element => { picture = element; }} />
    <div class="stream-shade" aria-hidden="true" />
    <div class="stream-frame" aria-hidden="true">
      <Corner at="tl" /><Corner at="tr" /><Corner at="bl" /><Corner at="br" />
    </div>
    <Show when={layout() === 'stage'}>
      <div class="stream-signature"><Crest /><span>{params.kingdomName}</span></div>
    </Show>
    <Show when={mark().kind !== 'live'}>
      <div class={`source-ribbon stream-mark ${mark().kind}`} role="status">
        <strong>{mark().title}</strong><Show when={layout() === 'stage'}><small>{mark().note}</small></Show>
      </div>
    </Show>
    <div class="stream-curtain" classList={{ open: phase() === 'ready', failed: phase() === 'failed' }} role="status" aria-live="polite">
      <Crest class="large" />
      <Switch>
        <Match when={phase() === 'failed'}>
          <div class="stream-gate kingdom-gate">
            <h2>{params.kingdomName} needs a moment</h2>
            <p>The gate will open again shortly.</p>
            <button type="button" onClick={open}>Try again now</button>
          </div>
        </Match>
        <Match when={true}>
          <h2>{params.kingdomName}</h2>
          <p>The lamps are being lit</p>
          <div class="stream-progress"><i style={{ transform: `scaleX(${Math.max(.04, progress())})` }} /></div>
        </Match>
      </Switch>
    </div>
  </div>;

  return <>
    <StreamDefs />
    <Show when={params.preview} fallback={output}>
      <div class="stream-bench">
        <header class="stream-bench-head">
          <div>
            <p class="stream-bench-eyebrow">Stream preview</p>
            <h1>{params.kingdomName}</h1>
          </div>
          <nav class="stream-bench-layouts" aria-label="Stream shape">
            <For each={['stage', 'window', 'strip'] as const}>{shape =>
              <button type="button" aria-pressed={layout() === shape} onClick={() => choose(shape)}>
                <span class={`stream-shape-glyph ${shape}`} aria-hidden="true" />{LAYOUT_NAMES[shape]}
              </button>}
            </For>
          </nav>
        </header>
        <div class="stream-bench-holder" ref={element => { holder = element; }}>{output}</div>
        <footer class="stream-bench-foot">
          <p>Add <code>{browserSourcePath(layout())}</code> as a browser source at {OUTPUT_SIZE[layout()][0] * (layout() === 'stage' ? 1.5 : 1)}×{OUTPUT_SIZE[layout()][1] * (layout() === 'stage' ? 1.5 : 1)}. These controls stay here; the source shows only the frame.</p>
          <Show when={params.source === 'simulated'}><p class="stream-bench-simulated">SIMULATED night: no chat is connected to this preview.</p></Show>
        </footer>
      </div>
    </Show>
  </>;
}

function browserSourcePath(layout: StreamLayout): string {
  const query = new URLSearchParams(location.search);
  query.delete('preview');
  if (layout === 'stage') query.delete('layout'); else query.set('layout', layout);
  const search = query.toString();
  return `${location.pathname}${search ? `?${search}` : ''}`;
}
