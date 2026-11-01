import * as THREE from 'three';
import { MATERIALS, createDressing, createGrowthHome } from './kit';
import { createNativeForgeHost } from '@chatdom/forge';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment, type WindowHouse } from '@chatdom/render';
import { createEffects, type SparkBurst } from '@chatdom/render/effects';
import { HOME_DEPTH_METRES, VOXEL_METRES, type GrowthHomeStage, type HomeTier, type KingdomPresenceFrame, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool, type AssetChunkMesh } from '@chatdom/voxel';
import { homeFrame, homeLifeAnchors, homeOrigin, randomUnit, samplePublicGround, seedHash, terrainHeight, transformCardinalPoint, type SettlementHome, type SettlementPlan } from '@chatdom/world';
import { createCastleContent, createCastleCourtContent } from '../../kingdom/castle-content';
import { createForgeSquareContent } from '../../kingdom/forge-square-content';
import { createHomeLife, type HomeLifeSite } from '../../kingdom/home-life';
import { createHorizonSurface } from '../../kingdom/horizon';
import { createLightField } from '../../kingdom/light-field';
import { inhabitedLightBounds } from '../../kingdom/light-bounds';
import { beaconStrength } from '../../kingdom/beacon';
import { placeMarketContent, placeSettlementContent, type Dressing } from '../../kingdom/settlement-content';
import { loadTerrain } from '../../kingdom/terrain-client';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../../kingdom/terrain-worker';
import { terrainBatches } from '../../kingdom/terrain-batches';
import { advanceDetailTransition, type DetailLevel, type DetailTransition } from '../../kingdom/detail-transition';
import { attachCanopy, createCanopyMaterial, groveBatches, plantGrove, type TreeSite } from '../../kingdom/trees';
import { createGroundDressing } from '../../kingdom/ground-dressing';
import { planAdoptedCover } from '../../kingdom/ground-dressing/adopted-cover';
import { createWaterSurface } from '../../places/water/surface';
import { QUARTER_PHASES, smooth, span, type ScoreSample, type Shot } from '../score';
import type { GrowthTown } from '../town';
import { createGrowthMaterial, type GrowthMaterial } from './growth-material';
import { createLanternGlows, type LanternGlow } from './lanterns';
import { GARLAND_LANTERNS, SCAFFOLD_OFFSET, createGarland, createPlotStakes, createScaffold, garlandPoint, occupied, scaffoldLantern } from './props';

const CELL = VOXEL_METRES.build;
const TIERS: readonly HomeTier[] = ['hut', 'cottage', 'house', 'manor', 'hall'];
/** Pseudo slots for the per-window lights and chimneys of homes whose tier changes in front of the camera. */
const DYNAMIC_SLOT = 60000;
/** Fixed evening the sequence is drawn on; the score's seconds are added to it for every light's fade. */
export const SEQUENCE_EPOCH = Date.UTC(2026, 0, 5, 19, 30);

/** `grow` cuts a piece to the world-height band [floor, top]; `glow` warms its newest course (homes only). */
interface Placement { readonly key: string; readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly yaw: number; grow?: readonly [number, number]; glow?: number }
/** One piece being raised: its own mesh and cut, sharing the growth program with every other slot. */
interface GrowSlot { readonly mesh: THREE.Mesh; readonly cut: GrowthMaterial }
interface Batch {
  readonly blueprint: VoxelBlueprint;
  readonly levels: Map<DetailLevel, THREE.InstancedMesh>;
  shadow?: { mesh: THREE.InstancedMesh; release: () => void; key: string } | undefined;
  readonly capacity: number;
}
interface DynamicHome {
  readonly plot: SettlementHome;
  readonly hosts: ReadonlyMap<HomeTier, WindowHouse>;
  readonly index: number;
}

export interface GrowthStageOptions {
  readonly canvas: HTMLCanvasElement;
  readonly town: GrowthTown;
  readonly hour: number;
  readonly onProgress: (text: string, fraction: number) => void;
  readonly signal: AbortSignal;
}

export interface GrowthStageReport {
  readonly drawCalls: number; readonly triangles: number; readonly homes: number; readonly growing: number;
  readonly lightingSettled: boolean; readonly quarterHomesLit: number; readonly heroShown: string;
}

