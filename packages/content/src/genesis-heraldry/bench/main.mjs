/* global URLSearchParams:readonly */
// Lane-local heraldry bench. It renders a recipe's heraldry with the production voxel worker, mesher, voxel
// material, sky and post stack on a small SIMULATED forecourt. It is not the kingdom and proves no integration:
// the forecourt, its houses, the lit lanterns and the window presence are bench staging.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeBlueprint } from '@chatdom/voxel';
import { KingdomPresenceFrameSchema, VOXEL_METRES } from '@chatdom/shared';
import { compileChannelGenesis } from '../../../../world/src/genesis/index.ts';
import { OBSERVED_GENESIS_FIXTURES } from '../../../../world/src/genesis/observed-fixtures.ts';
import { MAT, MATERIALS, STYLES } from '../../materials.ts';
import { createHome, createTree } from '../../core/index.ts';
import { composeGenesisHeraldry } from '../index.ts';
import { PROFILE_TARGETS } from '../fixtures.ts';
import { composition, forecourt, meadow } from './stage.mjs';

const CELL = VOXEL_METRES.build;
const params = new URLSearchParams(window.location.search);
const recipeIndex = Number(params.get('recipe') ?? 0);
const landIndex = Number(params.get('land') ?? 2);
const hour = Number(params.get('hour') ?? 19.1);
// `targets=profile` adds the channel's profile palette proposal as colour targets, so the snapped proposal shows.
const withTargets = params.get('targets') === 'profile';
const host = document.getElementById('stage');
window.__chatdomReady = false;

