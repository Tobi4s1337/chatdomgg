// The ground-dressing bench: the production kingdom renderer pieces (terrain, horizon, clay, light fields, window
// presence, sun shadows, fog) around the real generated town, with this lane's plan and mount on top. The land is
// the SIMULATED fixture until kingdom-land delivers; window presence is the scene's own SIMULATED evening.
// Served by the Vite dev server only (capture.mjs); the shipped app never loads it.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWater, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { terrainHeight, type KingdomTier } from '@chatdom/world';
import { beaconStrength } from '../beacon';
import { createCastleContent } from '../castle-content';
import { createHorizonSurface } from '../horizon';
import { inhabitedLightBounds } from '../light-bounds';
import { createLightField } from '../light-field';
import { createSimulatedPresence } from '../presence-feed';
import { placeMarketContent, placeSettlementContent } from '../settlement-content';
import { terrainBatches } from '../terrain-batches';
import { loadTerrain } from '../terrain-client';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../terrain-worker';
import { SIMULATED_LAND, simulatedLand, simulatedWaterKeepOut } from './fixture';
import { createGroundDressing } from './mount';
import { arrivalHome, planGroundDressing } from './plan';

type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomKingdom?: unknown };
const query = new URLSearchParams(location.search);
const seed = query.get('seed') ?? 'willowmere', tier = (query.get('tier') === 'hamlet' ? 'hamlet' : 'town') as KingdomTier;
const dressed = query.get('dressing') !== 'off';
let hour = Number(query.get('hour') ?? 19.5);
const time = 30;

