// The Forge ritual's set: the bench's real pieces (a native Hearth house, the local grammar's dragon chimney at
// its validated socket, main's anvil, the shared presentation) in the bench's paved yard, dressed with the town
// forge square's own fixtures (workshop, hearth, gate braziers) at the offsets the kingdom places them around its
// anvil, under the product sky and post stack. The forge's light reaches the yard through the voxel shader's own
// light volume and smithy bounce, the way the kingdom lights its square while a casting pours.
//
// Everything here is a pure function of the ritual second: `draw(t)` poses every product object from t alone,
// so any frame can be drawn first and looks the same as when it is reached from 0.
import * as THREE from 'three';
import { createHome, MAT, MATERIALS, STYLES, type StyleKey } from '../../../../../packages/content/src/index';
import { assembleForge, checkForge, findForgeSockets, forgeRitualFrame, forgeStyleKit, planLocalForge } from '../../../../../packages/forge/src/index';
import { createAtmosphere, createPostStack, createVoxelMaterial, geometryFromChunks, getEnvironment, type PostQuality } from '../../../../../packages/render/src/index';
import { VOXEL_METRES, type ForgeRitualFrame, type Vec3, type VoxelBlueprint } from '../../../../../packages/shared/src/index';
import { buildLightVolume, VoxelWorkerPool } from '../../../../../packages/voxel/src/index';
import { createForgeRitualView } from '../../../../web/src/forge/ritual-view';
import { createForgeStage, type ForgePresentation, type StageEnvironment } from '../../../../web/src/forge/presentation/stage';
import { createForgeEmitters } from '../../../../web/src/forge/emitters';
import { BENCH_WISHES } from '../../../../web/src/forge-ritual-bench/params';
import { createForgeSquareContent } from '../../../../web/src/kingdom/forge-square-content';
import { createRoyalLife } from '../../../../web/src/kingdom/royal-life';
import { buildLightFieldSamples } from '../../../../web/src/kingdom/light-field-worker';
import { selectTree, type TreeSpecies } from '../../../../../packages/content/src/trees/index';

const CELL = VOXEL_METRES.build;
/** The bench's layout: the home at the origin facing +z; the anvil out in a paved yard in front and to its right. */
export const ANVIL_GROUND = new THREE.Vector3(16, 0, 22);
/** Main's anvil stage: the top of its iron face sits 1.45 m above the ground (the presentation's work surface). */
export const WORK_SURFACE = 1.45;
/** The kingdom stands its anvil at (0, elevation, 8); the forge square's fixtures are placed around that point. */
const KINGDOM_ANVIL = new THREE.Vector3(0, 0, 8);
const YARD = { origin: new THREE.Vector3(-4, -2 * CELL, 4), size: 256 };
const MEADOW = 2;
/** The near light volume: half-metre cells, centred on the anvil, as the kingdom's near field. */
const FIELD = { size: [72, 24, 72] as Vec3, cell: .5 };
/**
 * The kingdom's picture trees around the yard (metres from the anvil, a seed, a yaw in quarter turns), so the
 * meadow's far edge never meets the sky as a bare line behind the forge. None stands on the camera's side.
 */
const TREES: readonly { at: readonly [number, number]; species: TreeSpecies; seed: string; turn: number }[] = [
  { at: [-27, -31], species: 'oak', seed: 'a', turn: 0 }, { at: [-9, -36], species: 'pine', seed: 'b', turn: 1 },
  { at: [5, -29], species: 'oak', seed: 'c', turn: 2 }, { at: [17, -25], species: 'pine', seed: 'd', turn: 3 },
  { at: [27, -13], species: 'oak', seed: 'e', turn: 1 }, { at: [31, 3], species: 'pine', seed: 'f', turn: 0 },
  { at: [-31, -9], species: 'birch', seed: 'g', turn: 2 }, { at: [12, -42], species: 'pine', seed: 'h', turn: 1 },
  { at: [-19, -46], species: 'pine', seed: 'i', turn: 3 }, { at: [35, -31], species: 'oak', seed: 'j', turn: 2 },
  { at: [-41, -27], species: 'oak', seed: 'k', turn: 1 }, { at: [-2, -52], species: 'oak', seed: 'l', turn: 0 },
  { at: [24, -48], species: 'birch', seed: 'm', turn: 3 }, { at: [-36, 8], species: 'pine', seed: 'n', turn: 2 },
];

