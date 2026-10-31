import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { Vec3 } from '@chatdom/shared';
import type { RealmInteractionAction, RealmSeat } from '@chatdom/shared/realm';
import type { CitizenSample } from '../../citizens';
import { createDefaultCitizenLooks } from '../../citizens';
import { STREET_ZONE } from '../../../../../packages/world/src/interactions';
import { bindUseKey, createInteractionSession, mountInteractionPrompt, promptView, selectInteraction, type InteractionSelection, type PromptView } from '..';
import { ANVIL, SEAT, SPOT } from './court';
import { createBenchRoom, type BenchPerson } from './room';
import { createBenchStage } from './stage';
import './bench.css';

/**
 * SIMULATED interaction bench: `/src/interactions/bench/index.html`.
 * ?look=north|south|east|west|anvil  initial gaze · ?latency=260 simulated round trip (ms)
 * ?rival=<seat>  Wren already sits there · ?race=<seat>  Wren's claim for that seat reaches the room first
 * ?motion=reduce  reduced motion
 */
interface BenchDebug {
  ready: boolean;
  focus: string | null; action: RealmInteractionAction | null;
  prompt: Pick<PromptView, 'tone' | 'words' | 'actionable'> | null;
  seats: readonly RealmSeat[]; self: { mode: string; targetId: string | null };
  /** Key press → pending prompt in the DOM, and → the next painted frame, in ms. Local only, not the room. */
  localResponse: { dom: number; paint: number } | null;
  face(id: string): void;
}
declare global { interface Window { __chatdomReady?: boolean; __chatdomInteractions?: BenchDebug } }

