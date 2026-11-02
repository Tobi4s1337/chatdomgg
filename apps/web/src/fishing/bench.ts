import * as THREE from 'three';
import { MATERIALS, type StyleKey } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment, windowGlowForHour } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { kingdomWaterMood, type FishingPierSite, type KingdomId, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import type { RealmFoundedScene } from '@chatdom/world';
import { terrainHeight } from '@chatdom/world';
import { BLUEPRINTS } from '../../../../packages/content/src/pier';
import { createNativeTown } from '../../../realm/src/founded/native';
import { installPier, pierLocalToWorld, pierWaterAt, type PierInstallation, type PierPiece } from '../../../realm/src/fishing/site';
import { groundMaterial, meshGround, type BenchGround } from '../places/water/surface-bench/ground';
import { createWaterSurface, type WaterLightSource } from '../places/water/surface';
import { createLightField } from '../kingdom/light-field';
import { createPierLanternGlow } from './lanterns';
import { mountPierKingdomLayer } from './kingdom-layer';
import { mountPierLayer, type PierLayer } from './layer';
import { mountPierAssetBench } from './asset-bench';
import { mountFishBench } from './fish-bench';
import { mountFurnishingSheet } from './furnishing-sheet';
import { createPlayStage, type PlayStage, type PlayStageOptions } from './play-bench';

type PierView = 'shore' | 'deck' | 'head' | 'asset' | 'fish' | 'play';
type Angle = 'front' | 'side' | 'back';
export interface PierBench {
  readonly stats: Record<string, unknown>;
  readonly site: FishingPierSite | null;
  view(value: PierView): void;
  hour(value: number): void;
  asset(id: string, angle: Angle): void;
  /** Only on `view=play`: the staged pier's clock, camera and fair player. */
  readonly play?: PlayStage['debug'];
  dispose(): void;
}
export type PierBenchWindow = Window & { __chatdomReady?: boolean; __chatdomPier?: PierBench; __chatdomPierError?: string; __chatdomPierPhase?: string };
const W = window as PierBenchWindow;

/** A founded kingdom's own plan and pieces with `?kingdom=<id>` (read from the realm, hash-checked), else a generated lake. */
export async function pierBenchFixture(query: URLSearchParams): Promise<{ plan: SettlementPlan; pieces: readonly PierPiece[] }> {
  const kingdomId = query.get('kingdom');
  if (kingdomId) {
    if (!/^[1-9][0-9]{0,31}$/.test(kingdomId)) throw new Error('Choose a valid founded kingdom.');
    const receipt = await fetch(`/api/realm/founded/${kingdomId}`, { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error('The founded scene receipt is unavailable.'); return response.json(); });
    const response = await fetch(`/api/realm/founded/scenes/${receipt.sceneHash}`);
    if (!response.ok) throw new Error('The founded scene is unavailable.');
    const data = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== receipt.sceneHash) throw new Error('The founded scene does not match its receipt.');
    const scene = JSON.parse(new TextDecoder().decode(data)) as RealmFoundedScene;
    if (scene.kingdomId !== kingdomId || scene.layoutRevision !== receipt.layoutRevision || scene.collisionRevision !== receipt.collisionRevision) throw new Error('The founded scene revisions do not match.');
    const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
    return { plan: scene.plan, pieces: scene.placements.filter(piece => !piece.id.startsWith('pier:')).map(piece => {
      const blueprint = assets.get(piece.assetHash); if (!blueprint) throw new Error('A founded piece is missing its asset.');
      return { ...piece, blueprint };
    }) };
  }
  const plan = generateSettlementPlan({ seed: query.get('seed') ?? 'pier-shore', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const native = createNativeTown(plan);
  return { plan, pieces: [...native.fixtures, ...native.homes.values()] };
}

/** Dev-only review surface. It never opens a walking session, grants an item or writes a kingdom. */
export async function mountPierBench(canvas: HTMLCanvasElement, query: URLSearchParams, stage?: Pick<PlayStageOptions, 'hud' | 'sound' | 'ui' | 'portrait' | 'onGrant' | 'attach' | 'onClock'>): Promise<PierBench> {
  if (query.get('view') === 'fish') return mountFishBench(canvas, query);
  if (query.get('view') === 'asset') return mountPierAssetBench(canvas, query);
  if (query.get('view') === 'furnishings') return mountFurnishingSheet(canvas, query);
  W.__chatdomReady = false;
  W.__chatdomPierPhase = 'reading-founded-copy';
  const { plan, pieces } = await pierBenchFixture(query);
  W.__chatdomPierPhase = 'placing-pier';
  const installed = installPier(plan, pieces);
  if (!installed) throw new Error('No supported, clear pier site fits this founded scene.');
  const { site } = installed;
  const style = query.get('style');
  if (style && !['hearth', 'tide', 'grove'].includes(style)) throw new Error('Choose Hearth, Tide or Grove.');
  const installation: PierInstallation = style ? installPier({ ...plan, homes: plan.homes.map(home => ({ ...home, style: style as StyleKey })) }, pieces)! : installed;
  if (!installation) throw new Error('The chosen kit could not be placed.');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(query.get('software') === '1' ? .75 : 1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, 1, .1, 800);
  const atmosphere = createAtmosphere(scene), fog = new THREE.FogExp2(0); scene.fog = fog;
  const clay = createVoxelMaterial(MATERIALS, 'build');
  const pool = new VoxelWorkerPool({ size: 2, maxQueue: 80 });
  const cleanups: (() => void)[] = [];
  const pier = new THREE.Group(), land = new THREE.Group(), isolated = new THREE.Group();
  scene.add(pier, land, isolated);
  const geometries = new Map<VoxelBlueprint, Promise<THREE.BufferGeometry>>();
  const mesh = (blueprint: VoxelBlueprint) => {
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
  W.__chatdomPierPhase = 'meshing-pier';
  const pierMeshes = await Promise.all(installation.pieces.map(async piece => {
    const object = new THREE.Mesh(await mesh(piece.blueprint), clay.material);
    object.name = piece.id; object.position.set(...piece.position); object.rotation.y = piece.rotation * Math.PI / 2; object.updateMatrixWorld(true); pier.add(object); return object;
  }));
  const lightPositions = installation.content.lights.map(light => pierLocalToWorld(site, light.at));
  const glow = createPierLanternGlow(lightPositions); pier.add(glow.root);
  // Seed the air outside each case, as windows do. Its brass corners fill the coarse occupancy cell.
  const sources: (WaterLightSource & { strength: number })[] = lightPositions.flatMap(([x, y, z]) =>
    [[.6, 0], [-.6, 0], [0, .6], [0, -.6]].map(([dx, dz]) => ({ position: [x + dx!, y, z + dz!] as Vec3, strength: 0, kind: 'lamp' })));
  const lowX = Math.floor((plan.lake.x - 52) / .5) * .5, lowZ = Math.floor((plan.lake.z - 52) / .5) * .5;
  const width = 209, depth = 209, data = new Float32Array(width * depth);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) data[x + z * width] = terrainHeight(plan, lowX + x * .5, lowZ + z * .5);
  const ground: BenchGround = { origin: [lowX, lowZ], step: .5, width, depth, data };
  const made = groundMaterial(ground, site.waterY);
  W.__chatdomPierPhase = 'meshing-shore';
  const terrain = await meshGround(pool, ground, made, (x, z) => pierWaterAt(plan, x, z) !== null); land.add(terrain);
  cleanups.push(() => terrain.geometry.dispose(), () => made.state.dispose());
  const bounds = new THREE.Box3(new THREE.Vector3(site.root[0] - 42, -4, site.root[2] - 42), new THREE.Vector3(site.root[0] + 42, 12, site.root[2] + 42));
  const shadows = createSunShadows(renderer, { bounds, resolution: query.get('software') === '1' ? 1024 : 2048 });
  shadows.bindReceiver(clay.material); shadows.bindReceiver(made.state.material);
  shadows.register(terrain); for (const object of pierMeshes) shadows.register(object);
  // A few existing trees frame the bank. Their exact accepted blueprints and transforms are retained.
  W.__chatdomPierPhase = 'meshing-bank-trees';
  for (const piece of pieces.filter(piece => piece.id.startsWith('tree:') && Math.hypot(piece.position[0] - site.root[0], piece.position[2] - site.root[2]) < 35).slice(0, 8)) {
    const object = new THREE.Mesh(await mesh(piece.blueprint), clay.material); object.position.set(...piece.position); object.rotation.y = piece.rotation * Math.PI / 2; object.updateMatrixWorld(true); land.add(object); shadows.register(object);
  }
  const water = createWaterSurface({ bodies: [{ ...plan.lake, id: 'lake', radiusX: plan.lake.radiusX * 1.3, radiusZ: plan.lake.radiusZ * 1.3, depth: 3 }], reaches: [],
    ground: { data, width, height: depth, origin: ground.origin, step: .5 }, quality: query.get('software') === '1' || canvas.clientWidth < 600 ? 'reduced' : 'full' });
  land.add(water.root);
  const light = createLightField(plan, installation.pieces.map((piece, slot) => ({ slot, blueprint: piece.blueprint, position: piece.position, yaw: piece.rotation * Math.PI / 2 })), volume => { clay.setLight(volume); made.state.setLight(volume); });
  const stats: Record<string, unknown> = { ready: false, site, kit: style ?? plan.homes[0]?.style, modules: pierMeshes.length,
    pierTriangles: pierMeshes.reduce((sum, object) => sum + (object.geometry.index?.count ?? 0) / 3, 0), pierDraws: pierMeshes.length + 1, source: query.has('kingdom') ? 'founded-copy' : 'bench' };
  let hour = Number(query.get('hour') ?? 18.6), grade = getEnvironment(hour);
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error('Hour must be between zero and twenty-four.');
  let view: PierView = (['shore', 'deck', 'head', 'asset', 'play'].includes(query.get('view') ?? '') ? query.get('view') : 'shore') as PierView;
  let play: PlayStage | undefined;
  let activeAsset: THREE.Mesh | undefined, disposed = false, raf = 0, painted = 0, frame = 0, started = false;
  const ticks = new Set<(dt: number, now: number) => void>();
  let watched: PierLayer | null = null;
  const target = new THREE.Vector3(), beacon = new THREE.Vector3(...site.root);
  const local = (at: Vec3) => pierLocalToWorld(site, at);
  let angle: Angle = (query.get('angle') === 'side' || query.get('angle') === 'back' ? query.get('angle') : 'front') as Angle;
  const reset = () => { painted = 0; W.__chatdomReady = false; stats.ready = false; if (started && raf === 0) raf = requestAnimationFrame(draw); };
  const resize = () => { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); reset(); };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const setHour = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value >= 24) throw new Error('Hour must lie in the kingdom day.');
    hour = value; grade = getEnvironment(hour); clay.setEnvironment(grade); made.state.setEnvironment(grade); renderer.toneMappingExposure = grade.exposure;
    fog.color.set(grade.fog); fog.density = grade.fogDensity;
    const warmth = windowGlowForHour(hour);
    glow.update(warmth); shadows.updateSunDirection(grade.sunDirection);
    for (const source of sources) source.strength = warmth * .55;
    light.update(local([10, 0, site.walk / .125 / 2]), sources);
    reset();
  };
  const setAsset = async (id: string, nextAngle: Angle) => {
    const blueprint = BLUEPRINTS.find(blueprint => blueprint.id === id);
    if (!blueprint) throw new Error('Choose a pier furnishing from its catalogue.');
    reset();
    if (activeAsset) isolated.remove(activeAsset);
    activeAsset = new THREE.Mesh(await mesh(blueprint), clay.material); activeAsset.position.set(-blueprint.size[0] * .0625, 0, -blueprint.size[2] * .0625); isolated.add(activeAsset);
    angle = nextAngle; stats.asset = id; stats.angle = angle; view = 'asset'; reset();
  };
  const draw = () => {
    if (disposed) return;
    W.__chatdomPierPhase = 'drawing';
    const asset = view === 'asset'; pier.visible = land.visible = !asset; isolated.visible = asset;
    if (asset && activeAsset) {
      const extent = Math.max(...activeAsset.geometry.boundingBox!.getSize(target).toArray()), distance = extent * (canvas.clientWidth < 600 ? 3.2 : 2.3);
      const yaw = angle === 'side' ? Math.PI * .63 : angle === 'back' ? Math.PI * 1.12 : Math.PI * .15;
      camera.position.set(Math.sin(yaw) * distance, extent * .8, Math.cos(yaw) * distance); target.set(0, extent * .44, 0); camera.fov = 36;
      fog.density = 0;
    } else if (play) {
      play.frame(); fog.density = grade.fogDensity;
    } else {
      const narrow = canvas.clientWidth < canvas.clientHeight;
      const walk = site.walk / .125;
      const eye: Vec3 = view === 'deck' ? [11, 14, 16] : view === 'head' ? [-14, 15, walk + 4] : narrow ? [-75, 75, -115] : [-75, 60, -90];
      const focus: Vec3 = view === 'deck' ? [12, 6, walk + 12] : view === 'head' ? [24, 7, walk + 19] : [10, 3, walk * .52];
      camera.position.set(...local(eye)); target.set(...local(focus)); camera.fov = narrow ? 58 : view === 'shore' ? 48 : 60;
      fog.density = grade.fogDensity;
    }
    if (!play) { camera.updateProjectionMatrix(); camera.lookAt(target); camera.updateMatrixWorld(); }
    const time = play ? 30 + play.seconds() : 30;
    atmosphere.update(hour, time, camera, beacon, 0);
    if (!asset) {
      water.update({ time, environment: grade, camera, sources });
      water.reflect({ renderer, scene, camera, frame: ++frame, exclusions: atmosphere.reflectionExclusions });
    }
    for (const tick of ticks) tick(1 / 60, performance.now());
    renderer.render(scene, camera);
    if (watched) Object.assign(stats, { watchLayer: watched.stats() });
    Object.assign(stats, { view, hour, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, light: light.stats });
    if (++painted > 2 && (asset || light.stats.publishedRevision > 0) && (!ticks.size || watched)) {
      if (!stats.ready) renderer.getContext().finish();
      stats.ready = true; W.__chatdomReady = true; W.__chatdomPierPhase = 'ready';
      if (query.get('still') === '1' && !play) { raf = 0; return; }
    }
    raf = requestAnimationFrame(draw);
  };
  setHour(hour);
  if (view === 'asset') await setAsset(query.get('asset') ?? BLUEPRINTS[0]!.id, angle);
  if (view === 'play') {
    if (!stage) throw new Error('The play view needs its overlay.');
    play = await createPlayStage({ scene, camera, canvas, site, installation, plan, query, hour: () => hour, ...stage });
    // The layer draws its own lantern glass; the review glass would double it.
    glow.root.visible = false;
  }
  // `layer=watch`: the lanterns and mood exactly as a watcher's kingdom or the stream view mounts them, read back from
  // the installed placements rather than from the installer's own light list.
  if (query.get('layer') === 'watch' && !play) {
    const founded = { assets: installation.pieces.map(piece => ({ assetHash: piece.id, blueprint: piece.blueprint })),
      placements: installation.pieces.map(piece => ({ id: piece.id, assetHash: piece.id, position: piece.position, rotation: piece.rotation })) } as unknown as Pick<RealmFoundedScene, 'assets' | 'placements'>;
    const abort = new AbortController(), kingdomId = (query.get('kingdom') ?? '1') as KingdomId;
    glow.root.visible = false;
    const stop = mountPierKingdomLayer({ scene, camera, mode: 'stream', kingdomId, founded, hour: () => hour, waterHeight: (x, z) => pierWaterAt(plan, x, z),
      onTick: listener => { ticks.add(listener); return () => { ticks.delete(listener); }; }, signal: abort.signal },
    async options => { const layer = await mountPierLayer(options); watched = layer; stats.watchMood = kingdomWaterMood(kingdomId, Date.now()); stats.watchLights = options.lights.length; return layer; });
    cleanups.push(stop, () => abort.abort());
  }
  started = true; raf = requestAnimationFrame(draw);
  return {
    stats, site, ...(play ? { play: play.debug } : {}),
    view(value) { view = value; reset(); },
    hour: setHour,
    asset(id, angle) { void setAsset(id, angle).catch(error => { W.__chatdomPierError = String(error); }); },
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(raf); observer.disconnect(); play?.dispose(); light.dispose(); pool.dispose(); water.dispose(); glow.dispose(); shadows.dispose(); atmosphere.dispose(); clay.dispose(); cleanups.forEach(cleanup => cleanup()); renderer.dispose(); scene.clear(); delete W.__chatdomPier; W.__chatdomReady = false; },
  };
}
