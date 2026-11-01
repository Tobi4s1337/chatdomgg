import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { GRAND_CHANNELS, grandChannel } from './channels';
import { GRAND_TIERS, GRAND_VIEWS, GrandEngine, type GrandStats, type GrandTier, type GrandView } from './engine';
import './grand.css';

type GrandWindow = Window & { __chatdomReady?: boolean; __chatdomGrand?: { stats: () => GrandStats; setHour: (hour: number) => void; setView: (view: GrandView) => void } };

const CHARACTER: Record<string, string> = { 'coastal-harbour': 'harbour coast', 'river-valley': 'river valley', 'mountain-pass': 'mountain pass' };
const HOURS: readonly { label: string; hour: number }[] = [
  { label: 'Dawn', hour: 6.4 }, { label: 'Morning', hour: 9.5 }, { label: 'Noon', hour: 12.5 }, { label: 'Golden hour', hour: 17.6 }, { label: 'Dusk', hour: 19.6 }, { label: 'Night', hour: 22.5 },
];

function detectTier(canvas: HTMLCanvasElement): GrandTier {
  const gl = canvas.getContext('webgl2');
  if (!gl) return 'software';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'software';
  if (/apple m\d (max|pro|ultra)|rtx|radeon rx [67-9]|arc a7/.test(name)) return 'ultra';
  if (/apple|nvidia|geforce|radeon/.test(name)) return 'high';
  if (/intel|iris|adreno 7|mali-g7/.test(name)) return 'medium';
  return 'low';
}

const number = (value: string | null): number | null => value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const formatCount = (n: number): string => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);
const formatHour = (h: number): string => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/**
 * `/-/grand`: a channel's whole land at the Eldermere scale, raised from its Genesis seed in the browser.
 *   ?channel=<login>  &hour=0..24  &view=orbit|high|castle|harbour|summit|fields|mere  &yaw &pitch &dist
 *   &tier=ultra|high|medium|low|software  &t=<seconds, freezes time>  &stats=1  &still=1 (no chrome)
 *   &capture=1 (software evidence stills: full resolution and detail, never an fps claim)
 */