const TARGETS: Readonly<Record<string, string>> = { ...SEAT, anvil: ANVIL };
const params = new URLSearchParams(window.location.search);
const latency = Math.max(0, Math.min(4000, Number(params.get('latency') ?? 260) || 0));
const reducedMotion = params.get('motion') === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Bench() {
  let host!: HTMLDivElement;
  const [note, setNote] = createSignal('Lighting the fire…');
  onMount(() => {
    window.__chatdomReady = false;
    let disposed = false, raf = 0;
    const room = createBenchRoom({ latencyMs: latency, you: SPOT.you, wren: SPOT.wren });
    const session = createInteractionSession({ realm: { send: intent => { race(intent.targetId, intent.action); room.you.send(intent.targetId, intent.action, intent.id, latency / 2); } }, clock: () => performance.now() });
    session.connect(room.writerEpoch);
    room.listen(message => session.receive(message));
    const records = room.registry.records;
    const target = (id: string) => records.find(r => r.target.id === id)!;
    const headingTo = (from: Vec3, to: Vec3) => Math.atan2(to[0] - from[0], to[2] - from[2]);
    let yaw = headingTo(SPOT.you, target(TARGETS[params.get('look') ?? 'north'] ?? SEAT.north).target.position);
    let selection: InteractionSelection = { focus: null, quiet: null };
    let pressedAt: number | null = null;
    const debug: BenchDebug = {
      ready: false, focus: null, action: null, prompt: null, seats: [], self: { mode: 'standing', targetId: null }, localResponse: null,
      face: id => { yaw = headingTo([room.you.body.x, 0, room.you.body.z], target(id).target.position); },
    };
    window.__chatdomInteractions = debug;

    // Wren is a SIMULATED neighbour: seated already, or reaching for the same log a moment before you.
    const rival = params.get('rival'), racing = params.get('race');
    const wrenTo = (seat: string) => { const approach = target(seat).target.approach; room.move(room.wren, [approach[0] + (approach[0] > 0 ? -.05 : .05), 0, approach[2]]); };
    if (rival && TARGETS[rival]) { wrenTo(TARGETS[rival]!); room.wren.send(TARGETS[rival]!, 'sit', 'wren-boot', 0); }
    else if (racing && TARGETS[racing]) {
      const seat = target(TARGETS[racing]!).target;
      room.move(room.wren, [seat.position[0] - .75, 0, seat.approach[2] + .2]);
    }
    let raced = false;
    function race(targetId: string, action: RealmInteractionAction) {
      if (raced || !racing || TARGETS[racing] !== targetId || action !== 'sit') return;
      raced = true;
      room.wren.send(targetId, 'sit', 'wren-race', Math.max(0, latency / 2 - 60));
    }

    const use = () => {
      const focus = selection.focus;
      if (!focus) return;
      pressedAt = performance.now();
      if (session.request(focus.record.target.id, focus.action)) refresh();
    };
    // The seated framing looks where the seat faces, at the fire. In the kingdom this is walk-camera's release/
    // resume token and the campfire's own framing; a late reply after Escape never fires this.
    const stopAccepted = session.onAccepted(accepted => {
      const record = accepted.state.mode === 'seated' ? target(accepted.targetId) : null;
      if (record?.facing !== null && record?.facing !== undefined) yaw = record.facing;
    });
    const prompt = mountInteractionPrompt(host, { onUse: use });
    const stopKey = bindUseKey(use);
    const keys = new Set<string>();
    const keydown = (event: KeyboardEvent) => { if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(event.code)) { keys.add(event.code); event.preventDefault(); } };
    const keyup = (event: KeyboardEvent) => keys.delete(event.code);
    const blur = () => { keys.clear(); session.abandon(); };
    let drag: number | null = null;
    const down = (event: PointerEvent) => { drag = event.clientX; };
    const move = (event: PointerEvent) => { if (drag === null) return; yaw -= (event.clientX - drag) * .006; drag = event.clientX; };
    const up = () => { drag = null; };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    window.addEventListener('pointerup', up);
    const resize = () => stage?.resize();
    window.addEventListener('resize', resize);

    let stage: Awaited<ReturnType<typeof createBenchStage>> | undefined;
    const looks = createDefaultCitizenLooks();
    const people = (now: number): CitizenSample[] => room.people.map((person: BenchPerson, index) => {
      const seat = room.authority.seats().seats.find(s => s.walkerId === person.walkerId);
      const record = seat ? target(seat.targetId) : null;
      const heading = record?.facing ?? (person === room.you ? yaw : headingTo([person.body.x, 0, person.body.z], [0, 0, 0]));
      return { id: person.walkerId, look: looks[(index * 3 + 1) % looks.length]!.id, position: [person.body.x, person.body.y, person.body.z], heading, distance: person.body.distance, moving: 0, time: now / 1000 };
    });

    let last = performance.now();
    function refresh() {
      if (!stage) return;
      const snapshot = session.snapshot();
      const feet: Vec3 = [room.you.body.x, room.you.body.y, room.you.body.z];
      selection = selectInteraction({
        frame: { feet, forward: stage.forward() }, records, world: room.world, seats: snapshot.seats,
        actor: { walkerId: room.you.walkerId, zone: STREET_ZONE, state: snapshot.self, ownedPlotId: null },
        previous: selection.focus?.record.target.id ?? null,
      });
      const view = promptView(selection, snapshot, records);
      prompt.update(view, view ? stage.project(view.anchor) : null);
      debug.focus = selection.focus?.record.target.id ?? null; debug.action = selection.focus?.action ?? null;
      debug.prompt = view ? { tone: view.tone, words: view.words, actionable: view.actionable } : null;
      debug.seats = snapshot.seats; debug.self = { mode: snapshot.self.mode, targetId: snapshot.self.targetId };
      if (pressedAt !== null && view?.tone === 'pending') {
        const started = pressedAt, dom = performance.now() - started;
        pressedAt = null;
        requestAnimationFrame(() => { debug.localResponse = { dom, paint: performance.now() - started }; });
      }
    }
    const draw = (now: number) => {
      if (disposed || !stage) return;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      session.tick(now);
      const turn = Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'));
      yaw += turn * dt * 1.9;
      const ahead = Number(keys.has('KeyW')) - Number(keys.has('KeyS')), side = Number(keys.has('KeyA')) - Number(keys.has('KeyD'));
      if (ahead || side) {
        const speed = 2.4 * dt / Math.hypot(ahead, side), fx = Math.sin(yaw), fz = Math.cos(yaw);
        const body = room.you.body;
        room.move(room.you, [body.x + (fx * ahead + fz * side) * speed, 0, body.z + (fz * ahead - fx * side) * speed]);
      }
      stage.frame({ now, feet: [room.you.body.x, 0, room.you.body.z], yaw, people: people(now) });
      refresh();
      if (!debug.ready) { debug.ready = true; requestAnimationFrame(() => { window.__chatdomReady = true; }); setNote(''); }
      raf = requestAnimationFrame(draw);
    };
    void createBenchStage(host, { reducedMotion }).then(created => {
      if (disposed) { created.dispose(); return; }
      stage = created;
      stage.canvas.addEventListener('pointerdown', down); stage.canvas.addEventListener('pointermove', move);
      raf = requestAnimationFrame(draw);
    }, reason => { setNote(`The bench could not open: ${reason instanceof Error ? reason.message : String(reason)}`); });

    onCleanup(() => {
      disposed = true; cancelAnimationFrame(raf);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', up); window.removeEventListener('resize', resize);
      stopKey(); stopAccepted(); prompt.dispose(); session.disconnect(); room.dispose(); stage?.dispose();
      delete window.__chatdomInteractions; window.__chatdomReady = false;
    });
  });
  return (
    <div class="ix-bench" ref={element => { host = element; }} data-motion={reducedMotion ? 'reduce' : 'full'}>
      <header class="ix-bench-plate">
        <p class="ix-bench-eyebrow">SIMULATED · Interaction bench</p>
        <p class="ix-bench-line">People, court and a {latency} ms room delay are simulated. The look, the prompt and the room’s answers are real.</p>
      </header>
      <p class="ix-bench-keys" aria-hidden="true"><span>W A S D</span> walk <i /> <span>← →</span> or drag to look <i /> <span>E</span> use</p>
      {note() && <p class="ix-bench-note">{note()}</p>}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing interaction bench root');
render(() => <Bench />, root);