function yard(styleId: VoxelBlueprint['styleId'], paved: boolean): VoxelBlueprint {
  const n = YARD.size, boxes: VoxelBlueprint['boxes'] = [
    { from: [0, 0, 0], to: [n, 1, n], material: MAT.earth },
    { from: [0, 1, 0], to: [n, 2, n], material: MAT.grass },
  ];
  // The bench's worn paved circle around the anvil, one row of build cells at a time.
  const cx = Math.round((ANVIL_GROUND.x - YARD.origin.x) / CELL), cz = Math.round((ANVIL_GROUND.z - YARD.origin.z) / CELL);
  for (const [radius, material] of paved ? [[22, MAT.darkStone], [20, MAT.paving]] as const : []) {
    for (let dz = -radius; dz < radius; dz++) {
      const half = Math.floor(Math.sqrt(radius * radius - (dz + .5) ** 2));
      if (half > 0) boxes.push({ from: [cx - half, 1, cz + dz], to: [cx + half, 2, cz + dz + 1], material });
    }
  }
  return { version: 1, id: paved ? 'forge-ritual-yard' : 'forge-ritual-meadow', styleId, kind: 'prop', lattice: 'build', size: [n, 2, n], boxes, windows: [] };
}

export interface ForgeWorld {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Top centre of the anvil's work surface, world metres. */
  anvil: THREE.Vector3;
  /** The forged part's size on the anvil, metres. */
  part: THREE.Vector3;
  /** Where the hammer meets the part: its highest face nearest the middle, standing on the anvil. */
  strike: THREE.Vector3;
  triangles: number;
  resize(width: number, height: number, ratio: number): void;
  /** Poses and draws the ritual at second t; `focus` is the lens's focus distance in metres (null: none). */
  draw(t: number, focus: number | null): void;
  stats(): Record<string, unknown>;
}

/** Full motion, a desktop/stream particle budget: the film never follows the viewer's reduced-motion setting. */
const FILM: StageEnvironment = { reducedMotion: () => false, subscribe: () => () => {}, phone: false };

