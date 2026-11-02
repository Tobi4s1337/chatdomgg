// The raid set piece (S15, S16, S20): the product's own incoming-raid moment, staged in a real kingdom by read-only
// import. The kingdom scene runs the moment exactly as it would for a witnessed raid (the gate wakes under the
// raider's banner, the braziers catch, the caravan rolls in along the town's own road); this page only hands it the
// raid, lights the town's windows and flies the camera along that road.
//
//   /studio/set.html?scene=raid&shot=S15[&from=<seconds>][&hour=<hour>]
//
// Nothing is drawn over the canvas: the moment's credit plate is a DOM caption, and this page never asks for it.
//
// Timing. The moment takes its time from Date.now() (a presence feed is given, as on the stream). The raid is handed
// over the moment the kingdom is ready, at virtual time A; shot time t is then Date.now() = A + beatAt + t·1000, so the
// beat is at `beatAt` ms when the shot starts. Under the recorder's virtual clock the page steps the clock itself to
// the shot's first frame before it says it is ready (one long step to shot time 0, steps of at most a second to
// `from`, single frames over the last stretch in which a window was still fading in), so a still at `from=3` shows
// what frame 180 of a take from 0 shows.
import * as THREE from 'three';
import { shotClock } from '../contract';
import { createKingdomScene, type PotentialKingdomView } from '../../../../web/src/kingdom/scene';
import { giftRouteOf } from '../../../../web/src/kingdom/moments/anchors';
import { Path } from '../../../../web/src/twitch-moments/gift-view';
import { raidUnits, wagonElapsed, wagonPose } from '../../../../web/src/twitch-moments/raid-beat';
import { createRoadArrivalFeed } from '../../../../web/src/raid-gate/road/arrival-feed';
import { roadLand } from '../../../../web/src/raid-gate/road/lands';
import type { KingdomId, KingdomPresenceFrame, PresenceFeed, Vec3 } from '../../../../../packages/shared/src/index';
import { CHANNELS, SHOTS, sampleKeys, type RaidShot, type RoadSpot } from './shots';

type Scene = Awaited<ReturnType<typeof createKingdomScene>>;
interface VirtualClock { advance(ms: number): number; now(): number }

const FRAME_MS = 1000 / 60;
/** A window takes 0.7 s to come up to full light; a still must step through that stretch frame by frame. */
const WINDOW_FADE_MS = 700;
const UP = new THREE.Vector3(0, 1, 0);

