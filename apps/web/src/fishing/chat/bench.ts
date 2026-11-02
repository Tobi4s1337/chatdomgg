import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createVoxelMaterial, geometryFromChunks, getEnvironment, windowGlowForHour } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { pierLightColour, type FishingPierSite, type PierFeedEvent, type PierFeedLine, type PierFeedWho, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { terrainHeight } from '@chatdom/world';
import { installPier, pierLocalToWorld, pierWaterAt } from '../../../../realm/src/fishing/site';
import { groundMaterial, meshGround, type BenchGround } from '../../places/water/surface-bench/ground';
import { createWaterSurface, type WaterLightSource } from '../../places/water/surface';
import { createLightField } from '../../kingdom/light-field';
import { createPierLanternGlow } from '../lanterns';
import { loadAlmanac } from '../../almanac/fetch';
import { pierBenchFixture } from '../bench';
import { watchPierFeed } from './feed';
import { mountChatLines, type ChatLines, type ChatLinesStats } from './lines';

/*
 * Review bench for chat's floats (`/-/pier?view=chat`): the real pier on a generated lake at dusk, the T-head in front
 * of the camera and open water beyond it, and a staged run of the realm's public feed played through the same view a
 * stream mounts. `?at=<seconds>` freezes the run at that moment so a still is exact; without it the run loops.
 * `?compact=1` lays the cards out as a phone does; `?hour=` and `?seed=` change the light and the kingdom.
 * `?kingdom=<id>` stands the founded kingdom's own pier instead, and `&feed=live` plays that kingdom's real public feed
 * from the realm in place of the staged run (the chat check points its stream view here).
 */

type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomPierError?: string;
  __chatdomChat?: { stats(): ChatLinesStats; at(): number; hold(ahead: number | null): void; holdOn(kind: PierFeedEvent['kind'], ahead: number): void } };

const RUN_S = 22, STEP_S = 1 / 30;
const KINGDOM = 'Willowmere';

/** Chat window slots whose lights are five different colours from the shared palette. */
function slotsForColours(count: number): number[] {
  const found = new Map<string, number>();
  for (let slot = 1; slot < 400 && found.size < count; slot++) {
    const colour = pierLightColour(slot);
    if (!found.has(colour)) found.set(colour, slot);
  }
  return [...found.values()];
}

