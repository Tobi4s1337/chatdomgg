import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { Vec3 } from '@chatdom/shared';
import type { RealmInteractionAction, RealmSeat } from '@chatdom/shared/realm';
import type { CitizenSample } from '../../citizens';
import { createDefaultCitizenLooks } from '../../citizens';
import { STREET_ZONE, type InteractionRecord } from '../../../../../packages/world/src/interactions';
import { createInteractionSession, mountInteractionController, type InteractionCamera, type InteractionController, type InteractionControllerDebug, type InteractionPlaces } from '..';
import { ANVIL, SEAT, SPOT } from './court';
import { createBenchRoom, type BenchPerson } from './room';
import { createBenchStage, type BenchView } from './stage';
import './bench.css';

/**
 * SIMULATED interaction bench: `/src/interactions/bench/index.html`.
 * ?look=north|south|east|west|anvil  initial gaze · ?latency=260 simulated round trip (ms)
 * ?rival=<seat>  Wren already sits there · ?race=<seat>  Wren's claim for that seat reaches the room first
 * ?motion=reduce  reduced motion · ?room=closed  the simulated room closes after opening (every answer is "not now")
 */
interface BenchDebug {
  ready: boolean;
  readonly focus: string | null; readonly action: RealmInteractionAction | null;
  readonly prompt: InteractionControllerDebug['prompt'];
  readonly seats: readonly RealmSeat[]; readonly self: { mode: string; targetId: string | null };
  readonly held: InteractionControllerDebug['held'];
  readonly pick: InteractionControllerDebug['pick'];
  /** The bench camera token: walking, or released to a place's framing. */
  readonly camera: 'walking' | 'released' | 'disposed';
  /** Use → pending prompt in the DOM, in ms. Local only, not the room. */
  readonly localResponse: number | null;
  /** Where the local body stands, and the gaze yaw. */
  readonly feet: readonly [number, number, number]; readonly yaw: number;
  face(id: string): void;
  /** CSS px of a target's authored point on screen, for a click or tap. */
  screenOf(id: string): { x: number; y: number } | null;
}
declare global { interface Window { __chatdomReady?: boolean; __chatdomInteractions?: BenchDebug } }

const TARGETS: Readonly<Record<string, string>> = { ...SEAT, anvil: ANVIL };
const params = new URLSearchParams(window.location.search);
const latency = Math.max(0, Math.min(4000, Number(params.get('latency') ?? 260) || 0));
const reducedMotion = params.get('motion') === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const closed = params.get('room') === 'closed';

