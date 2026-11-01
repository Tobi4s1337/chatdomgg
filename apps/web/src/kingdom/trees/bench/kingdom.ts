// The picture-tree kingdom bench: the production renderer pieces (terrain, horizon, clay, light fields, window presence,
// sun shadows, fog, ground dressing) around the real generated town, with trees on the scene's existing planting
// sites: `trees=core` plants today's three core trees the way the scene does (the before), `trees=picture` plants the
// grove through this lane's adapter and canopy material (the after). Land and presence are SIMULATED. Dev-served only.
import * as THREE from 'three';
import { createTree, MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWater, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { terrainHeight, type KingdomTier } from '@chatdom/world';
import { beaconStrength } from '../../beacon';
import { createCastleContent } from '../../castle-content';
import { createHorizonSurface } from '../../horizon';
import { inhabitedLightBounds } from '../../light-bounds';
import { createLightField } from '../../light-field';
import { createSimulatedPresence } from '../../presence-feed';
import { placeMarketContent, placeSettlementContent } from '../../settlement-content';
import { terrainBatches } from '../../terrain-batches';
import { loadTerrain } from '../../terrain-client';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../../terrain-worker';
import { SIMULATED_LAND, simulatedLand, simulatedWaterKeepOut } from '../../ground-dressing/fixture';
import { createGroundDressing } from '../../ground-dressing/mount';
import { planAdoptedCover } from '../../ground-dressing/adopted-cover';
import { attachCanopy, createCanopyMaterial } from '../canopy';
import { groveBatches, plantGrove } from '../plant';
import type { CanopyMotion, StyleFamily } from '@chatdom/content/trees';
import { existingTreeSites, toTreeSites } from './sites';

type BenchWindow = Window & { __chatdomReady?: boolean; __treeKingdom?: unknown };
const query = new URLSearchParams(location.search);
const seed = query.get('seed') ?? 'willowmere', tier = (query.get('tier') === 'hamlet' ? 'hamlet' : 'town') as KingdomTier;
const treesMode = query.get('trees') ?? 'picture', style = (query.get('style') ?? 'hearth') as StyleFamily;
let hour = Number(query.get('hour') ?? 19.5), time = Number(query.get('time') ?? 30);
const canvas = document.querySelector('canvas')!;
document.querySelector('[data-seal]')!.textContent = `${SIMULATED_LAND} · evening presence · trees: ${treesMode === 'picture' ? `picture grove (${style})` : treesMode}`;
const fail = (error: unknown) => { console.error('Tree kingdom bench failed', error); document.body.dataset.error = String(error); };

try {
  const land = simulatedLand({ seed, tier }), layout = land.plan;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, 0.15, 2200), atmosphere = createAtmosphere(scene);
  const fog = new THREE.FogExp2(0x000000); scene.fog = fog;
  const clay = createVoxelMaterial(MATERIALS, 'build'), ground = createVoxelMaterial(MATERIALS, 'terrain');
  for (const key of ['uLight', 'uLightOrigin', 'uLightExtent', 'uFarLight', 'uFarOrigin', 'uFarExtent', 'uFarCell', 'uBeaconLight', 'uBeaconOrigin', 'uBeaconExtent', 'uBeaconCell']) ground.material.uniforms[key] = clay.material.uniforms[key]!;
  const heightOrigin: [number, number] = [Math.floor(layout.bounds.minX) - 20, Math.floor(layout.bounds.minZ) - 20];
  const heightWidth = Math.ceil(layout.bounds.maxX - heightOrigin[0]) + 21, heightDepth = Math.ceil(layout.bounds.maxZ - heightOrigin[1]) + 21;
  const heightData = new Float32Array(heightWidth * heightDepth);
  for (let z = 0; z < heightDepth; z++) for (let x = 0; x < heightWidth; x++) heightData[x + z * heightWidth] = terrainHeight(layout, heightOrigin[0] + x, heightOrigin[1] + z);
  const corner = (x: number, z: number) => {
    const ix = x - heightOrigin[0], iz = z - heightOrigin[1];
    return Number.isInteger(ix) && Number.isInteger(iz) && ix >= 0 && iz >= 0 && ix < heightWidth && iz < heightDepth ? heightData[ix + iz * heightWidth]! : terrainHeight(layout, x, z);
  };
  ground.setTerrainHeight(heightData, heightWidth, heightDepth, heightOrigin, 1);
  const lake = layout.lake;
  ground.setShoreLevel(lake.level, [lake.x - lake.radiusX * 1.3, lake.x + lake.radiusX * 1.3, lake.z - lake.radiusZ * 1.3, lake.z + lake.radiusZ * 1.3]);
  const { geometry: horizonGeometry, sampleHeight: landHeight } = createHorizonSurface(layout, { farStep: 20, sampleTerrain: corner });
  const horizonMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: ground.material.uniforms, fragmentShader: ground.material.fragmentShader,
    vertexShader: 'out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}' });
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 2048 });

  const { houses, props } = placeSettlementContent(layout.homes, (x, z) => terrainHeight(layout, x, z));
  props.push(...placeMarketContent(layout.market));
  const { buildings: castle, beaconPosition } = createCastleContent(layout.castle);
  const content = [...houses, ...castle, ...props];
  const windows = createWindowLights(scene, houses);
  const simulation = createSimulatedPresence(layout, { firstSlot: houses[0]!.slot, waveSeconds: 6 });
  let frame: Parameters<typeof windows.setFrame>[0] | undefined;
  simulation.feed.subscribe(next => { frame = next; windows.setFrame(next); }, () => {});
  simulation.advance(30);

  const sunShadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(layout.bounds.minX - 40, -8, layout.bounds.minZ - 70), new THREE.Vector3(layout.bounds.maxX + 40, 60, layout.bounds.maxZ + 20)), resolution: 2048 });
  sunShadows.bindReceiver(clay.material); sunShadows.bindReceiver(ground.material);
  const canopy = createCanopyMaterial(clay.material);
  scene.add(new THREE.Mesh(horizonGeometry, horizonMaterial)); sunShadows.bindReceiver(horizonMaterial);
  const water = createWater(scene, { lake, terrain: { data: heightData, width: heightWidth, height: heightDepth, origin: heightOrigin, step: 1 } });

  const blockers = [...houses, ...castle], nearBlockers = [...blockers, ...props.map(p => ({ ...p, slot: 65534 }))];
  let nearBytes = 0, farBytes = 0, beaconBytes = 0;
  const field = createLightField(layout, nearBlockers, volume => { clay.setLight(volume); nearBytes = volume.estimatedPeakBytes; }, () => fail('near light field failed'));
  const farField = createLightField(layout, blockers, volume => { clay.setFarLight(volume); farBytes = volume.estimatedPeakBytes; }, () => fail('far light field failed'), { mode: 'kingdom', bounds: inhabitedLightBounds(layout.homes) });
  const beaconField = createLightField(layout, blockers, volume => { clay.setBeaconLight(volume); beaconBytes = volume.estimatedPeakBytes; }, () => fail('beacon field failed'), { mode: 'beacon', position: beaconPosition });

  const submit = async (blueprint: VoxelBlueprint, factor: 1 | 2 | 4 = 1) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, ...(factor === 1 ? {} : { lodFactor: factor }) });
    if (result?.kind !== 'asset') throw new Error(`Could not mesh ${blueprint.id}`);
    return result.chunks;
  };
  const matrixOf = (p: { position: Vec3; yaw: number }, level: number, m = new THREE.Matrix4()) => m.compose(new THREE.Vector3(...p.position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(level, level, level));
  const groups = new Map<VoxelBlueprint, { position: Vec3; yaw: number }[]>();
  for (const piece of content) { const list = groups.get(piece.blueprint); if (list) list.push(piece); else groups.set(piece.blueprint, [piece]); }
  const tasks: Promise<unknown>[] = [...groups].map(async ([blueprint, placements]) => {
    const geometry = geometryFromChunks(await submit(blueprint), 'build');
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1), 1));
    const mesh = new THREE.InstancedMesh(geometry, clay.material, placements.length);
    placements.forEach((p, i) => mesh.setMatrixAt(i, matrixOf(p, 1)));
    mesh.frustumCulled = false; scene.add(mesh); sunShadows.register(mesh);
  });
  tasks.push(loadTerrain(layout).then(({ chunks, origin }) => {
    for (const tile of terrainBatches(chunks)) {
      const geometry = geometryFromChunks(tile, 'terrain'); geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);
      geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geometry, ground.material); mesh.position.set(...origin); scene.add(mesh); sunShadows.register(mesh);
    }
  }));

  // Ground dressing as the scene mounts it: adopted cover over the real keep-outs.
  const coverInput = { ground: landHeight, waterKeepOut: simulatedWaterKeepOut(land), occupied: content, keepClear: [{ x: 0, z: 8, radius: 7 }] };
  const coverPlan = planAdoptedCover(layout, coverInput);
  const dressing = createGroundDressing({ ...coverInput, land: { plan: layout, sites: [], places: { court: { boundary: layout.castle.court.boundary } } }, seed, tier, plan: coverPlan,
    scene, camera, pool, clay, signal: new AbortController().signal, registerShadow: mesh => sunShadows.register(mesh) });
  tasks.push(dressing.ready);

  // Trees on the scene's existing sites. Each form gets one instanced mesh per detail level; a placement draws at the
  // level the scene's distance bands give it (1 within 32 m, 2 within 95 m, else 4), and one level-2 source with
  // every placement casts the sun shadow, as the scene registers flora.
  const rootHeight = (x: number, z: number) => { let h = Infinity; for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) h = Math.min(h, landHeight(x + dx, z + dz)); return h; };
  const existing = existingTreeSites(layout, seed, tier);
  type Batch = { blueprint: VoxelBlueprint; canopy?: CanopyMotion; placements: { position: Vec3; yaw: number }[]; levels: Map<1 | 2 | 4, THREE.InstancedMesh> };
  const treeBatches: Batch[] = [];
  const counts: Record<string, number> = {};
  if (treesMode === 'core') {
    const core = [createTree(0), createTree(1), createTree(2)];
    core.forEach((blueprint, variant) => treeBatches.push({ blueprint, placements: existing.filter(s => s.variant === variant).map(s => ({ position: [s.x - 4, rootHeight(s.x, s.z), s.z - 4] as Vec3, yaw: 0 })), levels: new Map() }));
    counts.core = existing.length;
  } else if (treesMode === 'picture') {
    const grown = plantGrove(toTreeSites(layout, existing, rootHeight, style, seed));
    for (const tree of grown) counts[tree.species] = (counts[tree.species] ?? 0) + 1;
    for (const batch of groveBatches(grown)) treeBatches.push({ blueprint: batch.blueprint, canopy: batch.canopy, placements: batch.placements, levels: new Map() });
  }
  for (const batch of treeBatches) tasks.push((async () => {
    const material = batch.canopy ? canopy.material : clay.material;
    for (const level of [1, 2, 4] as const) {
      const geometry = geometryFromChunks(await submit(batch.blueprint, level), 'build');
      geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(batch.placements.length).fill(1), 1));
      if (batch.canopy) attachCanopy(geometry, batch.canopy, [batch.blueprint.size[0] / 2, 0, batch.blueprint.size[2] / 2]);
      const mesh = new THREE.InstancedMesh(geometry, material, batch.placements.length);
      mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh); batch.levels.set(level, mesh);
      if (level === 2) {
        const source = new THREE.InstancedMesh(geometry, material, batch.placements.length);
        batch.placements.forEach((p, i) => source.setMatrixAt(i, matrixOf(p, 2)));
        source.name = `${batch.blueprint.id}:shadow-source`; sunShadows.register(source);
      }
    }
  })());
  const assignLevels = () => {
    const m = new THREE.Matrix4();
    for (const batch of treeBatches) {
      for (const mesh of batch.levels.values()) mesh.count = 0;
      for (const p of batch.placements) {
        const centre = new THREE.Vector3(p.position[0] + batch.blueprint.size[0] / 16, p.position[1], p.position[2] + batch.blueprint.size[2] / 16);
        const distance = centre.distanceTo(camera.position), level = distance < 32 ? 1 : distance < 95 ? 2 : 4;
        const mesh = batch.levels.get(level);
        if (mesh) mesh.setMatrixAt(mesh.count++, matrixOf(p, level, m));
      }
      for (const mesh of batch.levels.values()) mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const marketNode = layout.nodes.find(node => node.id === layout.market.nodeId)!.position;
  const hero = () => {
    const portrait = canvas.clientWidth < canvas.clientHeight;
    return { eye: [marketNode[0] + (portrait ? 150 : -110), marketNode[1] + (portrait ? 36 : 40), marketNode[2] + 160] as Vec3,
      target: [layout.castle.centre[0], layout.castle.centre[1] + 9, portrait ? -35 : marketNode[2] - 8] as Vec3, fov: portrait ? 58 : 52 };
  };
  const views = dressing.views();
  // A court ring seen from just outside it at eye height: trees in front, the homes they frame behind.
  const grove = () => {
    const courtSites = existing.filter(s => s.kind === 'court');
    if (!courtSites.length) throw new Error('No court ring trees in this layout');
    const site = courtSites.reduce((best, s) => Math.hypot(s.x - marketNode[0], s.z - marketNode[2]) < Math.hypot(best.x - marketNode[0], best.z - marketNode[2]) ? s : best);
    const court = layout.courts.find(c => site.id.startsWith(`court:${c.id}:`))!, anchor = layout.nodes.find(n => n.id === court.nodeId)!.position;
    const dx = site.x - anchor[0], dz = site.z - anchor[2], l = Math.hypot(dx, dz) || 1, ex = site.x + dx / l * 15 + dz / l * 5, ez = site.z + dz / l * 15 - dx / l * 5;
    return { eye: [ex, landHeight(ex, ez) + 4.5, ez] as Vec3, target: [anchor[0], landHeight(anchor[0], anchor[2]) + 4, anchor[2]] as Vec3, fov: canvas.clientWidth < canvas.clientHeight ? 64 : 54 };
  };
  let pose = hero();
  const choose = (name: string) => {
    if (name === 'hero') pose = hero();
    else if (name === 'grove') pose = grove();
    else if (name in views) { const view = views[name as keyof typeof views]; pose = { ...view, fov: name === 'ridge' ? 46 : 58 }; }
    else throw new Error(`Unknown view ${name}`);
  };
  choose(query.get('view') ?? 'hero');

  let loaded = false, drawn = false, lastField = -Infinity, placedFor = '';
  const stats = { ready: false, lightingReady: false, fieldSettled: false, drawCalls: 0, triangles: 0, hour, time, trees: existing.length, counts, forms: treeBatches.length, shadowCasters: 0 };
  void Promise.all(tasks).then(() => { loaded = true; }, fail);
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();
  const target = new THREE.Vector3();
  function render(now: number) {
    try {
      const grade = getEnvironment(hour); clay.setEnvironment(grade); ground.setEnvironment(grade);
      windows.update(1, hour);
      camera.position.set(...pose.eye); target.set(...pose.target);
      if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
      camera.lookAt(target); camera.updateMatrixWorld();
      const key = `${loaded}:${pose.eye.join(',')}`;
      if (loaded && key !== placedFor) { placedFor = key; assignLevels(); }
      canopy.sync(); canopy.setWind(time, [0.8, 0.6], 0.8);
      dressing.update({ time, walkers: [] });
      const beacon = beaconStrength(frame, houses.length);
      atmosphere.update(hour, time, camera, new THREE.Vector3(...beaconPosition), beacon);
      fog.color.set(grade.fog); fog.density = 0.0016;
      water.update(grade, time, camera);
      if (now - lastField > 240) {
        lastField = now;
        const centre: Vec3 = [target.x, terrainHeight(layout, target.x, target.z), target.z];
        field.update(centre, windows.getSources()); farField.update(centre, windows.getSources());
        beaconField.update(beaconPosition, [{ position: beaconPosition, strength: beacon, normal: [0, 1, 0] }]);
      }
      if (loaded) sunShadows.updateSunDirection(grade.sunDirection);
      renderer.render(scene, camera);
      Object.assign(stats, {
        ready: loaded, hour, time, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, shadowCasters: sunShadows.stats.casters,
        lightingReady: nearBytes > 0 && farBytes > 0 && beaconBytes > 0,
        fieldSettled: [field, farField, beaconField].every(f => f.stats.publishedRevision === f.stats.requestedRevision && !f.stats.busy && !f.stats.queued) && farBytes > 0 && beaconBytes > 0,
      });
      if (loaded && !drawn) { drawn = true; (window as BenchWindow).__chatdomReady = true; }
      requestAnimationFrame(render);
    } catch (error) { fail(error); }
  }
  requestAnimationFrame(render);
  (window as BenchWindow).__treeKingdom = {
    stats,
    view: (name: string) => choose(name),
    pose: (eye: Vec3, lookAt: Vec3, fov = 43) => { pose = { eye, target: lookAt, fov }; },
    hour: (value: number) => { hour = value; },
    time: (value: number) => { time = value; },
  };
} catch (error) { fail(error); }
