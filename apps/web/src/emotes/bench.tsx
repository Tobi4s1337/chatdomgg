import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
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
    __chatdomEmotes?: EmoteStageReport & { source: { id: string; origin: string; sourceHash: string; rendition: string; bytes: number }; decodeMs: number; compileMs: number; flatFrames: number };
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
  bytes: number;
  statue: CompiledEmote;
  stats: EmoteCompileStats;
  heraldry: CompiledEmote;
  decodeMs: number;
  compileMs: number;
}
interface FlatFrame { image: ImageData; durationMs: number }

/** Decoding and carving run on a worker; aborting terminates it, which frees every buffer at once. */
function compileInWorker(signal: AbortSignal): Promise<{ compiled: Compiled; frames: FlatFrame[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./compile-worker.ts', import.meta.url), { type: 'module', name: 'emote-compile' });
    const stop = () => { worker.terminate(); reject(new Error('The carving was cancelled.')); };
    signal.addEventListener('abort', stop, { once: true });
    worker.onerror = event => { signal.removeEventListener('abort', stop); worker.terminate(); reject(new Error(event.message || 'The carving worker failed.')); };
    worker.onmessage = (event: MessageEvent<BenchCompileReply>) => {
      signal.removeEventListener('abort', stop); worker.terminate();
      const reply = event.data;
      if (!reply.ok) { reject(new Error(reply.message)); return; }
      const { width, height } = reply.flat;
      const frames = reply.flat.frames.map(frame => ({
        image: new ImageData(new Uint8ClampedArray(frame.rgba.buffer as ArrayBuffer, frame.rgba.byteOffset, frame.rgba.byteLength), width, height),
        durationMs: frame.durationMs,
      }));
      resolve({ compiled: { source: reply.source, bytes: reply.bytes, statue: reply.statue, stats: reply.statueStats, heraldry: reply.heraldry, decodeMs: reply.decodeMs, compileMs: reply.compileMs }, frames });
    };
    worker.postMessage({ palette: BENCH_PALETTE, paletteRevision: PALETTE_REVISION } satisfies BenchCompileRequest);
  });
}

/** Draws one decoded frame at a given CSS size, smoothly, as chat would show it. */
function FlatEmote(props: { image: ImageData; size: number; label: string; class?: string }) {
  let canvas!: HTMLCanvasElement;
  const paint = (image: ImageData) => {
    const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = props.size * ratio; canvas.height = props.size * ratio;
    const scratch = document.createElement('canvas');
    scratch.width = image.width; scratch.height = image.height;
    scratch.getContext('2d')!.putImageData(image, 0, 0);
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
  };
  onMount(() => createEffect(() => paint(props.image)));
  return <canvas ref={element => { canvas = element; }} class={props.class} role="img" aria-label={props.label} style={{ width: `${props.size}px`, height: `${props.size}px` }} />;
}

