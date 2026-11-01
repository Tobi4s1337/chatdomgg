/* global location:readonly, navigator:readonly, requestAnimationFrame:readonly, ResizeObserver:readonly, URLSearchParams:readonly */
// The PinkKittyRose landing bench: the landing and grand stair under the river hall's town door, and the glass
// screen in the square, on SIMULATED bench ground through the production voxel mesher, clay, light fields, sun
// shadows, atmosphere and post stack. The fire baskets burn as a host would light them: SIMULATED host behaviour
// shown to judge the pieces, not a claim about any kingdom. `?view=landing|screen|back`, `?hour=`. Served by the
// Vite dev server only (capture.mjs); the app never loads it.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeLightOccluders } from '@chatdom/voxel';
import { MAT, MATERIALS } from '../../../../materials';
import { pinkkittyBench } from './scene';

const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const fail = (error) => {
  console.error('Landing bench failed', error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
};

/** A soft round dot, white in the middle: the texture of every glow. */
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

try {
  const hour = Number(query.get('hour') ?? 19.6), time = Number(query.get('time') ?? 12);
  const viewName = query.get('view') ?? 'landing';
  const bench = pinkkittyBench(), pose = bench.views[viewName];
  if (!pose) throw new Error(`Unknown view ${viewName}`);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(pose.fov, 1, 0.15, 1600);
  const atmosphere = createAtmosphere(scene);
  const fog = new THREE.FogExp2(0x000000);
  scene.fog = fog;
  const post = createPostStack(renderer, scene, camera, { quality: 'capture', toneMapping: 'aces', fog: 'material' });
  const clay = createVoxelMaterial(MATERIALS, 'build');
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 64 });
  const sun = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...bench.shadowBounds.min), new THREE.Vector3(...bench.shadowBounds.max)), resolution: 2048 });
  sun.bindReceiver(clay.material);

  // The fires' warm field, through the production flood; occluders are the placed pieces' solid boxes.
  const occluders = [];
  for (const p of bench.placements) {
    if (p.id === 'ground') continue;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw), C = 0.125;
    for (const b of p.blueprint.boxes) {
      if (b.material === MAT.air) continue;
      const corners = [[b.from[0], b.from[2]], [b.to[0], b.to[2]]].map(([x, z]) => [p.origin[0] + (x * c + z * s) * C, p.origin[2] + (-x * s + z * c) * C]);
      occluders.push({
        min: [Math.min(corners[0][0], corners[1][0]), p.origin[1] + b.from[1] * C, Math.min(corners[0][1], corners[1][1])],
        max: [Math.max(corners[0][0], corners[1][0]), p.origin[1] + b.to[1] * C, Math.max(corners[0][1], corners[1][1])],
      });
    }
  }
  const field = (spec, emitters) => buildLightVolume({ ...spec, occupancy: rasterizeLightOccluders(spec, occluders), emitters });
  const near = field({ revision: 1, origin: [-8, -2, -14], size: [64, 32, 40], cellSize: 0.5 }, bench.fires.map(position => ({ position: [position[0], position[1] + 0.25, position[2]], level: 13 })));
  const far = field({ revision: 1, origin: [-48, -4, -48], size: [48, 24, 48], cellSize: 2 }, []);
  clay.setLight(near);
  clay.setBeaconLight(far);

  const tasks = bench.placements.map(async (placement) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint: placement.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${placement.blueprint.id}`);
    const model = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), clay.material);
    model.position.set(...placement.origin);
    model.rotation.y = placement.yaw;
    scene.add(model);
    model.updateMatrixWorld(true);
    sun.register(model);
  });

  const glowTexture = dotTexture(0.22), glows = [];
  for (const at of bench.fires) {
    for (const [lift, scale, colour] of [[0.18, 0.5, new THREE.Color(6, 2.8, 0.8)], [0.32, 1.9, new THREE.Color(0.7, 0.32, 0.08)]]) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sprite.position.set(at[0], at[1] + lift, at[2]);
      sprite.scale.setScalar(scale);
      scene.add(sprite);
      glows.push(sprite);
    }
  }

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    post.resize(canvas.clientWidth, canvas.clientHeight, 1);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  const stats = { ready: false, view: viewName, landing: bench.landing.blueprint.id, screen: bench.screen.blueprint.id, boxes: { landing: bench.landing.blueprint.boxes.length, screen: bench.screen.blueprint.boxes.length }, label: 'SIMULATED' };
  let loaded = false, drawn = 0, shadowsSet = false;
  void Promise.all(tasks).then(() => { loaded = true; }, fail);
  const anchor = new THREE.Vector3(...bench.fires[0]), target = new THREE.Vector3(...pose.target);
  function draw() {
    const grade = getEnvironment(hour);
    clay.setEnvironment(grade);
    renderer.toneMappingExposure = grade.exposure;
    camera.position.set(...pose.eye);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    atmosphere.update(hour, time, camera, anchor, 0);
    clay.setBeaconSource(bench.fires[0], 0);
    fog.color.set(grade.fog);
    fog.density = grade.fogDensity;
    if (loaded && !shadowsSet) shadowsSet = sun.updateSunDirection(grade.sunDirection) || true;
    post.update({ environment: grade, hour, focusDistance: null, beacon: { position: anchor, strength: 0 } });
    post.render(0);
    Object.assign(stats, { hour, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
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
  window.__chatdomPinkkittyLanding = { stats };
} catch (error) {
  fail(error);
}