/** The staged feed: [seconds, event]. Every beat the realm can send, in an order a busy evening might bring them. */
export function chatBenchScript(site: FishingPierSite, loop = 0): readonly (readonly [number, PierFeedEvent])[] {
  const out = site.turn === 0 ? [0, 1] : site.turn === 1 ? [1, 0] : site.turn === 2 ? [0, -1] : [-1, 0];
  const right = [out[1]!, -out[0]!];
  const at = (across: number, reach: number): Vec3 => {
    const z = site.walk + 4 + reach;
    return [site.root[0] + right[0]! * across + out[0]! * z, site.waterY, site.root[2] + right[1]! * across + out[1]! * z];
  };
  const slots = slotsForColours(5);
  const who = (name: string | null, index: number): PierFeedWho => ({ name, slot: slots[index]!, colour: pierLightColour(slots[index]!) });
  const people = [who('Juniper', 0), who('mossy_otter', 1), who('Brannigan', 2), who('lilypad_lou', 3), who(null, 4)];
  const id = (n: number) => `bench-${loop}-${n}`;
  const line = (n: number, person: number, phase: PierFeedLine['phase'], float: Vec3, t: number): PierFeedLine =>
    ({ id: id(n), who: people[person]!, via: 'chat', phase, float, at: t });
  const floats: Vec3[] = [at(-2.6, 4.6), at(1.4, 3.2), at(-.4, 7.6), at(3.4, 6.4), at(-4, 8.6)];
  const ms = (s: number) => 1_800_000_000_000 + loop * RUN_S * 1000 + Math.round(s * 1000);
  return [
    [0, { kind: 'lines', at: ms(0), cap: 8, lines: [line(1, 1, 'float', floats[1]!, ms(0)), line(2, 4, 'float', floats[4]!, ms(0))] }],
    [.3, { kind: 'line', at: ms(.3), line: line(3, 0, 'float', floats[0]!, ms(.3)) }],
    [1.1, { kind: 'line', at: ms(1.1), line: line(4, 2, 'float', floats[2]!, ms(1.1)) }],
    [1.9, { kind: 'line', at: ms(1.9), line: line(5, 3, 'float', floats[3]!, ms(1.9)) }],
    [5.2, { kind: 'line', at: ms(5.2), line: line(5, 3, 'bite', floats[3]!, ms(1.9)) }],
    [5.55, { kind: 'line', at: ms(5.55), line: line(5, 3, 'fight', floats[3]!, ms(1.9)) }],
    [6.0, { kind: 'caught', at: ms(6), id: id(90), via: 'pier', who: { name: 'Aldous', slot: null, colour: null },
      fish: { speciesId: 'fish:lantern-eel', lengthMm: 640, weightG: 1180 }, kingdomFirst: false, keepsake: null, float: null }],
    [6.6, { kind: 'line', at: ms(6.6), line: line(3, 0, 'bite', floats[0]!, ms(.3)) }],
    [6.95, { kind: 'line', at: ms(6.95), line: line(3, 0, 'fight', floats[0]!, ms(.3)) }],
    [7.4, { kind: 'line', at: ms(7.4), line: line(1, 1, 'bite', floats[1]!, ms(0)) }],
    [8.0, { kind: 'caught', at: ms(8), id: id(3), via: 'chat', who: people[0]!,
      fish: { speciesId: 'fish:copper-perch', lengthMm: 342, weightG: 812 }, kingdomFirst: true, keepsake: 1, float: floats[0]! }],
    [9.6, { kind: 'full', at: ms(9.6), who: who('Pellinore', 2), cap: 8 }],
    [10.2, { kind: 'full', at: ms(10.2), who: who('Pellinore', 2), cap: 8 }],
    [10.6, { kind: 'gone', at: ms(10.6), id: id(1), reason: 'escaped' }],
    [10.8, { kind: 'line', at: ms(10.8), line: line(4, 2, 'bite', floats[2]!, ms(1.1)) }],
    [12.2, { kind: 'broken', at: ms(12.2), id: id(4), who: people[2]!, speciesId: 'fish:goldscale-emperor', float: floats[2]! }],
    [15.5, { kind: 'caught', at: ms(15.5), id: id(5), via: 'chat', who: people[3]!,
      fish: { speciesId: 'fish:silver-dace', lengthMm: 214, weightG: 168 }, kingdomFirst: false, keepsake: null, float: floats[3]! }],
    [17.5, { kind: 'gone', at: ms(17.5), id: id(2), reason: 'missed' }],
  ];
}

