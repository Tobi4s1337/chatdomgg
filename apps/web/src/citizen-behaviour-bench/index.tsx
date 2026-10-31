import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { createCitizenMotion, type CitizenMotionSample } from '@chatdom/world';
import * as THREE from 'three';
import type { CitizenChatCue, Vec3 } from '@chatdom/shared';
import { placeMarketContent } from '../kingdom/settlement-content';
import {
  createNeighbourStreet, createTownStreets, NEIGHBOUR_FIXTURE as F, TOWN_FIXTURE, type NeighbourStreet,
} from '../../../../packages/world/src/citizen-behaviours/fixture';
import type { CitizenChatReaction, CitizenEncounter, CitizenOverlay, CitizenRoutineView } from '../../../../packages/world/src/citizen-behaviours';
import { createBehaviourLoop, type BehaviourFrame, type BehaviourLoopSource } from './loop';
import { createBehaviourStage, type BenchFocus, type BenchView } from './stage';
import { chatSource, closedMarketGate, scoutChat, scoutStreet, type RoutineBeat, type RoutineStory, type ScoutedChat } from './stories';
import './style.css';

type Scenario = 'encounter' | 'takeover' | 'departure' | 'stroll' | 'market' | 'closed' | 'chat' | 'burst' | 'chat-walker' | 'reconnect' | 'town';
type Family = 'greeting' | 'routine' | 'chat' | 'town';
/** A chat moment as the report carries it, in fixture seconds. */
interface ChatReport {
  readonly cueId: string;
  readonly speaker: number;
  readonly listeners: readonly { readonly slot: number; readonly at: number; readonly out: number; readonly end: number }[];
  readonly start: number; readonly nod: number; readonly nodEnd: number; readonly end: number;
  readonly cut: number | null;
  /** Lines said in the moment (a burst has many) and how many of them turned heads. */
  readonly lines: number;
  readonly reactions: number;
  readonly outcomes: readonly { readonly id: string; readonly outcome: string }[];
}
interface Bubble { readonly slot: number; readonly x: number; readonly y: number; readonly name: string | null; readonly parts: CitizenChatCue['parts'] }
interface BehaviourReport {
  readonly t: number;
  readonly hour: number;
  readonly view: BenchView;
  readonly scenario: Scenario;
  readonly lightSettled: boolean;
  /** Seconds from the fixture start, for captures. Greeting scenarios only. */
  readonly encounter: { readonly greeter: number; readonly recipient: number; readonly gesture: 'nod' | 'wave'; readonly start: number; readonly pose: number; readonly poseEnd: number; readonly end: number; readonly glance: number | null } | null;
  readonly cut: number | null;
  /** The followed excursion, in fixture seconds. Routine scenarios only. */
  readonly routine: { readonly slot: number; readonly kind: RoutineStory['kind']; readonly beats: readonly { readonly kind: RoutineBeat['kind']; readonly from: number; readonly to: number; readonly node: string | null; readonly routine: string }[] } | null;
  /** The followed chat line. Chat scenarios only. */
  readonly chat: ChatReport | null;
  /** SIMULATED speech bubbles on screen, by the kingdom consumer's own rules. */
  readonly bubbles: number;
  readonly subject: { readonly slot: number; readonly routine: string; readonly activity: string; readonly nodeId: string | null; readonly lookYaw: number; readonly gesture: string } | null;
  readonly overlays: readonly { readonly slot: number; readonly gesture: CitizenOverlay['gesture']; readonly lookYaw: number }[];
  readonly counts: Readonly<Record<CitizenRoutineView['activity'], number>>;
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
const SCENARIOS: readonly { id: Scenario; family: Family; name: string; title: string; note: string }[] = [
  { id: 'encounter', family: 'greeting', name: 'Passing neighbours', title: 'Neighbours notice one another',
    note: 'Two neighbours meet in front of their doors. The one who notices turns their head first, gives one small greeting, holds the look and settles. The other glances back without breaking stride.' },
  { id: 'takeover', family: 'greeting', name: 'Walker takes over', title: 'Neighbours notice one another',
    note: 'The greeter comes under walker control mid-gesture. Ambient behaviour lets go of them at once and sends them nowhere; the neighbour they were greeting eases their glance back to rest.' },
  { id: 'departure', family: 'greeting', name: 'Neighbour leaves', title: 'Neighbours notice one another',
    note: 'The neighbour being greeted leaves presence mid-gesture. Their glance and every reference to them drop in the same step; the greeter finishes the dip already under way and settles.' },
  { id: 'stroll', family: 'routine', name: 'A stroll', title: 'A gentle rhythm in the street',
    note: 'A neighbour rests at their door, then strolls to a place on the street they have walked before. Each pause starts only when the kingdom\'s motion reports the arrival, holds one look along the lane, and the walk ends at their own door.' },
  { id: 'market', family: 'routine', name: 'The market', title: 'A gentle rhythm in the street',
    note: 'An occasional market visit: the walk across the hamlet, a look over one side of the square and then the other, a few seconds to take it in, and the walk home. Nothing is bought; the market is only watched.' },
  { id: 'closed', family: 'routine', name: 'Market closed', title: 'A gentle rhythm in the street',
    note: 'The square is closed by a simulated reserved action, so the route is refused. The neighbour stays at their door, never teleports or spins between choices, and later takes a stroll instead.' },
  { id: 'chat', family: 'chat', name: 'A line in chat', title: 'A witnessed line turns a few heads',
    note: 'A simulated chat line arrives for someone at their door. Its speaker gives one small nod; the two neighbours who can hear it turn to look, one after the other, hold the look and settle. Nobody moves toward them, and the words stay in the bubble.' },
  { id: 'burst', family: 'chat', name: 'A burst', title: 'A witnessed line turns a few heads',
    note: 'Six simulated lines inside a second, one person three times, plus an expired, a foreign and a missing-body cue. Only a couple of lines turn heads; repeats join the reaction already under way, the rest only show their bubble.' },
  { id: 'chat-walker', family: 'chat', name: 'Walker speaks', title: 'A witnessed line turns a few heads',
    note: 'The speaker comes under simulated walker control mid-nod. Ambient behaviour lets go of them at once and never poses them again; the neighbours who heard them keep their short look.' },
  { id: 'reconnect', family: 'chat', name: 'Reconnect', title: 'A witnessed line turns a few heads',
    note: 'The source reconnects while neighbours are looking. The kingdom resets its policy, as the real consumer does; the same line is still on offer, but it was said before this connection, so nobody turns again.' },
  { id: 'town', family: 'town', name: 'A town of 240', title: 'A town at ease',
    note: 'Every home of a five-quarter town occupied by a simulated neighbour, on the kingdom\'s real motion and citizen renderer. Rests, strolls and market visits are seeded per person, so nobody moves in step.' },
];
const VIEWS: Record<Family, readonly { id: BenchView; name: string }[]> = {
  greeting: [{ id: 'doorstep', name: 'Doorstep' }, { id: 'close', name: 'Close' }, { id: 'street', name: 'Street' }],
  routine: [{ id: 'follow', name: 'Follow' }, { id: 'market', name: 'Market' }, { id: 'street', name: 'Street' }],
  chat: [{ id: 'doorstep', name: 'Doorstep' }, { id: 'close', name: 'Close' }, { id: 'street', name: 'Street' }],
  town: [{ id: 'aerial', name: 'Above' }, { id: 'follow', name: 'In a lane' }],
};
const STEP_MS = 100;
/** Which line each chat scenario follows. */
const CHAT_CUE: Partial<Record<Scenario, string>> = { chat: 'simulated-line', burst: 'simulated-burst-0', 'chat-walker': 'simulated-walker', reconnect: 'simulated-reconnect' };
const TOWN_CLIP: readonly [number, number] = [125_000, 205_000];

const flat = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
const ahead = (sample: CitizenMotionSample, metres: number, yaw = 0): Vec3 =>
  [sample.position[0] + Math.sin(sample.heading + yaw) * metres, sample.position[1], sample.position[2] + Math.cos(sample.heading + yaw) * metres];

export default function CitizenBehaviourBench() {
  let canvas!: HTMLCanvasElement;
  const params = new URLSearchParams(window.location.search);
  const frameMode = params.get('frame') === 'still' ? 'still' : 'page';
  const hour = Number(params.get('hour') ?? 19) === 12 ? 12 : 19;
  const scenario: Scenario = SCENARIOS.find(item => item.id === params.get('scenario'))?.id ?? 'encounter';
  const meta = SCENARIOS.find(item => item.id === scenario)!, family = meta.family;
  const views = VIEWS[family].filter(item => item.id !== 'market' || scenario === 'market' || scenario === 'closed');
  const view: BenchView = views.find(item => item.id === params.get('view'))?.id ?? views[0]!.id;
  const fixed = params.has('t') ? Number(params.get('t')) : null;
  const pace = Number(params.get('pace') ?? 1) === 4 ? 4 : 1;
  const fixture = family === 'town' ? TOWN_FIXTURE : F;
  const [status, setStatus] = createSignal(family === 'town' ? 'Waking the town…' : 'Waking the street…');
  const [failed, setFailed] = createSignal(false);
  const [clock, setClock] = createSignal(0);
  const [encounter, setEncounter] = createSignal<{ encounter: CitizenEncounter; cut: number } | null>(null);
  const [story, setStory] = createSignal<RoutineStory | null>(null);
  /** The followed line, every reaction of its moment (a burst has more) and the valid lines said in it. */
  const [said, setSaid] = createSignal<{ reaction: CitizenChatReaction; scouted: ScoutedChat; cut: number | null; burst: readonly CitizenChatReaction[]; lines: number } | null>(null);
  const [bubbles, setBubbles] = createSignal<readonly Bubble[]>([]);
  const [scene, setScene] = createSignal<{ views: readonly CitizenRoutineView[]; overlays: ReadonlyMap<number, CitizenOverlay> }>({ views: [], overlays: new Map() });
  const [playing, setPlaying] = createSignal(fixed === null);
  let disposed = false, teardown: (() => void) | undefined, replay: (() => void) | undefined;

  /** Kingdom milliseconds → seconds on the fixture clock. */
  const seconds = (ms: number): number => (ms - fixture.startMs) / 1000;

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomBehaviour; delete window.__chatdomBehaviourError;
    void (async () => {
      if (fixed !== null && !Number.isFinite(fixed)) throw new Error('The time must be a number of seconds.');
      const street: NeighbourStreet = family === 'town' ? createTownStreets() : createNeighbourStreet();
      const everyone = new Set(street.slots), source = { kingdomId: fixture.kingdomId, epoch: fixture.epoch, origin: fixture.origin };
      await new Promise(resolve => setTimeout(resolve, 0));

      // The moments to show, read from the same motion and policy the stage plays.
      let first: CitizenEncounter | null = null, routine: RoutineStory | null = null, line: CitizenChatReaction | null = null;
      if (family === 'chat') {
        setStatus('Listening to the simulated street');
        const scouted = scoutChat(street, source, F.startMs, F.startMs + 240_000);
        line = scouted.reactions.find(item => item.cueId === CHAT_CUE[scenario]) ?? null;
        if (!line) throw new Error('That line turned no heads in the simulated story.');
        const cut = scenario === 'chat-walker' ? line.startMs + 700 : scenario === 'reconnect' ? Math.ceil((line.startMs + 1_200) / STEP_MS) * STEP_MS : null;
        const inMoment = (id: string): boolean => scenario === 'burst' ? id.startsWith('simulated-burst') : id === line!.cueId;
        const lines = new Set(scouted.notes.filter(note => inMoment(note.id) && !['expired', 'foreign', 'absent'].includes(note.outcome)).map(note => note.id)).size;
        setSaid({ reaction: line, scouted, cut, burst: scenario === 'burst' ? scouted.reactions.filter(item => inMoment(item.cueId)) : [line], lines });
      } else if (family !== 'town') {
        setStatus('Following the simulated street');
        const scouted = scoutStreet(street, source, F.startMs, F.startMs + 400_000);
        first = family === 'greeting' ? scouted.encounter : null;
        routine = scenario === 'stroll' ? scouted.stroll : scenario === 'market' ? scouted.market : scenario === 'closed' ? scouted.closed : null;
        if (family === 'greeting' && !first) throw new Error('No neighbours met in the simulated story.');
        if (family === 'routine' && !routine) throw new Error('No such outing happened in the simulated story.');
        setStory(routine);
      }
      const cut = first ? first.poseAtMs + 300 : Infinity;
      if (first) setEncounter({ encounter: first, cut });

      // The shown story: identical, plus the chosen labelled interruption.
      const departures = new Map(scenario === 'departure' && first ? [[first.recipient, cut]] : []);
      const motion = createCitizenMotion(street.plan), chat = family === 'chat' ? chatSource(street, source) : null;
      const frameFor = (atMs: number) => street.frameAt(atMs, chat ? chat.script.departures : departures);
      const loopSource: BehaviourLoopSource = chat ? chat.source : { ...source, frameAt: atMs => street.frameAt(atMs, departures),
        ambientAt: atMs => scenario === 'takeover' && first && atMs >= cut ? new Set(street.slots.filter(slot => slot !== first.greeter)) : everyone,
        ...(scenario === 'closed' ? { gate: closedMarketGate(street.plan.market.nodeId) } : {}) };
      const loop = createBehaviourLoop(motion, loopSource);
      const stage = await createBehaviourStage(canvas, street.plan, street.slots, { hour, onProgress: setStatus });
      if (disposed) { stage.dispose(); return; }

      const lineEnd = line ? Math.max(...(said()?.burst ?? [line]).map(item => item.endMs)) : 0;
      const clipStart = first ? first.startMs - 5_000 : line ? line.startMs - 4_000 : routine ? routine.startMs : fixture.startMs + TOWN_CLIP[0];
      const clipEnd = first ? first.endMs + 4_000 : line ? lineEnd + 4_000 : routine ? routine.endMs : fixture.startMs + TOWN_CLIP[1];
      let now = fixed === null ? clipStart : fixture.startMs + fixed * 1000, raf = 0, last = performance.now(), cursor: number | null = null;
      let latest: { views: readonly CitizenRoutineView[] } = { views: [] }, beatKey = '';

      /** Fixed steps from wherever the story is to `target`; backwards replays from the start. Yields while long. */
      const advanceTo = async (target: number, label: string): Promise<void> => {
        if (cursor === null || target < cursor) { loop.reset(); cursor = fixture.startMs - STEP_MS; }
        let count = 0;
        for (let t = cursor + STEP_MS; t < target; t += STEP_MS) {
          const steps = loop.advance(t); if (steps.length) latest = { views: steps.at(-1)!.routines };
          cursor = t;
          if (++count % 400 === 0) { setStatus(`${label} · ${Math.round(seconds(t))} s`); await new Promise(resolve => setTimeout(resolve, 0)); if (disposed) return; }
        }
        const steps = loop.advance(target); if (steps.length) latest = { views: steps.at(-1)!.routines };
        cursor = Math.max(cursor, target);
      };

      /** Where the camera looks, from actual samples and overlays at a time. */
      const frontages = new Set(street.plan.nodes.filter(node => node.kind === 'frontage').map(node => node.id));
      const focusAt = (current: BehaviourFrame): BenchFocus | null => {
        const find = (slot: number): CitizenMotionSample | undefined => current.samples.find(sample => sample.slot === slot);
        if (first) {
          const atPose = scoutPose ?? current.samples;
          const greeter = atPose.find(sample => sample.slot === first.greeter)!, recipient = atPose.find(sample => sample.slot === first.recipient)!;
          return { slot: first.greeter, subject: greeter.position, subjectHeading: greeter.heading, subjectSpeed: greeter.speed,
            other: recipient.position, otherHeading: recipient.heading, otherSpeed: recipient.speed };
        }
        if (line) {
          // The speaker, and the neighbours who turn to them: held once, around the nod.
          const atPose = scoutPose ?? current.samples, speaker = atPose.find(sample => sample.slot === line.speaker)!;
          // A burst holds every reaction of its moment that stands within bubble range of the first speaker.
          const people = new Set((said()?.burst ?? [line]).flatMap(item => [item.speaker, ...item.listeners.map(listener => listener.slot)]));
          people.delete(line.speaker);
          const listeners = [...people].map(slot => atPose.find(sample => sample.slot === slot)).filter((sample): sample is CitizenMotionSample => Boolean(sample))
            .filter(sample => flat(sample.position, speaker.position) <= 14)
            .sort((a, b) => flat(b.position, speaker.position) - flat(a.position, speaker.position));
          const far = listeners[0];
          // Two listeners stand either side of the speaker: hold all three, looking across the line between them.
          return { slot: line.speaker, subject: speaker.position, subjectHeading: speaker.heading, subjectSpeed: speaker.speed,
            other: far?.position ?? ahead(speaker, 3), otherHeading: far?.heading ?? speaker.heading + Math.PI, otherSpeed: 0,
            ...(listeners.length > 1 ? { spread: flat(far!.position, speaker.position) } : {}) };
        }
        let subject = routine ? find(routine.slot) : undefined;
        if (!routine) {
          // The town: the person paused out in a lane with the most neighbours near them.
          let best = -1;
          for (const sample of current.samples) {
            if (sample.speed > 0 || sample.opacity < 1 || !sample.goalNodeId || frontages.has(sample.goalNodeId)) continue;
            const near = current.samples.filter(other => other !== sample && flat(other.position, sample.position) < 14).length;
            if (near > best) { best = near; subject = sample; }
          }
        }
        if (!subject) return null;
        const overlay = current.overlays.get(subject.slot);
        let other = subject.speed > 0 ? ahead(subject, 4) : ahead(subject, 3, overlay?.lookYaw ?? 0);
        if (view === 'market') {
          // What a visitor watches: the square's stalls and well, wherever on the square they stand.
          const dressing = placeMarketContent(street.plan.market);
          other = [dressing.reduce((s, p) => s + p.position[0], 0) / dressing.length, subject.position[1], dressing.reduce((s, p) => s + p.position[2], 0) / dressing.length];
        } else if (!routine) {
          const neighbour = current.samples.filter(item => item !== subject).sort((a, b) => flat(a.position, subject!.position) - flat(b.position, subject!.position))[0];
          if (neighbour) other = neighbour.position;
        }
        return { slot: subject.slot, subject: subject.position, subjectHeading: subject.heading, subjectSpeed: subject.speed,
          other, otherHeading: subject.heading + Math.PI, otherSpeed: 0 };
      };
      // A greeting is framed once, around the pose; routines are re-framed at each change of beat.
      let scoutPose: readonly CitizenMotionSample[] | null = null;
      if (first) { await advanceTo(first.poseAtMs, 'Following the street'); scoutPose = loop.present(first.poseAtMs).samples; }
      if (line) { await advanceTo(line.nodAtMs, 'Listening to the street'); scoutPose = loop.present(line.nodAtMs).samples; }
      const beatAt = (atMs: number): RoutineBeat | undefined => routine?.beats.find(beat => atMs >= beat.fromMs && atMs < beat.toMs);
      const frame = (current: BehaviourFrame, force: boolean): void => {
        if ((first || line) && !force) return;
        const beat = beatAt(now), key = routine ? `${beat?.kind}:${beat?.fromMs}` : family === 'town' ? 'town' : 'greeting';
        if (!force && key === beatKey) return;
        beatKey = key; stage.setView(view, focusAt(current));
      };

      /** The kingdom consumer's bubble rules: said and unexpired, within 28 m of the eye, on screen, three at most. */
      const speak = (current: BehaviourFrame): void => {
        if (!chat) return;
        const held = chat.script.heldAt(now, current.samples), point = new THREE.Vector3(), list: Bubble[] = [];
        for (const sample of current.samples) {
          const cue = held.filter(item => item.slot === sample.slot).at(-1);
          if (!cue || sample.state === 'leaving') continue;
          point.set(sample.position[0], sample.position[1] + 1.9, sample.position[2]);
          if (point.distanceTo(stage.camera.position) > 28) continue;
          point.project(stage.camera);
          if (point.z < 0 || point.z > 1 || Math.abs(point.x) > .85 || Math.abs(point.y) > .8) continue;
          list.push({ slot: sample.slot, x: (point.x + 1) * canvas.clientWidth / 2, y: (1 - point.y) * canvas.clientHeight / 2, name: sample.publicName, parts: cue.parts });
          if (list.length >= 3) break;
        }
        setBubbles(list);
      };
      const report = (lightSettled: boolean, current: BehaviourFrame): void => {
        const counts = { walking: 0, pausing: 0, resting: 0, waiting: 0, held: 0 };
        for (const item of latest.views) counts[item.activity]++;
        const followed = routine?.slot ?? (first ? first.greeter : line ? line.speaker : null);
        const subjectView = followed === null ? undefined : latest.views.find(item => item.slot === followed);
        const overlay = followed === null ? undefined : current.overlays.get(followed);
        setScene({ views: latest.views, overlays: current.overlays });
        window.__chatdomBehaviour = { t: seconds(now), hour, view, scenario, lightSettled, people: current.samples.length, counts,
          cut: first ? seconds(cut) : null,
          encounter: first ? { greeter: first.greeter, recipient: first.recipient, gesture: first.gesture, start: seconds(first.startMs), pose: seconds(first.poseAtMs),
            poseEnd: seconds(first.poseEndMs), end: seconds(first.endMs), glance: first.glanceAtMs === null ? null : seconds(first.glanceAtMs) } : null,
          bubbles: bubbles().length,
          chat: line ? (() => {
            const moment = said()!, burst = moment.burst, ids = scenario === 'burst' ? (id: string) => id.startsWith('simulated-burst') : (id: string) => id === line.cueId;
            const outcomes = moment.scouted.notes.filter(note => ids(note.id)).map(note => ({ id: note.id, outcome: note.outcome }));
            return { cueId: line.cueId, speaker: line.speaker, start: seconds(line.startMs), nod: seconds(line.nodAtMs), nodEnd: seconds(line.nodEndMs), end: seconds(line.endMs),
              listeners: line.listeners.map(item => ({ slot: item.slot, at: seconds(item.atMs), out: seconds(item.outAtMs), end: seconds(item.endMs) })),
              cut: moment.cut === null ? null : seconds(moment.cut), lines: moment.lines,
              reactions: burst.length, outcomes };
          })() : null,
          routine: routine ? { slot: routine.slot, kind: routine.kind, beats: routine.beats.map(beat => ({ kind: beat.kind, from: seconds(beat.fromMs), to: seconds(beat.toMs), node: beat.nodeId, routine: beat.routine })) } : null,
          subject: subjectView ? { slot: subjectView.slot, routine: subjectView.routine, activity: subjectView.activity, nodeId: subjectView.nodeId,
            lookYaw: overlay?.lookYaw ?? 0, gesture: overlay?.gesture ?? 'none' } : null,
          overlays: [...current.overlays].map(([slot, overlay]) => ({ slot, gesture: overlay.gesture, lookYaw: overlay.lookYaw })) };
      };
      /** A fixed evidence frame: the story stepped to `target`, drawn, window light settled. */
      const still = async (target: number): Promise<void> => {
        window.__chatdomReady = false;
        now = target; setClock(seconds(now));
        await advanceTo(now, family === 'town' ? 'Walking the town' : 'Following the street');
        if (disposed) return;
        setStatus('');
        const current = loop.present(now);
        frame(current, true);
        for (let i = 0; i < 600; i++) {
          stage.draw(now, seconds(now), frameFor(now), current, true);
          if (i > 1 && stage.lightSettled) break;
          await new Promise(resolve => setTimeout(resolve, 50));
          if (disposed) return;
        }
        stage.draw(now, seconds(now), frameFor(now), current, true); stage.finish(); speak(current);
        report(stage.lightSettled, current);
        window.__chatdomReady = true;
      };
      const tick = (time: number): void => {
        if (disposed) return;
        try {
          // A slow frame slows the story rather than jumping it: the policy would treat a jump as a reset.
          const dt = Math.min(.1, (time - last) / 1000) * pace; last = time;
          if (playing()) {
            now += dt * 1000;
            if (now > clipEnd) { setPlaying(false); void advanceTo(clipStart, 'Back to the start').then(() => { now = clipStart; last = performance.now(); setStatus(''); setPlaying(true); }); }
            else {
              const steps = loop.advance(now); cursor = Math.max(cursor ?? now, now);
              if (steps.length) latest = { views: steps.at(-1)!.routines };
              const current = loop.present(now);
              frame(current, false);
              stage.draw(now, seconds(now), frameFor(now), current, false); speak(current);
              setClock(seconds(now)); report(false, current);
            }
          }
          raf = requestAnimationFrame(tick);
        } catch (error) { fail(error); }
      };
      window.__chatdomBehaviourSeek = async target => { setPlaying(false); await still(fixture.startMs + target * 1000); };
      teardown = () => { cancelAnimationFrame(raf); delete window.__chatdomBehaviourSeek; stage.dispose(); };
      if (fixed !== null) await still(now);
      else {
        await advanceTo(now, family === 'town' ? 'Walking the town' : 'Following the street');
        if (disposed) return;
        setStatus('');
        const current = loop.present(now);
        frame(current, true);
        stage.draw(now, seconds(now), frameFor(now), current, true); stage.finish(); speak(current);
        report(false, current);
        window.__chatdomReady = true;
      }
      replay = () => { setPlaying(false); void advanceTo(clipStart, 'Back to the start').then(() => { now = clipStart; last = performance.now(); setStatus(''); setPlaying(true); }); };
      raf = requestAnimationFrame(tick);
    })().catch(fail);
  });
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
  const kingdomNow = (): number => fixture.startMs + clock() * 1000;
  const subjectState = () => {
    const s = story(); if (!s) return null;
    const overlay = scene().overlays.get(s.slot);
    return { looking: Math.abs(overlay?.lookYaw ?? 0) > .12, beat: s.beats.find(beat => kingdomNow() >= beat.fromMs && kingdomNow() < beat.toMs) };
  };
  const phase = (): string => {
    if (family === 'town') {
      const counts = { walking: 0, pausing: 0, resting: 0 };
      for (const item of scene().views) if (item.activity in counts) counts[item.activity as keyof typeof counts]++;
      return `${counts.resting} at their doors · ${counts.walking} walking · ${counts.pausing} pausing`;
    }
    const moment = said();
    if (moment) {
      const e = moment.reaction, t = kingdomNow(), listening = e.listeners.filter(item => t >= item.atMs && t < item.endMs).length;
      if (scenario === 'reconnect' && moment.cut !== null && t >= moment.cut) return 'Reconnected · the line is not replayed';
      if (scenario === 'chat-walker' && moment.cut !== null && t >= moment.cut) return listening ? 'Walker control · neighbours still look' : 'Walker control · the routine lets go';
      if (scenario === 'burst' && t >= e.startMs && t < Math.max(...moment.burst.map(item => item.endMs))) {
        return `A burst · ${moment.burst.length} of ${moment.lines} lines turn heads`;
      }
      if (t < e.startMs) return 'At ease';
      if (t < e.nodAtMs) return 'A line in chat · the speaker lifts';
      if (t < e.nodEndMs) return listening ? `A small nod · ${listening === 1 ? 'a neighbour turns' : 'two neighbours turn'}` : 'A small nod';
      if (t < e.endMs) return listening ? `${listening === 1 ? 'A neighbour looks' : 'Two neighbours look'} · then settle` : 'Settling';
      return 'At ease';
    }
    const routine = subjectState();
    if (routine) {
      const { looking, beat } = routine, homeNode = story()?.beats.find(item => item.kind === 'rest')?.nodeId;
      if (!beat) return 'At ease';
      if (beat.kind === 'rest') return looking ? 'At the door · a glance down the lane' : 'Resting at the door';
      if (beat.kind === 'wait') return 'Market closed · resting where they stand';
      if (beat.kind === 'walk') return beat.nodeId === homeNode ? 'Walking home' : beat.routine === 'market' ? 'Walking to the market' : 'Strolling along the street';
      return beat.routine === 'market' ? (looking ? 'At the market · watching the stalls' : 'At the market · taking it in') : (looking ? 'A pause · looking along the lane' : 'A pause in the lane');
    }
    const s = encounter(); if (!s) return '';
    const e = s.encounter, t = kingdomNow();
    if (scenario === 'takeover' && t >= s.cut) return 'Walker control · the routine lets go';
    if (scenario === 'departure' && t >= s.cut) return t < e.poseEndMs ? 'Neighbour left · the dip finishes' : 'Neighbour left · settling';
    if (t < e.startMs) return 'Walking home';
    if (t < e.poseAtMs) return 'Noticing · the head turns first';
    if (t < e.poseEndMs) return e.gesture === 'nod' ? 'A small nod' : 'A brief wave';
    if (t < e.endMs) return 'Holding the look · settling';
    return 'At ease';
  };
  const greetingMarks = () => {
    const s = encounter(); if (!s) return null;
    const e = s.encounter, from = e.startMs - 1_500, span = e.endMs + 1_500 - from, at = (ms: number): string => `${((ms - from) / span * 100).toFixed(2)}%`;
    const width = (a: number, b: number): string => `${((b - a) / span * 100).toFixed(2)}%`;
    return { look: { left: at(e.startMs), width: width(e.startMs, e.poseAtMs) }, pose: { left: at(e.poseAtMs), width: width(e.poseAtMs, e.poseEndMs) },
      settle: { left: at(e.poseEndMs), width: width(e.poseEndMs, e.endMs) }, cut: scenario === 'encounter' ? null : at(s.cut),
      cursor: `${Math.max(0, Math.min(100, (kingdomNow() - from) / span * 100)).toFixed(2)}%` };
  };
  const chatMarks = () => {
    const moment = said(); if (!moment) return null;
    const e = moment.reaction, from = e.startMs - 1_500, span = e.endMs + 1_500 - from, at = (ms: number): string => `${((ms - from) / span * 100).toFixed(2)}%`;
    const width = (a: number, b: number): string => `${((b - a) / span * 100).toFixed(2)}%`;
    return { lead: { left: at(e.startMs), width: width(e.startMs, e.nodAtMs) }, nod: { left: at(e.nodAtMs), width: width(e.nodAtMs, e.nodEndMs) },
      listeners: e.listeners.map(item => ({ left: at(item.atMs), width: width(item.atMs, item.endMs) })),
      cut: moment.cut === null ? null : at(moment.cut), cursor: `${Math.max(0, Math.min(100, (kingdomNow() - from) / span * 100)).toFixed(2)}%` };
  };
  const routineMarks = () => {
    const s = story(); if (!s) return null;
    const span = s.endMs - s.startMs, at = (ms: number): number => Math.max(0, Math.min(100, (ms - s.startMs) / span * 100));
    return { beats: s.beats.map(beat => ({ kind: beat.kind, left: `${at(beat.fromMs).toFixed(2)}%`, width: `${(at(beat.toMs) - at(beat.fromMs)).toFixed(2)}%` })),
      cursor: `${at(kingdomNow()).toFixed(2)}%` };
  };
  const named = family === 'town' ? null : F.arrivals.filter(arrival => arrival.publicName).length;
  const people = family === 'town' ? 240 : F.arrivals.length;
  const facts = (): string => {
    const moment = said();
    if (moment) {
      const turned = new Set(moment.burst.flatMap(item => [item.speaker, ...item.listeners.map(listener => listener.slot)])).size;
      return `${people} simulated neighbours · ${moment.lines} line${moment.lines === 1 ? '' : 's'} · ${moment.burst.length} turn${moment.burst.length === 1 ? 's' : ''} heads · ${turned} people move · ${clock().toFixed(1)} s`;
    }
    const views = scene().views, walking = views.filter(item => item.activity === 'walking').length;
    const out = views.filter(item => item.activity === 'pausing').length;
    return named === null
      ? `${people} simulated neighbours · ${walking} walking · ${out} pausing · ${clock().toFixed(1)} s`
      : `${people} simulated neighbours · ${named} named · ${people - named} anonymous · ${walking} walking · ${out} pausing · ${clock().toFixed(1)} s`;
  };

  return <section class={`behaviour-bench behaviour-bench--${frameMode}`}>
    <div class="behaviour-stage"><canvas ref={element => { canvas = element; }} aria-label={family === 'town' ? 'A simulated town of 240 neighbours' : 'A simulated street of nine neighbours'} />
      <div class="behaviour-speech" aria-live="polite"><For each={bubbles()}>{bubble => <div class="behaviour-bubble" style={{ left: `${bubble.x}px`, top: `${bubble.y}px` }}>
        <small>SIMULATED{bubble.name ? ` · ${bubble.name.replace(/^SIMULATED /, '')}` : ''}</small>
        <p><For each={bubble.parts}>{part => part.kind === 'text' ? part.text : <span class="behaviour-emote">{part.alt}</span>}</For></p>
      </div>}</For></div>
    </div>
    <Show when={frameMode === 'still'}>
      <p class="behaviour-still"><b>SIMULATED</b> {phase()} · {clock().toFixed(2)} s</p>
    </Show>
    <Show when={frameMode === 'page'}>
      <aside class="behaviour-panel">
        <p class="behaviour-eyebrow">CHATDOM · CITIZENS AT EASE</p>
        <div class="behaviour-title"><h1>{meta.title}</h1><span class="behaviour-simulated" title="A labelled simulation: nobody here is a real viewer">SIMULATED</span></div>
        <p class="behaviour-phase" aria-live="polite">{phase()}</p>
        <Show when={greetingMarks()}>{m => <>
          <div class="behaviour-timeline" aria-hidden="true">
            <span class="look" style={m().look} /><span class="pose" style={m().pose} /><span class="settle" style={m().settle} />
            <Show when={m().cut}>{cut => <i class="cut" style={{ left: cut() }} />}</Show>
            <b style={{ left: m().cursor }} />
          </div>
          <p class="behaviour-legend"><span class="look" />look <span class="pose" />{encounter()?.encounter.gesture ?? 'nod'} <span class="settle" />settle</p>
        </>}</Show>
        <Show when={chatMarks()}>{m => <>
          <div class="behaviour-timeline behaviour-timeline--chat" aria-hidden="true">
            <span class="look" style={m().lead} /><span class="pose" style={m().nod} />
            <For each={m().listeners}>{(item, i) => <span class={`listen listen-${i()}`} style={item} />}</For>
            <Show when={m().cut}>{cut => <i class="cut" style={{ left: cut() }} />}</Show>
            <b style={{ left: m().cursor }} />
          </div>
          <p class="behaviour-legend"><span class="look" />lift <span class="pose" />nod <span class="listen" />neighbours look</p>
        </>}</Show>
        <Show when={routineMarks()}>{m => <>
          <div class="behaviour-timeline" aria-hidden="true">
            <For each={m().beats}>{beat => <span class={beat.kind} style={{ left: beat.left, width: beat.width }} />}</For>
            <b style={{ left: m().cursor }} />
          </div>
          <p class="behaviour-legend"><span class="rest" />at the door <span class="walk" />walking <span class="pause" />pause<Show when={scenario === 'closed'}> <span class="wait" />refused</Show></p>
        </>}</Show>
        <p class="behaviour-note">{meta.note}</p>
        <div class="behaviour-controls" role="group" aria-label="Scenario">
          <For each={SCENARIOS}>{item => <a href={query({ scenario: item.id, t: null, view: null })} aria-current={item.id === scenario ? 'true' : undefined}>{item.name}</a>}</For>
        </div>
        <div class="behaviour-controls" role="group" aria-label="View, light and pace">
          <For each={views}>{item => <a href={query({ view: item.id })} aria-current={item.id === view ? 'true' : undefined}>{item.name}</a>}</For>
          <For each={HOURS}>{item => <a href={query({ hour: String(item.hour) })} aria-current={item.hour === hour ? 'true' : undefined}>{item.name}</a>}</For>
          <Show when={family !== 'greeting'}><a href={query({ pace: pace === 4 ? null : '4' })} aria-current={pace === 4 ? 'true' : undefined}>×4</a></Show>
          <button type="button" onClick={() => replay?.()}>{playing() ? 'Replay' : 'Play'}</button>
        </div>
        <p class="behaviour-facts">{facts()}</p>
        <p class="behaviour-foot">A simulated {family === 'town' ? 'town' : 'street of a generated hamlet'}, on the kingdom's real motion and citizen renderer. Routines and greetings are presentation only: they record no friendship, purchase, reward or act on anyone's behalf.</p>
      </aside>
    </Show>
    <Show when={status()}>
      <div class="behaviour-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The street could not be shown' : family === 'town' ? 'SIMULATED town' : 'SIMULATED street'}</strong><p>{status()}</p></div>
    </Show>
  </section>;
}
