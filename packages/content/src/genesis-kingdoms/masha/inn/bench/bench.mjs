/* global location:readonly, navigator:readonly, requestAnimationFrame:readonly, ResizeObserver:readonly, URLSearchParams:readonly */
// The Copper Kettle bench: the inn on SIMULATED Bell Court, drawn through the production voxel mesher, clay and
// terrain materials, light fields, window lights, sun shadows, atmosphere and post stack. Its door lanterns burn as
// they would with people about, its windows glow as if every room were taken and both chimneys draw: SIMULATED host
// behaviour shown to judge the piece, not a claim about any kingdom. Served by the Vite dev server only
// (capture.mjs); the app never loads it.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeLightOccluders } from '@chatdom/voxel';
import { MAT, MATERIALS } from '../../../../materials';
import { groundMaterial, meshGround } from '../../../../../../../apps/web/src/places/water/surface-bench/ground';
import { CELL, innBench } from './scene';

const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const fail = (error) => {
  console.error('Inn bench failed', error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
};
const number = (name, fallback) => {
  const raw = query.get(name), value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, not "${raw}".`);
  return value;
};
/** A soft round dot, white in the middle: the shared texture of every glow and puff of smoke. */
function dotTexture(soft) {
  const size = 64, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(soft, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
/** A deterministic hash in [0, 1). */
const rand = (i, salt) => { const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return s - Math.floor(s); };

try {
  let hour = number('hour', 19), time = number('time', 42);
  const style = query.get('style') ?? 'tide';
  if (!['hearth', 'tide', 'grove'].includes(style)) throw new Error(`Unknown style ${style}`);
  const bench = innBench(style), piece = bench.piece;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, 1, 0.15, 1200);
  const atmosphere = createAtmosphere(scene);
  const fog = new THREE.FogExp2(0x000000);
  scene.fog = fog;
  const post = createPostStack(renderer, scene, camera, { quality: 'capture', toneMapping: 'aces', fog: 'material' });
  const clay = createVoxelMaterial(MATERIALS, 'build');
  const states = [clay];
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 256 });
  const mesh = async (blueprint) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${blueprint.id}`);
    return geometryFromChunks(result.chunks, 'build');
  };
  const { ground, inn } = bench;
  const made = groundMaterial(ground, -50);
  states.push(made.state);
  const sun = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...bench.shadowBounds.min), new THREE.Vector3(...bench.shadowBounds.max)), resolution: 2048 });
  for (const s of states) sun.bindReceiver(s.material);
  const world = (cells) => [inn[0] + cells[0] * CELL, inn[1] + cells[1] * CELL, inn[2] + cells[2] * CELL];
  const lanterns = piece.emitters.filter(e => e.kind === 'lantern').map(e => world(e.position));
  const chimneys = piece.mounts.filter(m => m.id.startsWith('chimney-smoke')).map(m => world(m.position));
  // SIMULATED presence: every room of the inn taken, through the production window lights.
  const windows = createWindowLights(scene, [{ slot: 0, blueprint: piece.blueprint, position: inn, yaw: 0 }], { allWindows: true });
  const asOf = Date.UTC(2026, 10, 1, 19, 0);
  windows.setFrame({ version: 1, kingdomId: 'kingdom_simulated_inn_bench', epoch: 'sim:inn-bench', sequence: 1, asOf, origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: [{ slot: 0, present: true, publicName: null, since: asOf - 60_000 }] });
  // The light fields, through the production flood: the lanterns and windows warm the court; the inn's own solid
  // boxes occlude them.
  const occluders = piece.blueprint.boxes.filter(b => b.material !== MAT.air).map(b => ({ min: world(b.from), max: world(b.to) }));
  const field = (spec, emitters) => buildLightVolume({ ...spec, occupancy: rasterizeLightOccluders(spec, occluders), emitters });
  const near = field({ revision: 1, origin: [-22, -2, -16], size: [88, 64, 96], cellSize: 0.5 },
    [...lanterns.map(position => ({ position, level: 13 })), ...windows.getSources().map(s => ({ position: s.position, level: 9 }))]);
  const far = field({ revision: 1, origin: [-48, -4, -48], size: [48, 24, 48], cellSize: 2 }, lanterns.map(position => ({ position, level: 10 })));
  for (const s of states) { s.setLight(near); s.setBeaconLight(far); }
  const tasks = bench.placements.map(async (placement) => {
    const model = new THREE.Mesh(await mesh(placement.blueprint), clay.material);
    model.position.set(...placement.origin);
    model.rotation.y = placement.yaw;
    scene.add(model);
    model.updateMatrixWorld(true);
    sun.register(model);
  });
  tasks.push(meshGround(pool, ground, made, () => false).then(land => { scene.add(land); land.updateMatrixWorld(true); sun.register(land); }));
  // Glows on each lantern's glass, bright enough for the bloom to take them.
  const glowTexture = dotTexture(0.22), glows = [];
  const glow = (at, scale, colour, flicker) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sprite.position.set(...at);
    sprite.scale.setScalar(scale);
    scene.add(sprite);
    glows.push({ sprite, base: scale, flicker });
  };
  for (const at of lanterns) {
    glow(at, 0.5, new THREE.Color(5, 2.6, 0.9), 0.06);
    glow(at, 2, new THREE.Color(0.55, 0.28, 0.08), 0.03);
  }
  // Wood smoke curling away downwind from both chimneys.
  const SMOKE = 44, wind = new THREE.Vector3(-0.9, 0, -0.3).normalize();
  const smokeGeometry = new THREE.BufferGeometry(), smokePositions = new Float32Array(SMOKE * 3), smokeColours = new Float32Array(SMOKE * 4);
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColours, 4));
  const smoke = new THREE.Points(smokeGeometry, new THREE.PointsMaterial({ map: dotTexture(0.5), size: 2, vertexColors: true, transparent: true, depthWrite: false }));
  smoke.frustumCulled = false;
  scene.add(smoke);
  function particles(t) {
    for (let i = 0; i < SMOKE; i++) {
      const main = i % 3 !== 0, from = chimneys[main ? 0 : 1], puff = main ? 1 : 0.7;
      const life = 9 + rand(i, 7) * 4, age = (t + rand(i, 8) * life) % life, a = age / life;
      const curl = Math.sin(age * 0.8 + rand(i, 9) * 6) * (0.3 + a * 1.2) * puff;
      const drift = age * age * 0.1 + age * 0.3;
      smokePositions.set([from[0] + wind.x * drift + wind.z * curl, from[1] + 0.15 + age * 0.8 * puff, from[2] + wind.z * drift - wind.x * curl], i * 3);
      const grey = 0.34 + rand(i, 10) * 0.08, alpha = 0.26 * Math.sin(Math.PI * Math.min(1, a * 1.15)) * (1 - a * 0.4);
      smokeColours.set([grey, grey * 0.95, grey * 0.92, alpha], i * 4);
    }
    smokeGeometry.attributes.position.needsUpdate = true;
    smokeGeometry.attributes.color.needsUpdate = true;
  }
  let pose = bench.views.wide;
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    post.resize(canvas.clientWidth, canvas.clientHeight, 1);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    pose = canvas.clientWidth >= canvas.clientHeight ? bench.views.wide : bench.views.tall;
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  const stats = { ready: false, blueprint: piece.blueprint.id, boxes: piece.blueprint.boxes.length, windows: piece.blueprint.windows.length, label: 'SIMULATED' };
  let loaded = false, drawn = 0, shadowsSet = false;
  void Promise.all(tasks).then(() => { loaded = true; }, fail);
  const nowhere = new THREE.Vector3(0, -500, 0), target = new THREE.Vector3();
  function draw() {
    const grade = getEnvironment(hour);
    for (const s of states) s.setEnvironment(grade);
    renderer.toneMappingExposure = grade.exposure;
    camera.position.set(...pose.eye);
    target.set(...pose.target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    // No beacon burns at the inn.
    atmosphere.update(hour, time, camera, nowhere, 0);
    for (const s of states) s.setBeaconSource(nowhere.toArray(), 0);
    fog.color.set(grade.fog);
    fog.density = grade.fogDensity;
    if (loaded && !shadowsSet) shadowsSet = sun.updateSunDirection(grade.sunDirection) || true;
    for (const [i, g] of glows.entries()) g.sprite.scale.setScalar(g.base * (1 + g.flicker * Math.sin(time * (6 + i) + i)));
    particles(time);
    windows.update(0, hour);
    post.update({ environment: grade, hour, focusDistance: null, beacon: { position: nowhere, strength: 0 } });
    post.render(0);
    Object.assign(stats, { hour, time, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
  }
  function render() {
    try {
      draw();
      if (loaded && ++drawn === 3) {
        renderer.getContext().finish();
        stats.ready = true;
        window.__chatdomReady = true;
      }
      requestAnimationFrame(render);
    } catch (error) {
      fail(error);
    }
  }
  requestAnimationFrame(render);
  window.__chatdomInn = { stats, time: t => { time = t; }, hour: h => { hour = h; } };
} catch (error) {
  fail(error);
}
