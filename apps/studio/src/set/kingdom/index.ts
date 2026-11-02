// The kingdom set piece (S05, S06, S07, S09, S12, S17, S18, S22): tobi4s_'s town as the stream shows it, the
// product's own kingdom scene staged by read-only import, every pose and event a function of shot time.
//
//   /studio/set.html?scene=kingdom&shot=S07[&from=2.5]
//
// How the scene is held to the shot clock:
//  - The kingdom's clock is the page's Date.now, which this page pins to the shot (presence shots), or the
//    simulated evening's second, seeked every frame (native shots). Before the take starts it is held at the shot's
//    first moment while the town loads, then walked forward in steps of at most a second to `from`, one drawn frame
//    per step, so citizen routines (they step on a 100 ms grid and catch up at most a second at a time) and dock acts
//    are exactly where a take from 0 would have them.
//  - Windows that light before `from` are published once at `from`, dated to when they lit, so their fade-in is as
//    far along as in a take from 0.
//  - The camera is ours every frame: the scene's capture pose places the light fields and the lens, and the camera's
//    own world-matrix update applies our pose last, over the dock act's and the Forge's directors.
//  - Clean plates: no DOM is drawn over the canvas, no name or caption callbacks are passed, and in-canvas text that
//    says SIMULATED is never drawn.
import * as THREE from 'three';
import { shotClock } from '../contract';
import { createKingdomScene, type SceneOptions } from '../../../../web/src/kingdom/scene';
import type { DockPresentationConnection } from '../../../../web/src/stream/dock-presenter';
import { generateSettlementPlan } from '../../../../../packages/world/src/index';
import type { CitizenMotion } from '../../../../../packages/world/src/citizens/types';
import { WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_TIME } from '../../../../../packages/shared/src/world-fixtures';
import type { KingdomPresenceFrame, PresenceFeed } from '../../../../../packages/shared/src/presence';
import type { RealmDockPresentation, RealmDockStageState } from '../../../../../packages/shared/src/realm/dock';
import { LURKER, SHOTS, type NativeShot, type Point, type Shot } from './shots';
import { cameraPath, type View } from './path';

export { SHOTS, DURATIONS, LURKER, QUIET_HOME } from './shots';

type Kingdom = Awaited<ReturnType<typeof createKingdomScene>>;
interface VirtualClock { advance(ms: number): void; now(): number; realNow(): number }

const PLAN = { seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 } as const;
/** Presence shots: the kingdom clock's epoch (a fixed evening, unrelated to the recorder's wall clock). */
const PRESENCE_EPOCH = WORLD_FIXTURE_TIME + 86_400_000;
/** Presence shots: the scene's animation seconds at take time 0 (wind, flames, water). */
const ANIMATION_BASE = 60;
/** Homes lit before the take came home this long before it. */
const LONG_AGO = -900;
const FRAME = 1 / 60;

