import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { MAT, MATERIALS } from '@chatdom/content';
import { getEnvironment } from '@chatdom/render';
import { EMOTE_CHAT_TUNING, type ApprovedEmoteVisual, type CompiledEmote, type EmoteCatalogueView, type EmotePurpose, type EmoteSource, type InlineEmoteVisual } from '../../../../packages/emotes/src/index';
import type { BenchCatalogue, BenchCompileReply, BenchCompileRequest, BenchDailyCheck } from './compile-worker';
import { createInlineEmoteImages, EmoteChatBubble, EmoteChatPop, EmoteImage } from './inline';
import type { ChatOverlay } from './kingdom-chat';
import { createKingdomEmoteStage, type KingdomEmoteStage, type KingdomEmoteStageReport } from './kingdom-stage';
import { BENCH_VIEWS, parseEmoteBench, type BenchView, type SquareView, type WorkshopView } from './params';
import { createEmoteStage, type EmoteStage, type EmoteStageReport } from './stage';
import './style.css';

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomEmotes?: (EmoteStageReport | KingdomEmoteStageReport) & { source: { id: string; origin: string; sourceHash: string; rendition: string; bytes: number }; decodeMs: number; compileMs: number; flatFrames: number; check?: BenchDailyCheck };
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
const VIEW_LABELS: Record<BenchView, string> = { kingdom: 'Square', chat: 'Chat', check: 'Daily check', front: 'Front', side: 'Side', banner: 'Banner' };
const WORKSHOP_VIEWS = BENCH_VIEWS.filter((v): v is WorkshopView => v !== 'kingdom' && v !== 'chat' && v !== 'check');
/** The raised kingdom's views; the daily check is a later evening of its own, reached by its own URL. */
const RAISED_VIEWS = BENCH_VIEWS.filter(v => v !== 'check');
const isKingdom = (view: BenchView): view is SquareView => view === 'kingdom' || view === 'chat' || view === 'check';
const material = (id: number) => MATERIALS.materials.find(m => m.id === id);
const metres = (cells: number) => `${(cells * .125).toFixed(2)} m`;

interface Compiled {
  source: EmoteSource;
  bytes: number;
  statue: CompiledEmote;
  /** Kingdom materials the approved statue uses, in registry order. */
  materials: readonly number[];
  heraldry: CompiledEmote;
  effect: CompiledEmote;
  inline: InlineEmoteVisual | null;
  catalogue: BenchCatalogue;
  decodeMs: number;
  compileMs: number;
}
interface FlatFrame { image: ImageData; durationMs: number }

/** The evening after the daily check: what the read found, chat's new flat image and the source it came from. */
interface Checked { check: BenchDailyCheck; source: EmoteSource; bytes: number; inline: InlineEmoteVisual | null; decodeMs: number; compileMs: number }

/** Decoding and carving run on a worker; aborting terminates it, which frees every buffer at once. */
function compileInWorker(signal: AbortSignal, mode: BenchCompileRequest['mode']): Promise<{ compiled: Compiled; frames: FlatFrame[] } | { checked: Checked }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./compile-worker.ts', import.meta.url), { type: 'module', name: 'emote-compile' });
    const stop = () => { worker.terminate(); reject(new Error('The carving was cancelled.')); };
    signal.addEventListener('abort', stop, { once: true });
    worker.onerror = event => { signal.removeEventListener('abort', stop); worker.terminate(); reject(new Error(event.message || 'The carving worker failed.')); };
    worker.onmessage = (event: MessageEvent<BenchCompileReply>) => {
      signal.removeEventListener('abort', stop); worker.terminate();
      const reply = event.data;
      if (!reply.ok) { reject(new Error(reply.message)); return; }
      if (reply.check) { resolve({ checked: { check: reply.check, source: reply.source, bytes: reply.bytes, inline: reply.inline, decodeMs: reply.decodeMs, compileMs: reply.compileMs } }); return; }
      const { width, height } = reply.flat;
      const frames = reply.flat.frames.map(frame => ({
        image: new ImageData(new Uint8ClampedArray(frame.rgba.buffer as ArrayBuffer, frame.rgba.byteOffset, frame.rgba.byteLength), width, height),
        durationMs: frame.durationMs,
      }));
      resolve({ compiled: { source: reply.source, bytes: reply.bytes, statue: reply.statue, materials: reply.statueMaterials, heraldry: reply.heraldry, effect: reply.effect, inline: reply.inline, catalogue: reply.catalogue, decodeMs: reply.decodeMs, compileMs: reply.compileMs }, frames });
    };
    worker.postMessage({ palette: BENCH_PALETTE, paletteRevision: PALETTE_REVISION, mode } satisfies BenchCompileRequest);
  });
}

