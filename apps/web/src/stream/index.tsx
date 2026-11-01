import { createDockFixture } from './dock-fixture';
import { openDurableChronicle } from '../chronicle/native-overlay';
import { createDockConnection } from './dock-connection';
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { NameLabel } from '../kingdom/scene';
import { createSceneMount, type KingdomScene, type StreamPhase } from './mount';
import { parseStreamParams, safeAreaName, SAFE_PRESETS, type SafeArea, type StreamLayout, type StreamMood, type StreamSeam } from './params';
import { createDirector, planNight, type DirectorState, type Shot } from './director';
import { Corner, Crest, Flame, StreamDefs } from './fittings';
import { SkyCaptions, type ScreenCaption } from '../twitch-moments';
import { createRealmSpectatorSource } from '../kingdom-entry/spectator';
import type { SpeechLabel } from '../kingdom/citizen-scene';
import type { WalkerLabel } from '../kingdom/walk-scene';
import type { ArrivalAttention } from '../kingdom/arrival-director';
import './stream.css';
import './speech.css';
import { PeopleLabels, peopleFromLabels, measureReservedElements } from '../walk/labels/index';

type SourceKind = 'simulated' | 'connecting' | 'live' | 'resting' | 'lost';
interface SourceMark { kind: SourceKind; title: string; note: string }

/** The renderer's own source words, told the way a stream should tell them. A fresh live kingdom needs no mark. */
function sourceMark(label: string): SourceMark {
  switch (label) {
    case 'SIMULATED': return { kind: 'simulated', title: 'SIMULATED', note: 'A demonstration night' };
    case 'LIVE CHAT': return { kind: 'live', title: '', note: '' };
    case 'STREAM RESTING': return { kind: 'resting', title: 'Stream resting', note: 'Every home keeps its place' };
    case 'CONNECTION LOST': return { kind: 'lost', title: 'Connection lost', note: 'Reconnecting to the kingdom' };
    default: return { kind: 'connecting', title: 'Finding the kingdom', note: 'Windows wait for chat' };
  }
}

const OUTPUT_SIZE: Record<StreamLayout, [number, number]> = { stage: [1280, 720], window: [480, 270], strip: [1280, 180] };
const LAYOUT_NAMES: Record<StreamLayout, string> = { stage: 'Stage', window: 'Corner window', strip: 'Bottom street' };
const SEAM_NAMES: Record<StreamSeam | 'none', string> = { none: 'None', starting: 'Starting', break: 'Break', ending: 'Ending' };
const SAFE_NAMES: Record<keyof typeof SAFE_PRESETS, string> = { full: 'Whole frame', chat: 'Chat column', camera: 'Camera column', band: 'Lower band' };
const RETRY_SECONDS = [15, 30, 60, 120];

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomKingdom?: unknown;
    __chatdomStream?: unknown;
    obsstudio?: unknown;
  }
}

/** The seam's card: the streamer chose the scene, so its words are theirs to show. Never a countdown. */
function seamWords(seam: StreamSeam, kingdom: string, named: boolean): { eyebrow: string; title: string; line: string } {
  if (seam === 'starting') return { eyebrow: kingdom, title: 'The stream begins soon', line: 'Every chatter lights a window' };
  if (seam === 'break') return { eyebrow: kingdom, title: 'Back soon', line: 'The kingdom keeps the night' };
  return { eyebrow: 'Until next time', title: named ? `Goodnight from ${kingdom}` : 'Goodnight', line: 'Every window keeps its place' };
}

