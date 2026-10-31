/* global URLSearchParams:readonly */
// Lane-local emote art bench. It renders a recipe's emote art with the production voxel worker, mesher, voxel
// material, light field, sky, window presence and post stack on a small SIMULATED plaza. It is not the kingdom and
// proves no integration: the plaza, the hall, the houses, lit lanterns, window presence and the stained-glass light
// layer (drawn here from `glass.light`, which main binds in the kingdom) are bench staging.
import * as THREE from 'three';
import { createAtmosphere, createPostStack, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, buildLightVolume, rasterizeBlueprint } from '@chatdom/voxel';
import { KingdomPresenceFrameSchema } from '@chatdom/shared';
import { compileChannelGenesis } from '../../../../world/src/genesis/index.ts';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../../../../world/src/genesis/observed-fixtures.ts';
import { MAT, MATERIALS, STYLES } from '../../materials.ts';
import { createHome, createTree } from '../../core/index.ts';
import { createStreetProp } from '../../props/street/index.ts';
import { composeGenesisEmoteArt, EMOTE_ART_KITS } from '../index.ts';
import { simulatedEmoteArtInput } from '../fixtures.ts';
import { CELL, composition, hall, meadow, plaza } from './stage.mjs';

const params = new URLSearchParams(window.location.search);
// `channel=simulated` (default) composes the SIMULATED toadWave channel with every use approved; `uses=` narrows the
// approvals (comma list, empty for none). `channel=observed-<0|1|2>` composes one of the three real composition targets,
// which have no approved emotes, on its showcase land: the honest empty state.
const channel = params.get('channel') ?? 'simulated';
const usesParam = params.get('uses');
const hour = Number(params.get('hour') ?? 19.1);
const frameParam = params.get('frame');
const heading = Number(params.get('heading') ?? -24) * Math.PI / 180;
const host = document.getElementById('stage');
window.__chatdomReady = false;
const DISPLAY_NAMES = { '63920635': 'The_AGGman', '4363967': 'PinkKittyRose', '154972160': 'MashaD4' };
const USE_WORDS = { statue: 'statue', weathervane: 'weathervane', 'stained-glass': 'glass' };