/**
 * The page's view of the public catalogue the worker resolved: the approved revisions and the verified
 * flat image, nothing else. Unknown IDs and other purposes resolve to null, exactly as the service does.
 */
function benchCatalogue(c: Compiled): EmoteCatalogueView {
  const approved: Partial<Record<EmotePurpose, ApprovedEmoteVisual>> = {};
  for (const visual of [c.statue, c.heraldry, c.effect]) {
    approved[visual.purpose] = { id: visual.id, revision: visual.revision, origin: visual.origin, purpose: visual.purpose, frames: visual.frames, periodMs: visual.periodMs, mask: visual.mask };
  }
  return {
    kingdomId: c.catalogue.kingdomId as EmoteCatalogueView['kingdomId'], revision: c.catalogue.revision, checkedAt: 0, health: c.catalogue.health,
    resolveApprovedEmote: (id, purpose) => id === c.source.id ? approved[purpose] ?? null : null,
    resolveInlineEmote: id => id === c.source.id && c.inline ? { ...c.inline, bytes: c.inline.bytes.slice() } : null,
  };
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
  const [checked, setChecked] = createSignal<Checked>();
  const [frames, setFrames] = createSignal<FlatFrame[]>([]);
  const [shown, setShown] = createSignal(heldFrame ?? 0);
  const [playing, setPlaying] = createSignal(heldFrame === null);
  const controller = new AbortController();
  let stage: EmoteStage | KingdomEmoteStage | null = null, disposed = false, mounting = 0;
  // Chat over the square: bubbles and lifted emotes keyed by cue, so an image is made once per message.
  const [overlay, setOverlay] = createStore<{ bubbles: ChatOverlay['bubbles'][number][]; pops: ChatOverlay['pops'][number][] }>({ bubbles: [], pops: [] });
  const showOverlay = (next: ChatOverlay) => { setOverlay('bubbles', reconcile([...next.bubbles], { key: 'cueId' })); setOverlay('pops', reconcile([...next.pops], { key: 'cueId' })); };
  const images = createInlineEmoteImages();

  const publish = (ready: boolean) => {
    const c = compiled(), k = checked();
    if (stage && k) {
      window.__chatdomEmotes = {
        ...stage.report(), source: { id: k.source.id, origin: k.source.origin, sourceHash: k.source.sourceHash, rendition: k.source.rendition, bytes: k.bytes },
        decodeMs: Math.round(k.decodeMs), compileMs: Math.round(k.compileMs), flatFrames: 0, check: k.check,
      };
    }
    if (stage && c) {
      window.__chatdomEmotes = {
        ...stage.report(), source: { id: c.source.id, origin: c.source.origin, sourceHash: c.source.sourceHash, rendition: c.source.rendition, bytes: c.bytes },
        decodeMs: Math.round(c.decodeMs), compileMs: Math.round(c.compileMs), flatFrames: frames().length,
      };
    }
    window.__chatdomReady = ready;
  };
  /** The square and the workshop plaza are different stages; moving between them rebuilds the scene. */
  const mount = async (next: BenchView, c: Compiled) => {
    const ticket = ++mounting;
    window.__chatdomReady = false;
    stage?.dispose(); stage = null;
    setStatus(isKingdom(next) ? 'Raising the statue in the square…' : 'Setting the statue on its plinth…');
    const alive = () => disposed || ticket !== mounting;
    const common = { host, hour: initial.hour, statue: c.statue, heraldry: c.heraldry, frame: playing() ? null : shown(), isDisposed: alive };
    const chat = next === 'chat' ? { catalogue: benchCatalogue(c), emoteId: c.source.id, emoteAlt: c.source.name, kingdomId: c.catalogue.kingdomId, onOverlay: showOverlay } : undefined;
    if (!chat) showOverlay({ bubbles: [], pops: [] });
    const made = isKingdom(next) ? await createKingdomEmoteStage(chat ? { ...common, chat } : common) : await createEmoteStage({ ...common, view: next });
    if (!made || alive()) { made?.dispose(); return; }
    stage = made;
    host.querySelector('canvas')?.setAttribute('aria-label', next === 'chat'
      ? 'A SIMULATED chat in the lit town square: toadWave lifted above the people who sent it, and a chant of it rising as small carved toads over the statue'
      : isKingdom(next)
      ? 'The SIMULATED toadWave statue waving in a lit town square at dusk, its standards in the wind'
      : `The SIMULATED toadWave statue waving in the plaza, ${next} view`);
    stage.onFrame(setShown);
    setStatus('');
    publish(true);
  };
  /** The square the evening after the daily check: the withdrawn carving's plinth draped, the standards plain. */
  const mountChecked = async (k: Checked) => {
    window.__chatdomReady = false;
    setStatus('Covering the plinth…');
    const made = await createKingdomEmoteStage({
      host, hour: initial.hour, view: 'check', statue: null, heraldry: null, frame: 0, isDisposed: () => disposed,
      withdrawn: { statueCells: k.check.statueCells, chargeCells: k.check.chargeCells },
    });
    if (!made || disposed) { made?.dispose(); return; }
    stage = made;
    host.querySelector('canvas')?.setAttribute('aria-label', 'The SIMULATED square at dusk after the daily check: toadWave’s old carving withdrawn, its plinth waiting under a red cloth tied with gold cord, the standards flying plain');
    setStatus('');
    publish(true);
  };
  const choose = (next: BenchView) => {
    if (next === view()) return;
    // The square and the plaza are different stages, and chat brings its own crowd: those rebuild.
    const crossing = isKingdom(next) || isKingdom(view());
    setView(next);
    const c = compiled();
    if (!stage || !c) return;
    if (crossing) { void mount(next, c).catch(fail); return; }
    window.__chatdomReady = false;
    if (!isKingdom(next)) (stage as EmoteStage).setView(next);
    publish(true);
  };
  const fail = (error: unknown) => {
    if (disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    window.__chatdomEmotesError = message;
    setStatus(message); setFailed(true);
    console.error(message);
  };
  const toggle = () => { const next = !playing(); setPlaying(next); stage?.setPlaying(next); };
  const onResize = () => { if (!stage) return; window.__chatdomReady = false; stage.resize(); publish(true); };

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomEmotes; delete window.__chatdomEmotesError;
    void (async () => {
      const result = await compileInWorker(controller.signal, initial.view === 'check' ? 'check' : 'raised');
      if (disposed) return;
      window.addEventListener('resize', onResize);
      if ('checked' in result) { setChecked(result.checked); await mountChecked(result.checked); return; }
      setCompiled(result.compiled); setFrames(result.frames);
      await mount(view(), result.compiled);
    })().catch(fail);
  });
  onCleanup(() => {
    disposed = true; controller.abort();
    window.removeEventListener('resize', onResize);
    stage?.dispose(); stage = null;
    images.dispose();
    window.__chatdomReady = false;
  });

  const size = () => compiled()?.statue.frames[0]!.blueprint.size;
  const current = () => frames()[shown()];
  const viewButtons = (options: readonly BenchView[]) => <>
    <For each={options}>{option =>
      <button type="button" aria-pressed={view() === option} onClick={() => choose(option)}>{VIEW_LABELS[option]}</button>}
    </For>
    <button type="button" class="play" aria-pressed={playing()} aria-label={playing() ? 'Hold the wave' : 'Play the wave'} onClick={toggle}>{playing() ? 'Hold' : 'Play'}</button>
  </>;
  return <section class="emote-bench" classList={{ 'is-kingdom': isKingdom(view()) }} style={{ background: `radial-gradient(ellipse at 38% 68%, #ffb86a26, transparent 58%), linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 74%, ${grade.fog} 100%)` }}>
    <div class="emote-bench-stage" ref={element => { host = element; }} />
    <Show when={view() === 'chat'}>
      {/* Speech and lifted emotes over the speakers, in the stage's own pixels; never interactive. */}
      <div class="emote-chat-layer">
        <For each={overlay.bubbles}>{bubble => <EmoteChatBubble parts={bubble.parts} images={images} x={bubble.x} y={bubble.y} />}</For>
        <For each={overlay.pops}>{pop => <EmoteChatPop visual={pop.visual} alt={pop.alt} images={images} x={pop.x} y={pop.y} scale={pop.scale} opacity={pop.opacity} />}</For>
      </div>
    </Show>
    <header class="emote-bench-title">
      <span>{view() === 'check' ? 'CHATDOM · AFTER THE DAILY CHECK' : view() === 'chat' ? 'CHATDOM · CHAT IN THE SQUARE' : isKingdom(view()) ? 'CHATDOM · THE SQUARE AT DUSK' : 'CHATDOM · EMOTE WORKSHOP'}</span>
      <strong>{view() === 'check' ? 'toadWave has new art' : view() === 'chat' ? 'Chat chants toadWave' : isKingdom(view()) ? 'toadWave, raised in the square' : 'toadWave, carved and waving'}</strong>
    </header>
    <small class="simulated" title="Original bench art drawn for this workshop, not a channel’s emote">SIMULATED</small>
    <Show when={checked()}>{k => <aside class="emote-kingdom-card emote-check-card" aria-label="The daily check’s card">
      <dl class="emote-kingdom-facts">
        <For each={k().check.trail}>{line => <div><dt>{line.step}</dt><dd>{line.detail}</dd></div>}</For>
        <div><dt>Chat</dt><dd class="emote-check-chat">
          <Show when={k().inline} keyed fallback={<span>keeps the word toadWave</span>}>{visual => <>
            <EmoteImage visual={visual} alt={k().source.name} images={images} size={28} />
            <span>already shows the new art · <code>{k().source.sourceHash.slice(0, 10)}</code></span>
          </>}</Show>
        </dd></div>
      </dl>
    </aside>}</Show>
    <Show when={isKingdom(view()) && !checked() && view() !== 'check'}>
      {/* The square's card stays small so the world leads; the catalogue status joins it here. */}
      <aside class="emote-kingdom-card" aria-label="The statue’s card">
        <div class="emote-kingdom-views" role="group" aria-label="Look at the statue from">{viewButtons(RAISED_VIEWS)}</div>
        <Show when={compiled()}>{c => <dl class="emote-kingdom-facts">
          <div><dt>Statue</dt><dd>{metres(size()![1])} · {c().statue.frames.length} frames · {(c().statue.periodMs / 1000).toFixed(2)} s</dd></div>
          <div><dt>Source</dt><dd>GIF · {c().bytes.toLocaleString('en')} bytes · <code>{c().source.sourceHash.slice(0, 10)}</code></dd></div>
          <Show when={view() === 'chat'}>
            <div><dt>Chant</dt><dd>{EMOTE_CHAT_TUNING.minSlots} people in {EMOTE_CHAT_TUNING.windowMs / 1000} s · rains {EMOTE_CHAT_TUNING.weatherMs / 1000} s · rests {EMOTE_CHAT_TUNING.cooldownMs / 1000} s</dd></div>
          </Show>
        </dl>}</Show>
        <div class="emote-kingdom-catalogue" data-slot="catalogue-status" />
      </aside>
    </Show>
    <Show when={!isKingdom(view())}><aside class="emote-plaque" aria-label="Sculptor’s card">
      <div class="emote-plaque-views" role="group" aria-label="Look at the statue from">{viewButtons(['kingdom', ...WORKSHOP_VIEWS])}</div>
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
            <For each={c().materials}>{id => {
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
    </aside></Show>
    <Show when={status()}>
      <div class="emote-bench-status" role={failed() ? 'alert' : 'status'}>
        <strong>{failed() ? 'The statue could not be carved' : 'At the sculptor’s bench'}</strong>
        <p>{status()}</p>
      </div>
    </Show>
  </section>;
}
