import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { MAT, MATERIALS } from '@chatdom/content';
import { getEnvironment } from '@chatdom/render';
import type { CompiledEmote, EmoteCompileStats, EmoteSource } from '../../../../packages/emotes/src/index';
import type { BenchCompileReply, BenchCompileRequest } from './compile-worker';
import { BENCH_VIEWS, parseEmoteBench, type BenchView } from './params';
import { createEmoteStage, type EmoteStage, type EmoteStageReport } from './stage';
import './style.css';

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomEmotes?: EmoteStageReport & { source: { id: string; origin: string; sourceHash: string }; compileMs: number };
    __chatdomEmotesError?: string;
  }
}

/**
 * The bench kingdom's explicit sculpting palette: stone, plaster and fabric swatches from the real
 * registry. A kingdom chooses its own subset; nothing outside it can reach the plaza.
 */
const BENCH_PALETTE: readonly number[] = [
  MAT.stone, MAT.limestone, MAT.darkStone, MAT.cream, MAT.plaster, MAT.cloth, MAT.moss, MAT.grass, MAT.leaf, MAT.fabricGreen,
  MAT.fabricMutedGreen, MAT.goldLeaf, MAT.fabricGold, MAT.brass, MAT.terracotta, MAT.fabricRed, MAT.petal, MAT.hairBlack, MAT.slate, MAT.timber, MAT.bark,
];
const PALETTE_REVISION = 1;
const VIEW_LABELS: Record<BenchView, string> = { front: 'Front', side: 'Side', banner: 'Banner' };
const material = (id: number) => MATERIALS.materials.find(m => m.id === id);
const metres = (cells: number) => `${(cells * .125).toFixed(2)} m`;

interface Compiled {
  source: EmoteSource;
  statue: CompiledEmote;
  stats: EmoteCompileStats;
  heraldry: CompiledEmote;
  elapsedMs: number;
}

function compileInWorker(signal: AbortSignal): Promise<{ compiled: Compiled; flat: ImageData }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./compile-worker.ts', import.meta.url), { type: 'module', name: 'emote-compile' });
    const stop = () => { worker.terminate(); reject(new Error('The carving was cancelled.')); };
    signal.addEventListener('abort', stop, { once: true });
    worker.onerror = event => { signal.removeEventListener('abort', stop); worker.terminate(); reject(new Error(event.message || 'The carving worker failed.')); };
    worker.onmessage = (event: MessageEvent<BenchCompileReply>) => {
      signal.removeEventListener('abort', stop); worker.terminate();
      const reply = event.data;
      if (!reply.ok) { reject(new Error(reply.message)); return; }
      const flat = new ImageData(new Uint8ClampedArray(reply.flat.rgba.buffer as ArrayBuffer, reply.flat.rgba.byteOffset, reply.flat.rgba.byteLength), reply.flat.width, reply.flat.height);
      resolve({ compiled: { source: reply.source, statue: reply.statue, stats: reply.statueStats, heraldry: reply.heraldry, elapsedMs: reply.elapsedMs }, flat });
    };
    worker.postMessage({ palette: BENCH_PALETTE, paletteRevision: PALETTE_REVISION } satisfies BenchCompileRequest);
  });
}

/** Draws the flat source at a given CSS size into a canvas, smoothly, as chat would show it. */
function FlatEmote(props: { image: ImageData; size: number; label: string }) {
  let canvas!: HTMLCanvasElement;
  onMount(() => {
    const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = props.size * ratio; canvas.height = props.size * ratio;
    const scratch = document.createElement('canvas');
    scratch.width = props.image.width; scratch.height = props.image.height;
    scratch.getContext('2d')!.putImageData(props.image, 0, 0);
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
  });
  return <canvas ref={element => { canvas = element; }} role="img" aria-label={props.label} style={{ width: `${props.size}px`, height: `${props.size}px` }} />;
}