export default function StreamView() {
  const params = parseStreamParams(location.search);
  const [layout, setLayout] = createSignal<StreamLayout>(params.layout);
  const [mood, setMood] = createSignal<StreamMood>(params.mood);
  const [seam, setSeam] = createSignal<StreamSeam | null>(params.seam);
  const [safe, setSafe] = createSignal<SafeArea | null>(params.safe);
  const [phase, setPhase] = createSignal<StreamPhase>('waking');
  const [progress, setProgress] = createSignal(0);
  const [loading, setLoading] = createSignal('Opening the kingdom');
  const [label, setLabel] = createSignal(params.source === 'simulated' ? 'SIMULATED' : 'CONNECTING');
  const [fonts, setFonts] = createSignal(false);
  const [scale, setScale] = createSignal(1);
  const [names, setNames] = createSignal<NameLabel[]>([]);
  const [speech, setSpeech] = createSignal<SpeechLabel[]>([]);
  const [walkers, setWalkers] = createSignal<readonly WalkerLabel[]>([]);
  const [momentCaptions, setMomentCaptions] = createSignal<readonly ScreenCaption[]>([]);
  const [kingdomName, setKingdomName] = createSignal(params.kingdomName);
  const mark = () => sourceMark(label());
  // Only a fresh projection may carry a person's name or give a close shot its subject.
  // Resting is an observed offline channel, not a broken presence connection.
  const fresh = () => ['simulated', 'live', 'resting'].includes(mark().kind);
  const [arrival, setArrival] = createSignal<Pick<ArrivalAttention, 'slot' | 'phase'> | null>(null);
  const stageSafe = () => layout() === 'stage' ? safe() : null;
  const named = () => kingdomName() !== 'Kingdom';
  let peopleLabelsRoot: HTMLElement | null = null;
  const peopleHud = () => peopleLabelsRoot ? measureReservedElements(peopleLabelsRoot, [...picture.querySelectorAll('.stream-name,.stream-mark,.stream-inscription,.sky-caption,.stream-seam')]) : [];
  let hour = params.hour, picture!: HTMLDivElement, lens!: HTMLDivElement, holder: HTMLDivElement | undefined, retryTimer = 0, attempts = 0, obsVisible = true;

  const plan = () => planNight({ layout: layout(), mood: mood(), seam: layout() === 'stage' ? seam() : null, camera: params.camera, hour: params.hour });
  const [shot, setShot] = createSignal<DirectorState>({ shot: plan().beats[0]!.shot, beat: 0, curtain: 'open', cut: plan().cut, climax: false });
  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  const director = createDirector(plan(), {
    motive: (view: Shot) => {
      if (view === 'hero') return true;
      const subject = fresh() ? mount.scene?.subject() : undefined;
      // A close window needs its light; the street needs someone in it.
      return view === 'window' ? !!subject?.homeLit : !!subject;
    },
    apply: view => mount.scene?.setCamera(view),
    drawn: view => !!mount.scene && mount.scene.debug.camera === view && mount.scene.debug.fieldSettled,
    setHour: value => { hour = value; mount.scene?.setHour(value); },
    reducedMotion: () => !!reduced?.matches,
    onChange: setShot,
  });
  hour = director.hour(hour);

  const dockFixture = params.source === 'simulated' && new URLSearchParams(location.search).get('dockFixture') === '1' ? createDockFixture() : undefined;
  const dockConnection = params.source === 'realm' && params.kingdomId ? createDockConnection(params.kingdomId) : undefined;
  onCleanup(() => dockConnection?.dispose());
  const spectator = params.source === 'realm' && params.kingdomId ? createRealmSpectatorSource({ kingdomId: params.kingdomId }) : undefined;
  let chronicle:ReturnType<typeof openDurableChronicle>|undefined,chronicleOpened=false;
  onCleanup(()=>chronicle?.close());

  const mount = createSceneMount({
    host: () => lens,
    // Build the opening's light fields with nobody home yet. Rewinding a fully
    // inhabited town after loading leaves its warm ground light behind for a beat.
    settings: () => ({ ...(dockFixture ? { dockFeed: dockFixture, simulatedDockSites: true, kingdomId: dockFixture.kingdomId } : {}), directArrivals: params.source === 'realm' && layout() === 'stage' && seam() !== 'ending' && params.focusSlot === undefined, onArrival: setArrival, tier: params.tier, seed: params.seed, firstYear: params.firstYear, year: params.year, ...(params.kingdomId ? { kingdomId: params.kingdomId } : {}), ...(params.focusSlot !== undefined ? { focusSlot: params.focusSlot } : {}), hour: director.hour(hour), time: params.time ?? (params.source === 'simulated' && seam() === 'starting' ? 0 : null), camera: director.shot, source: params.source === 'realm' ? 'herald' : params.source, presenceOrigin: dockFixture ? 'simulated' : params.presenceOrigin, onWalkers: setWalkers, onMomentCaptions: setMomentCaptions }),
    ...(params.source === 'realm' ? { prepare: async (signal: AbortSignal, revision: () => void, unavailable: () => void) => {
      if (!spectator) throw new Error('Choose a founded kingdom to watch.');
      const connection = await spectator(signal, revision, unavailable);
      return { settings: { founded: connection.scene, kingdomId: connection.manifest.kingdomId, ...(dockConnection ? { dockFeed: dockConnection } : {}),
        presenceOrigin: connection.manifest.origin, presenceFeed: connection.presenceFeed, growthFeed: connection.growthFeed, growthCeremonies: connection.growthCeremonies, forgeFeed: connection.forgeFeed, momentFeed: connection.momentFeed, walkerFeed: connection.walkerFeed,
        realmName: connection.kingdomName, source: 'herald' as const }, chatFeed: connection.chatFeed,
        activate: () => { connection.activate(); setKingdomName(connection.kingdomName); }, dispose: connection.dispose };
    } } : {}),
    onPhase: next => {
      setPhase(next);
      if (next !== 'ready') setArrival(null);
      if (next !== 'ready') setWalkers([]);
      if (next === 'ready') { attempts = 0; director.start(); } else director.stop();
      if (next === 'failed') scheduleRetry();
    },
    onProgress: (text, fraction) => { setLoading(text); setProgress(fraction); },
    // A remounted real source starts unconfirmed: nothing seen before hiding is presented as fresh.
    onSource: setLabel,
    onNames: next => {
      const current = names();
      if (next.length !== current.length || next.some((name, i) => name.slot !== current[i]!.slot || name.name !== current[i]!.name || name.arrivalAgeSeconds !== current[i]!.arrivalAgeSeconds || Math.abs(name.x - current[i]!.x) > .5 || Math.abs(name.y - current[i]!.y) > .5)) setNames(next);
    },
    onScene: publishDebug,
    onSpeech: setSpeech,
    onDirecting: directing => { if (directing) director.stop(); else if (phase() === 'ready') director.start(); },
  });

  function publishDebug(scene: KingdomScene | undefined): void {
    if (!scene) { chronicle?.close();setArrival(null); delete window.__chatdomKingdom; return; }
    if(!chronicleOpened&&params.source==='realm'&&params.kingdomId&&new URLSearchParams(location.search).get('chronicle')==='1'){
      chronicleOpened=true;chronicle=openDurableChronicle({kingdomId:params.kingdomId,liveEngine:scene,onOpen:()=>director.stop(),onClose:()=>{chronicle=undefined;if(phase()==='ready')director.start();}});
    }
    // The labelled opening starts with the first speaker, rather than an already-full town.
    // Real sources always keep their witnessed history; a fixed capture stays fixed.
    if (params.source === 'simulated' && seam() === 'starting' && params.time === null) scene.play();
    window.__chatdomKingdom = {
      stats: scene.debug,
      inspect: scene.inspect,
      suspendRendering: scene.suspendRendering,
      ...(dockFixture ? { dock: dockFixture.trigger } : {}),
      pose: scene.pose,
      seekGrowthCeremony: scene.seekGrowthCeremony,
      seek: (time: number, view?: Shot) => scene.seek(time, view),
      hour: (value: number) => { hour = value; scene.setHour(value); },
      capture: (time: number) => scene.capture(time),
      // Offline ritual capture uses the existing, explicitly SIMULATED fixture.
      ...(params.source === 'simulated' && new URLSearchParams(location.search).get('forgeFixture') === '1' ? { forge: scene.forge } : {}),
    };
  }

  // The climax: one public name, from the renderer's permitted labels, nearest the window in view.
  // Chosen once per climax, so the plate never jumps between neighbours.
  let lockedSlot: number | null = null;
  const climaxSlot = createMemo(() => {
    const homecoming = arrival();
    if (homecoming?.phase === 'window' && fresh()) return (lockedSlot = homecoming.slot);
    // A witnessed doorway arrival deserves its name even in a selected street lens.
    // Hold one name for its beat instead of hopping between neighbours each frame.
    const recent = names().filter(name => (name.arrivalAgeSeconds ?? Infinity) < 7);
    const arriving = recent.find(name => name.slot === lockedSlot) ?? recent[0];
    if (arriving && fresh()) return (lockedSlot = arriving.slot);
    if (!shot().climax || !fresh()) return (lockedSlot = null);
    if (lockedSlot !== null) return lockedSlot;
    const width = picture.clientWidth, height = lens.querySelector('.stream-canvas')?.clientHeight ?? picture.clientHeight;
    const nearest = [...names()].sort((a, b) => Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2))[0];
    return (lockedSlot = nearest?.slot ?? null);
  });
  const [shownName, setShownName] = createSignal<NameLabel | null>(null);
  const climaxName = createMemo(() => {
    const slot = climaxSlot();
    return slot === null || !fresh() ? null : names().find(name => name.slot === slot) ?? null;
  });
  // Keep the last name in place while it fades, so it leaves rather than vanishes.
  createEffect(() => { const name = climaxName(); if (name) setShownName(name); });

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

  // A streamer's change of shape, mood or seam in the preview applies at once.
  createEffect(on(plan, next => director.replan(next), { defer: true }));

  onMount(() => {
    window.__chatdomReady = false;
    document.documentElement.classList.add('stream-document');
    if (params.preview) document.documentElement.classList.add('stream-preview-document');
    window.__chatdomStream = {
      stats: mount.stats,
      get phase() { return phase(); },
      get loading() { return loading(); },
      get layout() { return layout(); },
      get source() { return mark().kind; },
      hold: (on: boolean) => director.hold(on),
      get director() { return { ...shot(), cuts: director.cuts.map(cut => ({ ...cut })), beats: director.plan.beats.map(beat => beat.shot), name: climaxName()?.name ?? null, hour }; },
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
    director.dispose();
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('obsSourceVisibleChanged', onObsVisible);
    mount.unmount('hidden');
    window.__chatdomReady = false;
    delete window.__chatdomStream;
    document.documentElement.classList.remove('stream-document', 'stream-preview-document');
  });

  const area = () => stageSafe();
  const output = <div class={`stream-output layout-${layout()}`} data-chatdom-kingdom data-chatdom-stream
    classList={{ drifting: director.plan.drift && phase() === 'ready' && shot().curtain === 'open', framed: !!area() }}
    data-layout={layout()} data-phase={phase()} data-source={mark().kind} data-mood={mood()} data-seam={(layout() === 'stage' && seam()) || 'none'}
    data-shot={shot().shot} data-curtain={shot().curtain} data-climax={climaxName() ? 'name' : 'none'} data-safe={safeAreaName(area()) ?? (area() ? 'custom' : 'none')}
    style={area() ? { left: `${area()![0]}%`, top: `${area()![1]}%`, width: `${area()![2]}%`, height: `${area()![3]}%` } : undefined}>
    <div class="stream-picture" ref={element => { picture = element; }}>
      <div class="stream-lens" ref={element => { lens = element; }}>
        <SkyCaptions captions={momentCaptions()} />
        <PeopleLabels class="stream-people-labels" people={peopleFromLabels(walkers(), speech())} reserved={peopleHud()} onRoot={root => { peopleLabelsRoot = root; }} />
        <div class="stream-names" aria-live="polite">
          <Show when={shownName()}>{name =>
            <div class="stream-name" classList={{ shown: !!climaxName() }}
              style={{ left: `${Math.min(Math.max(name().x, 70), picture.clientWidth - 70)}px`, top: `${Math.max(name().y, 46)}px` }}>
              <Flame /><span>{name().name}</span>
            </div>}
          </Show>
        </div>
      </div>
    </div>
    <div class="stream-shade" aria-hidden="true" />
    <div class={`stream-shutters ${shot().cut ?? 'none'}`} data-state={shot().curtain} aria-hidden="true">
      <div class="stream-leaf left"><i class="stream-strap top" /><i class="stream-strap bottom" /></div>
      <div class="stream-leaf right"><i class="stream-strap top" /><i class="stream-strap bottom" /><i class="stream-latch" /></div>
      <div class="stream-dip" />
    </div>
    <div class="stream-frame" aria-hidden="true">
      <Corner at="tl" /><Corner at="tr" /><Corner at="bl" /><Corner at="br" />
    </div>
    <Show when={layout() === 'stage'}>
      <Show when={seam()} fallback={<div class="stream-signature"><Crest /><span>{kingdomName()}</span></div>}>{current => {
        const words = () => seamWords(current(), kingdomName(), named());
        return <div class={`stream-seam ${current()}`}>
          <Crest class="seam" />
          <div>
            <p class="stream-seam-eyebrow">{words().eyebrow}</p>
            <h2>{words().title}</h2>
            <p class="stream-seam-line">{words().line}</p>
          </div>
        </div>;
      }}</Show>
    </Show>
    <Show when={mark().kind !== 'live'}>
      <div class={`source-ribbon stream-mark ${mark().kind}`} role="status">
        <strong>{mark().title}</strong><Show when={layout() === 'stage' && mark().kind !== 'simulated'}><small>{mark().note}</small></Show>
      </div>
    </Show>
    <div class="stream-curtain" classList={{ open: phase() === 'ready', failed: phase() === 'failed' }} role="status" aria-live="polite">
      <Crest class="large" />
      <Switch>
        <Match when={phase() === 'failed'}>
          <div class="stream-gate kingdom-gate">
            <h2>{kingdomName()} needs a moment</h2>
            <p>The gate will open again shortly.</p>
            <button type="button" onClick={open}>Try again now</button>
          </div>
        </Match>
        <Match when={true}>
          <h2>{kingdomName()}</h2>
          <p>{loading()}</p>
          <div class="stream-progress"><i style={{ transform: `scaleX(${Math.max(.04, progress())})` }} /></div>
        </Match>
      </Switch>
    </div>
  </div>;

  // The source is the whole browser-source rectangle; the kingdom sits inside its chosen part.
  const sheet = <div class="stream-sheet" classList={{ kept: !!area() }}
    style={params.preview ? { width: `${OUTPUT_SIZE[layout()][0]}px`, height: `${OUTPUT_SIZE[layout()][1]}px`, transform: `translate(-50%, -50%) scale(${scale()})` } : undefined}>
    <Show when={params.preview && area()}><p class="stream-kept-note">Kept clear for your camera and chat</p></Show>
    {output}
  </div>;

  return <>
    <StreamDefs />
    <Show when={params.preview} fallback={sheet}>
      <div class="stream-bench">
        <header class="stream-bench-head">
          <div>
            <p class="stream-bench-eyebrow">Stream preview</p>
            <h1>{kingdomName()}</h1>
          </div>
          <nav class="stream-bench-layouts" aria-label="Stream shape">
            <For each={['stage', 'window', 'strip'] as const}>{shape =>
              <button type="button" aria-pressed={layout() === shape} onClick={() => setLayout(shape)}>
                <span class={`stream-shape-glyph ${shape}`} aria-hidden="true" />{LAYOUT_NAMES[shape]}
              </button>}
            </For>
          </nav>
        </header>
        <div class="stream-bench-options">
          <Choice label="Mood" options={[['calm', 'Calm'], ['show', 'Show']]} value={mood()} pick={setMood} />
          <Show when={layout() === 'stage'}>
            <Choice label="Seam" options={(['none', 'starting', 'break', 'ending'] as const).map(value => [value, SEAM_NAMES[value]])}
              value={seam() ?? 'none'} pick={value => setSeam(value === 'none' ? null : value)} />
            <Choice label="Kept clear" options={(Object.keys(SAFE_PRESETS) as (keyof typeof SAFE_PRESETS)[]).map(value => [value, SAFE_NAMES[value]])}
              value={safeAreaName(safe()) ?? 'full'} pick={value => setSafe(SAFE_PRESETS[value])} />
          </Show>
        </div>
        <div class="stream-bench-holder" ref={element => { holder = element; }}>{sheet}</div>
        <footer class="stream-bench-foot">
          <p>Add <code>{browserSourcePath(layout(), mood(), seam(), safe())}</code> as a browser source at {OUTPUT_SIZE[layout()][0] * (layout() === 'stage' ? 1.5 : 1)}×{OUTPUT_SIZE[layout()][1] * (layout() === 'stage' ? 1.5 : 1)}. These controls stay here; the source shows only the frame.</p>
          <p class="stream-bench-sound"><strong>Broadcast mix unavailable.</strong> The source stays quiet: no kingdom sound plays into your stream yet.</p>
          <Show when={params.source === 'simulated'}><p class="stream-bench-simulated">SIMULATED night: no chat is connected to this preview.</p></Show>
        </footer>
      </div>
    </Show>
  </>;
}

function Choice<T extends string>(props: { label: string; options: readonly (readonly [T, string])[]; value: T; pick(value: T): void }) {
  return <div class="stream-bench-choice" role="group" aria-label={props.label}>
    <span>{props.label}</span>
    <For each={props.options}>{([value, text]) =>
      <button type="button" aria-pressed={props.value === value} onClick={() => props.pick(value)}>{text}</button>}
    </For>
  </div>;
}

function browserSourcePath(layout: StreamLayout, mood: StreamMood, seam: StreamSeam | null, safe: SafeArea | null): string {
  const query = new URLSearchParams(location.search);
  query.delete('preview');
  for (const [key, value] of [['layout', layout === 'stage' ? null : layout], ['mood', mood === 'calm' ? null : mood],
    ['seam', layout === 'stage' ? seam : null], ['safe', layout === 'stage' && safe ? safeAreaName(safe) ?? safe.join(',') : null]] as const) {
    if (value) query.set(key, value); else query.delete(key);
  }
  const search = query.toString();
  return `${location.pathname}${search ? `?${search}` : ''}`;
}
