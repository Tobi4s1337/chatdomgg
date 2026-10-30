import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { createCitizenMotion, type CitizenMotionSample } from '@chatdom/world';
import { createNeighbourStreet, NEIGHBOUR_FIXTURE as F } from '../../../../packages/world/src/citizen-behaviours/fixture';
import type { CitizenEncounter, CitizenOverlay } from '../../../../packages/world/src/citizen-behaviours';
import { createBehaviourLoop, type BehaviourLoopSource } from './loop';
import { createBehaviourStage, type BenchFocus, type BenchView } from './stage';
import './style.css';

type Scenario = 'encounter' | 'takeover' | 'departure';
interface BehaviourReport {
  readonly t: number;
  readonly hour: number;
  readonly view: BenchView;
  readonly scenario: Scenario;
  readonly lightSettled: boolean;
  /** Seconds from the fixture start, for captures. */
  readonly encounter: { readonly greeter: number; readonly recipient: number; readonly gesture: 'nod' | 'wave'; readonly start: number; readonly pose: number; readonly poseEnd: number; readonly end: number; readonly glance: number | null };
  readonly cut: number;
  readonly overlays: readonly { readonly slot: number; readonly gesture: CitizenOverlay['gesture']; readonly lookYaw: number }[];
  readonly people: number;
}
declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomBehaviour?: BehaviourReport;
    __chatdomBehaviourError?: string;
    __chatdomBehaviourSeek?: (seconds: number) => Promise<void>;
  }
}

const HOURS = [{ hour: 19, name: 'Dusk' }, { hour: 12, name: 'Midday' }] as const;
const VIEWS: readonly { id: BenchView; name: string }[] = [{ id: 'doorstep', name: 'Doorstep' }, { id: 'close', name: 'Close' }, { id: 'street', name: 'Street' }];
const SCENARIOS: readonly { id: Scenario; name: string; note: string }[] = [
  { id: 'encounter', name: 'Passing neighbours', note: 'Two neighbours meet in front of their doors on the way home. The one who notices turns their head first, gives one small nod, holds the look and settles. The other glances back without breaking stride.' },
  { id: 'takeover', name: 'Walker takes over', note: 'The greeter comes under walker control mid-gesture. Ambient behaviour lets go of them at once; the neighbour they were greeting eases their glance back to rest.' },
  { id: 'departure', name: 'Neighbour leaves', note: 'The neighbour being greeted leaves presence mid-gesture. Their glance and every reference to them drop in the same step; the greeter finishes the dip already under way and settles.' },
];
const STEP_MS = 100;

/** Kingdom milliseconds → seconds on the fixture clock. */
const seconds = (ms: number): number => (ms - F.startMs) / 1000;