/** A stable number in [0, 1) for a slot and a salt. */
function unit(slot: number, salt: number): number {
  let h = Math.imul(slot ^ salt, 0x9e3779b1) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca77) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export async function start(query: URLSearchParams, canvas: HTMLCanvasElement): Promise<void> {
  const shot: RaidShot = SHOTS[query.get('shot') ?? 'S15'] ?? SHOTS.S15!;
  const from = Math.max(0, Number(query.get('from') ?? 0) || 0);
  const hour = query.has('hour') ? Number(query.get('hour')) : shot.hour;
  const clock = shotClock(from);
  const virtual = (globalThis as { __virtualClock?: VirtualClock }).__virtualClock;

  const land = shot.destination === 'mashad4' ? roadLand(CHANNELS.mashad4.kingdomId) : null;
  const kingdomId = (land ? land.id : CHANNELS.tobi4s.kingdomId) as KingdomId;
  // MashaD4's land is potential land: its windows are a SIMULATED light study the scene reads from this object on
  // every frame, so the page lights them by replacing `windowPreview`. Without the study the land would be dark.
  const potential: PotentialKingdomView | undefined = land ? { ...land.potential } : undefined;
  const arrival = createRoadArrivalFeed(`studio-raid-${shot.id}`);

  // ── Time ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Virtual Date.now() when the beat started (null until the raid is handed over). */
  let anchor: number | null = null;
  const clockAt = (t: number) => anchor! + shot.beatAt + t * 1000;
  /** Shot time from the presentation clock, so every frame (stepped by the page or the recorder) agrees. */
  const now = () => anchor === null ? from : (Date.now() - anchor - shot.beatAt) / 1000;

  // ── Windows ──────────────────────────────────────────────────────────────────────────────────────────────
  // Each home is lit before the shot (`lit` of them), lights at a shot time in the wave, or stays dark.
  let lighting: Map<number, number | null> | null = null;
  function planLighting(scene: Scene): Map<number, number | null> {
    const plan = new Map<number, number | null>();
    const gate = gateOf(scene);
    const homes = scene.layout.homes;
    for (const home of homes) {
      // Potential land keeps its own light study's dark homes dark.
      if (potential?.windowPreview && !potential.windowPreview.windows.some(w => w.slot === home.slot && w.present)) { plan.set(home.slot, null); continue; }
      if (unit(home.slot, 0x11d) < shot.windows.lit) { plan.set(home.slot, -Infinity); continue; }
      const wave = shot.windows.wave;
      if (!wave || !gate) { plan.set(home.slot, null); continue; }
      const d = Math.hypot(home.position[0] - gate.x, home.position[2] - gate.z);
      plan.set(home.slot, wave.start + d / wave.speed + (unit(home.slot, 0x2b7) - 0.5) * 2 * wave.jitter);
    }
    return plan;
  }
  /** When a window that was dark before the shot came on, in shot seconds (for stepping a still through its fade). */
  const switches = () => [...(lighting?.values() ?? [])].filter((at): at is number => at !== null && Number.isFinite(at));

  let sequence = 0, lastKey = '';
  /** The windows at shot time t: present homes with the virtual time each came on. */
  function windowsAt(t: number, asOf: number): KingdomPresenceFrame['windows'] {
    if (!lighting) return [];
    const out: { slot: number; present: boolean; publicName: null; since: number }[] = [];
    for (const [slot, at] of lighting) {
      const present = at !== null && (at === -Infinity || (anchor !== null && at <= t));
      out.push({ slot, present, publicName: null, since: present && at !== -Infinity ? Math.min(asOf, Math.round(clockAt(at!))) : asOf - 20 * 60_000 });
    }
    return out;
  }

  // tobi4s_'s town is lit by its presence feed (people at home in chat). Potential land has no audience: its feed is
  // empty and its windows come from the light study instead.
  let receive: ((frame: KingdomPresenceFrame) => void) | null = null;
  const presenceFrame = (windows: KingdomPresenceFrame['windows'], asOf: number): KingdomPresenceFrame => land
    ? { version: 1, kingdomId, epoch: `potential:${kingdomId}`, sequence: 0, asOf, origin: 'simulated', connection: 'offline', streamLive: false, windows: [] }
    : { version: 1, kingdomId, epoch: 'studio-raid', sequence, asOf, origin: 'simulated', connection: 'fresh', streamLive: true, windows };
  const presenceFeed: PresenceFeed = {
    label: 'SIMULATED',
    subscribe(next) { receive = next; next(presenceFrame([], Date.now())); return () => { receive = null; }; },
  };
  function light(t: number): void {
    if (!lighting) return;
    const asOf = Math.floor(Date.now());
    const windows = windowsAt(t, asOf);
    const key = windows.filter(w => w.present).map(w => w.slot).join(',');
    if (key === lastKey) return;
    lastKey = key; sequence++;
    if (potential) potential.windowPreview = { version: 1, kingdomId, epoch: `studio-raid-light:${kingdomId}`, sequence, asOf, origin: 'simulated', connection: 'offline', streamLive: false, windows };
    else receive?.(presenceFrame(windows, asOf));
  }

  // ── The road and the camera ──────────────────────────────────────────────────────────────────────────────
  let road: { path: Path; gate: THREE.Vector3 } | null = null;
  function roadOf(scene: Scene) {
    if (road) return road;
    const route = giftRouteOf(scene.layout);
    if (!route) throw new Error('This kingdom has no road for a caravan');
    // The caravan's own road: in from the gate to the market, then on up the castle road (as raid-view.ts joins it).
    const joined: Vec3[] = [...route.inbound];
    for (const point of route.outbound) {
      const last = joined.at(-1)!;
      if (Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]) > 0.05) joined.push(point);
    }
    road = { path: new Path(joined), gate: new THREE.Vector3(...route.inbound[0]!) };
    return road;
  }
  const gateOf = (scene: Scene) => roadOf(scene).gate;
  function spot(scene: Scene, at: RoadSpot): THREE.Vector3 {
    const { position, tangent } = roadOf(scene).path.at(at.s);
    const across = new THREE.Vector3().crossVectors(UP, tangent).normalize();
    return position.addScaledVector(across, at.side).addScaledVector(UP, at.up);
  }
  const units = raidUnits(shot.raid.viewers);
  /** Where wagon i of the column stands at beat time `beat` ms, or null when it is not on the road. */
  function wagonAt(scene: Scene, index: number, beat: number): THREE.Vector3 | null {
    if (index >= units) return null;
    const elapsed = wagonElapsed({ t: beat }, index);
    if (elapsed === null) return null;
    const { path } = roadOf(scene);
    return path.at(wagonPose(elapsed, path.length).distance).position;
  }
  function place(scene: Scene, t: number): void {
    const { a, b, u } = sampleKeys(shot.keys, t);
    const eye = spot(scene, a.eye).lerp(spot(scene, b.eye), u);
    const look = spot(scene, a.look).lerp(spot(scene, b.look), u);
    const follow = a.follow ?? b.follow;
    if (follow) {
      const weight = (a.follow?.weight ?? 0) + ((b.follow?.weight ?? 0) - (a.follow?.weight ?? 0)) * u;
      const wagon = wagonAt(scene, follow.wagon, shot.beatAt + t * 1000);
      if (wagon) look.lerp(wagon.addScaledVector(UP, follow.up), weight);
    }
    scene.pose(eye.toArray() as Vec3, look.toArray() as Vec3, a.fov + (b.fov - a.fov) * u);
  }

  // ── Text guard ───────────────────────────────────────────────────────────────────────────────────────────
  // Plates carry no words. No module this scene mounts draws text into the world, but if one ever did (a keeper's
  // sign, a label sprite), it is hidden here before it reaches the picture.
  let hiddenText = 0;
  const render = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function (this: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera) {
    if ((object as THREE.Scene).isScene) object.traverse(child => {
      const map = (child as THREE.Sprite).isSprite ? ((child as THREE.Sprite).material.map as THREE.Texture & { isCanvasTexture?: boolean } | null) : null;
      if (map?.isCanvasTexture && child.visible) { child.visible = false; hiddenText++; }
    });
    return render.call(this, object, camera);
  };

  // ── The kingdom ──────────────────────────────────────────────────────────────────────────────────────────
  let scene: Scene | null = null, failure: string | null = null, ready = false;
  // The kingdom scene announces readiness itself once its first frame is drawn, long before the raid is staged; the
  // recorder must wait for this page instead, so the flag reads this page's own state and ignores other writers.
  Object.defineProperty(window, '__chatdomReady', { configurable: true, get: () => ready, set: () => undefined });
  /** Where loading stands, for the take's sidecar and for diagnosing a page that never becomes ready. */
  let stage = 'loading the kingdom';
  let onFrame: (() => void) | null = null;
  const moments = () => scene?.inspect().moments as { preparation?: string; preparationError?: string | null; controller?: { latest?: { kind: string; startAt: number } | null }; view?: Record<string, unknown> } | undefined;
  const fields = () => {
    const f = scene!.inspect().fields;
    return [f.local, f.kingdom, f.beacon].every(s => s.publishedRevision === s.requestedRevision && !s.busy && !s.queued);
  };

  /** True once the frame on screen is final: the world drawn, the raid's parts meshed, every light field solved. */
  function idle(): boolean {
    const kingdom = scene;
    if (!ready || !kingdom || failure || !kingdom.debug.ready || moments()?.preparation !== 'ready' || kingdom.inspect().renderPhase !== 'drawn') return false;
    if (kingdom.debug.fieldSettled) return true;
    // The fields were solved after this frame was drawn: draw it again at the same instant (no time passes).
    if (fields() && virtual) virtual.advance(0);
    return false;
  }

  window.__set = {
    scene: 'raid',
    duration: shot.duration,
    canvas,
    idle,
    t: () => clock.t(),
    stats: () => {
      const kingdom = scene;
      const view = moments()?.view ?? {};
      const beat = shot.beatAt + clock.t() * 1000;
      return {
        shot: shot.id, from, hour, stage, failure, destination: shot.destination, raid: shot.raid, units, beatMs: Math.round(beat),
        wagons: kingdom ? Array.from({ length: units }, (_, i) => wagonAt(kingdom, i, beat)?.toArray().map(v => Number(v.toFixed(2))) ?? null) : [],
        view: Object.fromEntries(Object.entries(view).filter(([key]) => key.startsWith('raid'))),
        preparation: moments()?.preparation ?? null,
        gate: road?.gate.toArray(), roadLength: road ? Number(road.path.length.toFixed(1)) : null,
        lit: lighting ? [...lighting.values()].filter(at => at !== null && (at === -Infinity || at <= clock.t())).length : 0,
        homes: kingdom?.layout.homes.length ?? 0, hiddenText, debug: kingdom ? { ...kingdom.debug, post: undefined } : null,
      };
    },
  };

  // The camera driver runs before the kingdom's own frame (it is registered first), so each pose and each change of
  // light lands in the frame it belongs to.
  const drive = () => {
    requestAnimationFrame(drive);
    if (!scene || failure) return;
    const t = now();
    place(scene, t);
    light(t);
    onFrame?.();
  };
  requestAnimationFrame(drive);

  const fail = (message: string) => { failure = message; stage = 'failed'; console.error(`raid set: ${message}`); };
  const common = {
    presenceFeed, presenceOrigin: 'simulated' as const, momentFeed: arrival, hour, time: null, camera: 'hero' as const, source: 'simulated' as const,
    kingdomId, onProgress: (text: string) => { stage = `loading the kingdom: ${text}`; }, onNames: () => undefined, onSource: () => undefined, onError: fail,
  };
  try {
    scene = land && potential
      ? await createKingdomScene(canvas, { ...common, potential, nativeStyle: potential.style, forgeFamily: potential.style, tier: potential.plan.config.tier, seed: potential.plan.config.seed, realmName: land.name })
      : await createKingdomScene(canvas, { ...common, tier: 'town', seed: 'willowmere', firstYear: 2022, year: 2026, realmName: 'Willowmere' });
  } catch (error) { fail(error instanceof Error ? error.message : String(error)); return; }
  const kingdom = scene;
  lighting = planLighting(kingdom);
  place(kingdom, from);
  light(from);

  const awaitFrame = (test: () => boolean) => new Promise<void>((resolve, reject) => {
    onFrame = () => {
      if (failure) { onFrame = null; reject(new Error(failure)); return; }
      const parts = moments();
      if (parts?.preparation === 'failed' || parts?.preparation === 'disposed') { onFrame = null; reject(new Error(parts.preparationError ?? 'the gate could not be prepared')); return; }
      if (test()) { onFrame = null; resolve(); }
    };
  });

  try {
    // The kingdom is ready once its world and the raid's parts are meshed and its light is solved.
    stage = 'waiting for the world, the gate and the light';
    await awaitFrame(() => kingdom.debug.ready && kingdom.debug.fieldSettled && moments()?.preparation === 'ready');

    // Hand the kingdom its raid. The moment begins on the presentation clock as the fact arrives.
    arrival.arrive({ raidId: `studio-${shot.id.toLowerCase()}`, kingdomId, from: shot.raid.from, viewers: shot.raid.viewers, founded: true }, Date.now());
    const latest = moments()?.controller?.latest;
    if (latest?.kind !== 'raid') throw new Error('The kingdom did not take the raid');
    anchor = latest.startAt;

    // Step to the shot's first frame. Every take begins with the same long step to shot time 0 (the beat already at
    // `beatAt`), so what that jump leaves behind (citizens catch up at most a second per frame) is the same in a take
    // from 0 and a still at `from`. From there the page walks to `from` in steps of at most a second, one drawn frame
    // each, so the citizens keep up; over the last stretch in which a window was still fading in it steps single
    // frames on the take's own frame grid, so every fade is where frame `from·60` of a take would have it.
    stage = 'stepping to the first frame';
    const start = clockAt(0), target = clockAt(from);
    if (virtual) {
      if (start > Date.now()) virtual.advance(start - Date.now());
      const fading = switches().filter(at => at > from - WINDOW_FADE_MS / 1000 - 0.05 && at <= from);
      const frames = Math.round(from * 60);
      const tail = fading.length ? Math.min(frames, Math.ceil((target - clockAt(Math.min(...fading)) + FRAME_MS) / FRAME_MS)) : 0;
      const walkTo = Math.max(start, target - tail * FRAME_MS);
      const steps = Math.ceil((walkTo - Date.now()) / 1000 - 1e-9);
      const step = steps > 0 ? (walkTo - Date.now()) / steps : 0;
      for (let i = 0; i < steps; i++) virtual.advance(Math.min(step, walkTo - Date.now()));
      for (let i = 0; i < tail; i++) virtual.advance(Math.max(0, Math.min(FRAME_MS, target - Date.now())));
      if (target - Date.now() > 1e-6) virtual.advance(target - Date.now());
    } else {
      await awaitFrame(() => Date.now() >= target);
    }
  } catch (error) { fail(error instanceof Error ? error.message : String(error)); return; }
  clock.begin();
  ready = true;
  stage = 'ready';
  window.addEventListener('resize', () => { if (scene) place(scene, now()); });
}
