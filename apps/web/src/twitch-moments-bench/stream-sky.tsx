import { createSignal, onCleanup, onMount } from 'solid-js';
import { WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_TIME } from '@chatdom/shared/world-fixtures';
import { createSceneMount, type KingdomScene, type StreamPhase } from '../stream/mount';
import { Corner, Crest, StreamDefs } from '../stream/fittings';
import { DEFAULT_CHEER_LADDER, SkyCaptions, type ScreenCaption, type TwitchMomentFeed } from '../twitch-moments';
import { benchPerson, createBenchSimulation, type BenchCitizen, type BenchSimulation } from './simulation';
import { HYPE_RUN, type HypeOutcome } from './hype-run';
import '../stream/stream.css';

/**
 * The sky moments over the stream's own picture: the real kingdom scene through the stream's scene mount, Willowmere
 * as a town at dusk from the hero view, with the stream's walnut frame, signature and SIMULATED ribbon. Cheers are
 * synthetic `channel.bits.use` frames through the real Herald ingest into the scene's own moment feed, so what is
 * drawn here is exactly what the stream draws once main feeds it real cheers. Everything here is SIMULATED.
 *
 *   /-/twitch-moments?stage=stream&rung=skyfire        one cheer of that rung, 2 s after the scene opens
 *   &bits=5000 (instead of rung) · &at=<ms>            frozen at that offset into the beat (for captures)
 *   ?stage=stream&moment=hype&outcome=victory|retreat  the Hype Train run (`hype-run.ts`): the train dresses the
 *                                                       town, level 3 wakes the dragon through the SIMULATED realm
 *                                                       battle authority, and it falls or flies home
 *   &hour=19.5 · &seed=willowmere · &tier=town
 */

/** Scene seconds the picture rests at before a cheer: every arrival of the simulated evening is home by then. */
const REST_SECONDS = 40;
/** The cheer arrives this long after the picture has rested. */
const LEAD_MS = 2000;

declare global { interface Window { __chatdomSky?: unknown } }