const canvas = document.querySelector('canvas')!;
const seal = document.querySelector('[data-seal]')!;
seal.textContent = `${SIMULATED_LAND} · SIMULATED evening presence · ground dressing ${dressed ? 'on' : 'off'}`;
const fail = (error: unknown) => { console.error('Ground dressing bench failed', error); document.body.dataset.error = String(error); };

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
  // The scene's exact metre corner grid: terrain shading, water and (through the horizon) every ground contact.
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
  const arrival = arrivalHome(layout);
  const simulation = createSimulatedPresence(layout, { firstSlot: arrival.slot, waveSeconds: 6 });
  let frame: Parameters<typeof windows.setFrame>[0] | undefined;
  simulation.feed.subscribe(next => { frame = next; windows.setFrame(next); }, () => {});
  simulation.advance(time);

  const sunShadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(layout.bounds.minX - 40, -8, layout.bounds.minZ - 70), new THREE.Vector3(layout.bounds.maxX + 40, 60, layout.bounds.maxZ + 20)), resolution: 2048 });
  sunShadows.bindReceiver(clay.material); sunShadows.bindReceiver(ground.material);
  scene.add(new THREE.Mesh(horizonGeometry, horizonMaterial)); sunShadows.bindReceiver(horizonMaterial);
  const water = createWater(scene, { lake, terrain: { data: heightData, width: heightWidth, height: heightDepth, origin: heightOrigin, step: 1 } });

  const blockers = [...houses, ...castle], nearBlockers = [...blockers, ...props.map(p => ({ ...p, slot: 65534 }))];
  let nearBytes = 0, farBytes = 0, beaconBytes = 0, fieldUploads = 0;
  const field = createLightField(layout, nearBlockers, volume => { clay.setLight(volume); nearBytes = volume.estimatedPeakBytes; fieldUploads++; }, () => fail('near light field failed'));
  const farField = createLightField(layout, blockers, volume => { clay.setFarLight(volume); farBytes = volume.estimatedPeakBytes; fieldUploads++; }, () => fail('far light field failed'), { mode: 'kingdom', bounds: inhabitedLightBounds(layout.homes) });
  const beaconField = createLightField(layout, blockers, volume => { clay.setBeaconLight(volume); beaconBytes = volume.estimatedPeakBytes; fieldUploads++; }, () => fail('beacon field failed'), { mode: 'beacon', position: beaconPosition });

  // Homes, castle and street furnishings at full detail, one instanced draw per blueprint, shadows registered.
  const groups = new Map<VoxelBlueprint, { position: Vec3; yaw: number }[]>();
  for (const piece of content) { const list = groups.get(piece.blueprint); if (list) list.push(piece); else groups.set(piece.blueprint, [piece]); }
  const tasks: Promise<unknown>[] = [...groups].map(async ([blueprint, placements]) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset') throw new Error(`Could not mesh ${blueprint.id}`);
    const geometry = geometryFromChunks(result.chunks, 'build');
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1), 1));
    const mesh = new THREE.InstancedMesh(geometry, clay.material, placements.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    placements.forEach((p, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...p.position), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(1, 1, 1))));
    mesh.frustumCulled = false; scene.add(mesh); sunShadows.register(mesh);
  });
  tasks.push(loadTerrain(layout).then(({ chunks, origin }) => {
    for (const tile of terrainBatches(chunks)) {
      const geometry = geometryFromChunks(tile, 'terrain'); geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);
      geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geometry, ground.material); mesh.position.set(...origin); scene.add(mesh); sunShadows.register(mesh);
    }
  }));

  const abort = new AbortController();
  const planStarted = performance.now();
  const input = { land, seed, tier, ground: landHeight, waterKeepOut: simulatedWaterKeepOut(land), occupied: content,
    keepClear: [{ x: 0, z: 8, radius: 7 }] }; // The Forge plaza around the anvil, as the scene places it.
  const plan = dressed ? planGroundDressing(input) : undefined;
  const planMs = performance.now() - planStarted;
  const dressing = plan ? createGroundDressing({ ...input, plan, scene, camera, pool, clay, registerShadow: mesh => sunShadows.register(mesh), signal: abort.signal }) : undefined;
  if (dressing) tasks.push(dressing.ready);

  // Capture poses: this lane's plan-derived views, plus the scene's own hero framing over the town.
  const marketNode = layout.nodes.find(node => node.id === layout.market.nodeId)!.position;
  const hero = () => {
    const portrait = canvas.clientWidth < canvas.clientHeight;
    return { eye: [marketNode[0] + (portrait ? 150 : -110), marketNode[1] + (portrait ? 36 : 40), marketNode[2] + 160] as Vec3,
      target: [layout.castle.centre[0], layout.castle.centre[1] + 9, portrait ? -35 : marketNode[2] - 8] as Vec3, fov: portrait ? 58 : 52 };
  };
  // The stall garden, seen from the square at standing height: the stall to one side, its beds along the bank.
  const market = () => {
    const garden = plan ? [...plan.pieces.values()].flat().filter(p => p.id.startsWith('market:stall:') && !p.id.includes(':wild:')) : [];
    if (!garden.length) throw new Error('No stall garden in this plan');
    const xs = garden.map(p => p.position[0]), zs = garden.map(p => p.position[2]);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2, z = (Math.min(...zs) + Math.max(...zs)) / 2;
    const square = layout.market.boundary, mx = square.reduce((n, p) => n + p[0], 0) / square.length - x, mz = square.reduce((n, p) => n + p[1], 0) / square.length - z;
    const length = Math.hypot(mx, mz) || 1, portrait = canvas.clientWidth < canvas.clientHeight, back = portrait ? 15 : 12;
    const ex = x + mx / length * back, ez = z + mz / length * back;
    return { eye: [ex, landHeight(ex, ez) + 2.3, ez] as Vec3, target: [x, landHeight(x, z) + 0.6, z] as Vec3, fov: portrait ? 64 : 50 };
  };
  const views = dressing?.views();
  let pose = { eye: [0, 0, 0] as Vec3, target: [0, 0, 1] as Vec3, fov: 52 };
  const choose = (name: string) => {
    if (name === 'hero') pose = hero();
    else if (name === 'market') pose = market();
    else if (views && name in views) { const view = views[name as keyof typeof views]; pose = { ...view, fov: name === 'ridge' ? 46 : 58 }; }
    else throw new Error(`Unknown view ${name}`);
  };
  choose(query.get('view') ?? 'street');

  let loaded = false, drawn = false, lastField = -Infinity;
  const stats = { ready: false, lightingReady: false, fieldSettled: false, drawCalls: 0, triangles: 0, planMs, hour };
  void Promise.all(tasks).then(() => { loaded = true; }, fail);
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
    sunShadows.setResolution(canvas.clientWidth < canvas.clientHeight ? 1024 : 2048);
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
      dressing?.update({ time, walkers: [] });
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
        ready: loaded, hour, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        lightingReady: nearBytes > 0 && farBytes > 0 && beaconBytes > 0, fieldUploads,
        fieldSettled: [field, farField, beaconField].every(f => f.stats.publishedRevision === f.stats.requestedRevision && !f.stats.busy && !f.stats.queued) && farBytes > 0 && beaconBytes > 0,
      });
      if (loaded && !drawn) { drawn = true; (window as BenchWindow).__chatdomReady = true; }
      requestAnimationFrame(render);
    } catch (error) { fail(error); }
  }
  requestAnimationFrame(render);
  (window as BenchWindow).__chatdomKingdom = {
    stats,
    view: (name: string) => choose(name),
    pose: (eye: Vec3 | null, lookAt?: Vec3, fov = 43) => { if (eye && lookAt) pose = { eye, target: lookAt, fov }; },
    hour: (value: number) => { hour = value; },
    dressing: dressing ? { views: dressing.views, stats: dressing.stats, report: plan!.report, blockers: dressing.blockers.length, hideLot: dressing.hideLot } : null,
  };
} catch (error) { fail(error); }