export default function EmoteBench() {
  let host!: HTMLDivElement;
  const initial = parseEmoteBench(window.location.search);
  const grade = getEnvironment(initial.hour);
  const [view, setView] = createSignal<BenchView>(initial.view);
  const [status, setStatus] = createSignal('Carving the sculpture from the flat emote…');
  const [failed, setFailed] = createSignal(false);
  const [compiled, setCompiled] = createSignal<Compiled>();
  const [flat, setFlat] = createSignal<ImageData>();
  const controller = new AbortController();
  let stage: EmoteStage | null = null, disposed = false;

  const publish = (ready: boolean) => {
    const c = compiled();
    if (stage && c) window.__chatdomEmotes = { ...stage.report(), source: { id: c.source.id, origin: c.source.origin, sourceHash: c.source.sourceHash }, compileMs: Math.round(c.elapsedMs) };
    window.__chatdomReady = ready;
  };
  const choose = (next: BenchView) => {
    if (next === view()) return;
    setView(next);
    if (!stage) return;
    window.__chatdomReady = false;
    stage.setView(next);
    publish(true);
  };
  const onResize = () => { if (!stage) return; window.__chatdomReady = false; stage.resize(); publish(true); };

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomEmotes; delete window.__chatdomEmotesError;
    void (async () => {
      const { compiled: result, flat: image } = await compileInWorker(controller.signal);
      if (disposed) return;
      setCompiled(result); setFlat(image);
      setStatus('Setting the statue on its plinth…');
      stage = await createEmoteStage({ host, view: view(), hour: initial.hour, statue: result.statue, heraldry: result.heraldry, isDisposed: () => disposed });
      if (!stage || disposed) return;
      host.querySelector('canvas')?.setAttribute('aria-label', `The SIMULATED toadWave statue in the plaza, ${view()} view`);
      window.addEventListener('resize', onResize);
      setStatus('');
      publish(true);
    })().catch(error => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      window.__chatdomEmotesError = message;
      setStatus(message); setFailed(true);
      console.error(message);
    });
  });
  onCleanup(() => {
    disposed = true; controller.abort();
    window.removeEventListener('resize', onResize);
    stage?.dispose(); stage = null;
    window.__chatdomReady = false;
  });

  const size = () => compiled()?.statue.frames[0]!.blueprint.size;
  return <section class="emote-bench" style={{ background: `linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 74%, ${grade.fog} 100%)` }}>
    <div class="emote-bench-stage" ref={element => { host = element; }} />
    <header class="emote-bench-title">
      <span>CHATDOM · EMOTE WORKSHOP</span>
      <strong>toadWave, carved for the plaza</strong>
      <small class="simulated">SIMULATED source · original bench art, not a channel’s emote</small>
    </header>
    <aside class="emote-plaque" aria-label="Sculptor’s card">
      <div class="emote-plaque-views" role="group" aria-label="Look at the statue from">
        <For each={BENCH_VIEWS}>{option =>
          <button type="button" aria-pressed={view() === option} onClick={() => choose(option)}>{VIEW_LABELS[option]}</button>}
        </For>
      </div>
      <Show when={compiled()} fallback={<p class="emote-plaque-wait">The sculptor is at work.</p>}>{c => <>
        <div class="emote-plaque-flat">
          <Show when={flat()}>{image => <>
            <figure><FlatEmote image={image()} size={72} label="toadWave as a flat emote" /><figcaption>Flat source</figcaption></figure>
            <figure class="chat"><p><span>simulated</span> nice wave <FlatEmote image={image()} size={28} label="toadWave" /></p><figcaption>At chat size</figcaption></figure>
          </>}</Show>
        </div>
        <dl class="emote-plaque-facts">
          <div><dt>Stands</dt><dd>{metres(size()![1])} on a 1.00 m plinth</dd></div>
          <div><dt>Carved</dt><dd>{metres(size()![0])} wide · {size()![2]} cells deep, bevelled</dd></div>
          <div><dt>Geometry</dt><dd>{c().stats.occupiedCells.toLocaleString('en')} cells · {c().stats.boxes.toLocaleString('en')} boxes</dd></div>
          <div><dt>Revision</dt><dd><code>{c().statue.revision}</code></dd></div>
        </dl>
        <div class="emote-plaque-palette">
          <span>Kingdom stone and cloth it uses</span>
          <ul>
            <For each={c().stats.materials}>{id => {
              const m = material(id);
              return <li title={m?.name}><i style={{ background: m?.colour }} /><span>{m?.name.replace(/([A-Z])/g, ' $1').toLowerCase()}</span></li>;
            }}</For>
          </ul>
        </div>
        <p class="emote-plaque-review"><strong>SIMULATED · preview only</strong> This workshop has no review or unveiling service connected.</p>
      </>}</Show>
    </aside>
    <Show when={status()}>
      <div class="emote-bench-status" role={failed() ? 'alert' : 'status'}>
        <strong>{failed() ? 'The statue could not be carved' : 'At the sculptor’s bench'}</strong>
        <p>{status()}</p>
      </div>
    </Show>
  </section>;
}