/** The campfire's seated framing stands in here: over the sitter's shoulder toward the fire the seat faces. */
function seatedView(record: InteractionRecord): BenchView | null {
  if (!record.rest || record.facing === null) return null;
  // From behind the body on the approach, high and wide of its right shoulder, so the fire and the ring stay open.
  const fx = Math.sin(record.facing), fz = Math.cos(record.facing), [ax, ay, az] = record.target.approach, [x, , z] = record.rest;
  return { eye: [ax - fx * 2.6 - fz * 1.5, ay + 2.9, az - fz * 2.6 + fx * 1.5], at: [x + fx * 1.2, .35, z + fz * 1.2] };
}

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
    // SIMULATED: the room closes after opening, so every request gets the real authority's "not now".
    if (closed) room.authority.dispose();
    const records = room.registry.records;
    const target = (id: string) => records.find(r => r.target.id === id)!;
    const headingTo = (from: Vec3, to: Vec3) => Math.atan2(to[0] - from[0], to[2] - from[2]);
    let yaw = headingTo(SPOT.you, target(TARGETS[params.get('look') ?? 'north'] ?? SEAT.north).target.position);

    // The bench's camera token, shaped like walk-camera's: released to a place's framing, resumed on the citizen.
    let owner: 'walking' | 'released' | 'disposed' = 'walking';
    let placed: BenchView | null = null;
    const keys = new Set<string>();
    let drag: number | null = null;
    const camera: InteractionCamera = {
      get owner() { return owner; },
      release() { if (owner === 'walking') owner = 'released'; keys.clear(); drag = null; },
      resume() { if (owner === 'released') owner = 'walking'; },
    };
    const places: InteractionPlaces = {
      open({ action, record }) {
        // No Forge on the bench: the anvil keeps the walking view (the kingdom opens the existing Forge, IN04).
        const view = action === 'forge' ? null : seatedView(record);
        if (!view) return null;
        placed = view;
        // Leaving the seat's view, the walking camera carries on looking the way the seat faced (toward the fire).
        return { close() { placed = null; if (record.facing !== null) yaw = record.facing; } };
      },
    };

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

    let stage: Awaited<ReturnType<typeof createBenchStage>> | undefined;
    let controller: InteractionController | undefined;
    const debug: BenchDebug = {
      ready: false,
      get focus() { return controller?.debug.focus ?? null; }, get action() { return controller?.debug.action ?? null; },
      get prompt() { return controller?.debug.prompt ?? null; }, get seats() { return controller?.debug.seats ?? []; },
      get self() { return controller?.debug.self ?? { mode: 'standing', targetId: null }; },
      get held() { return controller?.debug.held ?? null; }, get pick() { return controller?.debug.pick ?? null; },
      get camera() { return owner; }, get feet() { return [room.you.body.x, room.you.body.y, room.you.body.z] as const; }, get yaw() { return yaw; }, get localResponse() { return controller?.debug.localResponse ?? null; },
      face: id => { yaw = headingTo([room.you.body.x, 0, room.you.body.z], target(id).target.position); },
      screenOf: id => stage?.project(target(id).target.position) ?? null,
    };
    window.__chatdomInteractions = debug;

    const keydown = (event: KeyboardEvent) => { if (owner === 'walking' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(event.code)) keys.add(event.code); };
    const keyup = (event: KeyboardEvent) => keys.delete(event.code);
    const blur = () => { keys.clear(); drag = null; };
    const down = (event: PointerEvent) => { if (owner === 'walking') drag = event.clientX; };
    const move = (event: PointerEvent) => { if (drag === null) return; yaw -= (event.clientX - drag) * .006; drag = event.clientX; };
    const up = () => { drag = null; };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    window.addEventListener('pointerup', up);
    const resize = () => stage?.resize();
    window.addEventListener('resize', resize);

    const looks = createDefaultCitizenLooks();
    const people = (now: number): CitizenSample[] => room.people.map((person: BenchPerson, index) => {
      const seat = room.authority.seats().seats.find(s => s.walkerId === person.walkerId);
      const record = seat ? target(seat.targetId) : null;
      const heading = record?.facing ?? (person === room.you ? yaw : headingTo([person.body.x, 0, person.body.z], [0, 0, 0]));
      return { id: person.walkerId, look: looks[(index * 3 + 1) % looks.length]!.id, position: [person.body.x, person.body.y, person.body.z], heading, distance: person.body.distance, moving: 0, time: now / 1000 };
    });

    let last = performance.now();
    const draw = (now: number) => {
      if (disposed || !stage || !controller) return;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      if (owner === 'walking') {
        const turn = Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'));
        yaw += turn * dt * 1.9;
        const ahead = Number(keys.has('KeyW')) - Number(keys.has('KeyS')), side = Number(keys.has('KeyA')) - Number(keys.has('KeyD'));
        if (ahead || side) {
          const speed = 2.4 * dt / Math.hypot(ahead, side), fx = Math.sin(yaw), fz = Math.cos(yaw);
          const body = room.you.body;
          room.move(room.you, [body.x + (fx * ahead + fz * side) * speed, 0, body.z + (fz * ahead - fx * side) * speed]);
        }
      }
      const feet: Vec3 = [room.you.body.x, room.you.body.y, room.you.body.z];
      stage.frame({ now, feet, yaw, people: people(now), view: owner === 'released' ? placed : null });
      const view = stage;
      controller.frame({
        now, look: { feet, forward: stage.forward() }, records, world: room.world,
        actor: { walkerId: room.you.walkerId, zone: STREET_ZONE, ownedPlotId: null },
        project: point => view.project(point), ray: (x, y) => view.ray(x, y),
      });
      if (!debug.ready) { debug.ready = true; requestAnimationFrame(() => { window.__chatdomReady = true; }); setNote(''); }
      raf = requestAnimationFrame(draw);
    };
    void createBenchStage(host, { reducedMotion }).then(created => {
      if (disposed) { created.dispose(); return; }
      stage = created;
      stage.canvas.addEventListener('pointerdown', down); stage.canvas.addEventListener('pointermove', move);
      controller = mountInteractionController({ host, surface: stage.canvas, session, camera, places });
      raf = requestAnimationFrame(draw);
    }, reason => { setNote(`The bench could not open: ${reason instanceof Error ? reason.message : String(reason)}`); });

    onCleanup(() => {
      disposed = true; cancelAnimationFrame(raf);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', up); window.removeEventListener('resize', resize);
      controller?.dispose(); owner = 'disposed'; session.disconnect(); room.dispose(); stage?.dispose();
      delete window.__chatdomInteractions; window.__chatdomReady = false;
    });
  });
  return (
    <div class="ix-bench" ref={element => { host = element; }} data-motion={reducedMotion ? 'reduce' : 'full'}>
      <header class="ix-bench-plate">
        <p class="ix-bench-eyebrow">SIMULATED · Interaction bench</p>
        <p class="ix-bench-line">{closed
          ? 'People, court and room are simulated, and this room has closed. The look, the prompt and the room’s answers are real.'
          : `People, court and a ${latency} ms room delay are simulated. The look, the prompt and the room’s answers are real.`}</p>
      </header>
      <p class="ix-bench-keys" aria-hidden="true"><span>W A S D</span> walk <i /> <span>← →</span> or drag to look <i /> <span>E</span> or click to use <i /> <span>Esc</span> leave</p>
      {note() && <p class="ix-bench-note">{note()}</p>}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing interaction bench root');
render(() => <Bench />, root);