export default function StreamSkyBench() {
  const query = new URLSearchParams(location.search);
  const seed = /^[a-z][a-z0-9-]{0,39}$/.test(query.get('seed') ?? '') ? query.get('seed')! : 'willowmere';
  const tier = query.get('tier') === 'hamlet' ? 'hamlet' : 'town';
  const hour = query.has('hour') && Number.isFinite(Number(query.get('hour'))) ? Number(query.get('hour')) : 19.5;
  const rung = DEFAULT_CHEER_LADDER.find(step => step.rung === query.get('rung'));
  const bits = query.has('bits') ? Math.max(1, Math.round(Number(query.get('bits')) || 1)) : rung?.minBits ?? 5000;
  const frozenAt = query.has('at') ? Math.max(-LEAD_MS, Number(query.get('at')) || 0) : null;
  const hype = query.get('moment') === 'hype', outcome: HypeOutcome = query.get('outcome') === 'retreat' ? 'retreat' : 'victory';
  const kingdomName = seed.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const [phase, setPhase] = createSignal<StreamPhase>('waking'), [progress, setProgress] = createSignal(0);
  const [captions, setCaptions] = createSignal<readonly ScreenCaption[]>([]), [prepared, setPrepared] = createSignal(false);
  let lens!: HTMLDivElement, scene: KingdomScene | undefined, sim: BenchSimulation | undefined, who: BenchCitizen | undefined, raf = 0, disposed = false;
  /** Scene seconds: the scene's simulated evening and the cheer's clock are the same clock. */
  let seconds = REST_SECONDS, cheerAt: number | null = null, playing = frozenAt === null, last = performance.now();
  const clock = { now: () => WORLD_FIXTURE_TIME + seconds * 1000 };

  // The scene subscribes when it opens; the simulation that answers it needs the scene's homes, so it joins later.
  type Listener = Parameters<TwitchMomentFeed['subscribe']>;
  let pending: Listener | null = null, stop: (() => void) | null = null;
  const feed: TwitchMomentFeed = {
    origin: 'simulated',
    subscribe(reset, receive, unavailable) {
      pending = [reset, receive, unavailable];
      if (sim) stop = sim.feed.subscribe(reset, receive, unavailable);
      return () => { stop?.(); stop = null; pending = null; };
    },
  };

  const mount = createSceneMount({
    host: () => lens,
    settings: () => ({ tier, seed, hour, time: REST_SECONDS, camera: 'hero', source: 'simulated', kingdomId: WORLD_FIXTURE_KINGDOM, momentFeed: feed,
      onMomentCaptions: next => setCaptions(next) }),
    onPhase: setPhase,
    onProgress: (_text, fraction) => setProgress(fraction),
    onSource: () => {},
    onNames: () => {},
    onScene: next => { scene = next; if (next) void begin(next); },
  });

  /** The town's named people nearest the market, at home like the evening's other people: Juniper first. */
  function neighbours(s: KingdomScene): BenchCitizen[] {
    const homes = s.layout.homes, edge = s.layout.market.boundary;
    const mx = edge.reduce((sum, p) => sum + p[0], 0) / edge.length, mz = edge.reduce((sum, p) => sum + p[1], 0) / edge.length;
    const near = [...homes].sort((a, b) => Math.hypot(a.position[0] - mx, a.position[2] - mz) - Math.hypot(b.position[0] - mx, b.position[2] - mz));
    return HYPE_RUN.riders.map((name, i) => ({ id: benchPerson(i + 1), name, slot: near[i * 3]!.slot, disclosure: 'named' as const }));
  }
  let riders: BenchCitizen[] = [], done = 0;

  async function begin(s: KingdomScene): Promise<void> {
    riders = neighbours(s); who = riders[0]!;
    // A hype run binds the SIMULATED realm battle authority; a cheer never needs one (no cheer wakes the dragon).
    sim = createBenchSimulation(riders, clock, { battle: hype ? 'simulated' : 'unbound', outcome: () => outcome, kingdomId: WORLD_FIXTURE_KINGDOM });
    sim.start();
    if (pending) stop = sim.feed.subscribe(...pending);
    // The moment parts mesh on the scene's own worker lanes after it opens.
    while (!disposed && (s.inspect().moments as { preparation?: string } | undefined)?.preparation === 'loading') await new Promise(r => setTimeout(r, 100));
    if (disposed) return;
    setPrepared(true);
    cheerAt = REST_SECONDS + LEAD_MS / 1000;
    if (frozenAt !== null) { await seek(frozenAt); return; }
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  /**
   * Step the scene and the moment's clock together. A cheer is sent when its moment comes; a hype run sends each of
   * its reports at its own time, and the SIMULATED realm advances its battle on the same clock.
   */
  async function advance(to: number): Promise<void> {
    if (!scene || !sim) return;
    if (!hype && cheerAt !== null && seconds < cheerAt && to >= cheerAt) {
      seconds = cheerAt; scene.seek(seconds);
      sim.cheer(who!, bits);
      await sim.settled();
    }
    if (hype && cheerAt !== null) {
      const steps = HYPE_RUN.steps(outcome);
      while (done < steps.length && cheerAt + steps[done]!.at / 1000 <= to) {
        const step = steps[done++]!;
        seconds = Math.max(seconds, cheerAt + step.at / 1000); scene.seek(seconds);
        step.run(sim, riders);
        await sim.settled();
      }
      const before = sim.authority?.current()?.revision;
      sim.authority?.tick();
      if (sim.authority?.current()?.revision !== before) await sim.settled();
    }
    seconds = to; scene.seek(seconds);
  }

  /** Frozen at `offset` ms into the beat, stepped there in quarter seconds so the director's eases see the beat as a viewer would. */
  async function seek(offset: number): Promise<void> {
    if (cheerAt === null) return;
    const target = cheerAt + offset / 1000;
    if (target < seconds) return;
    for (let t = seconds; t < target; t += 0.25) { await advance(Math.min(target, t + 0.25)); await new Promise(r => requestAnimationFrame(r)); }
    await advance(target);
  }

  function loop(now: number): void {
    if (disposed) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) void advance(seconds + dt);
    raf = requestAnimationFrame(loop);
  }

  onMount(() => {
    document.documentElement.classList.add('stream-document');
    window.__chatdomReady = false;
    mount.mount();
    window.__chatdomSky = {
      ready: () => phase() === 'ready' && prepared() && !!scene?.debug.ready && !!scene.debug.lightingReady,
      failed: () => phase() === 'failed',
      seek: (offset: number) => { playing = false; return seek(offset); },
      replay: () => { if (!scene) return; playing = true; },
      inspect: () => scene?.inspect(),
      beat: () => (cheerAt === null ? null : (seconds - cheerAt) * 1000),
      /** The run's stills for a sequence capture: [name, ms from the moment's start]. */
      beats: () => (hype ? HYPE_RUN.beats(outcome) : []),
    };
  });
  onCleanup(() => {
    disposed = true; cancelAnimationFrame(raf); sim?.stop(); mount.unmount('hidden');
    delete window.__chatdomSky; document.documentElement.classList.remove('stream-document');
  });

  return <>
    <StreamDefs />
    <div class="stream-sheet">
      <div class="stream-output layout-stage" data-chatdom-stream data-phase={phase()} data-source="simulated">
        <div class="stream-picture">
          <div class="stream-lens" ref={element => { lens = element; }} />
          <SkyCaptions captions={captions()} />
        </div>
        <div class="stream-frame" aria-hidden="true"><Corner at="tl" /><Corner at="tr" /><Corner at="bl" /><Corner at="br" /></div>
        <div class="stream-signature"><Crest /><span>{kingdomName}</span></div>
        <div class="source-ribbon stream-mark simulated" role="status"><strong>SIMULATED</strong></div>
        <div class="stream-curtain" classList={{ open: phase() === 'ready' && prepared() }} role="status">
          <Crest class="large" />
          <h2>{kingdomName}</h2>
          <p>{phase() === 'failed' ? 'The kingdom could not open' : 'The lamps are being lit'}</p>
          <div class="stream-progress"><i style={{ transform: `scaleX(${Math.max(.04, progress())})` }} /></div>
        </div>
      </div>
    </div>
  </>;
}