export default function CitizenBehaviourBench() {
  let canvas!: HTMLCanvasElement;
  const params = new URLSearchParams(window.location.search);
  const frameMode = params.get('frame') === 'still' ? 'still' : 'page';
  const hour = Number(params.get('hour') ?? 19) === 12 ? 12 : 19;
  const view: BenchView = (['close', 'street'] as const).find(id => id === params.get('view')) ?? 'doorstep';
  const scenario: Scenario = (['takeover', 'departure'] as const).find(id => id === params.get('scenario')) ?? 'encounter';
  const fixed = params.has('t') ? Number(params.get('t')) : null;
  const [status, setStatus] = createSignal('Waking the street…');
  const [failed, setFailed] = createSignal(false);
  const [clock, setClock] = createSignal(0);
  const [story, setStory] = createSignal<{ encounter: CitizenEncounter; cut: number } | null>(null);
  const [playing, setPlaying] = createSignal(fixed === null);
  let disposed = false, teardown: (() => void) | undefined;

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomBehaviour; delete window.__chatdomBehaviourError;
    void (async () => {
      if (fixed !== null && !Number.isFinite(fixed)) throw new Error('The time must be a number of seconds.');
      const street = createNeighbourStreet();
      // Find the first encounter of the plain story, through the same motion and policy the stage shows.
      const allSlots = new Set(street.slots);
      const plain: BehaviourLoopSource = { kingdomId: F.kingdomId, epoch: F.epoch, origin: F.origin, frameAt: atMs => street.frameAt(atMs), ambientAt: () => allSlots };
      const scout = createBehaviourLoop(createCitizenMotion(street.plan), plain);
      let first: CitizenEncounter | undefined;
      for (let now = F.startMs; now <= F.startMs + 150_000 && !first; now += STEP_MS) first = scout.advance(now).flatMap(step => step.started)[0];
      if (!first) throw new Error('No neighbours met in the simulated story.');
      const atPose = scout.present(first.poseAtMs).samples, find = (slot: number): CitizenMotionSample => atPose.find(sample => sample.slot === slot)!;
      const greeter = find(first.greeter), recipient = find(first.recipient);
      const focus: BenchFocus = { slot: first.greeter, subject: greeter.position, subjectHeading: greeter.heading, subjectSpeed: greeter.speed,
        other: recipient.position, otherHeading: recipient.heading, otherSpeed: recipient.speed };
      const cut = first.poseAtMs + 300;
      setStory({ encounter: first, cut });

      // The shown story: identical, plus the chosen labelled interruption.
      const departures = new Map(scenario === 'departure' ? [[first.recipient, cut]] : []);
      const motion = createCitizenMotion(street.plan);
      const loop = createBehaviourLoop(motion, { kingdomId: F.kingdomId, epoch: F.epoch, origin: F.origin,
        frameAt: atMs => street.frameAt(atMs, departures),
        ambientAt: atMs => scenario === 'takeover' && atMs >= cut ? new Set(street.slots.filter(slot => slot !== first.greeter)) : allSlots });
      const stage = await createBehaviourStage(canvas, street.plan, street.slots, { hour, onProgress: setStatus });
      if (disposed) { stage.dispose(); return; }
      stage.setView(view, focus);
      const clipStart = first.startMs - 5_000, clipEnd = first.endMs + 4_000;
      let now = fixed === null ? clipStart : F.startMs + fixed * 1000, raf = 0, last = performance.now();
      const replayTo = (target: number): void => {
        loop.reset();
        for (let t = F.startMs; t < target; t += STEP_MS) loop.advance(t);
        loop.advance(target);
      };
      const report = (lightSettled: boolean, overlays: ReadonlyMap<number, CitizenOverlay>, people: number): void => {
        window.__chatdomBehaviour = { t: seconds(now), hour, view, scenario, lightSettled, cut: seconds(cut), people,
          encounter: { greeter: first.greeter, recipient: first.recipient, gesture: first.gesture, start: seconds(first.startMs), pose: seconds(first.poseAtMs),
            poseEnd: seconds(first.poseEndMs), end: seconds(first.endMs), glance: first.glanceAtMs === null ? null : seconds(first.glanceAtMs) },
          overlays: [...overlays].map(([slot, overlay]) => ({ slot, gesture: overlay.gesture, lookYaw: overlay.lookYaw })) };
      };
      /** A fixed evidence frame: replay the whole story to `target`, draw, wait for window light. */
      const still = async (target: number): Promise<void> => {
        window.__chatdomReady = false;
        now = target; setClock(seconds(now)); replayTo(now);
        const current = loop.present(now);
        for (let i = 0; i < 600; i++) {
          stage.draw(now, seconds(now), street.frameAt(now, departures), current, true);
          if (i > 1 && stage.lightSettled) break;
          await new Promise(resolve => setTimeout(resolve, 50));
          if (disposed) return;
        }
        stage.draw(now, seconds(now), street.frameAt(now, departures), current, true); stage.finish();
        report(stage.lightSettled, current.overlays, current.samples.length);
        window.__chatdomReady = true;
      };
      const tick = (time: number): void => {
        if (disposed) return;
        try {
          const dt = Math.min(.1, (time - last) / 1000); last = time;
          if (playing()) {
            now += dt * 1000;
            if (now > clipEnd) { now = clipStart; replayTo(now); }
            loop.advance(now);
            const current = loop.present(now);
            stage.draw(now, seconds(now), street.frameAt(now, departures), current, false);
            setClock(seconds(now)); report(false, current.overlays, current.samples.length);
          }
          raf = requestAnimationFrame(tick);
        } catch (error) { fail(error); }
      };
      window.__chatdomBehaviourSeek = async target => { setPlaying(false); await still(F.startMs + target * 1000); };
      teardown = () => { cancelAnimationFrame(raf); delete window.__chatdomBehaviourSeek; stage.dispose(); };
      setStatus('');
      if (fixed !== null) await still(now);
      else {
        replayTo(now);
        const current = loop.present(now);
        stage.draw(now, seconds(now), street.frameAt(now, departures), current, true); stage.finish();
        report(false, current.overlays, current.samples.length);
        window.__chatdomReady = true;
      }
      replay = () => { now = clipStart; replayTo(now); last = performance.now(); setPlaying(true); };
      raf = requestAnimationFrame(tick);
    })().catch(fail);
  });
  let replay: (() => void) | undefined;
  function fail(error: unknown): void {
    if (disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    window.__chatdomBehaviourError = message; setStatus(message); setFailed(true); console.error(message);
  }
  onCleanup(() => { disposed = true; teardown?.(); window.__chatdomReady = false; });

  const query = (changes: Record<string, string | null>): string => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) if (value === null) next.delete(key); else next.set(key, value);
    return `?${next}`;
  };
  const phase = (): string => {
    const s = story(); if (!s) return '';
    const e = s.encounter, t = F.startMs + clock() * 1000;
    if (scenario === 'takeover' && t >= s.cut) return 'Walker control · the routine lets go';
    if (scenario === 'departure' && t >= s.cut) return t < e.poseEndMs ? 'Neighbour left · the dip finishes' : 'Neighbour left · settling';
    if (t < e.startMs) return 'Walking home';
    if (t < e.poseAtMs) return 'Noticing · the head turns first';
    if (t < e.poseEndMs) return e.gesture === 'nod' ? 'A small nod' : 'A brief wave';
    if (t < e.endMs) return 'Holding the look · settling';
    return 'At ease';
  };
  const marks = () => {
    const s = story(); if (!s) return null;
    const e = s.encounter, from = e.startMs - 1_500, span = e.endMs + 1_500 - from, at = (ms: number): string => `${((ms - from) / span * 100).toFixed(2)}%`;
    const width = (a: number, b: number): string => `${((b - a) / span * 100).toFixed(2)}%`;
    return { look: { left: at(e.startMs), width: width(e.startMs, e.poseAtMs) }, pose: { left: at(e.poseAtMs), width: width(e.poseAtMs, e.poseEndMs) },
      settle: { left: at(e.poseEndMs), width: width(e.poseEndMs, e.endMs) }, cut: scenario === 'encounter' ? null : at(s.cut),
      cursor: `${Math.max(0, Math.min(100, (F.startMs + clock() * 1000 - from) / span * 100)).toFixed(2)}%` };
  };
  const note = SCENARIOS.find(item => item.id === scenario)!.note;
  const named = F.arrivals.filter(arrival => arrival.publicName).length;

  return <section class={`behaviour-bench behaviour-bench--${frameMode}`}>
    <div class="behaviour-stage"><canvas ref={element => { canvas = element; }} aria-label="A simulated street of nine neighbours at dusk" /></div>
    <Show when={frameMode === 'still'}>
      <p class="behaviour-still"><b>SIMULATED</b> {phase()} · {clock().toFixed(2)} s</p>
    </Show>
    <Show when={frameMode === 'page'}>
      <aside class="behaviour-panel">
        <p class="behaviour-eyebrow">CHATDOM · CITIZENS AT EASE</p>
        <div class="behaviour-title"><h1>Neighbours notice one another</h1><span class="behaviour-simulated" title="A labelled simulation: nobody here is a real viewer">SIMULATED</span></div>
        <p class="behaviour-phase" aria-live="polite">{phase()}</p>
        <Show when={marks()}>{m => <div class="behaviour-timeline" aria-hidden="true">
          <span class="look" style={m().look} /><span class="pose" style={m().pose} /><span class="settle" style={m().settle} />
          <Show when={m().cut}>{cut => <i class="cut" style={{ left: cut() }} />}</Show>
          <b style={{ left: m().cursor }} />
        </div>}</Show>
        <p class="behaviour-legend"><span class="look" />look <span class="pose" />{story()?.encounter.gesture ?? 'nod'} <span class="settle" />settle</p>
        <p class="behaviour-note">{note}</p>
        <div class="behaviour-controls" role="group" aria-label="Scenario">
          <For each={SCENARIOS}>{item => <a href={query({ scenario: item.id, t: null })} aria-current={item.id === scenario ? 'true' : undefined}>{item.name}</a>}</For>
        </div>
        <div class="behaviour-controls" role="group" aria-label="View and light">
          <For each={VIEWS}>{item => <a href={query({ view: item.id })} aria-current={item.id === view ? 'true' : undefined}>{item.name}</a>}</For>
          <For each={HOURS}>{item => <a href={query({ hour: String(item.hour) })} aria-current={item.hour === hour ? 'true' : undefined}>{item.name}</a>}</For>
          <button type="button" onClick={() => replay?.()}>{playing() ? 'Replay' : 'Play'}</button>
        </div>
        <p class="behaviour-facts">{F.arrivals.length} simulated neighbours · {named} named · {F.arrivals.length - named} anonymous · {clock().toFixed(1)} s</p>
        <p class="behaviour-foot">A simulated street of a generated hamlet, on the kingdom's real motion and citizen renderer. A greeting is presentation only: it records no friendship, reward or act on anyone's behalf.</p>
      </aside>
    </Show>
    <Show when={status()}>
      <div class="behaviour-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The street could not be shown' : 'SIMULATED street'}</strong><p>{status()}</p></div>
    </Show>
  </section>;
}