export default function GrandLandView() {
  const params = new URLSearchParams(window.location.search);
  const channel = grandChannel(params.get('channel'));
  const still = params.get('still') === '1';
  const showStats = params.get('stats') === '1';
  const view = (GRAND_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? params.get('view') as GrandView : 'orbit';
  const [hour, setHour] = createSignal(Math.max(0, Math.min(24, number(params.get('hour')) ?? 17.6)));
  const [stats, setStats] = createSignal<GrandStats | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  let canvas: HTMLCanvasElement | undefined;
  let engine: GrandEngine | null = null;

  onMount(() => {
    const requested = params.get('tier');
    // Tier detection uses a throwaway canvas: a context, once made, fixes the canvas to it.
    const tier = requested && requested in GRAND_TIERS ? requested as GrandTier : detectTier(document.createElement('canvas'));
    const time = number(params.get('t'));
    if (!canvas) return;
    engine = new GrandEngine(canvas, channel.seed, { tier, capture: params.get('capture') === '1', hour: hour(), view, time: time ?? (tier === 'software' ? 0 : null) });
    engine.onFailure = message => setFailure(message);
    let last = 0;
    engine.onChange = () => {
      const now = performance.now();
      if (now - last < 250 && engine!.stats.phase !== 'ready') return;
      last = now;
      setStats({ ...engine!.stats, levels: [...engine!.stats.levels] });
    };
    engine.onReady = () => {
      setStats({ ...engine!.stats, levels: [...engine!.stats.levels] });
      (window as GrandWindow).__chatdomReady = true;
    };
    (window as GrandWindow).__chatdomGrand = { stats: () => engine!.stats, setHour: h => { setHour(h); engine?.setHour(h); }, setView: v => engine?.setView(v) };
    const onResize = () => engine?.resize();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
    void engine.start().then(() => {
      const yaw = number(params.get('yaw')), pitch = number(params.get('pitch')), dist = number(params.get('dist'));
      if (yaw !== null || pitch !== null || dist !== null) engine?.orbit(yaw, pitch, dist);
    }).catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  });
  onCleanup(() => engine?.dispose());

  const changeHour = (value: number) => { setHour(value); engine?.setHour(value); };
  const link = (login: string) => { const next = new URLSearchParams(params); next.set('channel', login); return `?${next.toString()}`; };
  const facts = () => {
    const seed = channel.seed;
    return `${seed.tier[0]!.toUpperCase()}${seed.tier.slice(1)} · ${CHARACTER[seed.character] ?? seed.character.replace(/-/g, ' ')} · ${seed.biome.replace(/-/g, ' ')}`;
  };

  return <div class="grand" classList={{ 'grand--still': still }} data-grand-phase={stats()?.phase ?? 'raising'}>
    <canvas ref={element => { canvas = element; }} class="grand-canvas" aria-label={`The land of ${channel.name}`} />
    <div class="grand-vignette" aria-hidden="true" />
    <Show when={!still}>
      <header class="grand-plaque">
        <p class="grand-eyebrow">The land of</p>
        <h1>{channel.name}</h1>
        <p class="grand-facts">{facts()}</p>
        <Show when={channel.evidence === 'simulated'}>
          <p class="grand-simulated"><b>SIMULATED</b> No audience or categories observed yet; the seed uses Genesis defaults.</p>
        </Show>
        <Show when={stats()?.trees}>
          <p class="grand-count">{formatCount(stats()!.terrainVoxels)} voxels of land · {formatCount(stats()!.trees)} trees</p>
        </Show>
      </header>
      <nav class="grand-realms" aria-label="Kingdoms">
        <For each={GRAND_CHANNELS}>{c => <a href={link(c.login)} classList={{ 'is-here': c.login === channel.login }}>{c.name}</a>}</For>
      </nav>
      <div class="grand-hours" role="group" aria-label="Hour of the day">
        <span class="grand-clock">{formatHour(hour())}</span>
        <input type="range" min="0" max="24" step="0.05" value={hour()} aria-label="Hour" onInput={event => changeHour(Number(event.currentTarget.value))} />
        <div class="grand-hour-marks">
          <For each={HOURS}>{h => <button type="button" classList={{ 'is-here': Math.abs(hour() - h.hour) < 0.3 }} onClick={() => changeHour(h.hour)}>{h.label}</button>}</For>
        </div>
      </div>
    </Show>
    <Show when={!still && stats()?.phase !== 'ready' && !failure()}>
      <div class="grand-raising" role="status">
        <span class="grand-raising-mark" aria-hidden="true" />
        {stats() === null || stats()!.phase === 'raising' ? 'Raising the land…' : `Growing the forests… ${Math.round((stats()!.progress) * 100)}%`}
      </div>
    </Show>
    <Show when={failure()}>
      <div class="grand-failure" role="alert"><strong>The land could not be raised</strong><p>{failure()}</p></div>
    </Show>
    <Show when={showStats && stats()}>
      <dl class="grand-stats">
        <dt>tier</dt><dd>{stats()!.tier}{stats()!.capture ? ' · capture' : ''} · {(stats()!.pixels / 1e6).toFixed(2)} Mpx</dd>
        <dt>source</dt><dd>{formatCount(stats()!.terrainVoxels)} cells · {formatCount(stats()!.treeVoxels)} tree voxels stamped at ×1 this visit</dd>
        <dt>resident</dt><dd>{formatCount(stats()!.quadsResident)} quads · {(stats()!.residentBytes / 1048576).toFixed(0)} + {(stats()!.targetBytes / 1048576).toFixed(0)} MiB targets</dd>
        <dt>main</dt><dd>{formatCount(stats()!.main.triangles)} tris · {stats()!.main.calls} draws</dd>
        <dt>reflect</dt><dd>{formatCount(stats()!.reflection.triangles)} tris · {stats()!.reflection.calls} draws</dd>
        <dt>shadow</dt><dd>{formatCount(stats()!.shadow.triangles)} tris · {stats()!.shadow.calls} draws</dd>
        <dt>frame</dt><dd>{formatCount(stats()!.frame.triangles)} tris · {stats()!.frame.calls} draws</dd>
        <dt>levels</dt><dd>{stats()!.levels.join(' / ')} of {stats()!.regions} · target ×{stats()!.governor.toFixed(2)}</dd>
        <dt>workers</dt><dd>{stats()!.busyWorkers}/{stats()!.workers} · queue {stats()!.queued} · {(stats()!.queuedResultBytes / 1048576).toFixed(1)} MiB · p95 {stats()!.workerP95.toFixed(0)} ms</dd>
        <dt>installs</dt><dd>{(stats()!.installedBytes / 1048576).toFixed(0)} MiB · {stats()!.installsPending} staged · {stats()!.evictions} evicted · {stats()!.staleResults} stale</dd>
        <dt>raise</dt><dd>{Math.round(stats()!.generateMillis)} ms{stats()!.landCached ? ' (kept from a visit)' : ''} · mesh {Math.round(stats()!.meshMillis)} ms</dd>
        <dt>fps</dt><dd>{stats()!.fps.toFixed(0)}{stats()!.tier === 'software' ? ' (software, not a GPU figure)' : ''}</dd>
      </dl>
    </Show>
  </div>;
}
