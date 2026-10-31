import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import * as THREE from 'three';
import type { KingdomPresenceFrame } from '@chatdom/shared';
import {
  BANNER_BEAT, createProceduralMomentSound, createTwitchMoments, createTwitchMomentView, createUnavailableMomentFeed,
  type ActionPreview, type CameraLease, type CameraPose, type HomeAnchor, type ScreenCaption, type TwitchMoments, type TwitchMomentView,
} from '../twitch-moments';
import { createMomentStage, type MomentStage } from './stage';
import { BENCH_KINGDOM, benchPerson, createBenchSimulation, type BenchCitizen, type BenchDelivery, type BenchSimulation } from './simulation';
import './style.css';

/** The scrubber's reach: long enough for a full gift cart to arrive, hand out its waves and roll on. */
const TIMELINE_MS = 20_000;
/** Kingdom time at which every deterministic bench scenario begins. */
const START = Date.UTC(2026, 9, 30, 19, 40);
interface LogLine { readonly id: number; readonly text: string; readonly tone: 'public' | 'refused' | 'source' }

/** Bench scenarios: each opens on one deterministic beat so a capture can seek straight into it. */
const SCENARIOS = ['banner', 'neighbours', 'restored', 'idle', 'resub', 'tiers', 'lapse', 'rejoin', 'cloak', 'gift', 'forward', 'cart', 'friend', 'ward'] as const;
type Scenario = typeof SCENARIOS[number];
const HEADINGS: Partial<Record<Scenario, string>> = { gift: 'A gift at the door', forward: 'A gift paid forward', cart: 'The gift cart', friend: 'From a friend of the realm',
  ward: 'Parcels for the whole street', cloak: 'A rose cloak',
  resub: 'Seven months under the banner', tiers: 'A finer cloth', lapse: 'A banner furled', rejoin: 'The banner, again' };

const DECREE = { kind: 'poll-create', title: 'Where shall the new well be dug?', choices: ['By the old bridge', 'In the market square', 'Up on Heather Hill'], durationSeconds: 180 } as const;