/** Mounts the bench into `root` (positioned, filled); returns its teardown. */
export function mountChatBench(root: HTMLElement, params: URLSearchParams): () => void {
  const W = window as BenchWindow;
  W.__chatdomReady = false;
  let disposed = false, raf = 0;
  const cleanups: (() => void)[] = [];
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Chat floats off the pier');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  root.append(canvas, overlay);
  cleanups.push(() => { canvas.remove(); overlay.remove(); });
  const fail = (error: unknown) => { W.__chatdomPierError = error instanceof Error ? error.message : String(error); console.error('The chat bench could not be drawn.', error); };

  void (async () => {
    const kingdomId = params.get('kingdom'), live = params.get('feed') === 'live';
    if (live && !kingdomId) throw new Error('Choose the kingdom whose pier to watch.');
    if (live && params.has('at')) throw new Error('A live pier cannot be held at a moment.');
    const frozen = params.has('at') ? Number(params.get('at')) : null;
    if (frozen !== null && (!Number.isFinite(frozen) || frozen < 0 || frozen > RUN_S)) throw new Error(`Choose a moment between 0 and ${RUN_S} seconds.`);
    const hour = Number(params.get('hour') ?? 20.1);
    if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error('Hour must be between zero and twenty-four.');
    const compact = params.get('compact') === '1' || (params.get('compact') !== '0' && root.clientWidth < 600);
    const { plan, pieces } = await pierBenchFixture(params);
    const installation = installPier(plan, pieces);
    if (!installation) throw new Error('No clear pier site fits this kingdom.');
    const site = installation.site;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(compact ? 62 : 46, 1, .1, 800);
    const atmosphere = createAtmosphere(scene), fog = new THREE.FogExp2(0); scene.fog = fog;
    const clay = createVoxelMaterial(MATERIALS, 'build');
    const pool = new VoxelWorkerPool({ size: 2, maxQueue: 64 });
    cleanups.push(() => { pool.dispose(); clay.dispose(); atmosphere.dispose(); renderer.dispose(); scene.clear(); });
    const geometries = new Map<VoxelBlueprint, Promise<THREE.BufferGeometry>>();
    const meshBlueprint = (blueprint: VoxelBlueprint) => {
      let job = geometries.get(blueprint);
      if (!job) {
        job = pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }).then(result => {
          if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error('The pier could not be meshed.');
          const geometry = geometryFromChunks(result.chunks, 'build'); cleanups.push(() => geometry.dispose()); return geometry;
        });
        geometries.set(blueprint, job);
      }
      return job;
    };
    for (const piece of installation.pieces) {
      const object = new THREE.Mesh(await meshBlueprint(piece.blueprint), clay.material);
      object.position.set(...piece.position); object.rotation.y = piece.rotation * Math.PI / 2; object.updateMatrixWorld(true); scene.add(object);
    }
    if (disposed) return;
    const lanterns = installation.content.lights.map(light => pierLocalToWorld(site, light.at));
    const glow = createPierLanternGlow(lanterns); scene.add(glow.root); cleanups.push(() => glow.dispose());
    // The shore and lake bed around the pier, so the water has its real depth and the far bank shows.
    const lowX = Math.floor((plan.lake.x - 52) / .5) * .5, lowZ = Math.floor((plan.lake.z - 52) / .5) * .5;
    const width = 209, depth = 209, data = new Float32Array(width * depth);
    for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) data[x + z * width] = terrainHeight(plan, lowX + x * .5, lowZ + z * .5);
    const ground: BenchGround = { origin: [lowX, lowZ], step: .5, width, depth, data };
    const made = groundMaterial(ground, site.waterY);
    const terrain = await meshGround(pool, ground, made, (x, z) => pierWaterAt(plan, x, z) !== null);
    scene.add(terrain); cleanups.push(() => { terrain.geometry.dispose(); made.state.dispose(); });
    const water = createWaterSurface({ bodies: [{ ...plan.lake, id: 'lake', radiusX: plan.lake.radiusX * 1.3, radiusZ: plan.lake.radiusZ * 1.3, depth: 3 }], reaches: [],
      ground: { data, width, height: depth, origin: ground.origin, step: .5 }, quality: compact ? 'reduced' : 'full' });
    scene.add(water.root); cleanups.push(() => water.dispose());
    const light = createLightField(plan, installation.pieces.map((piece, slot) => ({ slot, blueprint: piece.blueprint, position: piece.position, yaw: piece.rotation * Math.PI / 2 })),
      volume => { clay.setLight(volume); made.state.setLight(volume); });
    cleanups.push(() => light.dispose());
    const sources: (WaterLightSource & { strength: number })[] = lanterns.flatMap(([x, y, z]) =>
      [[.6, 0], [-.6, 0], [0, .6], [0, -.6]].map(([dx, dz]) => ({ position: [x + dx!, y, z + dz!] as Vec3, strength: 0, kind: 'lamp' })));
    const grade = getEnvironment(hour), warmth = windowGlowForHour(hour);
    clay.setEnvironment(grade); made.state.setEnvironment(grade); renderer.toneMappingExposure = grade.exposure;
    fog.color.set(grade.fog); fog.density = grade.fogDensity; glow.update(warmth);
    for (const source of sources) source.strength = warmth * .55;
    light.update(pierLocalToWorld(site, [10, 0, site.walk / .125 / 2]), sources);

    // Framing: from behind and above the T-head's rail, over its deck, to the water where chat's floats lie.
    const out = site.turn === 0 ? [0, 1] : site.turn === 1 ? [1, 0] : site.turn === 2 ? [0, -1] : [-1, 0];
    const right = [out[1]!, -out[0]!];
    const local = (across: number, up: number, along: number) => new THREE.Vector3(site.root[0] + right[0]! * across + out[0]! * along, up, site.root[2] + right[1]! * across + out[1]! * along);
    const eye = compact ? local(-1.2, site.deckY + 8.5, site.walk - 5.5) : local(-2.4, site.deckY + 7.2, site.walk - 6.5);
    const focus = local(.2, site.waterY, site.walk + 10.5);
    camera.position.copy(eye); camera.lookAt(focus); camera.updateMatrixWorld();
    const beacon = new THREE.Vector3(...site.root);

    const resize = () => {
      const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    cleanups.push(() => observer.disconnect());

    await document.fonts?.ready;
    const kingdomName = live ? await loadAlmanac(kingdomId!).then(almanac => almanac.kingdom || KINGDOM, () => KINGDOM) : KINGDOM;
    if (disposed) return;
    const lines: ChatLines = mountChatLines({ scene, camera, site, overlay, compact, kingdomName, hour: () => hour,
      viewport: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }) });
    cleanups.push(() => lines.dispose());

    let loop = 0, script = live ? [] : chatBenchScript(site, loop), next = 0, start = performance.now(), scriptAt = 0;
    const play = (t: number) => {
      while (next < script.length && script[next]![0] <= t) lines.apply(script[next++]![1]);
      lines.update(t + loop * RUN_S);
    };
    // `hold(seconds)` stops the clock that many seconds ahead of now; `hold(null)` runs it on from where it stopped,
    // so a beat that arrived meanwhile still plays out in full. `holdOn(kind, seconds)` stops it the moment that beat
    // arrives: a live check on a slow software renderer, whose frames can outlast a card, still captures it.
    let held: number | null = null, queued: number | null = null;
    const arms = new Map<PierFeedEvent['kind'], number>();
    const hear = (event: PierFeedEvent) => {
      const ahead = arms.get(event.kind);
      if (ahead !== undefined) { arms.delete(event.kind); if (held === null) held = scriptAt + ahead; else queued = ahead; }
      lines.apply(event);
    };
    if (live) {
      // The realm's own public feed, exactly as a stream hears it: no staged beats, the run never loops.
      const feed = watchPierFeed(kingdomId!, event => { console.info(`pier feed: ${event.kind}`); hear(event); },
        { onStatus: (status, retryMs) => console.info(`pier feed ${status}${retryMs === undefined ? '' : ` (again in ${retryMs} ms)`}`) });
      cleanups.push(() => feed.dispose());
    }
    if (frozen !== null) {
      for (let t = 0; t < frozen; t += STEP_S) play(t);
      play(frozen); scriptAt = frozen;
      // The fish's and the float's models arrive from the worker: wait for them, then hold the moment.
      await new Promise(ready => setTimeout(ready, 1500));
      if (disposed) return;
      play(frozen);
    }
    W.__chatdomChat = { stats: () => lines.stats(), at: () => scriptAt,
      hold: ahead => {
        if (ahead !== null) { held = scriptAt + ahead; return; }
        if (held !== null) start = performance.now() - held * 1000;
        // A beat armed while the clock stood still is held next, from the moment it arrived.
        held = held !== null && queued !== null ? held + queued : null; queued = null;
      },
      holdOn: (kind, ahead) => { arms.set(kind, ahead); } };
    let painted = 0;
    const draw = () => {
      if (disposed) return;
      if (frozen === null) {
        let t = (performance.now() - start) / 1000;
        if (t >= RUN_S && !live) {
          loop++; start = performance.now(); t = 0; next = 0; script = chatBenchScript(site, loop);
        }
        if (held !== null) t = held;
        scriptAt = t; play(t);
      } else play(frozen);
      const time = 30 + scriptAt;
      atmosphere.update(hour, time, camera, beacon, 0);
      water.update({ time, environment: grade, camera, sources });
      water.reflect({ renderer, scene, camera, frame: painted, exclusions: atmosphere.reflectionExclusions });
      renderer.render(scene, camera);
      if (++painted > 3 && light.stats.publishedRevision > 0 && !W.__chatdomReady) { renderer.getContext().finish(); W.__chatdomReady = true; }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
  })().catch(fail);

  return () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch (error) { console.error('A chat bench part could not be put away.', error); } }
    delete W.__chatdomChat;
    W.__chatdomReady = false;
  };
}