export async function createGrowthStage(options: GrowthStageOptions) {
  const { canvas, town } = options;
  const before = town.before, after = town.after;
  const cleanups: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(value: T): T => { cleanups.push(() => value.dispose()); return value; };
  const renderer = own(new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Growth shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A growth shader could not compile');
  };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, .15, 2200);
  const atmosphere = own(createAtmosphere(scene));
  const portrait = () => canvas.clientWidth < canvas.clientHeight;
  const post = own(createPostStack(renderer, scene, camera, { quality: canvas.clientWidth < 600 ? 'low' : 'high', toneMapping: 'aces', fog: 'material' }));
  const clay = own(createVoxelMaterial(MATERIALS, 'build'));
  const groundBefore = own(createVoxelMaterial(MATERIALS, 'terrain')), groundAfter = own(createVoxelMaterial(MATERIALS, 'terrain'));
  const lightKeys = ['uLight', 'uLightOrigin', 'uLightExtent', 'uFarLight', 'uFarOrigin', 'uFarExtent', 'uFarCell', 'uBeaconLight', 'uBeaconOrigin', 'uBeaconExtent', 'uBeaconCell', 'uBeaconPosition', 'uBeaconStrength'];
  for (const ground of [groundBefore, groundAfter]) for (const key of lightKeys) ground.material.uniforms[key] = clay.material.uniforms[key]!;

  // One height grid over the grown town serves both years; only the new quarter's streets differ between them.
  const bounds = after.bounds;
  const heightOrigin: [number, number] = [Math.floor(bounds.minX) - 20, Math.floor(bounds.minZ) - 20];
  const heightWidth = Math.ceil(bounds.maxX - heightOrigin[0]) + 21, heightDepth = Math.ceil(bounds.maxZ - heightOrigin[1]) + 21;
  const heights = (plan: SettlementPlan) => {
    const data = new Float32Array(heightWidth * heightDepth);
    for (let z = 0; z < heightDepth; z++) for (let x = 0; x < heightWidth; x++) data[x + z * heightWidth] = terrainHeight(plan, heightOrigin[0] + x, heightOrigin[1] + z);
    return data;
  };
  options.onProgress('Surveying the land', .02);
  const beforeHeights = heights(before), afterHeights = heights(after);
  const lake = after.lake;
  for (const [ground, data] of [[groundBefore, beforeHeights], [groundAfter, afterHeights]] as const) {
    ground.setTerrainHeight(data, heightWidth, heightDepth, heightOrigin, 1);
    ground.setShoreLevel(lake.level, [lake.x - lake.radiusX * 1.3, lake.x + lake.radiusX * 1.3, lake.z - lake.radiusZ * 1.3, lake.z + lake.radiusZ * 1.3]);
  }
  const groundAt = (plan: SettlementPlan) => (x: number, z: number) => terrainHeight(plan, x, z);

  const sunShadows = own(createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(bounds.minX - 40, -8, bounds.minZ - 70), new THREE.Vector3(bounds.maxX + 40, 60, bounds.maxZ + 20)), resolution: 2048 }));
  sunShadows.bindReceiver(clay.material); sunShadows.bindReceiver(groundBefore.material); sunShadows.bindReceiver(groundAfter.material);
  // Pieces being raised are drawn one mesh each, cut by a material uniform: a handful at a time, one shared program.
  const growSlots: GrowSlot[] = [];
  const growSlot = (i: number): GrowSlot => {
    let slot = growSlots[i];
    if (!slot) {
      const cut = own(createGrowthMaterial(clay)); sunShadows.bindReceiver(cut.material);
      const mesh = new THREE.Mesh(undefined, cut.material); mesh.frustumCulled = false; mesh.visible = false; mesh.name = `growth@${i}`;
      scene.add(mesh); slot = { mesh, cut }; growSlots.push(slot);
    }
    return slot;
  };
  const terrainBefore = own(createGrowthMaterial(groundBefore)), terrainAfter = own(createGrowthMaterial(groundAfter));
  sunShadows.bindReceiver(terrainBefore.material); sunShadows.bindReceiver(terrainAfter.material);
  const floraMaterial = own(new THREE.ShaderMaterial({ glslVersion: clay.material.glslVersion, uniforms: clay.material.uniforms, defines: clay.material.defines,
    alphaToCoverage: clay.material.alphaToCoverage, vertexShader: clay.material.vertexShader, fragmentShader: clay.material.fragmentShader }));
  const canopy = own(createCanopyMaterial(floraMaterial));
  const pool = own(new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 256 }));
  const abort = new AbortController(); cleanups.push(() => abort.abort());
  options.signal.addEventListener('abort', () => abort.abort(), { once: true });

  // ---- The town as it stands, the homes that will grow, and the quarter still to come ----
  const hero = town.hero, dynamicPlots = [hero, ...town.neighbours];
  const dynamicIds = new Set(dynamicPlots.map(plot => plot.id));
  const standing = placeSettlementContent(before.homes.filter(home => !dynamicIds.has(home.id)), groundAt(before));
  const neighbourProps = placeSettlementContent(town.neighbours, groundAt(before)).props;
  const quarterContent = placeSettlementContent(town.quarter.homes, groundAt(after));
  // An installed home stays exactly as published; every tier an Emberfold home grows into on camera comes from the
  // street-readable growth line, the revision a live kingdom publishes when the home is witnessed growing.
  const hostFor = (plot: SettlementHome, tier: HomeTier) => {
    const host = { ...createNativeForgeHost({ ...plot, tier }), slot: plot.slot };
    const grown = plot.style === 'hearth' && plot.variant === 0 && TIERS.indexOf(tier) > TIERS.indexOf(plot.tier);
    return grown ? { ...host, blueprint: createGrowthHome('emberfold', tier) } : host;
  };
  const dynamic: DynamicHome[] = dynamicPlots.map((plot, index) => ({ plot, index, hosts: new Map(TIERS.map(tier => [tier, hostFor(plot, tier)])) }));
  const heroHome = dynamic[0]!;
  const civic: Dressing[] = [...placeMarketContent(before.market), ...createForgeSquareContent(before.market.elevation).props, ...createCastleCourtContent(before.castle, 'hearth').props];
  const castle = createCastleContent(before.castle, 'hearth');
  const heroFrame = homeFrame(hero), heroRotation = hero.rotation, heroYaw = heroRotation * Math.PI / 2;
  const heroOrigin = homeOrigin(hero, 16);
  /** A point in the hero's lot frame: x across the frontage, y up, z from the back of the reserved lot toward the street. */
  const lot = (x: number, y: number, z: number): Vec3 => transformCardinalPoint(heroOrigin, heroRotation, [x, y, z]);
  const heroGround = (x: number, z: number) => { const p = lot(x, 0, z); return terrainHeight(before, p[0], p[2]); };
  const scaffolds = new Map(TIERS.map(tier => [tier, createScaffold(heroHome.hosts.get(tier)!.blueprint, tier)]));
  const stakes = createPlotStakes(), garland = createGarland(), fence = createDressing('back-fence', 'hearth');
  const tops = new Map(TIERS.map(tier => [tier, occupied(heroHome.hosts.get(tier)!.blueprint).max[1] * CELL]));

  // ---- Windows: the standing town and the new quarter share one presence texture; growing homes light per pane ----
  const townHouses: WindowHouse[] = [...standing.houses, ...town.neighbours.map((plot, i) => dynamic[i + 1]!.hosts.get(plot.tier)!), ...quarterContent.houses];
  const townWindows = own(createWindowLights(scene, townHouses));
  const paneSlots = new Map<HomeTier, { lights: ReturnType<typeof createWindowLights>; panes: { slot: number; y: number; order: number }[] }>();
  for (const [t, tier] of TIERS.entries()) {
    const host = heroHome.hosts.get(tier)!;
    const panes = host.blueprint.windows.map((pane, i) => ({ slot: t * 32 + i, pane }));
    const lights = own(createWindowLights(scene, panes.map(({ slot, pane }) => ({ slot, position: host.position, yaw: host.yaw, blueprint: { ...host.blueprint, windows: [pane] } }))));
    // Rooms light from the hearth outward: ground floor first, then up the stairs.
    const ordered = [...panes].sort((a, b) => a.pane.centre[1] - b.pane.centre[1] || Math.abs(a.pane.centre[0] - 32) - Math.abs(b.pane.centre[0] - 32));
    paneSlots.set(tier, { lights, panes: panes.map(({ slot, pane }) => ({ slot, y: host.position[1] + pane.centre[1] * CELL, order: ordered.findIndex(o => o.slot === slot) / Math.max(1, panes.length - 1) })) });
  }
  // A neighbour who grows needs the new home's panes; its old ones go dark with the old shell.
  const neighbourWindows = new Map(dynamic.slice(1).map(home => [home.plot.id, own(createWindowLights(scene, TIERS.flatMap((tier, t) =>
    tier === home.plot.tier ? [] : [{ ...home.hosts.get(tier)!, slot: t }])))]));
  const homeLifeSites: HomeLifeSite[] = [];
  const chimneySites = (host: WindowHouse, slot: number): HomeLifeSite[] => {
    const anchors = homeLifeAnchors(host.blueprint), c = Math.cos(host.yaw), s = Math.sin(host.yaw);
    if (!anchors.chimneys.length) return [];
    return [{ slot, lantern: null, normal: [s, 0, c], mouths: anchors.chimneys.map(([x, y, z]): Vec3 => [host.position[0] + (x * c + z * s) * CELL, host.position[1] + y * CELL, host.position[2] + (-x * s + z * c) * CELL]) }];
  };
  for (const house of [...standing.houses, ...quarterContent.houses]) homeLifeSites.push(...chimneySites(house, house.slot));
  for (const home of dynamic) for (const [t, tier] of TIERS.entries()) homeLifeSites.push(...chimneySites(home.hosts.get(tier)!, DYNAMIC_SLOT + home.index * 8 + t));
  const homeLife = own(createHomeLife(scene, homeLifeSites));
  const lanterns = own(createLanternGlows(scene));
  const effects = own(createEffects({ scene, camera, seed: seedHash(`growth:${town.seed}`), quality: canvas.clientWidth < 600 ? 'balanced' : 'high' }));

  // ---- Light: the kingdom's own light fields, fed by every lit window, chimney glow and lantern ----
  const blockersFor = (shown: ReadonlyMap<string, HomeTier>, quarterOpen: boolean): WindowHouse[] => [
    ...standing.houses, ...castle.buildings,
    ...dynamic.flatMap(home => { const tier = shown.get(home.plot.id); return tier ? [home.hosts.get(tier)!] : []; }),
    ...(quarterOpen ? quarterContent.houses : []),
    ...[...standing.props, ...civic].map(p => ({ ...p, slot: 65534 })),
  ];
  let fieldsPublished = 0, fieldFailed: string | null = null;
  const fail = (error: Error) => { fieldFailed = error.message; };
  const initialShown = new Map<string, HomeTier>(town.neighbours.map(plot => [plot.id, plot.tier]));
  const near = own(createLightField(after, blockersFor(initialShown, false), volume => { clay.setLight(volume); fieldsPublished++; }, fail));
  const far = own(createLightField(after, blockersFor(initialShown, false), volume => { clay.setFarLight(volume); fieldsPublished++; }, fail,
    { mode: 'kingdom', bounds: inhabitedLightBounds(after.homes) }));
  const beaconField = own(createLightField(after, blockersFor(initialShown, false), volume => { clay.setBeaconLight(volume); fieldsPublished++; }, fail,
    { mode: 'beacon', position: castle.beaconPosition }));

  // ---- Land, water, woods and cover ----
  const horizon = createHorizonSurface(after, { farStep: 20, distantRelief: false, sampleTerrain: groundAt(after) });
  cleanups.push(() => horizon.geometry.dispose());
  const horizonMaterial = own(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: groundAfter.material.uniforms, fragmentShader: groundAfter.material.fragmentShader,
    vertexShader: 'out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}' }));
  const horizonMesh = new THREE.Mesh(horizon.geometry, horizonMaterial); scene.add(horizonMesh);
  sunShadows.bindReceiver(horizonMaterial);
  const water = own(createWaterSurface({ bodies: [{ ...lake, id: 'lake', radiusX: lake.radiusX * 1.3, radiusZ: lake.radiusZ * 1.3, depth: Math.max(0, lake.level + 2.8) }],
    reaches: [], ground: { data: afterHeights, width: heightWidth, height: heightDepth, origin: heightOrigin, step: 1 }, quality: canvas.clientWidth < 600 ? 'reduced' : 'full' }));
  scene.add(water.root);
  const allContent = [...standing.houses, ...standing.props, ...neighbourProps, ...civic, ...castle.buildings,
    ...dynamic.map(home => home.hosts.get('hall')!), ...quarterContent.houses, ...quarterContent.props];
  const waterKeepOut = (x: number, z: number, margin: number) => Math.hypot((x - lake.x) / (lake.radiusX + margin), (z - lake.z) / (lake.radiusZ + margin)) < 1.19;
  // The new quarter's lots and streets are already reserved: no meadow cover grows where they will open.
  const keepOut = town.quarter.homes.map(home => [[home.lot.minX - 1, home.lot.minZ - 1], [home.lot.maxX + 1, home.lot.minZ - 1], [home.lot.maxX + 1, home.lot.maxZ + 1], [home.lot.minX - 1, home.lot.maxZ + 1]] as [number, number][]);
  const keepClear = [{ x: 0, z: 8, radius: 7 }, ...town.quarter.streets.flatMap(edge => edge.points.filter((_, i) => i % 2 === 0).map(p => ({ x: p[0], z: p[2], radius: edge.width / 2 + 1.5 })))];
  const coverInput = { ground: horizon.sampleHeight, waterKeepOut, occupied: allContent, keepClear, keepOut };
  const coverPlan = planAdoptedCover(before, coverInput);
  const dressing = own(createGroundDressing({ ...coverInput, land: { plan: before, sites: [], places: { court: { boundary: before.castle.court.boundary } } },
    seed: before.config.seed, tier: before.config.tier, plan: coverPlan, scene, camera, pool, clay, signal: abort.signal, registerShadow: mesh => sunShadows.register(mesh) }));
  const sites: TreeSite[] = [], planted: THREE.Vector2[] = [];
  const crown = 4.25, castleBounds = after.castle.bounds;
  const rootHeight = (x: number, z: number) => { let h = Infinity; for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) h = Math.min(h, horizon.sampleHeight(x + dx, z + dz)); return h; };
  const plant = (id: string, zone: 'court' | 'grove', x: number, z: number) => {
    if (after.reservations.some(({ lot: l }) => x > l.minX - crown && x < l.maxX + crown && z > l.minZ - crown && z < l.maxZ + crown)) return;
    if ((samplePublicGround(after, x, z)?.reservedDistance ?? Infinity) < crown) return;
    if (x > castleBounds.minX - crown && x < castleBounds.maxX + crown && z > castleBounds.minZ - crown && z < castleBounds.maxZ + crown) return;
    const lakeDistance = Math.hypot((x - lake.x) / lake.radiusX, (z - lake.z) / lake.radiusZ);
    if (lakeDistance < 1.19 || planted.some(p => p.distanceToSquared(new THREE.Vector2(x, z)) < 8)) return;
    planted.push(new THREE.Vector2(x, z));
    sites.push({ id, zone: lakeDistance < 1.55 ? 'water' : zone, position: [x, rootHeight(x, z), z], yaw: randomUnit(seedHash(`${town.seed}:tree-yaw:${id}`)) * Math.PI * 2, style: 'hearth', seed: town.seed, room: 6 });
  };
  for (const court of before.courts) {
    if (!before.homes.some(home => home.courtId === court.id)) continue;
    const anchor = before.nodes.find(node => node.id === court.nodeId)!;
    for (let side = 0; side < 8; side++) plant(`court:${court.id}:${side}`, 'court', anchor.position[0] + Math.cos(side * Math.PI / 4) * 10, anchor.position[2] + Math.sin(side * Math.PI / 4) * 10);
  }
  for (let i = 0; i < 260 * 12 && planted.length < 260; i++) {
    const group = Math.floor(i / 7), rand = (part: string) => randomUnit(seedHash(`${town.seed}:grove:${part}`));
    const cx = bounds.minX - 35 + rand(`${group}:x`) * (bounds.maxX - bounds.minX + 70), cz = bounds.minZ - 65 + rand(`${group}:z`) * (bounds.maxZ - bounds.minZ + 45);
    const angle = rand(`${i}:angle`) * Math.PI * 2, radius = Math.sqrt(rand(`${i}:radius`)) * 10;
    plant(`grove:${i}`, 'grove', cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius);
  }
  // The new quarter's green: a ring of young trees planted as its streets open.
  const greenSites: TreeSite[] = [];
  for (let side = 0; side < 6; side++) {
    const a = side * Math.PI / 3 + .4, x = town.quarter.root[0] + Math.cos(a) * 7.5, z = town.quarter.root[2] + Math.sin(a) * 7.5;
    if (after.reservations.some(({ lot: l }) => x > l.minX - 2 && x < l.maxX + 2 && z > l.minZ - 2 && z < l.maxZ + 2)) continue;
    if ((samplePublicGround(after, x, z)?.reservedDistance ?? Infinity) < 2.2) continue;
    greenSites.push({ id: `green:${town.quarter.year}:${side}`, zone: 'court', position: [x, rootHeight(x, z), z], yaw: side * 1.3, style: 'hearth', seed: town.seed, room: 3.5 });
  }
  const treeBatches = groveBatches(plantGrove(sites)), greenBatches = groveBatches(plantGrove(greenSites));

  // ---- Batches ----
  let dirtyShadows = true, shadowKey = '', blockerKey = '';
  const batches = new Map<string, Batch>();
  // Batches are keyed by blueprint id, and equal ids may arrive as separate objects: count by id.
  const capacity = new Map<string, number>(), blueprints = new Map<string, VoxelBlueprint>();
  const count = (blueprint: VoxelBlueprint, n = 1) => { capacity.set(blueprint.id, (capacity.get(blueprint.id) ?? 0) + n); if (!blueprints.has(blueprint.id)) blueprints.set(blueprint.id, blueprint); };
  for (const item of [...standing.houses, ...standing.props, ...neighbourProps, ...civic, ...castle.buildings, ...quarterContent.houses, ...quarterContent.props]) count(item.blueprint);
  for (const home of dynamic) for (const host of home.hosts.values()) count(host.blueprint, 2);
  for (const blueprint of [...scaffolds.values(), stakes, garland, fence]) count(blueprint, 2);
  const flora = new Map<VoxelBlueprint, { canopy: ReturnType<typeof groveBatches>[number]['canopy']; placements: Placement[] }>();
  for (const batch of [...treeBatches, ...greenBatches]) {
    const entry = flora.get(batch.blueprint) ?? { canopy: batch.canopy, placements: [] };
    entry.placements.push(...batch.placements.map(p => ({ key: p.id, blueprint: batch.blueprint, position: p.position, yaw: p.yaw })));
    flora.set(batch.blueprint, entry);
  }
  for (const [blueprint, entry] of flora) count(blueprint, entry.placements.length);
  const geometries: THREE.BufferGeometry[] = [];
  cleanups.push(() => geometries.forEach(g => g.dispose()));
  const floraIds = new Set([...flora.keys()].map(blueprint => blueprint.id));
  const greenKeys = new Set(greenBatches.flatMap(batch => batch.placements.map(p => p.id)));

  function install(blueprint: VoxelBlueprint, chunks: readonly AssetChunkMesh[], level: DetailLevel) {
    const n = capacity.get(blueprint.id) ?? 1;
    const geometry = geometryFromChunks(chunks, 'build'); geometries.push(geometry);
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(n * 2).fill(1), 1));
    const tree = [...flora].find(([b]) => b.id === blueprint.id)?.[1];
    if (tree) attachCanopy(geometry, tree.canopy, [blueprint.size[0] / 2, 0, blueprint.size[2] / 2]);
    const material = tree ? canopy.material : blueprint.kind === 'flora' ? floraMaterial : clay.material;
    const mesh = new THREE.InstancedMesh(geometry, material, n * 2);
    mesh.count = 0; mesh.frustumCulled = false; mesh.name = `${blueprint.id}@${level}`; scene.add(mesh);
    const batch: Batch = batches.get(blueprint.id) ?? { blueprint, levels: new Map(), capacity: n };
    batch.levels.set(level, mesh); batches.set(blueprint.id, batch);
    dirtyShadows = true;
  }

  // ---- Load everything in workers, coarse levels first ----
  const jobs = ([4, 2, 1] as const).flatMap(level => [...blueprints.values()].map(blueprint => ({ level, blueprint })));
  let next = 0, done = 0;
  const total = jobs.length + 2;
  const tasks: Promise<unknown>[] = Array.from({ length: Math.min(8, jobs.length) }, async () => {
    while (next < jobs.length) {
      const { level, blueprint } = jobs[next++]!;
      const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, ...(level === 1 ? {} : { lodFactor: level }) });
      if (abort.signal.aborted) return;
      if (result?.kind !== 'asset') throw new Error(`The voxel workers could not build ${blueprint.id}.`);
      install(blueprint, result.chunks, level);
      options.onProgress(level === 1 ? 'Raising the homes' : 'Laying out the streets', ++done / total);
    }
  });
  const terrainMeshes: { before: THREE.Mesh[]; after: THREE.Mesh[] } = { before: [], after: [] };
  for (const [plan, key, material] of [[before, 'before', terrainBefore], [after, 'after', terrainAfter]] as const) {
    tasks.push(loadTerrain(plan, () => {}, { signal: abort.signal }).then(({ chunks, origin }) => {
      for (const tile of terrainBatches(chunks)) {
        const geometry = geometryFromChunks(tile, 'terrain'); geometries.push(geometry);
        geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING); geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
        const mesh = new THREE.Mesh(geometry, material.material); mesh.position.set(...origin); scene.add(mesh); terrainMeshes[key].push(mesh);
        if (key === 'before') cleanups.push(sunShadows.register(mesh));
      }
      options.onProgress('Shaping the land', ++done / total);
    }));
  }
  tasks.push(dressing.ready);
  await Promise.all(tasks);
  if (abort.signal.aborted) throw new DOMException('The growth stage closed while loading.', 'AbortError');

  // ---- Placement per frame ----
  const transitions = new Map<string, DetailTransition>();
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), centre = new THREE.Vector3(), scale = new THREE.Vector3();
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();

  function draw(placements: readonly Placement[], seeking: boolean, now: number) {
    for (const batch of batches.values()) for (const mesh of batch.levels.values()) mesh.count = 0;
    let slots = 0;
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
    const near = portrait() ? 22 : 34, mid = portrait() ? 60 : 105;
    for (const p of placements) {
      const batch = batches.get(p.blueprint.id); if (!batch) continue;
      rotation.setFromAxisAngle(up, p.yaw);
      // Trees have no cut draw: a sapling on the new green grows up from its roots instead.
      const tree = floraIds.has(p.blueprint.id);
      const sprout = p.grow && tree ? Math.max(0, Math.min(1, (p.grow[1] - p.position[1]) / 12)) : 1;
      if (sprout <= .01) continue;
      const full = batch.levels.get(1);
      if (p.grow && !tree && full) {
        const slot = growSlot(slots++);
        slot.mesh.geometry = full.geometry; slot.mesh.position.set(...p.position); slot.mesh.quaternion.copy(rotation); slot.mesh.visible = true;
        slot.cut.setCut(p.grow[0], p.grow[1]); slot.cut.setGlow(p.glow ?? 0);
        continue;
      }
      const size = new THREE.Vector3(...p.blueprint.size).multiplyScalar(CELL), radius = size.length() / 2;
      centre.copy(size).multiplyScalar(.5).applyAxisAngle(up, p.yaw).add(new THREE.Vector3(...p.position));
      if (!frustum.intersectsSphere(new THREE.Sphere(centre, radius + 2))) continue;
      const distance = Math.max(0, camera.position.distanceTo(centre) - radius);
      const wanted: DetailLevel = distance < near ? 1 : distance < mid ? 2 : 4;
      const available = ([wanted, 4, 2, 1] as const).find(level => batch.levels.has(level))!;
      const state = advanceDetailTransition(transitions.get(p.key), available, now, seeking);
      transitions.set(p.key, state);
      const add = (level: DetailLevel, fade: number) => {
        const mesh = batch.levels.get(level); if (!mesh) return;
        const i = mesh.count++;
        mesh.setMatrixAt(i, matrix.compose(centre.set(...p.position), rotation, scale.setScalar(level * sprout)));
        (mesh.geometry.getAttribute('aLodFade') as THREE.InstancedBufferAttribute).setX(i, fade);
      };
      add(state.to, state.active ? state.progress : 1);
      if (state.active) add(state.from, -1 - state.progress);
    }
    for (const batch of batches.values())
      for (const mesh of batch.levels.values()) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; (mesh.geometry.getAttribute('aLodFade') as THREE.InstancedBufferAttribute).needsUpdate = true; }
    for (let i = slots; i < growSlots.length; i++) growSlots[i]!.mesh.visible = false;
  }

  /** The static map: homes standing still cast shadows; anything mid-growth stays out until it settles. */
  function refreshShadows(placements: readonly Placement[]) {
    const still = placements.filter(p => !p.grow && p.blueprint.kind !== 'flora');
    const key = still.map(p => `${p.blueprint.id}@${p.position.join(',')}`).join('|');
    if (key === shadowKey && !dirtyShadows) return;
    shadowKey = key; dirtyShadows = false;
    const byBlueprint = new Map<string, Placement[]>();
    for (const p of [...still, ...placements.filter(p => p.blueprint.kind === 'flora')]) { const list = byBlueprint.get(p.blueprint.id) ?? []; list.push(p); byBlueprint.set(p.blueprint.id, list); }
    for (const batch of batches.values()) {
      const list = byBlueprint.get(batch.blueprint.id) ?? [];
      const level: DetailLevel = batch.blueprint.kind === 'flora' ? 2 : 1;
      const source = batch.levels.get(level);
      const signature = list.map(p => p.position.join(',')).join('|');
      if (batch.shadow?.key === signature) continue;
      batch.shadow?.release();
      batch.shadow = undefined;
      if (!source || !list.length) continue;
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, list.length);
      list.forEach((p, i) => mesh.setMatrixAt(i, matrix.compose(centre.set(...p.position), rotation.setFromAxisAngle(up, p.yaw), scale.setScalar(level))));
      mesh.visible = false;
      batch.shadow = { mesh, release: sunShadows.register(mesh), key: signature };
    }
    sunShadows.invalidate();
  }

  // ---- Camera ----
  const heroCentre = lot(4, 0, 8), heroBase = hero.position[1];
  const toQuarter = new THREE.Vector3(town.quarter.centre[0] - heroCentre[0], 0, town.quarter.centre[2] - heroCentre[2]).normalize();
  const across = new THREE.Vector3(-toQuarter.z, 0, toQuarter.x);
  const outward = new THREE.Vector3(heroFrame.outward[0], 0, heroFrame.outward[2]), right = new THREE.Vector3(heroFrame.right[0], 0, heroFrame.right[2]);
  // The lot is watched from its open side, so a neighbour's gable never fills half the picture; the score's side only
  // varies how far round the camera swings.
  const openSide = before.homes.filter(home => home.id !== hero.id).reduce((sum, home) => {
    const dx = home.position[0] - heroCentre[0], dz = home.position[2] - heroCentre[2], d = Math.hypot(dx, dz);
    return d < 40 ? sum - Math.sign(dx * right.x + dz * right.z) / Math.max(8, d) : sum;
  }, 0) >= 0 ? 1 : -1;
  interface Pose { eye: THREE.Vector3; target: THREE.Vector3; fov: number; focus: number | null }
  const height = (stage: GrowthHomeStage) => stage === 'tent' ? 3 : tops.get(stage)!;
  function pose(shot: Shot, local: number): Pose {
    const tall = portrait();
    if (shot.kind === 'lot') {
      const h = height(shot.stage), distance = Math.max(17, h * 1.55 + 10) * (tall ? 1.45 : 1);
      const azimuth = openSide * ((shot.side > 0 ? .78 : .46) + shot.drift * local * .012), elevation = .33 + h * .006;
      const target = new THREE.Vector3(...lot(4, 0, 16 - HOME_DEPTH_METRES.house / 2)).setY(heroBase + h * .42);
      const direction = outward.clone().multiplyScalar(Math.cos(azimuth)).addScaledVector(right, Math.sin(azimuth)).multiplyScalar(Math.cos(elevation)).setY(Math.sin(elevation));
      return { eye: target.clone().addScaledVector(direction, distance), target, fov: tall ? 54 : 40, focus: distance };
    }
    if (shot.kind === 'wide') {
      const target = new THREE.Vector3(...heroCentre).addScaledVector(toQuarter, 34).setY(heroBase + 2);
      const eye = new THREE.Vector3(...heroCentre).addScaledVector(toQuarter, -46).addScaledVector(across, 26 + shot.drift * local * .6).setY(heroBase + 30 + shot.drift * local * .4);
      return { eye, target, fov: tall ? 62 : 46, focus: null };
    }
    const target = new THREE.Vector3(...town.quarter.centre).lerp(new THREE.Vector3(...heroCentre), .3).setY(town.quarter.root[1] + 1);
    const reach = Math.max(70, town.quarter.reach * .85);
    const eye = new THREE.Vector3(...heroCentre).addScaledVector(toQuarter, -reach * .55).addScaledVector(across, reach * .35 - local * .5).setY(heroBase + reach * .62 + local * .3);
    return { eye, target, fov: tall ? 64 : 48, focus: null };
  }
  function blendPose(a: Pose, b: Pose, t: number): Pose {
    // Around the lot, swing on a circle about the home rather than cutting through it.
    const target = a.target.clone().lerp(b.target, t);
    const da = a.eye.clone().sub(a.target), db = b.eye.clone().sub(b.target);
    const ra = da.length(), rb = db.length();
    const dir = da.normalize().lerp(db.normalize(), t);
    if (dir.lengthSq() < 1e-4) dir.copy(db.normalize()); else dir.normalize();
    return { target, eye: target.clone().addScaledVector(dir, ra + (rb - ra) * t), fov: a.fov + (b.fov - a.fov) * t,
      focus: a.focus !== null && b.focus !== null ? a.focus + (b.focus - a.focus) * t : t < .5 ? a.focus : b.focus };
  }

  // ---- Per-frame composition from the score ----
  const presence = (windows: { slot: number; present: boolean; since: number }[], asOf: number): KingdomPresenceFrame => ({
    version: 1, kingdomId: '41960001' as KingdomPresenceFrame['kingdomId'], epoch: 'growth-simulated', sequence: 1, asOf, origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: windows.map(w => ({ slot: w.slot, present: w.present, publicName: null, since: Math.min(w.since, asOf) })) });
  const hash = (s: string) => randomUnit(seedHash(s));
  // Most of an established town is home in the evening; a few windows stay dark.
  const townPresence = townHouses.filter(house => !town.quarter.homes.some(h => h.slot === house.slot)).map(house => ({ slot: house.slot, present: hash(`${town.seed}:home:${house.slot}`) < .82, since: SEQUENCE_EPOCH - 3_600_000 }));
  const quarterOrder = new Map(town.quarter.homes.map(home => [home.slot, Math.min(1, Math.hypot(home.position[0] - town.quarter.root[0], home.position[2] - town.quarter.root[2]) / Math.max(1, town.quarter.reach))]));
  const quarterTiming = (slot: number) => {
    const order = quarterOrder.get(slot) ?? 1, jitter = hash(`${town.seed}:quarter:${slot}`);
    const rise = QUARTER_PHASES.homes[0] + order * (QUARTER_PHASES.homes[1] - QUARTER_PHASES.homes[0] - QUARTER_PHASES.rise) + jitter * .5;
    return { rise, lit: rise + QUARTER_PHASES.rise + QUARTER_PHASES.lights * (.4 + jitter), present: jitter < .9 };
  };
  let time = 0, lastField = -Infinity, sparks: SparkBurst[] = [];
  // Every pane starts shown; the first frame hides whatever is not standing.
  const hiddenPanes = new Set<number | string>();
  const fog = new THREE.FogExp2(0x000000); scene.fog = fog;
  let report: GrowthStageReport = { drawCalls: 0, triangles: 0, homes: 0, growing: 0, lightingSettled: false, quarterHomesLit: 0, heroShown: 'tent' };

  function frame(sample: ScoreSample, dt: number, seeking: boolean) {
    time = sample.t;
    const atMs = SEQUENCE_EPOCH + sample.t * 1000, now = performance.now();
    const grade = getEnvironment(options.hour);
    for (const state of [clay, groundBefore, groundAfter]) state.setEnvironment(grade);
    const hero = sample.hero, growth = hero.growth;
    const placements: Placement[] = [];
    const place = (key: string, blueprint: VoxelBlueprint, position: Vec3, yaw: number, grow?: readonly [number, number], glow?: number) =>
      placements.push({ key, blueprint, position, yaw, ...(grow ? { grow } : {}), ...(grow && glow ? { glow } : {}) });
    for (const item of [...standing.houses, ...standing.props, ...neighbourProps, ...civic, ...castle.buildings]) place(`${item.blueprint.id}@${item.position.join(',')}`, item.blueprint, item.position, item.yaw);
    for (const [blueprint, entry] of flora) for (const p of entry.placements) if (!greenKeys.has(p.key) || sample.quarter.green > 0) place(p.key, blueprint, p.position, p.yaw, greenKeys.has(p.key) && sample.quarter.green < 1 ? [-1e6, p.position[1] + smooth(sample.quarter.green) * 12] : undefined);

    // The growing home: the old shell above the building line, the new one below it, then a short settle.
    const shown = new Map<string, HomeTier>();
    const heroHosts = heroHome.hosts;
    let buildY = -Infinity;
    if (growth) {
      const from = growth.from === 'tent' ? null : heroHosts.get(growth.from)!, to = heroHosts.get(growth.to)!;
      // The storey settles: a breath of weight coming onto the new frame as the last course goes on.
      const top = tops.get(growth.to)!, settle = growth.settle, drop = settle > 0 && settle < 1 ? -.05 * Math.sin(settle * Math.PI) : 0;
      buildY = heroBase - .05 + (top + .3) * smooth(growth.build);
      const glow = growth.build > 0 && growth.build < 1 ? 1 : Math.max(0, 1 - growth.settle * 1.6);
      if (growth.build < 1) {
        if (from) place('hero:from', from.blueprint, from.position, from.yaw, [buildY, 1e6]);
        if (growth.build > 0) place('hero:to', to.blueprint, to.position, to.yaw, [-1e6, buildY], glow);
      } else place('hero:to', to.blueprint, [to.position[0], to.position[1] + drop, to.position[2]], to.yaw, glow > 0 ? [-1e6, 1e6] : undefined, glow);
      if (growth.build >= 1) shown.set(heroHome.plot.id, growth.to);
      else if (growth.from !== 'tent') shown.set(heroHome.plot.id, growth.from);
    } else if (hero.shown !== 'tent') {
      const host = heroHosts.get(hero.shown)!;
      place('hero:shown', host.blueprint, host.position, host.yaw); shown.set(heroHome.plot.id, hero.shown);
    }
    // Plot stakes until the first walls rise; they come up as the hut goes up.
    const stakesGone = hero.shown !== 'tent' ? 1 : growth?.from === 'tent' ? smooth(growth.build * 1.5) : 0;
    if (stakesGone < 1) place('hero:stakes', stakes, heroOrigin, heroYaw, stakesGone > 0 ? [-1e6, heroBase + 1.5 * (1 - stakesGone)] : undefined);
    // Scaffolding climbs ahead of the walls, carries the builder's lantern, and is struck once the storey settles.
    let scaffoldLight: LanternGlow | null = null;
    if (growth && growth.scaffold > 0 && growth.strike < 1) {
      const scaffold = scaffolds.get(growth.to)!, at = lot(...SCAFFOLD_OFFSET);
      const climb = smooth(growth.scaffold), strike = smooth(growth.strike);
      const topY = heroBase + scaffold.size[1] * CELL * climb - .02, sink = strike * scaffold.size[1] * CELL;
      place('hero:scaffold', scaffold, [at[0], at[1] - sink, at[2]], heroYaw, [-1e6, topY - sink]);
      const hook = scaffoldLantern(heroHosts.get(growth.to)!.blueprint);
      const local: Vec3 = [SCAFFOLD_OFFSET[0] + hook[0] * CELL, hook[1] * CELL - sink - .25, SCAFFOLD_OFFSET[2] + hook[2] * CELL];
      const p = lot(...local);
      if (climb > .95) scaffoldLight = { position: [p[0], heroBase + local[1], p[2]], strength: (1 - strike) * smooth((growth.scaffold - .95) * 20) };
    }
    // The back fence stands where the home has grown to; it walks back as the lot fills, and comes down at the hall.
    const depthOf = (stage: GrowthHomeStage) => stage === 'tent' ? HOME_DEPTH_METRES.hut : HOME_DEPTH_METRES[stage];
    const fenceFrom = depthOf(growth?.from ?? hero.shown), fenceTo = depthOf(growth?.to ?? hero.shown);
    const fenceDepth = fenceFrom + (fenceTo - fenceFrom) * smooth(growth?.fence ?? 1);
    const fenceLower = fenceTo >= 16 ? smooth(growth?.fence ?? 1) : 0;
    if (fenceLower < 1 && fenceDepth < 16 + .01) {
      const z = 16 - Math.min(15.6, fenceDepth) - .5 - fence.size[2] * CELL, at = lot(0, 0, z);
      const lift = growth && growth.fence > 0 && growth.fence < 1 ? Math.sin(growth.fence * Math.PI) * .35 : 0;
      place('hero:fence', fence, [at[0], heroGround(4, z + .2) + lift - fenceLower * 1.2, at[2]], heroYaw, fenceLower > 0 ? [-1e6, heroGround(4, z) + 1.2 * (1 - fenceLower)] : undefined);
    }
    // The housewarming garland across the lot's front corners.
    const garlandLights: LanternGlow[] = [];
    if (hero.garland > 0) {
      const z = 16.18, at = lot(-.0625, 0, z), y = heroGround(4, 16.4);
      const rise = hero.garland < 1 ? (1 - smooth(hero.garland)) * 3.4 : 0;
      place('hero:garland', garland, [at[0], y, at[2]], heroYaw, hero.garland < 1 ? [-1e6, y + 3.4 - rise] : undefined);
      for (let i = 0; i < GARLAND_LANTERNS; i++) {
        const [gx, gy, gz] = garlandPoint(i), p = lot(-.0625 + gx + .125, 0, z + gz + .3);
        const on = smooth((hero.garlandLit * (GARLAND_LANTERNS + 2) - i) / 2);
        if (on > 0 && gy + y < y + 3.4 - rise) garlandLights.push({ position: [p[0], y + gy, p[2]], strength: on * .85 });
      }
    }

    // Neighbours who earned growth: a quick settle from their old shell into the new one.
    for (const home of dynamic.slice(1)) {
      const change = sample.neighbours.find(n => n.plotId === home.plot.id);
      const fromTier = home.plot.tier;
      if (!change || change.build <= 0) { const host = home.hosts.get(fromTier)!; place(`n:${home.plot.id}`, host.blueprint, host.position, host.yaw); shown.set(home.plot.id, fromTier); continue; }
      const to = home.hosts.get(change.to)!, from = home.hosts.get(change.from === 'tent' ? fromTier : change.from)!;
      if (change.build >= 1) { place(`n:${home.plot.id}`, to.blueprint, to.position, to.yaw); shown.set(home.plot.id, change.to); continue; }
      const line = home.plot.position[1] + (tops.get(change.to)! + .3) * smooth(change.build);
      place(`n:${home.plot.id}:from`, from.blueprint, from.position, from.yaw, [line, 1e6]);
      place(`n:${home.plot.id}:to`, to.blueprint, to.position, to.yaw, [-1e6, line], 1);
    }

    // The new quarter: streets spread from its green, homes rise in a wave outward, then their windows come on.
    const q = sample.quarter;
    const ring = q.open ? q.streets * (town.quarter.reach + 24) : 0;
    terrainBefore.setRing(town.quarter.root[0], town.quarter.root[2], ring, ring > 0 ? -1 : 0);
    terrainAfter.setRing(town.quarter.root[0], town.quarter.root[2], ring, 1);
    for (const mesh of terrainMeshes.after) mesh.visible = ring > 0;
    const quarterWindows: { slot: number; present: boolean; since: number }[] = [];
    let quarterLit = 0, quarterStanding = 0;
    const quarterHouse = new Map(quarterContent.houses.map(house => [house.slot, house]));
    for (const home of town.quarter.homes) {
      const timing = quarterTiming(home.slot), house = quarterHouse.get(home.slot)!;
      const rise = q.open ? span(q.local, [timing.rise, timing.rise + QUARTER_PHASES.rise]) : 0;
      if (rise <= 0) { quarterWindows.push({ slot: home.slot, present: false, since: atMs }); continue; }
      const top = occupied(house.blueprint).max[1] * CELL;
      place(`q:${home.id}`, house.blueprint, house.position, house.yaw, rise < 1 ? [-1e6, house.position[1] - .05 + (top + .3) * smooth(rise)] : undefined, .8);
      if (rise >= 1) quarterStanding++;
      const lit = timing.present && q.local >= timing.lit;
      if (lit) quarterLit++;
      quarterWindows.push({ slot: home.slot, present: lit, since: SEQUENCE_EPOCH + (sample.t - q.local + timing.lit) * 1000 });
    }
    for (const prop of quarterContent.props) {
      const owner = town.quarter.homes.find(home => Math.hypot(home.position[0] - prop.position[0], home.position[2] - prop.position[2]) < 14);
      const timing = owner ? quarterTiming(owner.slot) : null;
      if (!q.open || !timing || q.local < timing.rise + QUARTER_PHASES.rise * .7) continue;
      place(`qp:${prop.blueprint.id}@${prop.position.join(',')}`, prop.blueprint, prop.position, prop.yaw);
    }

    // Camera, from the score's shots.
    const a = pose(sample.camera.from, sample.camera.fromLocal), b = pose(sample.camera.to, sample.camera.local);
    const view = sample.camera.blend >= 1 ? b : blendPose(a, b, sample.camera.blend);
    camera.position.copy(view.eye); camera.lookAt(view.target);
    if (Math.abs(camera.fov - view.fov) > .001) { camera.fov = view.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();

    draw(placements, seeking, now);
    refreshShadows(placements);
    const blockers = blockersFor(shown, quarterStanding > 0);
    const nextBlockers = blockers.map(b => `${b.blueprint.id}@${b.position.join(',')}`).join('|');
    if (nextBlockers !== blockerKey) { blockerKey = nextBlockers; near.replaceHouses(blockers); far.replaceHouses(blockers); beaconField.replaceHouses(blockers); lastField = -Infinity; }

    // Window light: deterministic from the score's clock, so a seek and a playthrough agree.
    // Panes belong to walls: a home not yet risen shows none.
    for (const home of town.quarter.homes) {
      const standing = quarterWindows.find(w => w.slot === home.slot) !== undefined && placements.some(p => p.key === `q:${home.id}` && (!p.grow || p.grow[1] > home.position[1] + 2.2));
      if (hiddenPanes.has(home.slot) === standing) { townWindows.setHidden(home.slot, !standing); if (standing) hiddenPanes.delete(home.slot); else hiddenPanes.add(home.slot); }
    }
    for (const home of dynamic.slice(1)) {
      const change = sample.neighbours.find(n => n.plotId === home.plot.id), lights = neighbourWindows.get(home.plot.id)!;
      const oldStanding = !change || change.build < .15;
      if (hiddenPanes.has(home.plot.slot) === oldStanding) { townWindows.setHidden(home.plot.slot, !oldStanding); if (oldStanding) hiddenPanes.delete(home.plot.slot); else hiddenPanes.add(home.plot.slot); }
      const grown = change && change.build >= 1 ? TIERS.indexOf(change.to) : -1;
      for (const [t, tier] of TIERS.entries()) {
        if (tier === home.plot.tier) continue;
        const key = `n:${home.plot.id}:${t}`, visible = t === grown;
        if (hiddenPanes.has(key) === visible) { lights.setHidden(t, !visible); if (visible) hiddenPanes.delete(key); else hiddenPanes.add(key); }
      }
      // The family was home all along: the new rooms are lit the moment their walls close.
      const settled = SEQUENCE_EPOCH - 600_000;
      lights.clear();
      lights.setFrame(presence(TIERS.flatMap((tier, t) => tier === home.plot.tier ? [] : [{ slot: t, present: t === grown, since: settled }]), atMs));
      lights.update(0, options.hour, atMs);
    }
    townWindows.clear();
    townWindows.setFrame(presence([...townPresence, ...quarterWindows], atMs));
    townWindows.update(0, options.hour, atMs);
    const heroSources: { position: Vec3; strength: number; normal?: Vec3 }[] = [];
    for (const [tier, entry] of paneSlots) {
      const fromTier = growth ? growth.from : hero.shown, toTier = growth ? growth.to : hero.shown;
      for (const pane of entry.panes) {
        const visible = growth
          ? tier === growth.to && pane.y < buildY - .3 || tier === growth.from && pane.y > buildY + .3
          : tier === hero.shown;
        const key = `hero:${pane.slot}`;
        if (hiddenPanes.has(key) === visible) { entry.lights.setHidden(pane.slot, !visible); if (visible) hiddenPanes.delete(key); else hiddenPanes.add(key); }
      }
      const windows = entry.panes.map(pane => {
        if (tier === toTier && growth) {
          const on = growth.hearth > pane.order * .75 + .05;
          return { slot: pane.slot, present: on, since: SEQUENCE_EPOCH + (sample.t - (growth.hearth - pane.order * .75 - .05) * 1.8) * 1000 };
        }
        if (tier === fromTier && growth) return { slot: pane.slot, present: pane.y > buildY + .4, since: SEQUENCE_EPOCH };
        return { slot: pane.slot, present: tier === hero.shown && !growth, since: SEQUENCE_EPOCH };
      });
      entry.lights.clear();
      entry.lights.setFrame(presence(windows, atMs));
      entry.lights.update(0, options.hour, atMs);
      if (tier === hero.shown || tier === growth?.to || tier === growth?.from) heroSources.push(...entry.lights.getSources().filter(s => s.strength > .02));
    }

    // Chimneys: the town's hearths breathe; a grown home's chimney catches as its windows light.
    const chimneys: { slot: number; present: boolean; since: number }[] = [...townPresence, ...quarterWindows];
    for (const home of dynamic) {
      for (const [t, tier] of TIERS.entries()) {
        const slot = DYNAMIC_SLOT + home.index * 8 + t;
        if (home === heroHome) {
          const lit = growth ? tier === growth.to && growth.hearth > 0 : tier === hero.shown;
          chimneys.push({ slot, present: lit, since: growth && tier === growth.to ? SEQUENCE_EPOCH + (sample.t - growth.hearth * 1.8) * 1000 : SEQUENCE_EPOCH - 600_000 });
        } else chimneys.push({ slot, present: shown.get(home.plot.id) === tier, since: SEQUENCE_EPOCH - 600_000 });
      }
    }
    const chimneyFrame = presence(chimneys, atMs);
    homeLife.update(atMs, sample.t, chimneyFrame, options.hour, camera);
    const heroChimney = growth ? homeLifeSites.find(site => site.slot === DYNAMIC_SLOT + TIERS.indexOf(growth.to)) : undefined;
    if (growth && growth.hearth > 0 && growth.hearth < 1 && heroChimney && !sparks.some(s => s.burstId === `hearth:${growth.to}`)) {
      sparks = [...sparks.filter(s => sample.t - s.startedAt < 3), ...heroChimney.mouths.slice(0, 1).map(m => ({ id: `chimney:${growth.to}`, burstId: `hearth:${growth.to}`, position: [m[0], m[1] + .3, m[2]] as Vec3, startedAt: sample.t - growth.hearth * 1.8 }))];
    }
    if (seeking) sparks = sparks.filter(s => s.startedAt <= sample.t && sample.t - s.startedAt < 3);
    const embers = growth && heroChimney && growth.hearth > 0 && growth.cheer < 1 ? heroChimney.mouths.slice(0, 1).map((m, i) => ({ id: `ember:${i}`, position: [m[0], m[1] + .2, m[2]] as Vec3 })) : [];
    const garden = lot(4, 0, 16 - depthOf(hero.shown) - 1.2);
    effects.update({ time: sample.t, wind: [.8, 0, .6], sparks, embers, fireflies: [{ id: 'hero-garden', position: [garden[0], heroGround(4, 16 - depthOf(hero.shown) - 1.2) + .9, garden[2]] }] });
    const lights = [...garlandLights, ...(scaffoldLight && scaffoldLight.strength > 0 ? [scaffoldLight] : [])];
    lanterns.set(lights, sample.t);

    const townSources = townWindows.getSources(), lifeSources = homeLife.sources();
    const beacon = beaconStrength(presence([...townPresence, ...quarterWindows], atMs), townHouses.length);
    clay.setBeaconSource(castle.beaconPosition, beacon);
    if (seeking || now - lastField > 220) {
      lastField = now;
      const sources = [...townSources, ...heroSources, ...lifeSources, ...lights.map(l => ({ position: l.position, strength: l.strength * .9 }))];
      const focus: Vec3 = [view.target.x, terrainHeight(after, view.target.x, view.target.z), view.target.z];
      near.update(focus, sources); far.update(focus, sources);
      beaconField.update(castle.beaconPosition, [{ position: castle.beaconPosition, strength: beacon, normal: [0, 1, 0] }]);
    }

    canopy.sync(); canopy.setWind(sample.t, [.8, .6], .8);
    atmosphere.update(options.hour, sample.t, camera, new THREE.Vector3(...castle.beaconPosition), beacon);
    fog.color.set(grade.fog); fog.density = grade.fogDensity; renderer.toneMappingExposure = grade.exposure;
    post.update({ environment: grade, hour: options.hour, focusDistance: view.focus, beacon: { position: new THREE.Vector3(...castle.beaconPosition), strength: beacon } });
    water.update({ time: sample.t, environment: grade, camera, sources: [...townSources.map(s => ({ ...s, kind: 'window' as const })), { position: castle.beaconPosition, strength: beacon, kind: 'beacon' as const }] });
    dressing.hideLot(null);
    dressing.update({ time: sample.t, walkers: [] });
    sunShadows.updateSunDirection(grade.sunDirection);
    water.reflect({ renderer, scene, camera, frame: Math.floor(sample.t * 60), exclusions: atmosphere.reflectionExclusions });
    post.render(seeking ? 1 / 60 : dt);
    const fieldsSettled = [near, far, beaconField].every(f => !f.stats.busy && !f.stats.queued && f.stats.publishedRevision === f.stats.requestedRevision);
    report = { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, homes: placements.filter(p => p.blueprint.kind === 'home').length,
      growing: placements.filter(p => p.grow).length, lightingSettled: fieldsSettled && fieldsPublished >= 3 && !fieldFailed, quarterHomesLit: quarterLit, heroShown: hero.shown };
    if (fieldFailed) throw new Error(fieldFailed);
  }

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    post.resize(canvas.clientWidth, canvas.clientHeight, renderer.getPixelRatio());
    camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight); camera.updateProjectionMatrix();
    sunShadows.setResolution(portrait() ? 1024 : 2048);
  }
  resize();
  let disposed = false;
  return {
    frame, resize,
    report: () => report,
    /** Light fields have published every request (no render needed to ask). */
    settled: () => [near, far, beaconField].every(f => !f.stats.busy && !f.stats.queued && f.stats.publishedRevision === f.stats.requestedRevision) && fieldsPublished >= 3 && !fieldFailed,
    time: () => time,
    dispose() {
      if (disposed) return; disposed = true;
      for (const batch of batches.values()) { batch.shadow?.release(); for (const mesh of batch.levels.values()) { scene.remove(mesh); mesh.dispose(); } }
      for (const slot of growSlots) scene.remove(slot.mesh);
      for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch { /* keep releasing the rest */ } }
    },
  };
}

export type GrowthStage = Awaited<ReturnType<typeof createGrowthStage>>;