export default function TwitchMomentsBench() {
  const query = new URLSearchParams(location.search);
  const live = query.get('mode') === 'live', clean = query.get('clean') === '1';
  const scenario: Scenario = SCENARIOS.find(s => s === query.get('scenario')) ?? 'neighbours';
  const fixedAt = query.has('at') ? Math.max(0, Number(query.get('at')) || 0) : null;
  const hour = Number.isFinite(Number(query.get('hour'))) && query.has('hour') ? Number(query.get('hour')) : 19.8;
  const [phase, setPhase] = createSignal('Raising the hamlet'), [progress, setProgress] = createSignal(0), [failed, setFailed] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false), [captions, setCaptions] = createSignal<ScreenCaption[]>([]), [log, setLog] = createSignal<LogLine[]>([]);
  const [citizens, setCitizens] = createSignal<BenchCitizen[]>([]), [status, setStatus] = createSignal<string>(live ? 'unavailable' : 'waiting');
  const [playing, setPlaying] = createSignal(fixedAt === null), [beatAt, setBeatAt] = createSignal<number | null>(null), [clockMs, setClockMs] = createSignal(START);
  const [sound, setSound] = createSignal(false), [sheet, setSheet] = createSignal(!clean), [preview, setPreview] = createSignal<ActionPreview | null>(null);
  const [actionNote, setActionNote] = createSignal<string | null>(null), [busy, setBusy] = createSignal(false);
  let canvas!: HTMLCanvasElement, stage: MomentStage | undefined, moments: TwitchMoments | undefined, view: TwitchMomentView | undefined, sim: BenchSimulation | undefined;
  let raf = 0, last = performance.now(), now = START, logId = 0, audio: { context: AudioContext; destination: AudioNode } | null = null, disposed = false;
  const construction = new AbortController();
  const benchWindow = window as Window & { __chatdomReady?: boolean; __chatdomMoments?: unknown };
  const clock = { now: () => now };

  const note = (text: string, tone: LogLine['tone']) => setLog(lines => [{ id: ++logId, text, tone }, ...lines].slice(0, 7));

  /** The bench owns its camera; a lease lends it to the moments director and hands back the actual prior pose. */
  let basePose: CameraPose = { eye: [0, 30, 60], target: [0, 0, 0], fov: 46 }, lease: { pose: CameraPose; open: boolean } | null = null;
  const cameraPort = { acquire(): CameraLease | null {
    if (lease?.open) return null;
    const mine = { pose: basePose, open: true };
    lease = mine;
    return { read: () => mine.pose, write: pose => { if (!mine.open) return false; mine.pose = pose; return true; }, release: () => { mine.open = false; if (lease === mine) lease = null; } };
  } };

  function presenceFor(people: readonly BenchCitizen[], layoutSlots: readonly number[]): KingdomPresenceFrame {
    // SIMULATED presence: the bench's citizens are home, plus a few other lit windows along the street.
    const named = new Map(people.flatMap(c => c.disclosure === 'named' && c.slot !== null ? [[c.slot, c.name] as const] : []));
    const present = new Set([...people.flatMap(c => c.slot === null ? [] : [c.slot]), ...layoutSlots.filter((_, i) => i % 3 !== 1).slice(0, 10)]);
    return { version: 1, kingdomId: BENCH_KINGDOM, epoch: 'bench-presence', sequence: 1, asOf: START, origin: 'simulated', streamLive: true, connection: 'fresh',
      windows: layoutSlots.map(slot => ({ slot, present: present.has(slot), publicName: present.has(slot) ? named.get(slot) ?? null : null, since: START - 600_000 })) };
  }

  function chooseCitizens(s: MomentStage): BenchCitizen[] {
    const homes = s.layout.homes, anchored = homes.filter(h => s.homeAnchor(h.slot));
    const neighbours = (h: typeof homes[number]) => homes.filter(o => Math.hypot(o.position[0] - h.position[0], o.position[2] - h.position[2]) < 34).length;
    const home = [...anchored].sort((a, b) => (b.tier === 'house' ? 1 : 0) - (a.tier === 'house' ? 1 : 0) || neighbours(b) - neighbours(a))[0];
    if (!home) throw new Error('No home in this hamlet has a wall a banner can hang on');
    const near = homes.filter(h => h !== home).sort((a, b) => Math.hypot(a.position[0] - home.position[0], a.position[2] - home.position[2]) - Math.hypot(b.position[0] - home.position[0], b.position[2] - home.position[2]));
    // Neighbours with a banner wall first; any nearby home will do for a giver, who needs a name, not a wall.
    const rest = near.slice(1), others = [...rest.filter(h => s.homeAnchor(h.slot)), ...rest.filter(h => !s.homeAnchor(h.slot))].slice(0, 2);
    const quiet = near[0]!;
    return [
      { id: benchPerson(1), name: 'Juniper', slot: home.slot, disclosure: 'named' },
      { id: benchPerson(2), name: 'A quiet neighbour', slot: quiet.slot, disclosure: 'anonymous' },
      ...others.map((h, i) => ({ id: benchPerson(3 + i), name: ['Rowan', 'Hazel'][i]!, slot: h.slot, disclosure: 'named' as const })),
      // Named in chat, but without a home in Willowmere yet: support for Moss is welcomed at the gate.
      { id: benchPerson(9), name: 'Moss', slot: null, disclosure: 'named' },
    ];
  }

  /**
   * More named neighbours for the capital-shaped gift: every other home with a doorstep, in street order. They are
   * SIMULATED citizens of the bench hamlet like the rest, entered into the same directory and presence frame.
   */
  function wardCitizens(s: MomentStage, taken: readonly BenchCitizen[]): BenchCitizen[] {
    const used = new Set(taken.flatMap(c => (c.slot === null ? [] : [c.slot])));
    const names = ['Alder', 'Bramble', 'Clover', 'Dunlin', 'Ember', 'Fennel', 'Garnet', 'Heron', 'Ivy', 'Jasper', 'Kestrel', 'Linden', 'Marigold', 'Nettle', 'Oriel', 'Plover'];
    return s.layout.homes.filter(h => !used.has(h.slot) && s.doorAnchor(h.slot)).slice(0, names.length)
      .map((h, i) => ({ id: benchPerson(20 + i), name: names[i]!, slot: h.slot, disclosure: 'named' as const }));
  }

  function framing(s: MomentStage, people: readonly BenchCitizen[]): CameraPose {
    const a = s.homeAnchor(people[0]!.slot!)!, quiet = s.layout.homes.find(h => h.slot === people[1]!.slot)!;
    const door = new THREE.Vector3(...a.doorstep), normal = new THREE.Vector3(...a.normal), right = new THREE.Vector3(...a.right);
    const toQuiet = new THREE.Vector3(quiet.position[0], door.y, quiet.position[2]).sub(door).dot(right) > 0 ? 1 : -1;
    const portrait = canvas.clientHeight > canvas.clientWidth;
    const target = door.clone().addScaledVector(right, toQuiet * 4.2).add(new THREE.Vector3(0, 2.6, 0));
    const eye = target.clone().addScaledVector(normal, portrait ? 26 : 19).addScaledVector(right, -toQuiet * (portrait ? 4 : 7)).add(new THREE.Vector3(0, portrait ? 7.5 : 5.5, 0));
    return { eye: eye.toArray(), target: target.toArray(), fov: portrait ? 58 : 46 };
  }

  async function settle(): Promise<void> {
    await sim?.settled();
    for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
  }

  async function deliver(kind: BenchDelivery, citizen: BenchCitizen): Promise<void> {
    if (!sim || !moments) return;
    const before = sim.status().counts, seen = moments.metrics().admitted;
    const delivered = sim.deliver(kind, citizen);
    await settle();
    const label = citizen.disclosure === 'named' ? citizen.name : 'a quiet neighbour';
    report(delivered, before, seen, kind === 'lapse' ? `channel.subscription.end → ${label}`
      : `${kind === 'resub' ? 'resub' : kind.startsWith('tier') ? `sub (${kind})` : 'sub'} notice → ${label}${citizen.slot === null ? ' at the gate' : '’s home'}`, kind === 'late');
  }

  /** The public outcome of whatever the source just delivered, as counted by the real ingest. */
  function report(delivered: boolean, before: ReturnType<BenchSimulation['status']>['counts'], seen: number, what: string, late = false): void {
    if (!sim || !moments) return;
    const after = sim.status().counts;
    if (!delivered) { note('The source is down: Twitch has nothing to deliver to', 'source'); return; }
    if (after.duplicate > before.duplicate) note('Refused · a delivery Twitch already sent once', 'refused');
    else if (after.malformed > before.malformed) note('Refused · the event belongs to another channel', 'refused');
    else if (after.published > before.published) {
      const beat = moments.metrics().admitted > seen;
      note(`${what} · ${beat ? 'a beat plays' : late ? 'late: it simply flies' : 'state only'}`, 'public');
      if (beat) setBeatAt(Math.max(now, beatAt() === null ? now : beatAt()!));
    } else if (after.applied > before.applied) note(`${what} → recorded privately; never named or marked`, 'public');
    else if (after.record > before.record) note('Refused · the record store failed; nothing was published', 'refused');
    refreshStatus();
  }

  async function gift(send: (s: BenchSimulation) => boolean, what: string): Promise<void> {
    if (!sim || !moments) return;
    const before = sim.status().counts, seen = moments.metrics().admitted;
    const delivered = send(sim);
    await settle();
    report(delivered, before, seen, what);
    // Gift groups gather briefly before the beat is planned; the beat starts when the group was first seen.
    if (moments.metrics().admitted > seen || delivered) setBeatAt(beatAt() ?? now);
    refreshStatus();
  }

  function refreshStatus(): void { setStatus(moments?.status ?? 'unavailable'); }

  function frame(atMs: number): void {
    if (!stage || !moments || !view) return;
    const sampled = moments.sample(atMs);
    view.apply(sampled);
    stage.setPose(lease?.open ? lease.pose : basePose);
    stage.render(atMs);
    setCaptions(view.labels(stage.camera));
  }

  function loop(t: number): void {
    if (disposed) return;
    const dt = Math.min(100, t - last); last = t;
    if (playing() && fixedAt === null) { now += dt; setClockMs(now); }
    frame(now);
    if (!ready() && stage?.stats().lightingReady) { setReady(true); benchWindow.__chatdomReady = true; }
    raf = requestAnimationFrame(loop);
  }

  function seek(offset: number): void {
    const start = beatAt();
    if (start === null) return;
    setPlaying(false);
    now = start + offset; setClockMs(now);
  }

  function enableSound(): void {
    if (!audio) {
      const context = new AudioContext(), master = context.createGain(), limiter = context.createDynamicsCompressor();
      master.gain.value = 0.5; limiter.threshold.value = -16; limiter.ratio.value = 6;
      master.connect(limiter); limiter.connect(context.destination);
      audio = { context, destination: master };
    }
    void audio.context.resume();
    setSound(!sound());
  }

  onMount(() => {
    benchWindow.__chatdomReady = false;
    document.body.classList.add('moments-bench-page');
    void (async () => {
      try {
        stage = await createMomentStage(canvas, { seed: query.get('seed') ?? 'willowmere', hour, signal: construction.signal, onProgress: f => { setProgress(f); if (f > 0.6) setPhase('Hanging the lanterns'); } });
        if (disposed) { stage.dispose(); return; }
        const chosen = chooseCitizens(stage);
        const people = scenario === 'ward' ? [...chosen, ...wardCitizens(stage, chosen)] : chosen;
        setCitizens(chosen);
        basePose = framing(stage, people);
        stage.setPresence(presenceFor(people, stage.layout.homes.map(h => h.slot)));
        moments = createTwitchMoments({ kingdomId: BENCH_KINGDOM, expectedOrigin: live ? 'live' : 'simulated', clock });
        moments.receivePresence(presenceFor(people, stage.layout.homes.map(h => h.slot)));
        const port = createProceduralMomentSound({ context: () => (sound() ? audio : null), now: () => now, gain: () => (sound() ? 1 : 0) });
        view = createTwitchMomentView({ parent: stage.parent, material: stage.material, kit: query.get('kit') === 'hearth' ? 'hearth' : 'tide',
          mesh: b => stage!.mesh(b), homeAnchor: (slot): HomeAnchor | null => stage!.homeAnchor(slot), doorAnchor: slot => stage!.doorAnchor(slot),
          windowAnchor: slot => stage!.windowAnchor(slot), placeAnchor: place => stage!.placeAnchor(place), giftRoute: () => stage!.giftRoute(), sound: port, camera: cameraPort,
          viewport: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }) });
        setPhase('Weaving the banners');
        await view.prepare();
        if (live) {
          // A live source that is not bound stays unavailable; the bench never substitutes fixtures for it.
          moments.connect(createUnavailableMomentFeed('live'));
          await new Promise(r => setTimeout(r, 0));
        } else {
          sim = createBenchSimulation(people, clock);
          moments.connect(sim.feed);
          const started = sim.start();
          note(`Source · SIMULATED local EventSub transport, plan: ${started.plan.map(p => `${p.type} v${p.version}`).join(', ')}`, 'source');
          await settle();
          const [juniper, quiet] = people, rowan = people.find(p => p.name === 'Rowan'), hazel = people.find(p => p.name === 'Hazel'), moss = people.find(p => p.name === 'Moss')!;
          const giver = rowan ?? juniper!, other = hazel ?? quiet!;
          if (scenario === 'resub' || scenario === 'tiers' || scenario === 'cloak' || scenario === 'lapse' || scenario === 'rejoin') {
            // An hour earlier Juniper already flew a banner: the beat now is the change, not the first raising.
            now = START - 3_600_000; await deliver('subscribe', juniper!);
            if (scenario === 'rejoin') { now = START - 1_800_000; await deliver('lapse', juniper!); }
            now = START; await deliver(scenario === 'resub' ? 'resub' : scenario === 'tiers' ? 'tier-3' : scenario === 'cloak' ? 'tier-2' : scenario === 'lapse' ? 'lapse' : 'rejoin', juniper!);
            setBeatAt(START);
          } else if (scenario === 'gift') {
            await gift(s => s.giftOne(giver, juniper!), `${giver.name} gifts a sub to Juniper`);
          } else if (scenario === 'forward') {
            await gift(s => s.giftOne(other, juniper!, { id: giver.id, name: giver.name }), `${other.name} pays ${giver.name}’s gift forward to Juniper`);
          } else if (scenario === 'cart') {
            await gift(s => s.giftGroup(giver, 6, [juniper!, other, moss, quiet!]), `${giver.name} gifts 6 subs · 4 recipients disclosed`);
          } else if (scenario === 'friend') {
            await gift(s => s.giftGroup('anonymous', 3, [juniper!], '2000'), 'An anonymous gifter gives 3 subs · 1 recipient disclosed');
          } else if (scenario === 'ward') {
            // Thirty gifts, eighteen recipients disclosed: waves of parcels street by street, the rest ride on unnamed.
            const disclosed = people.filter(p => p !== giver);
            await gift(s => s.giftGroup(giver, 30, disclosed), `${giver.name} gifts 30 subs · ${disclosed.length} recipients disclosed`);
          } else if (scenario === 'restored') {
            now = START - 3_600_000; await deliver('subscribe', juniper!); await deliver('subscribe', quiet!);
            now = START - 3_000_000; await gift(s => s.giftOne(rowan ?? juniper!, juniper!), 'A gift an hour ago');
            now = START; sim.restartSource(); await settle();
            note('New source session · restored from records, no beat replays', 'source');
            setBeatAt(null);
          } else if (scenario !== 'idle') {
            await deliver('subscribe', juniper!);
            setBeatAt(START);
            if (scenario === 'neighbours') { now = START + 600; await deliver('subscribe', quiet!); now = START; }
          }
        }
        refreshStatus();
        if (fixedAt !== null) { now = START + fixedAt; setClockMs(now); }
        setPreview(moments.previewAction(DECREE));
        benchWindow.__chatdomMoments = {
          metrics: () => moments?.metrics(), status: () => sim?.status() ?? null, view: () => view?.stats(), sample: (at: number) => moments?.sample(at),
          seek: (offset: number) => { now = START + offset; setClockMs(now); frame(now); },
          hide: (hidden: boolean) => moments?.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: !hidden, safeRects: [], autoOpenKinds: [] }),
        };
        last = performance.now();
        raf = requestAnimationFrame(loop);
      } catch (error) {
        if (disposed) return;
        console.error('Twitch moments bench failed', error);
        setFailed(error instanceof Error ? error.message : 'The bench could not open');
      }
    })();
  });

  onCleanup(() => {
    disposed = true; construction.abort(); cancelAnimationFrame(raf);
    view?.dispose(); moments?.dispose(); sim?.stop(); stage?.dispose(); void audio?.context.close();
    benchWindow.__chatdomReady = false; document.body.classList.remove('moments-bench-page');
  });

  async function pressDecree(): Promise<void> {
    if (!moments || busy()) return;
    setBusy(true);
    const result = await moments.submitAction({ id: `decree-${Date.now().toString(36)}`, type: 'twitch.action', args: DECREE });
    setBusy(false);
    setActionNote(result.status === 'unavailable' ? 'Nothing was sent. No action service is bound to this bench.' : `Result: ${result.status}`);
  }

  const offset = () => { const start = beatAt(); return start === null ? 0 : Math.max(0, Math.min(TIMELINE_MS, clockMs() - start)); };
  const statusText = () => live ? 'LIVE · NOT CONNECTED' : status() === 'ready' ? 'SIMULATED' : status() === 'unavailable' ? 'SIMULATED · SOURCE DOWN' : 'SIMULATED · CONNECTING';

  return <div class="moments-bench" classList={{ clean, live }} data-chatdom-moments>
    <canvas ref={element => { canvas = element; }} class="moments-canvas" aria-label="Willowmere, a hamlet; a home banner moment" />
    <div class="moments-vignette" aria-hidden="true" />
    <div class="moment-captions" aria-live="polite">
      <For each={captions()}>{caption => <div class="moment-caption" style={{ left: `${caption.x}px`, top: `${caption.y}px`, opacity: caption.opacity }}>
        <span class="caption-mark" aria-hidden="true" /><strong>{caption.title}</strong><small>{caption.line}</small>
        <Show when={caption.detail}><em class="caption-detail">{caption.detail}</em></Show>
      </div>}</For>
    </div>
    <Show when={!clean}>
      <header class="moments-heading">
        <p class="moments-eyebrow">Twitch happens in the kingdom</p>
        <h1>{HEADINGS[scenario] ?? 'A banner at home'}</h1>
        <p class="moments-sub">Willowmere · a hamlet of {citizens().length ? 'familiar' : ''} lights</p>
      </header>
    </Show>
    <div class="moments-source" classList={{ down: status() !== 'ready' }}><span class="source-pip" />{statusText()}</div>
    <Show when={clean}><div class="moments-clean-mark">{live ? 'LIVE · NOT CONNECTED' : 'SIMULATED'}</div></Show>

    <Show when={!clean && ready()}>
      <button class="sheet-toggle" aria-expanded={sheet()} onClick={() => setSheet(!sheet())}>{sheet() ? 'Hide the bench' : 'Open the bench'}</button>
      <Show when={sheet()}>
        <aside class="moments-panel" aria-label="Twitch moments bench">
          <Show when={live} fallback={<>
            <section>
              <h2>Provider notifications <em>SIMULATED</em></h2>
              <p class="panel-note">Synthetic EventSub frames enter the real Herald ingest, records and directory. Simulated channel {BENCH_KINGDOM}.</p>
              <ul class="citizens">
                <For each={citizens()}>{citizen => <li>
                  <span class="citizen-name" classList={{ quiet: citizen.disclosure === 'anonymous' }}>{citizen.name}<small>{citizen.disclosure === 'named' ? 'named citizen' : 'never named or marked'}</small></span>
                  <Show when={citizen.slot !== null}><button onClick={() => void deliver('subscribe', citizen)}>Subscribes</button></Show>
                </li>}</For>
              </ul>
              <div class="source-actions">
                <button onClick={() => void deliver('resub', citizens()[0]!)}>Resub · 7 months</button>
                <button onClick={() => void deliver('tier-2', citizens()[0]!)}>Tier 2</button>
                <button onClick={() => void deliver('tier-3', citizens()[0]!)}>Tier 3</button>
                <button onClick={() => void deliver('lapse', citizens()[0]!)}>Lapses</button>
              </div>
              <div class="source-actions">
                <button onClick={() => { const c = citizens(), giver = c[2] ?? c[0]!; void gift(s => s.giftOne(giver, c[0]!), `${giver.name} gifts a sub to ${c[0]!.name}`); }}>Gift one</button>
                <button onClick={() => { const c = citizens(), giver = c[3] ?? c[0]!, from = c[2] ?? c[0]!; void gift(s => s.giftOne(giver, c[0]!, { id: from.id, name: from.name }), `${giver.name} pays ${from.name}’s gift forward`); }}>Pay it forward</button>
                <button onClick={() => { const c = citizens(), giver = c[2] ?? c[0]!; void gift(s => s.giftGroup(giver, 6, c.filter(x => x !== giver)), `${giver.name} gifts 6 subs`); }}>Gift cart</button>
                <button onClick={() => { const c = citizens(); void gift(s => s.giftGroup('anonymous', 3, [c[0]!], '2000'), 'An anonymous gifter gives 3 subs'); }}>Anonymous gifts</button>
              </div>
              <div class="source-actions">
                <button onClick={() => void deliver('repeat', citizens()[0]!)}>Deliver again</button>
                <button onClick={() => void deliver('late', citizens()[2] ?? citizens()[0]!)}>Late delivery</button>
                <button onClick={() => void deliver('wrong-channel', citizens()[0]!)}>Wrong channel</button>
                <button onClick={() => { sim?.disconnect(); note('Source dropped · beats and leases end, homes keep their banners', 'source'); refreshStatus(); }}>Drop the source</button>
                <button onClick={() => { sim?.restartSource(); void settle().then(() => { note('New source session · non-animating reset', 'source'); refreshStatus(); }); }}>New session</button>
              </div>
            </section>
            <section>
              <h2>Timeline</h2>
              <div class="timeline">
                <button class="play" aria-label={playing() ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing())}>{playing() ? 'Pause' : 'Play'}</button>
                <input type="range" min="0" max={TIMELINE_MS} step="20" value={offset()} disabled={beatAt() === null} aria-label="Time into the latest banner beat"
                  onInput={event => seek(Number(event.currentTarget.value))} />
                <output>{(offset() / 1000).toFixed(1)} s</output>
              </div>
              <div class="beat-marks" aria-hidden="true">
                <For each={[BANNER_BEAT.anticipation, BANNER_BEAT.action, BANNER_BEAT.settle, BANNER_BEAT.end]}>{mark => <i style={{ left: `${mark / TIMELINE_MS * 100}%` }} />}</For>
              </div>
              <button class="sound" aria-pressed={sound()} onClick={enableSound}>{sound() ? 'Sound on' : 'Sound off'}</button>
            </section>
          </>}>
            <section>
              <h2>Live source</h2>
              <p class="panel-note">No Twitch moments source is bound to this page. Nothing is simulated in this mode, and nothing will appear until main binds the real feed.</p>
            </section>
          </Show>
          <section class="decree">
            <h2>Decree preview</h2>
            <Show when={preview()?.ok ? preview() as Extract<ActionPreview, { ok: true }> : null}>{p => <>
              <p class="decree-title">{p().title}</p>
              <ol class="decree-lines"><For each={p().lines}>{line => <li>{line}</li>}</For></ol>
              <p class="decree-state">{p().capability.available ? 'Ready' : 'Unavailable · no action service is bound'}</p>
              <button disabled={!p().capability.available || busy()} onClick={() => void pressDecree()}>Open the poll on Twitch</button>
              <Show when={actionNote()}><p class="panel-note">{actionNote()}</p></Show>
            </>}</Show>
          </section>
          <section>
            <h2>Public projection</h2>
            <ol class="log"><For each={log()}>{line => <li class={line.tone}>{line.text}</li>}</For></ol>
          </section>
        </aside>
      </Show>
    </Show>

    <Show when={!ready() || failed()}>
      <div class="moments-gate" role="status">
        <h2>{failed() ? 'The bench needs a moment.' : phase()}</h2>
        <p>{failed() ?? 'A hamlet is gathering its lights.'}</p>
        <Show when={!failed()}><div class="gate-progress"><i style={{ width: `${Math.round(progress() * 100)}%` }} /></div></Show>
      </div>
    </Show>
  </div>;
}