async function main() {
  let recipe, land, derivatives, name;
  if (channel === 'simulated') {
    const uses = usesParam === null ? undefined : usesParam.split(',').filter(Boolean);
    const input = await simulatedEmoteArtInput(uses);
    recipe = compileChannelGenesis(input.facts);
    land = recipe.landscapes.find(candidate => candidate.character === (params.get('land') ?? 'river-valley'));
    derivatives = input.derivatives;
    name = 'a rehearsal channel';
  } else {
    const index = Number(channel.replace('observed-', ''));
    const facts = OBSERVED_GENESIS_FIXTURES[index];
    if (!facts) throw new Error(`No observed recipe ${index}.`);
    recipe = compileChannelGenesis(facts);
    land = recipe.landscapes.find(candidate => candidate.character === OBSERVED_GENESIS_SHOWCASE_CHOICES[index].character);
    derivatives = [];
    name = DISPLAY_NAMES[facts.broadcasterId];
  }
  if (!land) throw new Error('No such landscape.');
  const art = composeGenesisEmoteArt(recipe, land, derivatives);
  const kit = EMOTE_ART_KITS[art.style];
  const plan = composition();
  if (params.get('view')) plan.camera = plan.views[params.get('view')] ?? (() => { throw new Error(`No view ${params.get('view')}.`); })();
  const frameIndex = art.monument ? Math.min(art.monument.frames.length - 1, Number(frameParam ?? 3)) : 0;

  const carved = ['statue', 'stained-glass', 'weathervane'].filter(use => !art.absences.some(absence => absence.use === use));
  const plate = document.getElementById('plate');
  plate.innerHTML = carved.length
    ? `Genesis · ${name}'s emote, carved<small>${STYLES[art.style].name} · ${land.character.replace('-', ' ')} · ${carved.map(use => USE_WORDS[use]).join(', ')} from one approved emote${art.monument?.frames.length > 1 ? ` · frame ${frameIndex + 1} of ${art.monument.frames.length}` : ''}</small>`
    : `Genesis · ${name}<small>${STYLES[art.style].name} · ${land.character.replace('-', ' ')} · no approved emotes yet: nothing carved, plain glass in the hall</small>`;

  const homeStyle = art.style === 'grove' ? 'hearth' : art.style;
  const glassUnit = art.glass.blueprint;
  const nave = hall(art.style, MAT, kit, glassUnit);
  const at = (base, cells) => base.map((v, axis) => v + cells[axis] * CELL);
  const windowAt = at(plan.hall, nave.window);
  const placed = [
    { blueprint: plaza(art.style, MAT), position: [0, 0, 0], yaw: 0 },
    ...plan.meadows.map((position, i) => ({ blueprint: meadow(art.style, MAT, i), position, yaw: 0 })),
    ...plan.backdrop.map(([tier, variant, position, yaw]) => ({ blueprint: createHome(tier, homeStyle, variant), position, yaw })),
    ...plan.grove.map(([variant, position]) => ({ blueprint: createTree(variant), position, yaw: 0 })),
    { blueprint: createHome('house', homeStyle, 1), position: plan.homes[0], yaw: 0, windows: 0 },
    { blueprint: createHome('cottage', homeStyle, 2), position: plan.homes[1], yaw: 0, windows: 1 },
    ...plan.trees.map((position, i) => ({ blueprint: createTree(i), position, yaw: 0 })),
    ...plan.props.map(([, form, position, yaw]) => ({ blueprint: createStreetProp(form, homeStyle), position, yaw })),
    { blueprint: nave.blueprint, position: plan.hall, yaw: 0 },
    { blueprint: glassUnit, position: windowAt, yaw: 0 },
  ];
  if (art.monument) placed.push({ blueprint: art.monument.frames[frameIndex].blueprint, position: plan.monument, yaw: 0, lanterns: art.monument.lanterns });

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

  // The light field as the kingdom builds it: 0.5 m cells, occupied where most build cells are solid and not glass,
  // every lantern a source. The hall's lit interior adds sources just behind the glass, so its light leaves through
  // the window onto the reveal, the sill and the plaza.
  const spec = { revision: 1, origin: [-6, -4, -6], size: [76, 44, 72], cellSize: 0.5 };
  const [lx, ly, lz] = spec.size;
  const counts = new Uint8Array(lx * ly * lz);
  const blocks = new Set(MATERIALS.materials.filter(m => m.blocksLight).map(m => m.id));
  const emitters = [];
  const light = art.glass.light;
  for (const fy of [0.3, 0.55, 0.8]) for (const fx of [0.3, 0.7]) {
    emitters.push({ position: at(windowAt, [light.origin[0] + light.width * fx, light.origin[1] + light.height * fy, light.origin[2] - 9]), level: 12 });
  }
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
  const volume = buildLightVolume({ ...spec, occupancy: counts.map(n => (n >= 32 ? 1 : 0)), emitters });
  material.setLight(volume);
  material.setFarLight(volume);

  const pool = new VoxelWorkerPool({ size: 2 });
  const meshOf = async item => {
    const result = await pool.submit({ kind: 'blueprint', blueprint: item.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned no geometry for ${item.blueprint.id}.`);
    return new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), material.material);
  };
  for (const item of placed) {
    const mesh = await meshOf(item);
    mesh.position.set(...item.position);
    mesh.rotation.y = item.yaw;
    scene.add(mesh);
  }
  // The vane on the hall's ridge: the mast fixed, the rotor turned about its pivot to the evening's wind.
  if (art.vane) {
    const mastAt = at(plan.hall, nave.ridge.map((v, axis) => v - art.vane.mount[axis]));
    const mast = await meshOf({ blueprint: art.vane.mast });
    mast.position.set(...mastAt);
    scene.add(mast);
    const pivot = new THREE.Group();
    pivot.position.set(...at(mastAt, art.vane.mastPivot));
    pivot.rotation.y = heading;
    const rotor = await meshOf({ blueprint: art.vane.rotor });
    rotor.position.set(...art.vane.rotorPivot.map(v => -v * CELL));
    pivot.add(rotor);
    scene.add(pivot);
  }
  pool.dispose();

  // Simulated presence: both houses lit, as if their citizens were home.
  const houses = placed.filter(item => item.windows !== undefined).map(item => ({ slot: item.windows, blueprint: item.blueprint, position: item.position, yaw: item.yaw }));
  const windows = createWindowLights(scene, houses, { allWindows: true });
  windows.setFrame(KingdomPresenceFrameSchema.parse({ version: 1, kingdomId: '1', epoch: 'emote-bench', sequence: 1, asOf: 1000, origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: houses.map(house => ({ slot: house.slot, present: true, publicName: null, since: 0 })) }));
  windows.update(1, hour);

  // The stained-glass light layer: one texel per pane from `glass.light`, lit from within. Light through pot-metal
  // glass is deeper and more saturated than the same glass seen by reflected light, so each pane's registered colour
  // is pushed toward its own hue before it glows; came stays dark. Plain quarries glow a warm candle amber.
  const glow = Math.min(1, Math.max(0.15, (Math.abs(hour - 12) - 3.5) / 3));
  const texture = glassTexture(light, art.glass.kind);
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(light.width * CELL, light.height * CELL),
    new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1, 1, 1).multiplyScalar(art.glass.kind === 'emote' ? 3.4 * glow : 2.2 * glow), transparent: true, alphaTest: 0.5, fog: false }),
  );
  pane.position.set(...at(windowAt, [light.origin[0] + light.width / 2, light.origin[1] + light.height / 2, light.origin[2] + 0.04]));
  scene.add(pane);
  // Its spill on the flags: the same panes, cast long and soft down the plaza in front of the hall.
  const spill = new THREE.Mesh(
    new THREE.PlaneGeometry(light.width * CELL * 1.25, light.height * CELL * 0.85),
    new THREE.MeshBasicMaterial({ map: spillTexture(light, art.glass.kind), color: new THREE.Color(1, 1, 1).multiplyScalar(0.9 * glow), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(pane.position.x, 0.5 + 0.02, windowAt[2] + 7 * CELL + light.height * CELL * 0.85 / 2);
  scene.add(spill);

  // Lantern flames, hot enough to bloom, and warm motes drifting in their light and the window's.
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb24f').multiplyScalar(7), toneMapped: true, fog: false });
  const flameGeometry = new THREE.BoxGeometry(2.15 * CELL, 3.6 * CELL, 2.15 * CELL);
  const motes = [];
  const next = seeded(7);
  for (const item of placed) for (const lantern of item.lanterns ?? []) {
    const position = lantern.position.map((v, axis) => item.position[axis] + (v + 0.5) * CELL);
    const core = new THREE.Mesh(flameGeometry, flame);
    core.position.set(position[0] - CELL / 2, position[1] - CELL / 2, position[2] - CELL / 2);
    scene.add(core);
    for (let i = 0; i < 16; i++) {
      const angle = next() * Math.PI * 2, radius = 0.25 + next() * 1.1;
      motes.push(position[0] + Math.cos(angle) * radius, position[1] - 0.4 + next() * 1.8, position[2] + Math.sin(angle) * radius);
    }
  }
  for (let i = 0; i < 70; i++) {
    motes.push(pane.position.x + (next() - 0.5) * light.width * CELL * 1.3, 0.8 + next() * light.height * CELL * 0.7, windowAt[2] + 1 + next() * 4.5);
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
  window.__chatdomBench = {
    channel, name, style: art.style, land: land.character, label: art.label, glass: art.glass.kind, monument: !!art.monument, vane: !!art.vane,
    frames: art.monument?.frames.length ?? 0, frame: frameIndex, absences: art.absences, palette: art.palette.materials.length,
  };
  window.__chatdomReady = true;
}

function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

const colourOf = new Map(MATERIALS.materials.map(m => [m.id, m.colour]));
/** A pane's transmitted colour: its registered hue, deeper and more saturated, never black. */
function transmitted(material, kind) {
  if (kind === 'plain' || material === MAT.glass) return new THREE.Color('#ffc887');
  const colour = new THREE.Color(colourOf.get(material));
  const hsl = {};
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, Math.min(1, hsl.s * 1.9 + 0.12), Math.min(0.62, Math.max(0.34, hsl.l)));
  return colour;
}

function glassTexture(light, kind) {
  const { width, height, texels } = light;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const m = texels[x + width * y];
    if (!m) continue;
    const c = transmitted(m, kind), o = 4 * (x + width * y);
    data[o] = Math.round(c.r * 255); data[o + 1] = Math.round(c.g * 255); data[o + 2] = Math.round(c.b * 255); data[o + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The window's panes thrown onto the ground: the top of the window lands farthest out, blurred, fading with distance. */
function spillTexture(light, kind) {
  const { width, height, texels } = light;
  const canvas = document.createElement('canvas');
  canvas.width = width * 4; canvas.height = height * 4;
  const g = canvas.getContext('2d');
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const m = texels[x + width * y];
    if (!m) continue;
    const c = transmitted(m, kind);
    g.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    // The window's top lands farthest from the hall.
    g.fillRect(x * 4, y * 4, 4, 4);
  }
  const soft = document.createElement('canvas');
  soft.width = canvas.width; soft.height = canvas.height;
  const s = soft.getContext('2d');
  s.filter = 'blur(5px)';
  s.drawImage(canvas, 0, 0);
  s.filter = 'none';
  s.globalCompositeOperation = 'destination-in';
  const fade = s.createLinearGradient(0, 0, 0, soft.height);
  fade.addColorStop(0, 'rgba(0,0,0,0.25)'); fade.addColorStop(0.3, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  s.fillStyle = fade;
  s.fillRect(0, 0, soft.width, soft.height);
  const texture = new THREE.CanvasTexture(soft);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