async function main() {
  const facts = OBSERVED_GENESIS_FIXTURES[recipeIndex];
  if (!facts) throw new Error(`No observed recipe ${recipeIndex}.`);
  const recipe = compileChannelGenesis(withTargets ? { ...facts, profileColours: [...PROFILE_TARGETS[facts.broadcasterId]] } : facts);
  const land = recipe.landscapes[landIndex];
  if (!land) throw new Error(`No landscape ${landIndex}.`);
  const heraldry = composeGenesisHeraldry(recipe, land);
  const style = heraldry.style;
  const plan = composition(heraldry);
  const { shape, charge, cut } = heraldry.device;
  const colours = heraldry.treatment.kind === 'snapped' ? 'profile colours snapped to the dyes, not approved' : "the land's own colours";
  const title = heraldry.treatment.kind === 'snapped' ? 'colour proposal' : 'neutral proposal';
  document.getElementById('plate').innerHTML = `Genesis heraldry · ${title}<small>${STYLES[style].name} · ${land.character.replace('-', ' ')} · ${charge} on a ${shape} · ${cut} cloth · ${colours}</small>`;

  const homeStyle = style === 'grove' ? 'grove' : style;
  const placed = [
    { blueprint: forecourt(style, MAT), position: [0, 0, 0], yaw: 0 },
    ...plan.meadows.map((position, i) => ({ blueprint: meadow(style, MAT, i), position, yaw: 0 })),
    ...plan.backdrop.map(([tier, variant, position, yaw]) => ({ blueprint: createHome(tier, homeStyle, variant), position, yaw })),
    ...plan.grove.map(([variant, position]) => ({ blueprint: createTree(variant), position, yaw: 0 })),
    { blueprint: createHome('house', homeStyle, 1), position: plan.homes[0], yaw: 0, windows: 0 },
    { blueprint: createHome('cottage', homeStyle, 2), position: plan.homes[1], yaw: 0, windows: 1 },
    { blueprint: createTree(1), position: plan.trees[0], yaw: 0 },
    { blueprint: createTree(2), position: plan.trees[1], yaw: 0 },
    { blueprint: heraldry.crest.blueprint, position: plan.crest, yaw: 0, lanterns: heraldry.crest.lanterns },
    { blueprint: heraldry.standard.blueprint, position: plan.standard, yaw: 0, lanterns: heraldry.standard.lanterns },
  ];

  const env = getEnvironment(hour);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.debug.onShaderError = () => { throw new Error('Bench shader compilation failed.'); };
  host.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(plan.camera.fov, host.clientWidth / host.clientHeight, 0.1, 400);
  camera.position.set(...plan.camera.position);
  camera.lookAt(new THREE.Vector3(...plan.camera.target));
  camera.updateMatrixWorld(true);

  const material = createVoxelMaterial(MATERIALS, 'build');
  material.setEnvironment(env);
  const atmosphere = createAtmosphere(scene);
  atmosphere.update(hour, 0, camera, new THREE.Vector3(0, -100, 0), 0);

  // The light field, as the kingdom builds it: 0.5 m cells, each occupied when most of its build cells are solid
  // and not glass (carving included), every lantern a source. The shader fades the field toward the volume's
  // faces, so it reaches well below the ground and above the finials.
  const spec = { revision: 1, origin: [3, -4, 8], size: [48, 28, 48], cellSize: 0.5 };
  const [lx, ly, lz] = spec.size;
  const counts = new Uint8Array(lx * ly * lz);
  const blocks = new Set(MATERIALS.materials.filter(m => m.blocksLight).map(m => m.id));
  const emitters = [];
  for (const item of placed) {
    const world = (v, axis) => item.position[axis] + v * CELL;
    for (const lantern of item.lanterns ?? []) emitters.push({ position: lantern.position.map((v, axis) => world(v + 0.5, axis)), level: 15 });
    if (item.yaw !== 0) continue;
    const asset = rasterizeBlueprint(item.blueprint);
    const [sx, sy, sz] = asset.size;
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      if (!blocks.has(asset.voxels[x + sx * (y + sy * z)])) continue;
      const cell = [x, y, z].map((v, axis) => Math.floor((world(v + 0.5, axis) - spec.origin[axis]) / spec.cellSize));
      if (cell.some((c, axis) => c < 0 || c >= spec.size[axis])) continue;
      counts[cell[0] + lx * (cell[1] + ly * cell[2])]++;
    }
  }
  const occupancy = counts.map(n => n >= 32 ? 1 : 0);
  const volume = buildLightVolume({ ...spec, occupancy, emitters });
  material.setLight(volume);
  material.setFarLight(volume);

  const pool = new VoxelWorkerPool({ size: 2 });
  for (const item of placed) {
    const result = await pool.submit({ kind: 'blueprint', blueprint: item.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned no geometry for ${item.blueprint.id}.`);
    const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), material.material);
    mesh.position.set(...item.position);
    mesh.rotation.y = item.yaw;
    scene.add(mesh);
  }
  pool.dispose();

  // Simulated presence: both houses are lit, as if their citizens were home.
  const houses = placed.filter(item => item.windows !== undefined).map(item => ({ slot: item.windows, blueprint: item.blueprint, position: item.position, yaw: item.yaw }));
  const windows = createWindowLights(scene, houses, { allWindows: true });
  windows.setFrame(KingdomPresenceFrameSchema.parse({ version: 1, kingdomId: '1', epoch: 'heraldry-bench', sequence: 1, asOf: 1000, origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: houses.map(house => ({ slot: house.slot, present: true, publicName: null, since: 0 })) }));
  windows.update(1, hour);

  // Lantern flames, hot enough to bloom, and a few warm motes drifting in their light.
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb24f').multiplyScalar(7), toneMapped: true, fog: false });
  const flameGeometry = new THREE.BoxGeometry(2.15 * CELL, 4.1 * CELL, 2.15 * CELL);
  const motes = [];
  let seed = 7;
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const { position } of emitters) {
    const glow = new THREE.Mesh(flameGeometry, flame);
    // The glass core spans the anchor cell and the cells either side of it: centre it on the anchor's near corner.
    glow.position.set(position[0] - CELL / 2, position[1] - CELL / 2, position[2] - CELL / 2);
    scene.add(glow);
    for (let i = 0; i < 14; i++) {
      const angle = next() * Math.PI * 2, radius = 0.25 + next() * 0.9;
      motes.push(position[0] + Math.cos(angle) * radius, position[1] - 0.3 + next() * 1.6, position[2] + Math.sin(angle) * radius);
    }
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.Float32BufferAttribute(motes, 3));
  scene.add(new THREE.Points(moteGeometry, new THREE.PointsMaterial({ color: new THREE.Color('#ffc978').multiplyScalar(2.2), size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));

  const post = createPostStack(renderer, scene, camera, { quality: 'capture' });
  post.resize(host.clientWidth, host.clientHeight, 1);
  post.update({ environment: env, hour, focusDistance: null });
  await renderer.compileAsync(scene, camera);
  post.render(0);
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  post.render(0);
  renderer.getContext().finish();
  window.__chatdomBench = { recipe: recipeIndex, land: land.character, style, treatment: heraldry.treatment.kind, device: heraldry.device, standard: heraldry.standard.blueprint.id, crest: heraldry.crest.blueprint.id };
  window.__chatdomReady = true;
}

main().catch(error => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  window.__chatdomBenchError = message;
  const box = document.createElement('pre');
  box.className = 'error';
  box.textContent = message;
  document.body.append(box);
  console.error(message);
});
