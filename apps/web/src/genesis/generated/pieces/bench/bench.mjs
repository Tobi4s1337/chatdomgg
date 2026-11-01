/* global location:readonly, navigator:readonly, performance:readonly, requestAnimationFrame:readonly, ResizeObserver:readonly, URLSearchParams:readonly */
// The generated pieces bench: the open-air stage, the standing stones and the bell garden, two seeded variants of
// each in different styles and cloth, side by side on SIMULATED flat ground, drawn through the production voxel
// mesher, clay and terrain materials, light fields, sun shadows, atmosphere and post stack. Lanterns and fires burn
// as they would with the chat gathered (SIMULATED host lighting, shown to judge the pieces). `?view=overview|stage|
// stones|garden` frames the row or one pair; `?hour=` sets the light. Dev-served by capture.mjs only; the app never
// loads it.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeLightOccluders } from '@chatdom/voxel';
import { MAT, MATERIALS } from '@chatdom/content/materials';
import { groundMaterial, meshGround } from '../../../../places/water/surface-bench/ground';
import { createBellGarden, createOpenAirStage, createStandingStones } from '../index';

const CELL = 0.125;
const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const fail = (error) => {
  console.error('Pieces bench failed', error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
};
const number = (name, fallback) => {
  const raw = query.get(name), value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, not "${raw}".`);
  return value;
};

/** Six SIMULATED kingdoms' pieces: [factory, label, style, seed, cloth]. */
const KINGDOMS = [
  [createOpenAirStage, 'Stage', 'hearth', 11, { field: MAT.fabricRed, charge: MAT.cream, border: MAT.fabricGold }],
  [createOpenAirStage, 'Stage', 'tide', 2, { field: MAT.fabricBlue, charge: MAT.cream, border: MAT.fabricGold }],
  [createStandingStones, 'Stones', 'grove', 7, { field: MAT.fabricGreen, charge: MAT.cream, border: MAT.fabricRed }],
  [createStandingStones, 'Stones', 'hearth', 404, { field: MAT.fabricViolet, charge: MAT.fabricGold, border: MAT.cream }],
  [createBellGarden, 'Bell garden', 'tide', 2, { field: MAT.fabricOrange, charge: MAT.cream, border: MAT.fabricBlue }],
  [createBellGarden, 'Bell garden', 'grove', 3, { field: MAT.fabricViolet, charge: MAT.fabricGold, border: MAT.cream }],
];
const SPACING = 23;
const VIEWS = {
  overview: { eye: [3, 21, 96], target: [0, 3, -4], fov: 50 },
  stage: { eye: [-36, 12.5, 34], target: [-46, 4, -1], fov: 46 },
  stones: { eye: [7, 15, 37], target: [0, 1.4, -1], fov: 46 },
  garden: { eye: [54, 15.5, 34], target: [46, 2, -1], fov: 46 },
};

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

const smooth = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
/** Flat SIMULATED meadow under the row, rising into soft low hills behind and to the sides. */
const land = (x, z) => 0.002 + 4.5 * smooth(18, 70, -z) * (0.6 + 0.4 * Math.sin(x * 0.045 + 1.3)) + 1.6 * smooth(78, 120, Math.abs(x)) + 0.05 * Math.sin(x * 0.31 + z * 0.23) * smooth(14, 22, Math.abs(z));

try {
  const hour = number('hour', 19.4), time = number('time', 42);
  const viewName = query.get('view') ?? 'overview';
  const pose = VIEWS[viewName];
  if (!pose) throw new Error(`Unknown view ${viewName}.`);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(pose.fov, 1, 0.15, 1600);
  const atmosphere = createAtmosphere(scene);
  const fog = new THREE.FogExp2(0x000000);
  scene.fog = fog;
  const post = createPostStack(renderer, scene, camera, { quality: 'capture', toneMapping: 'aces', fog: 'material' });
  const clay = createVoxelMaterial(MATERIALS, 'build');
  const states = [clay];
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 256 });

  // The pieces, centred on their columns, fronts to +Z.
  const placed = KINGDOMS.map(([make, label, style, seed, colours], i) => {
    const piece = make({ style, seed, colours });
    const [sx, , sz] = piece.blueprint.size;
    const centre = -SPACING * 2.5 + SPACING * i;
    const origin = [centre - (sx * CELL) / 2, 0, -(sz * CELL) / 2];
    const world = c => [origin[0] + (c[0] + 0.5) * CELL, origin[1] + (c[1] + 0.5) * CELL, origin[2] + (c[2] + 0.5) * CELL];
    return { piece, label, style, seed, origin, centre, lanterns: piece.lanterns.map(world) };
  });
  const lanterns = placed.flatMap(p => p.lanterns);
  const mark = (stage) => { window.__chatdomStage = `${stage} ${Math.round(performance.now())}ms`; };
  mark('pieces');

  const width = 401, depth = 521, origin = [-100, -140], step = 0.5, data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = land(origin[0] + i * step, origin[1] + k * step);
  const ground = { origin, step, width, depth, data };
  const made = groundMaterial(ground, -50);
  states.push(made.state);
  const sun = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-72, -1, -14), new THREE.Vector3(72, 14, 14)), resolution: 2048 });
  for (const s of states) sun.bindReceiver(s.material);

  // Light fields through the production flood: every piece's solid boxes occlude; glass passes light. A lantern
  // whose own cell is filled by its cage lights from the nearest open cell beside it.
  const occluders = placed.flatMap(p => p.piece.blueprint.boxes.filter(b => b.material !== MAT.air && b.material !== MAT.glass)
    .map(b => ({ min: b.from.map((v, d) => p.origin[d] + v * CELL), max: b.to.map((v, d) => p.origin[d] + v * CELL) })));
  const field = (spec, level) => {
    const occupancy = rasterizeLightOccluders(spec, occluders);
    const emitters = lanterns.map(position => {
      const free = (q) => { const c = q.map((n, d) => Math.floor((n - spec.origin[d]) / spec.cellSize)); return c.every((n, d) => n >= 0 && n < spec.size[d]) && !occupancy[c[0] + spec.size[0] * (c[1] + spec.size[1] * c[2])]; };
      const s = spec.cellSize;
      for (const o of [[0, 0, 0], [0, 0, s], [s, 0, 0], [-s, 0, 0], [0, 0, -s], [0, s, 0], [0, s, s], [s, 0, s], [-s, 0, s]]) {
        const q = position.map((n, d) => n + o[d]);
        if (free(q)) return { position: q, level };
      }
      return { position, level };
    });
    return buildLightVolume({ ...spec, occupancy, emitters });
  };
  const near = field({ revision: 1, origin: [-72, -1, -12], size: [288, 30, 48], cellSize: 0.5 }, 10);
  // No kingdom beacon burns on this bench: its coarse field stays dark.
  const far = buildLightVolume({ revision: 1, origin: [-96, -4, -48], size: [96, 16, 48], cellSize: 2, occupancy: new Uint8Array(96 * 16 * 48), emitters: [] });
  for (const s of states) { s.setLight(near); s.setBeaconLight(far); }
  mark('light');

  const mesh = async (blueprint) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${blueprint.id}`);
    return geometryFromChunks(result.chunks, 'build');
  };
  const tasks = placed.map(async (p) => {
    const model = new THREE.Mesh(await mesh(p.piece.blueprint), clay.material);
    model.position.set(...p.origin);
    scene.add(model);
    model.updateMatrixWorld(true);
    sun.register(model);
    mark(`meshed ${p.piece.blueprint.id}`);
  });
  tasks.push(meshGround(pool, ground, made, () => false).then(landMesh => { scene.add(landMesh); landMesh.updateMatrixWorld(true); sun.register(landMesh); }));

  // Glows at every lamp and fire, sized to the source so the bloom takes them without blowing out.
  const glowTexture = dotTexture(0.22), glows = [];
  for (const at of lanterns) {
    for (const [scale, colour, flicker] of [[0.5, new THREE.Color(5, 2.6, 0.9), 0.06], [2.0, new THREE.Color(0.55, 0.28, 0.08), 0.03]]) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sprite.position.set(...at);
      sprite.scale.setScalar(scale);
      scene.add(sprite);
      glows.push({ sprite, base: scale, flicker });
    }
  }

  const captions = document.querySelector('[data-captions]');
  const labels = placed.map(p => {
    const span = document.createElement('span');
    span.textContent = `${p.label} · ${p.style} · seed ${p.seed}`;
    captions.append(span);
    return { span, at: new THREE.Vector3(p.centre, 0, (p.piece.blueprint.size[2] * CELL) / 2 + 1.5) };
  });

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    post.resize(canvas.clientWidth, canvas.clientHeight, 1);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const stats = { ready: false, view: viewName, hour, label: 'SIMULATED', pieces: placed.map(p => ({ id: p.piece.blueprint.id, boxes: p.piece.blueprint.boxes.length, size: p.piece.blueprint.size, lanterns: p.piece.lanterns.length })) };
  let loaded = false, drawn = 0, shadowsSet = false;
  void Promise.all(tasks).then(() => { loaded = true; mark('loaded'); }, fail);
  const target = new THREE.Vector3(), beacon = new THREE.Vector3(0, -100, 0), projected = new THREE.Vector3();
  function draw() {
    const grade = getEnvironment(hour);
    for (const s of states) { s.setEnvironment(grade); s.setBeaconSource([0, -100, 0], 0); }
    renderer.toneMappingExposure = grade.exposure;
    camera.position.set(...pose.eye);
    target.set(...pose.target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    atmosphere.update(hour, time, camera, beacon, 0);
    fog.color.set(grade.fog);
    fog.density = grade.fogDensity;
    if (loaded && !shadowsSet) shadowsSet = sun.updateSunDirection(grade.sunDirection) || true;
    for (const [i, g] of glows.entries()) g.sprite.scale.setScalar(g.base * (1 + g.flicker * Math.sin(time * (6 + i) + i)));
    post.update({ environment: grade, hour, focusDistance: null, beacon: { position: beacon, strength: 0 } });
    post.render(0);
    for (const l of labels) {
      projected.copy(l.at).project(camera);
      const visible = projected.z < 1 && Math.abs(projected.x) < 0.98;
      l.span.style.display = visible ? '' : 'none';
      l.span.style.left = `${((projected.x + 1) / 2) * 100}%`;
    }
    Object.assign(stats, { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
  }
  function render() {
    try {
      draw();
      if (drawn === 0) mark(`first frame${loaded ? ' (loaded)' : ''}`);
      if (loaded && ++drawn === 3) {
        renderer.getContext().finish();
        stats.ready = true;
        window.__chatdomReady = true;
      }
      requestAnimationFrame(render);
    } catch (error) { fail(error); }
  }
  requestAnimationFrame(render);
  window.__chatdomPieces = { stats };
} catch (error) {
  fail(error);
}
