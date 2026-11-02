import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { GRAND_CHANNELS, grandChannel, type GrandChannel } from './channels';
import { detectGrandTier, GRAND_TIERS, GRAND_VIEWS, type GrandStats, type GrandTier, type GrandView } from './engine';
import { GrandRaisedEngine } from './engine-raise';
import { grandHoldingChannel, withLandform } from './holding-world';
import './grand.css';

type GrandWindow = Window & { __chatdomReady?: boolean; __chatdomGrand?: { stats: () => GrandStats; setHour: (hour: number) => void; setView: (view: GrandView) => void; setCitizens: (citizens: number, lift?: number) => void } };

const CHARACTER: Record<string, string> = { 'coastal-harbour': 'harbour coast', 'river-valley': 'river valley', 'mountain-pass': 'mountain pass' };
const HOURS: readonly { label: string; hour: number }[] = [
  { label: 'Dawn', hour: 6.4 }, { label: 'Morning', hour: 9.5 }, { label: 'Noon', hour: 12.5 }, { label: 'Golden hour', hour: 17.6 }, { label: 'Dusk', hour: 19.6 }, { label: 'Night', hour: 22.5 },
];

const number = (value: string | null): number | null => value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const formatCount = (n: number): string => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);
const formatHour = (h: number): string => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/**
 * `/-/grand-bench`: a channel's whole land at the Eldermere scale, raised from its Genesis seed in the browser.
 *   ?channel=<login>  &hour=0..24  &view=orbit|high|castle|harbour|summit|fields|mere  &yaw &pitch &dist
 *   &tier=ultra|high|medium|low|software  &t=<seconds, freezes time>  &stats=1  &still=1 (no chrome)
 *   &capture=1 (software evidence stills: full resolution and detail, never an fps claim)
 *   &world=1 (the channel's own world, grand-land-2)  &holding=<broadcaster id> (any Atlas holding's world)
 *   &landform=island|mountain-valley|river-delta|lake-country|cliff-coast|highland (raise the same world as another form)
 *   &citizens=<n> (stage the sea mist for that many citizens; staged, never a real count)
 */
export default function GrandLandBench() {
  const params = new URLSearchParams(window.location.search);
  const holdingId = params.get('holding');
  const known = grandChannel(params.get('channel'));
  const [channel, setChannel] = createSignal<GrandChannel>(known);
  const citizens = number(params.get('citizens'));
  const [opening, setOpening] = createSignal<string | null>(null);
  const still = params.get('still') === '1';
  const showStats = params.get('stats') === '1';
  const view = (GRAND_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? params.get('view') as GrandView : 'orbit';
  const [hour, setHour] = createSignal(Math.max(0, Math.min(24, number(params.get('hour')) ?? 17.6)));
  const [stats, setStats] = createSignal<GrandStats | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  let canvas: HTMLCanvasElement | undefined;
  let engine: GrandRaisedEngine | null = null;

  onMount(() => {
    const requested = params.get('tier');
    // Tier detection uses a throwaway canvas: a context, once made, fixes the canvas to it.
    const tier = requested && requested in GRAND_TIERS ? requested as GrandTier : detectGrandTier(document.createElement('canvas'));
    const time = number(params.get('t'));
    if (!canvas) return;
    const abort = new AbortController();
    onCleanup(() => abort.abort());
    void (async () => {
    const chosen = holdingId ? await grandHoldingChannel(holdingId, abort.signal) : known;
    const base = holdingId || params.get('world') === '1' || params.get('landform') ? chosen.world ?? chosen.seed : chosen.seed;
    const seed = withLandform(base, params.get('landform'));
    setChannel({ ...chosen, seed });
    if (!canvas || abort.signal.aborted) return;
    engine = new GrandRaisedEngine(canvas, seed, { tier, capture: params.get('capture') === '1', hour: hour(), view, time: time ?? (tier === 'software' ? 0 : null), citizens: citizens === null ? null : Math.max(0, Math.floor(citizens)) });
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
    (window as GrandWindow).__chatdomGrand = {
      stats: () => engine!.stats, setHour: h => { setHour(h); engine?.setHour(h); }, setView: v => engine?.setView(v),
      setCitizens: (n, lift) => { engine?.setCitizens(n, lift); setOpening(engine?.opening?.line ?? null); },
    };
    const onResize = () => engine?.resize();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
    await engine.start();
    setOpening(engine.opening?.line ?? null);
    const yaw = number(params.get('yaw')), pitch = number(params.get('pitch')), dist = number(params.get('dist'));
    if (yaw !== null || pitch !== null || dist !== null) engine?.orbit(yaw, pitch, dist);
    })().catch((error: unknown) => { if (!abort.signal.aborted) setFailure(error instanceof Error ? error.message : String(error)); });
  });
  onCleanup(() => engine?.dispose());

  const changeHour = (value: number) => { setHour(value); engine?.setHour(value); };
  const link = (login: string) => { const next = new URLSearchParams(params); next.set('channel', login); next.delete('holding'); return `?${next.toString()}`; };
  const facts = () => {
    const seed = channel().seed;
    const form = seed.world ? `${seed.world.landform.replace(/-/g, ' ')} · ${seed.world.forest[0].replace(/-/g, ' ')} woods` : CHARACTER[seed.character] ?? seed.character.replace(/-/g, ' ');
    return `${seed.tier[0]!.toUpperCase()}${seed.tier.slice(1)} · ${form} · ${seed.biome.replace(/-/g, ' ')}`;
  };

  return <div class="grand" classList={{ 'grand--still': still }} data-grand-phase={stats()?.phase ?? 'raising'}>
    <canvas ref={element => { canvas = element; }} class="grand-canvas" aria-label={`The land of ${channel().name}`} />
    <div class="grand-vignette" aria-hidden="true" />
    <Show when={!still}>
      <header class="grand-plaque">
        <p class="grand-eyebrow">Landscape study</p>
        <h1>{channel().name}</h1>
        <p class="grand-facts">{facts()}</p>
        <Show when={channel().seed.world}>
          <p class="grand-crest" aria-label="Crest">
            <span style={{ background: channel().seed.world!.crest.field }} /><span style={{ background: channel().seed.world!.crest.charge }} />
          </p>
        </Show>
        <Show when={opening()}><p class="grand-opening">{opening()}</p></Show>
        <Show when={stats()?.trees}>
          <p class="grand-count">{formatCount(stats()!.terrainVoxels)} voxels of land · {formatCount(stats()!.trees)} trees</p>
        </Show>
      </header>
      <nav class="grand-realms" aria-label="Kingdoms">
        <For each={GRAND_CHANNELS}>{c => <a href={link(c.login)} classList={{ 'is-here': c.login === channel().login }}>{c.name}</a>}</For>
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