export default function EmoteBench() {
  let host!: HTMLDivElement;
  const initial = parseEmoteBench(window.location.search);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  // Reduced motion holds the wave at its highest pose until someone presses Play.
  const heldFrame = initial.frame ?? (reducedMotion ? 3 : null);
  const grade = getEnvironment(initial.hour);
  const [view, setView] = createSignal<BenchView>(initial.view);
  const [status, setStatus] = createSignal('Decoding the GIF and carving every frame…');
  const [failed, setFailed] = createSignal(false);
  const [compiled, setCompiled] = createSignal<Compiled>();
  const [frames, setFrames] = createSignal<FlatFrame[]>([]);
  const [shown, setShown] = createSignal(heldFrame ?? 0);
  const [playing, setPlaying] = createSignal(heldFrame === null);
  const controller = new AbortController();
  let stage: EmoteStage | null = null, disposed = false;

  const publish = (ready: boolean) => {
    const c = compiled();
    if (stage && c) {
      window.__chatdomEmotes = {
        ...stage.report(), source: { id: c.source.id, origin: c.source.origin, sourceHash: c.source.sourceHash, rendition: c.source.rendition, bytes: c.bytes },
        decodeMs: Math.round(c.decodeMs), compileMs: Math.round(c.compileMs), flatFrames: frames().length,
      };
    }
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
  const toggle = () => { const next = !playing(); setPlaying(next); stage?.setPlaying(next); };
  const onResize = () => { if (!stage) return; window.__chatdomReady = false; stage.resize(); publish(true); };

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomEmotes; delete window.__chatdomEmotesError;
    void (async () => {
      const result = await compileInWorker(controller.signal);
      if (disposed) return;
      setCompiled(result.compiled); setFrames(result.frames);
      setStatus('Setting the statue on its plinth…');
      stage = await createEmoteStage({ host, view: view(), hour: initial.hour, statue: result.compiled.statue, heraldry: result.compiled.heraldry, frame: heldFrame, isDisposed: () => disposed });
      if (!stage || disposed) return;
      host.querySelector('canvas')?.setAttribute('aria-label', `The SIMULATED toadWave statue waving in the plaza, ${view()} view`);
      stage.onFrame(setShown);
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
  const current = () => frames()[shown()];
  return <section class="emote-bench" style={{ background: `radial-gradient(ellipse at 38% 68%, #ffb86a26, transparent 58%), linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 74%, ${grade.fog} 100%)` }}>
    <div class="emote-bench-stage" ref={element => { host = element; }} />
    <header class="emote-bench-title">
      <span>CHATDOM · EMOTE WORKSHOP</span>
      <strong>toadWave, carved and waving</strong>
    </header>
    <small class="simulated" title="Original bench art drawn for this workshop, not a channel’s emote">SIMULATED</small>
    <aside class="emote-plaque" aria-label="Sculptor’s card">
      <div class="emote-plaque-views" role="group" aria-label="Look at the statue from">
        <For each={BENCH_VIEWS}>{option =>
          <button type="button" aria-pressed={view() === option} onClick={() => choose(option)}>{VIEW_LABELS[option]}</button>}
        </For>
        <button type="button" class="play" aria-pressed={playing()} aria-label={playing() ? 'Hold the wave' : 'Play the wave'} onClick={toggle}>{playing() ? 'Hold' : 'Play'}</button>
      </div>
      <Show when={compiled()} fallback={<p class="emote-plaque-wait">The sculptor is at work.</p>}>{c => <>
        <div class="emote-plaque-flat">
          <Show when={current()}>{frame => <>
            <figure><FlatEmote image={frame().image} size={72} label={`toadWave, flat frame ${shown() + 1} of ${frames().length}`} /><figcaption>Flat GIF</figcaption></figure>
            <figure class="chat"><p><span>simulated</span> hi chat <FlatEmote image={frame().image} size={28} label="toadWave" /></p><figcaption>At chat size</figcaption></figure>
          </>}</Show>
        </div>
        <div class="emote-plaque-frames">
          <span>{frames().length} frames, one origin</span>
          <ol aria-label="Decoded frames">
            <For each={frames()}>{(frame, index) =>
              <li aria-current={index() === shown() ? 'true' : undefined}>
                <FlatEmote image={frame.image} size={30} label={`Frame ${index() + 1}, ${frame.durationMs} ms`} />
                <small>{frame.durationMs}</small>
              </li>}
            </For>
          </ol>
        </div>
        <dl class="emote-plaque-facts">
          <div><dt>Stands</dt><dd>{metres(size()![1])} on a 1.00 m plinth</dd></div>
          <div><dt>Carved</dt><dd>{metres(size()![0])} wide · {size()![2]} cells deep</dd></div>
          <div><dt>Plays</dt><dd>{(c().statue.periodMs / 1000).toFixed(2)} s loop · {c().statue.frames.length} carved frames</dd></div>
          <div><dt>Source</dt><dd>GIF · {c().bytes.toLocaleString('en')} bytes · <code>{c().source.sourceHash.slice(0, 12)}</code></dd></div>
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
        <div class="emote-plaque-review">
          <strong>Catalogue · not connected</strong>
          <p>No Twitch reader is bound to this workshop, so it carves its own bench art. 7TV, BetterTTV and FrankerFaceZ stay off until the monarch opts in.</p>
        </div>
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