export async function createForgeWorld(canvas: HTMLCanvasElement, options: { ritualId: string; hour: number; family: StyleKey; quality: PostQuality | 'none' }): Promise<ForgeWorld> {
  const { ritualId, hour, family } = options;
  // The bench's real assembly: the local grammar reads the wish (chimney, sleeping-dragon), main assembles it
  // at the home's validated chimney socket and checks it against the home.
  const home = createHome('house', family, 0);
  const plan = planLocalForge(BENCH_WISHES.chimney);
  const socket = findForgeSockets(home).find(s => s.kind === plan.kind);
  if (!socket) throw new Error(`This home has no clear ${plan.kind} socket.`);
  const result = assembleForge(plan, forgeStyleKit(family), socket);
  checkForge(result, home);

  const grade = getEnvironment(hour);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = () => { throw new Error('Forge set shader compilation failed.'); };
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = grade.exposure;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .05, 600);
  const atmosphere = createAtmosphere(scene);
  const material = createVoxelMaterial(MATERIALS, 'build');
  material.setEnvironment(grade);

  // The physical stage (anvil, engraving) from the shared ritual view. Its own legacy effects stay hidden: the
  // shared presentation below draws the ritual, exactly as the kingdom's realm scene composes the two.
  const view = createForgeRitualView(scene, material);
  view.root.position.copy(ANVIL_GROUND);
  view.update(null);
  view.setEnvironment(grade);
  const effects = new THREE.Group(); effects.name = 'forge-ritual-effects'; scene.add(effects);

  // The town forge square's fixtures, moved from the kingdom's anvil to this one.
  const square = createForgeSquareContent(0);
  const shift = ANVIL_GROUND.clone().sub(KINGDOM_ANVIL);
  const moved = (p: Vec3): Vec3 => [p[0] + shift.x, p[1] + shift.y, p[2] + shift.z];

  const pool = new VoxelWorkerPool({ size: 2 });
  let revision = 0;
  const mesh = async (blueprint: VoxelBlueprint) => {
    const out = await pool.submit({ kind: 'blueprint', blueprint, revision: ++revision, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (out?.kind !== 'asset' || !out.chunks.length) throw new Error(`The voxel worker did not return ${blueprint.id}.`);
    return { geometry: geometryFromChunks(out.chunks, 'build'), triangles: out.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0) };
  };
  const trees = TREES.map(t => ({ ...t, tree: selectTree(family, t.species, `forge-set:${t.seed}`) }));
  const [ground, meadow, house, forged, ...rest] = await Promise.all([
    mesh(yard(STYLES[family].id, true)), mesh(yard(STYLES[family].id, false)), mesh(home), mesh(result.blueprint),
    ...square.props.map(p => mesh(p.blueprint)), ...trees.map(t => mesh(t.tree.blueprint)),
  ]);
  const props = rest.slice(0, square.props.length), treeMeshes = rest.slice(square.props.length);
  pool.dispose();
  let triangles = ground.triangles + house.triangles + forged.triangles;
  for (let x = -MEADOW; x <= MEADOW; x++) for (let z = -MEADOW; z <= MEADOW; z++) {
    const tile = new THREE.Mesh(x || z ? meadow.geometry : ground.geometry, material.material);
    tile.position.copy(YARD.origin).add(new THREE.Vector3(x, 0, z).multiplyScalar(YARD.size * CELL)); scene.add(tile);
  }
  const houseMesh = new THREE.Mesh(house.geometry, material.material); scene.add(houseMesh);
  square.props.forEach((p, i) => {
    const m = new THREE.Mesh(props[i]!.geometry, material.material);
    m.position.set(...moved(p.position)); m.rotation.y = p.yaw; scene.add(m);
    triangles += props[i]!.triangles;
  });

  trees.forEach((t, i) => {
    const holder = new THREE.Group();
    holder.position.set(ANVIL_GROUND.x + t.at[0], 0, ANVIL_GROUND.z + t.at[1]); holder.rotation.y = t.turn * Math.PI / 2;
    const m = new THREE.Mesh(treeMeshes[i]!.geometry, material.material);
    m.position.set(-t.tree.root[0] * CELL, 0, -t.tree.root[2] * CELL);
    holder.add(m); scene.add(holder);
    triangles += treeMeshes[i]!.triangles;
  });

  // The host's presentation clone, posed at its validated socket like the kingdom poses an arriving part.
  const piece = new THREE.Mesh(forged.geometry, material.material);
  piece.name = 'forge-presentation-clone';
  piece.position.set(...socket.origin).multiplyScalar(CELL);
  piece.frustumCulled = false; scene.add(piece); piece.updateMatrixWorld(true);
  const anvil = ANVIL_GROUND.clone().add(new THREE.Vector3(0, WORK_SURFACE, 0));
  const presentation: ForgePresentation = createForgeStage({ root: effects, anvil: anvil.toArray(), landing: piece.position.toArray(), piece }, FILM);
  // The forged part's tight size (its blueprint's box is the socket's whole allowance).
  const tight = new THREE.Box3();
  for (const b of result.blueprint.boxes) if (b.material !== 0) tight.expandByPoint(new THREE.Vector3(...b.from)).expandByPoint(new THREE.Vector3(...b.to));
  const part = tight.getSize(new THREE.Vector3()).multiplyScalar(CELL);

  // The seal's ribbon letters its judgement in the canvas; the plate never shows words, so the seal stays down.
  const seal = effects.getObjectByName('forge-seal');
  if (!seal) throw new Error('The forge seal was not found.');
  const hideWords = () => {
    seal.visible = false;
    // The ritual view's own stamp sprite ("fit for this home") is never shown either.
    view.root.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = false; });
  };

  // The hearth and braziers burn as they do on the town square, and the hearth's chimney breathes smoke.
  const hearth = createRoyalLife(scene, material, undefined, square.fires.filter(f => f.normal[1] === 0).map(f => ({ position: moved(f.position), normal: f.normal })), undefined, true);
  const braziers = createRoyalLife(scene, material, undefined, square.fires.filter(f => f.normal[1] !== 0).map(f => ({ position: moved(f.position), normal: f.normal })), undefined, false, true);
  const breath = createForgeEmitters(scene), emitters = createForgeEmitters(scene);
  const noses = square.noses.map(n => ({ position: new THREE.Vector3(...moved(n)), kind: 'smoke' as const }));

  const post = options.quality === 'none' ? null : createPostStack(renderer, scene, camera, { quality: options.quality, toneMapping: 'aces', fog: 'material' });

  // The light volume: the ground below the yard is solid; the fires and the casting are emitters.
  const fieldOrigin: Vec3 = [Math.floor(ANVIL_GROUND.x - FIELD.size[0] * FIELD.cell / 2), -2, Math.floor(ANVIL_GROUND.z - FIELD.size[2] * FIELD.cell / 2)];
  const occupancy = new Uint8Array(FIELD.size[0] * FIELD.size[1] * FIELD.size[2]);
  for (let z = 0; z < FIELD.size[2]; z++) for (let y = 0; y < FIELD.size[1]; y++) {
    if (fieldOrigin[1] + (y + 1) * FIELD.cell > 0) continue;
    occupancy.fill(1, FIELD.size[0] * (y + FIELD.size[1] * z), FIELD.size[0] * (y + 1 + FIELD.size[1] * z));
  }
  let fieldKey = '', fieldRevision = 0, fieldBuilds = 0;
  const anvilFace = ANVIL_GROUND.clone().add(new THREE.Vector3(0, 1.43, 0));

  /** The realm scene's casting heat for a phase: what lights the square while metal is liquid. */
  const castingHeat = (f: ForgeRitualFrame) => f.phase === 'pour' || f.phase === 'strike' ? 1 : f.phase === 'seal' ? .85 : f.phase === 'cool' ? 1 - f.phaseProgress : 0;
  /** The kingdom eases its smithy shade toward heat × night at rate 3/s; integrated here from 0, so it is pure in t. */
  const smithyShade = (t: number) => {
    let shade = 0;
    const dt = 1 / 120, steps = Math.round(t / dt);
    for (let i = 0; i < steps; i++) shade += (castingHeat(forgeRitualFrame(ritualId, i * dt)) * grade.night - shade) * Math.min(1, dt * 3);
    return shade;
  };

  function light(frame: ForgeRitualFrame) {
    const heat = castingHeat(frame);
    const sources: { position: Vec3; strength: number }[] = [...hearth.sources(), ...braziers.sources()];
    if (heat > 0) sources.push(
      { position: [anvilFace.x, anvilFace.y + .45, anvilFace.z], strength: heat },
      { position: [anvilFace.x - .5, anvilFace.y + .3, anvilFace.z - .4], strength: heat },
    );
    const emitted = sources.map(s => ({ position: s.position, level: Math.min(15, Math.round(15 * s.strength)) })).filter(e => e.level > 0);
    const key = JSON.stringify(emitted);
    if (key === fieldKey) return;
    fieldKey = key;
    const raw = buildLightVolume({ revision: ++fieldRevision, origin: fieldOrigin, size: FIELD.size, cellSize: FIELD.cell, occupancy, emitters: emitted });
    // The kingdom's surface samples: shared cell corners, so the pool on the ground is smooth, not blocky.
    const volume = { ...raw, surfaceSamples: buildLightFieldSamples(FIELD.size, occupancy, raw.light) };
    material.setLight(volume); material.setFarLight(volume);
    fieldBuilds++;
  }

  function draw(t: number, focus: number | null) {
    const frame = forgeRitualFrame(ritualId, t);
    presentation.update(frame);
    view.update(null);
    view.updateAnvil(frame);
    hideWords();
    hearth.update(t, undefined, hour); braziers.update(t, undefined, hour);
    light(frame);
    const shade = smithyShade(t);
    material.material.uniforms.uSmithyPower!.value = shade;
    (material.material.uniforms.uSmithyOrigin!.value as THREE.Vector3).set(ANVIL_GROUND.x, ANVIL_GROUND.y + 2.3, ANVIL_GROUND.z);
    breath.update({ time: t, anvil: anvilFace, activity: 0, landed: noses });
    emitters.update({ time: t, anvil: anvilFace, activity: frame.phase === 'pour' ? 1 : 0,
      fillHeight: frame.phase === 'pour' ? part.y * frame.phaseProgress : 0, strike: frame.phase === 'strike' ? 1 - frame.phaseProgress : 0 });
    camera.updateMatrixWorld();
    atmosphere.update(hour, t, camera, ANVIL_GROUND, 0);
    if (post) {
      post.update({ environment: grade, hour, focusDistance: focus, forge: { position: ANVIL_GROUND.clone().add(new THREE.Vector3(0, 1.6, 0)), strength: 1 } });
      post.render(0);
    } else renderer.render(scene, camera);
  }

  // The strike point, as the presentation finds it: the highest upward face nearest the part's middle.
  const strike = anvil.clone().add(new THREE.Vector3(0, .05 + part.y, 0));

  return {
    renderer, scene, camera, anvil, part, strike, triangles,
    resize(width, height, ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      post?.resize(width, height, ratio);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    draw,
    stats: () => ({ triangles, part: part.toArray(), fieldBuilds, post: post?.diagnostics() ?? null, calls: renderer.info.render.calls }),
  };
}