/** A fixed 32-bit hash of a slot, for choosing which homes are lit. */
function slotHash(slot: number): number {
  let h = Math.imul(slot ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export async function start(query: URLSearchParams, canvas: HTMLCanvasElement): Promise<void> {
  const id = (query.get('shot') ?? 'S07').toUpperCase();
  const shot: Shot | undefined = SHOTS[id];
  if (!shot) throw new Error(`no kingdom shot called ${id}`);
  const from = Math.max(0, Number(query.get('from') ?? 0) || 0);
  const offset = shot.mode === 'native' ? shot.offset ?? 0 : 0;
  // The take's clock (`t`), and the longer clock it belongs to (`s` = t + offset), which events are timed on.
  const clock = shotClock(from);
  const target = from + offset;
  const virtual = (globalThis as { __virtualClock?: VirtualClock }).__virtualClock;
  let failure: string | null = null;

  // --- The page: readiness, clocks, randomness, storage, text and DOM, before any product code runs ------------------
  // The scene announces readiness itself when its first frame is drawn; the recorder must wait for ours.
  let ready = false;
  Object.defineProperty(window, '__chatdomReady', { configurable: true, get: () => ready, set: () => undefined });
  let held: number | null = 0;
  const now = () => held ?? clock.t() + offset;
  const epochMs = shot.mode === 'native' ? WORLD_FIXTURE_TIME + shot.at * 1000 : PRESENCE_EPOCH;
  const K = (s: number) => Math.round(epochMs + s * 1000);
  Date.now = () => K(now());
  // The Forge names its ritual from crypto randomness: a seeded stream keeps every take the same.
  let random = 0x6d2b79f5;
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: <T extends ArrayBufferView | null>(array: T): T => {
    if (!array) return array;
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; bytes[i] = random >>> 24; }
    return array;
  } });
  for (const key of Object.keys(localStorage)) if (key.startsWith('chatdom:forge:simulated:')) localStorage.removeItem(key);
  let hiddenText = 0;
  for (const method of ['fillText', 'strokeText'] as const) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
      if (/simulated/i.test(String(text))) { hiddenText++; return; }
      return maxWidth === undefined ? original.call(this, text, x, y) : original.call(this, text, x, y, maxWidth);
    };
  }
  const clean = document.createElement('style');
  clean.textContent = 'body > :not(canvas#set) { display: none !important; }';
  document.head.append(clean);
  const forgeShot = shot.mode === 'native' && shot.forgeAt !== undefined;
  if (forgeShot) {
    // The Forge's local fixture grammar (no service call) is chosen by the page's query.
    const url = new URL(location.href); url.searchParams.set('forgeFixture', '1');
    history.replaceState(history.state, '', url);
  }

  // --- Presence (presence shots): our own feed, origin simulated --------------------------------------------------------
  const plan = generateSettlementPlan(PLAN);
  const slots = plan.homes.map(home => home.slot);
  let sequence = 1;
  const lit = new Map<number, { since: number; look?: string }>();
  let pendingArrivals = shot.mode === 'presence' ? [...(shot.arrivals ?? [])].sort((a, b) => a.at - b.at) : [];
  let presenceListener: ((frame: KingdomPresenceFrame) => void) | undefined, lastFrame: KingdomPresenceFrame | undefined;
  const frameAt = (asOf: number): KingdomPresenceFrame => ({
    version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, epoch: 'studio:willowmere', sequence: sequence++, asOf, origin: 'simulated',
    streamLive: true, connection: 'fresh',
    windows: slots.map(slot => {
      const home = lit.get(slot);
      return home ? { slot, present: true, publicName: null, since: home.since, ...(home.look ? { look: home.look } : {}) }
        : { slot, present: false, publicName: null, since: K(LONG_AGO) };
    }),
  });
  const publish = (asOf: number) => { lastFrame = frameAt(asOf); presenceListener?.(lastFrame); };
  const presenceFeed: PresenceFeed = {
    label: 'SIMULATED',
    subscribe(receive) { presenceListener = receive; if (lastFrame) receive(lastFrame); return () => { presenceListener = undefined; }; },
  };
  if (shot.mode === 'presence') {
    for (const slot of slots) {
      const chosen = shot.alsoLit?.includes(slot) || (!shot.dark?.includes(slot) && slotHash(slot) < shot.lit);
      // The lurker always wears their own look, whichever shot they are home in.
      if (chosen && !(shot.arrivals ?? []).some(arrival => arrival.slot === slot)) lit.set(slot, { since: K(LONG_AGO), ...(slot === LURKER.slot ? { look: LURKER.look } : {}) });
    }
    publish(K(-600));
  }

  // --- Dock (native gate shots): one gate-open act on the shared take clock --------------------------------------------
  let dockListener: ((act: RealmDockPresentation) => void) | undefined, gateDelivered = false, witnessed = 0;
  const gateAt = shot.mode === 'native' ? shot.gateOpensAt : undefined;
  const dockFeed: DockPresentationConnection = {
    subscribe(receive) { dockListener = receive; return () => { dockListener = undefined; }; },
    subscribeState(receive) {
      const state: RealmDockStageState = { version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', asOf: K(-1), revision: 'studio:gate:closed',
        gate: 'closed', fire: 'unlit', fireUntil: K(-1), honours: [] };
      receive(state);
      return () => undefined;
    },
    async witness() { witnessed++; },
  };
  const deliverGate = () => {
    if (gateAt === undefined || gateDelivered || now() < gateAt - 1e-6) return;
    gateDelivered = true;
    kingdom?.pose(null);
    dockListener?.({ version: 1, id: 'studio:gate:1', actionId: 'studio:gate:press:1', kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', kind: 'gate-open',
      occurredAt: K(gateAt), expiresAt: K(gateAt) + 60_000, gate: 'open', fire: 'unlit' });
  };

  // --- The camera ---------------------------------------------------------------------------------------------------
  let view: View | null = null, path: ((t: number) => View) | null = null, fieldFocus: (view: View) => THREE.Vector3 = view => view.target;
  let camera: THREE.PerspectiveCamera | undefined;
  const place = (subject: THREE.PerspectiveCamera, pose: View) => {
    subject.position.copy(pose.eye); subject.up.set(0, 1, 0); subject.lookAt(pose.target);
    // The Forge frames its casting above a prompt card with a view offset; a plate has no card.
    if (subject.view?.enabled) subject.clearViewOffset();
    if (subject.fov !== pose.fov || subject.zoom !== 1) { subject.fov = pose.fov; subject.zoom = 1; subject.updateProjectionMatrix(); }
  };

  // --- The frame driver: registered before the scene's own loop, so our state lands in the same frame ----------------
  let kingdom: Kingdom | undefined;
  let forgeReady = false;
  let waiters: { calls: number; resolve: () => void }[] = [];
  const drive = () => {
    requestAnimationFrame(drive);
    try {
      const s = now();
      if (kingdom) {
        if (shot.mode === 'native') kingdom.seek(shot.at + s);
        deliverGate();
        if (shot.mode === 'presence' && held === null) arrive(s);
        if (forgeShot && forgeReady) kingdom.forge.seek((shot as NativeShot).forgeAt! + s);
        if (path) {
          view = path(held === null ? clock.t() : target - offset);
          if (camera) place(camera, view);
          // The dock act owns the scene's director while it plays; elsewhere the capture pose also places the light.
          const acting = gateAt !== undefined && gateDelivered;
          if (!acting) kingdom.pose(view.eye.toArray(), fieldFocus(view).toArray(), view.fov);
        }
      }
    } catch (error) { failure = String(error); console.error('kingdom set: frame failed', error); }
    const due = waiters.filter(waiter => --waiter.calls <= 0);
    waiters = waiters.filter(waiter => waiter.calls > 0);
    for (const waiter of due) waiter.resolve();
  };
  requestAnimationFrame(drive);
  /** Resolves once the scene has drawn a frame with the state set before this call. */
  // Where loading spends its wall-clock time (for the take's sidecar; never used for the picture): seconds from the
  // page's start to each stage.
  const wall = () => (virtual ? virtual.realNow() : 0) / 1000;
  const stages: [string, number][] = [];
  const stage = (name: string) => {
    const label = name.replace(/ [0-9.]+$/, '');
    if (stages.at(-1)?.[0] !== label) stages.push([label, Number(wall().toFixed(1))]);
    (window as Window & { __kingdomStage?: string }).__kingdomStage = name;
  };
  const drawn = () => new Promise<void>(resolve => waiters.push({ calls: 2, resolve }));

  // Windows that light during the take (presence shots): published on the frame they light, dated to the moment.
  function arrive(s: number) {
    const due = pendingArrivals.filter(arrival => arrival.at <= s + 1e-6);
    if (!due.length) return;
    pendingArrivals = pendingArrivals.filter(arrival => arrival.at > s + 1e-6);
    for (const arrival of due) lit.set(arrival.slot, { since: K(arrival.at), ...(arrival.look ? { look: arrival.look } : {}) });
    publish(Math.max(K(s), lastFrame?.asOf ?? 0));
  }

  // --- Mount ---------------------------------------------------------------------------------------------------------
  const common = {
    tier: PLAN.tier, seed: PLAN.seed, firstYear: PLAN.firstYear, year: PLAN.year, realmName: 'Willowmere', hour: shot.hour, camera: 'hero' as const,
    source: 'simulated' as const, presenceOrigin: 'simulated' as const, kingdomId: WORLD_FIXTURE_KINGDOM,
    onProgress: (text: string, share?: number) => stage(`mounting: ${text} ${share ?? ''}`), onNames: () => undefined, onSource: () => undefined,
    onError: (message: string) => { failure = message; console.error(`kingdom set: ${message}`); },
  };
  const options: SceneOptions = shot.mode === 'presence'
    ? { ...common, presenceFeed, time: ANIMATION_BASE + target }
    : { ...common, time: shot.at, ...(gateAt !== undefined ? { dockFeed, simulatedDockSites: true, dockActive: true } : {}) };
  // The scene makes its camera synchronously, before its first await: note it as it is made.
  const proto = THREE.PerspectiveCamera.prototype, updateProjection = proto.updateProjectionMatrix;
  proto.updateProjectionMatrix = function (this: THREE.PerspectiveCamera) {
    if (!camera && this.near === .15 && this.far === 2200) camera = this;
    return updateProjection.call(this);
  };
  let mounting: Promise<Kingdom>;
  try { mounting = createKingdomScene(canvas, options); } finally { proto.updateProjectionMatrix = updateProjection; }
  if (!camera) throw new Error('The kingdom camera was not found');
  const lens = camera;
  // Our pose wins over every director: it is applied as the camera's world matrix is brought up to date.
  lens.updateMatrixWorld = function (this: THREE.PerspectiveCamera, force?: boolean) {
    if (view) place(this, view);
    THREE.PerspectiveCamera.prototype.updateMatrixWorld.call(this, force);
  };
  stage('mounting');
  kingdom = await mounting;
  stage('mounted');
  const scene = kingdom;
  const layout = scene.layout;
  let motion: CitizenMotion = scene.captureCitizens()!.motion;

  // --- Anchors and the camera path ------------------------------------------------------------------------------------
  const node = (nodeId: string) => { const found = layout.nodes.find(item => item.id === nodeId); if (!found) throw new Error(`no node ${nodeId}`); return new THREE.Vector3(...found.position); };
  const gate = node(layout.castle.gateNodeId), market = node(layout.market.nodeId);
  const crown = (() => {
    const road = layout.streets.find(street => street.id === 'road:castle');
    if (!road) throw new Error('no Crown Road');
    const points = (road.from === layout.castle.gateNodeId ? road.points : [...road.points].reverse()).map(p => new THREE.Vector3(...p));
    return (metres: number) => {
      let left = metres;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!, length = a.distanceTo(b);
        if (left <= length) return a.clone().lerp(b, length > 0 ? left / length : 0);
        left -= length;
      }
      return points.at(-1)!.clone();
    };
  })();
  const route = (slot: number) => { const found = motion.routeForSlot(slot); if (!found) throw new Error(`home ${slot} has no route`); return found.points; };
  const resolve = (point: Point) => {
    const [anchor, dx, dy, dz] = point, [kind, arg] = anchor.split(':') as [string, string | undefined];
    const base = kind === 'gate' ? gate : kind === 'market' ? market : kind === 'world' ? new THREE.Vector3()
      : kind === 'door' ? new THREE.Vector3(...route(Number(arg)).at(-1)!) : kind === 'start' ? new THREE.Vector3(...route(Number(arg))[0]!)
      : kind === 'crown' ? crown(Number(arg)) : null;
    if (!base) throw new Error(`unknown anchor ${anchor}`);
    return base.clone().add(new THREE.Vector3(dx, dy, dz));
  };
  path = cameraPath(shot.camera.map(key => ({ eye: resolve(key.eye), target: resolve(key.target), fov: key.fov })), shot.duration, shot.ease);
  // Where the local light field centres: the dock act's own focus at the gate, so it never re-centres when the act
  // takes over; the house for the Forge; elsewhere what the camera looks at.
  if (gateAt !== undefined) { const focus = gate.clone().add(new THREE.Vector3(0, 1.2, 0)); fieldFocus = () => focus; }

  // --- Errands: present citizens walking to a public node, arriving on cue ----------------------------------------------
  // The time a walk takes is measured on the scene's own motion (one trial goal per candidate), which is then reset by
  // an older frame; the real goals start that long before each cue.
  const errands: { slot: number; to: string; startMs: number; arriveMs: number }[] = [];
  if (shot.errands?.length) {
    const wanted = [...shot.errands].sort((a, b) => a.arrive - b.arrive);
    // Trial goals need a frame before them; the real ones need one older still.
    let trialAt: number, floor: number;
    if (shot.mode === 'native') {
      scene.seek(70); motion = scene.captureCitizens()!.motion; trialAt = WORLD_FIXTURE_TIME + 70_001; floor = WORLD_FIXTURE_TIME + 69_000;
    } else { trialAt = K(-590); floor = K(-601); }
    const present = shot.mode === 'native' ? slots : [...lit.keys()];
    // People who live nearest the destination have the shortest walks, so their trial goals are the cheapest.
    const named = new Set(wanted.flatMap(errand => errand.slot === undefined ? [] : [errand.slot]));
    const candidates = present.filter(slot => named.size === 0 || named.has(slot) || wanted.some(errand => errand.slot === undefined))
      .sort((a, b) => gate.distanceToSquared(new THREE.Vector3(...route(a).at(-1)!)) - gate.distanceToSquared(new THREE.Vector3(...route(b).at(-1)!)) || a - b)
      .slice(0, 48);
    // A person takes one trial goal (a second at the same moment is refused), so each person is measured for the
    // first destination that names them.
    const destinations = [...new Set(wanted.map(item => item.to))], takes = new Map<string, Map<number, number>>();
    for (const destination of destinations) {
      const times = new Map<number, number>();
      for (const slot of candidates) {
        if (!motion.requestGoal({ slot, nodeId: destination, startAtMs: trialAt }).accepted) continue;
        const arrived = (ms: number) => { const sample = motion.sample(ms).find(item => item.slot === slot); return !!sample && sample.goalNodeId === destination && sample.goalReached; };
        let lo = trialAt, hi = trialAt + 1_200_000;
        if (!arrived(hi)) continue;
        for (let i = 0; i < 36; i++) { const mid = (lo + hi) / 2; if (arrived(mid)) hi = mid; else lo = mid; }
        times.set(slot, hi - trialAt);
      }
      takes.set(destination, times);
    }
    // Forget the trial goals: an older frame resets the motion and keeps everyone at home.
    if (shot.mode === 'native') scene.seek(69); else publish(K(-601));
    motion = scene.captureCitizens()!.motion;
    const used = new Set<number>();
    for (const item of wanted) {
      const order = [...(takes.get(item.to) ?? new Map<number, number>()).entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const chosen = item.slot !== undefined ? order.find(([slot]) => slot === item.slot) : order.find(([slot]) => !used.has(slot));
      if (!chosen) { console.warn(`kingdom set: nobody can walk to ${item.to} for ${item.arrive} s`); continue; }
      const [slot, takesMs] = chosen, arriveMs = K(item.arrive), startMs = Math.round(arriveMs - takesMs);
      used.add(slot);
      if (startMs < floor) { console.warn(`kingdom set: home ${slot} is too far from ${item.to}`); continue; }
      if (motion.requestGoal({ slot, nodeId: item.to, startAtMs: startMs }).accepted) errands.push({ slot, to: item.to, startMs, arriveMs });
    }
    if (shot.mode === 'native') scene.seek(shot.at);
  }

  // --- Load to the first frame of the take ----------------------------------------------------------------------------
  // The kingdom stands at the take's first moment while it loads: citizens are first seen there, the Forge is lit there.
  held = 0;
  stage('holding');
  await drawn();
  let forging: Promise<boolean> | undefined;
  if (forgeShot) {
    forging = scene.forge.submit('a sleeping dragon chimney');
    await drawn();
    if (!(await forging)) throw new Error(`The Forge fixture did not take the wish: ${scene.forge.status().privateError ?? scene.forge.status().phase}`);
    forgeReady = true;
  }
  // Then walk to `from`: steps of at most a second, landing exactly on every timed event.
  const stops = [...new Set([...Array.from({ length: Math.ceil(target) }, (_, i) => i + 1), ...(gateAt !== undefined ? [gateAt] : [])])]
    .filter(s => s > 0 && s < target).sort((a, b) => a - b);
  for (const stop of [...stops, target]) { if (stop <= 0) continue; held = stop; stage(`walking to ${stop}`); await drawn(); }
  if (forgeShot && forgeReady) {
    // The flight's trail is drawn from where the piece has been: give it the frames a take from 0 would have seen.
    const ritual = (shot as NativeShot).forgeAt! + target, scratch = new THREE.Vector3();
    for (let k = 45; k >= 1; k--) { scene.forge.seek(ritual - k * FRAME); scene.forge.update(performance.now(), scratch, false); }
  }
  // Windows that lit before `from`, dated to when they lit, published as the take's first frame.
  if (shot.mode === 'presence') arrive(target);
  await drawn();
  clock.begin();
  held = null;
  stage('ready');

  // --- The handle -----------------------------------------------------------------------------------------------------
  const fieldsSolved = () => {
    const fields = scene.inspect().fields;
    return [fields.local, fields.kingdom, fields.beacon].every(field => field.publishedRevision === field.requestedRevision && !field.busy && !field.queued);
  };
  /** True once the frame on screen is final: the town drawn, the Forge's piece made, and every light field solved for
   * the frame that is on screen (if the fields finished after it was drawn, it is drawn again at the same instant). */
  function idle(): boolean {
    if (failure || !scene.debug.ready || scene.inspect().renderPhase !== 'drawn') return false;
    if (forgeShot && (!forgeReady || scene.forge.status().phase === 'preparing')) return false;
    if (scene.debug.fieldSettled) return true;
    if (fieldsSolved() && virtual) virtual.advance(0);
    return false;
  }
  window.__set = {
    scene: 'kingdom',
    duration: shot.duration,
    canvas,
    idle,
    t: () => clock.t(),
    stats: () => ({
      shot: shot.id, mode: shot.mode, from, t: Number(clock.t().toFixed(4)), kingdomSeconds: Number(now().toFixed(4)), hour: shot.hour,
      buffer: [canvas.width, canvas.height], css: [canvas.clientWidth, canvas.clientHeight], devicePixelRatio: window.devicePixelRatio,
      camera: view ? { eye: view.eye.toArray().map(v => Number(v.toFixed(3))), target: view.target.toArray().map(v => Number(v.toFixed(3))), fov: Number(view.fov.toFixed(3)) } : null,
      lit: shot.mode === 'presence' ? lit.size : null, errands, gate: gateAt === undefined ? null : { at: gateAt, delivered: gateDelivered, witnessed, dock: scene.inspect().dock },
      forge: forgeShot ? scene.forge.status() : null, hiddenText, failure,
      loading: stages,
      debug: { ...scene.debug },
    }),
  };
  ready = true;
}
