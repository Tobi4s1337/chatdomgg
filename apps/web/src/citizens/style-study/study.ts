import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { compileAvatarPart } from '@chatdom/content/avatars';
import { MAT } from '@chatdom/content/materials';
import { createVoxelMaterial, geometryFromChunks, getEnvironment, type VoxelRenderState } from '@chatdom/render';
import { VOXEL_METRES, type AvatarAttachmentId, type AvatarCapeBlueprint, type AvatarPartBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { AVATAR_STYLE_IDS, STYLE_STUDY_FIXTURES, avatarStyle, convertLook, currentRig, rigOffset, type AvatarStyleId, type StyleRig } from '../../../../../packages/content/src/avatar-style';
import { createCitizenCapeRenderer } from '../capes';
import { createLegacyCitizenLooks } from '../legacy-look';
import { checkFixture, readStyleSource } from './identity';

/*
 * The citizen bench (`../review.ts`) with one change of subject: the same five everyday looks, converted
 * into one candidate style per page. Scene, backdrop, ground, camera angle, tone mapping, voxel material
 * and noon environment are the bench's own; the frame is 16:9 and closer, so the figures are large enough
 * to judge silhouette and face. `?style=hearthling|blockwright|storybook|current`.
 */
type StudyStyle = AvatarStyleId | 'current';
const params = new URLSearchParams(location.search);
const requested = params.get('style') ?? 'hearthling';
if (requested !== 'current' && !(AVATAR_STYLE_IDS as readonly string[]).includes(requested)) throw new Error(`Unknown style ${requested}.`);
const styleId = requested as StudyStyle;
const hour = Number(params.get('hour') ?? 12);
const M = VOXEL_METRES.avatar;

/** Fixed study controls: identical in every option. */
const CONTROLS = { spacing: 1.3, heading: -.23, halfHeight: 1.95, target: new THREE.Vector3(0, 1.05, 0), eye: new THREE.Vector3(0, 3.2, 15), staffX: -3.3 } as const;

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#ede1c9');
const aspect = innerWidth / innerHeight;
const camera = new THREE.OrthographicCamera(-CONTROLS.halfHeight * aspect, CONTROLS.halfHeight * aspect, CONTROLS.halfHeight, -CONTROLS.halfHeight, .1, 100);
camera.position.copy(CONTROLS.eye); camera.lookAt(CONTROLS.target);
camera.updateMatrixWorld(); camera.updateProjectionMatrix();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: '#d1c3a6' }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; scene.add(ground);
const material = createVoxelMaterial(MATERIALS, 'avatar');
material.setEnvironment(getEnvironment(hour));

interface StudyCitizen { readonly parts: readonly AvatarPartBlueprint[]; readonly rig: StyleRig; readonly cape: AvatarCapeBlueprint | null }

const looks = createLegacyCitizenLooks();
const citizens = STYLE_STUDY_FIXTURES.map((fixture): StudyCitizen => {
  const look = looks.find(item => item.id === fixture.look);
  if (!look) throw new Error(`No everyday look ${fixture.look}.`);
  const source = readStyleSource(look);
  checkFixture(fixture, source);
  if (styleId === 'current') return { parts: look.parts.map(p => p.blueprint), rig: currentRig(), cape: look.cape ?? null };
  const styled = convertLook(styleId, source);
  return { parts: styled.parts, rig: styled.rig, cape: styled.cape };
});

/** A measuring staff on the avatar lattice: timber, a brass band every half metre. */
const STAFF: AvatarPartBlueprint = {
  version: 1, id: 'study.staff', lattice: 'avatar', size: [2, 33, 2], pivot: [1, 0, 1], attachment: 'root', layer: 'accessory',
  boxes: [{ from: [0, 0, 0], to: [2, 33, 2], material: MAT.timber }, ...[8, 16, 24, 32].map(y => ({ from: [0, y, 0] as [number, number, number], to: [2, y + 1, 2] as [number, number, number], material: MAT.brass }))],
};

async function meshPart(pool: VoxelWorkerPool, state: VoxelRenderState, part: AvatarPartBlueprint): Promise<THREE.InstancedMesh> {
  const asset = compileAvatarPart(part, 0);
  const result = await pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (!result || result.kind !== 'asset') throw new Error(`Could not mesh ${part.id}.`);
  const geometry = geometryFromChunks(result.chunks, 'avatar');
  geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
  const mesh = new THREE.InstancedMesh(geometry, state.material, 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(...part.pivot.map(n => -n * M) as [number, number, number]));
  mesh.frustumCulled = false;
  return mesh;
}

/** Nested joints at the rig's rest offsets, each turned by the fixture's pose. */
function buildSkeleton(rig: StyleRig, pose: (typeof STYLE_STUDY_FIXTURES)[number]['pose']): Map<AvatarAttachmentId, THREE.Object3D> {
  const nodes = new Map<AvatarAttachmentId, THREE.Object3D>();
  const make = (id: AvatarAttachmentId): THREE.Object3D => {
    const known = nodes.get(id);
    if (known) return known;
    const node = new THREE.Group();
    node.name = id;
    node.position.set(...rigOffset(rig, id).map(n => n * M) as [number, number, number]);
    const turn = (pose as Partial<Record<string, readonly [number, number, number]>>)[id];
    if (turn) node.rotation.set(turn[0], turn[1], turn[2], 'XYZ');
    nodes.set(id, node);
    const parent = rig.parent.get(id);
    if (parent) make(parent).add(node);
    return node;
  };
  for (const id of rig.rest.keys()) make(id);
  return nodes;
}

const project = (p: THREE.Vector3): { x: number; y: number } => {
  const v = p.clone().project(camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
};

function describe(): void {
  const option = document.querySelector('#option')!, title = document.querySelector('#title')!, summary = document.querySelector('#summary')!, facts = document.querySelector('#facts')!;
  const sim = '<span class="simulated">SIMULATED REVIEW PEOPLE · FIVE EVERYDAY LOOKS</span>';
  if (styleId === 'current') {
    option.textContent = 'Reference · not an option';
    title.textContent = 'Today’s citizen';
    summary.textContent = 'The wardrobe as it stands, posed and lit exactly as the three options.';
    facts.innerHTML = `<b>1.50 m</b> tall · head <b>33%</b> of height<br>24 cells · 6.25 cm voxels<br>${sim}`;
    return;
  }
  const s = avatarStyle(styleId);
  option.textContent = `Option ${s.option} · ${s.inspiration}`;
  title.textContent = s.name;
  summary.textContent = s.summary;
  const head = Math.round((s.head.y[1] - s.head.y[0]) / s.height * 100);
  facts.innerHTML = `<b>${(s.height * M).toFixed(2)} m</b> tall · head <b>${head}%</b> of height<br>${s.height} cells · 6.25 cm voxels<br>${sim}`;
}

try {
  describe();
  const pool = new VoxelWorkerPool({ size: 2 });
  const capes = createCitizenCapeRenderer(scene, { registry: MATERIALS, material, capacity: STYLE_STUDY_FIXTURES.length });
  const roots: { root: THREE.Object3D; back: THREE.Object3D; cape: AvatarCapeBlueprint | null }[] = [];
  for (const [i, citizen] of citizens.entries()) {
    const fixture = STYLE_STUDY_FIXTURES[i]!;
    const nodes = buildSkeleton(citizen.rig, fixture.pose);
    const root = nodes.get('root')!;
    root.position.set((i - (citizens.length - 1) / 2) * CONTROLS.spacing, 0, 0);
    root.rotation.y = CONTROLS.heading;
    for (const part of citizen.parts) nodes.get(part.attachment)!.add(await meshPart(pool, material, part));
    scene.add(root);
    roots.push({ root, back: nodes.get('back')!, cape: citizen.cape });
  }
  const staff = await meshPart(pool, material, STAFF);
  staff.position.set(CONTROLS.staffX, 0, 0);
  scene.add(staff);
  scene.updateMatrixWorld(true);
  capes.beginFrame(0, [0, 0]);
  roots.forEach(({ back, cape }, i) => { if (cape) capes.add({ id: `simulated-${i}`, heading: CONTROLS.heading, distance: 0, speed: 0 }, cape, back.matrixWorld); });
  capes.endFrame();
  renderer.render(scene, camera);
  pool.dispose();

  // Names under the feet, half-metre marks beside the staff, and the band the contact sheet keeps.
  const labels = document.querySelector('#labels')!;
  let bottom = 0;
  STYLE_STUDY_FIXTURES.forEach((fixture, i) => {
    const at = project(new THREE.Vector3((i - (STYLE_STUDY_FIXTURES.length - 1) / 2) * CONTROLS.spacing, -.16, 0));
    const el = document.createElement('div');
    el.className = 'label';
    el.style.left = `${at.x}px`; el.style.top = `${at.y}px`;
    el.innerHTML = `${fixture.label}<small>SIMULATED</small><em>${fixture.expect.family} · ${fixture.expect.hair.replace(/([A-Z])/g, ' $1').toLowerCase()}${fixture.expect.cloak ? ' · cloak' : ''}</em>`;
    labels.append(el);
    bottom = Math.max(bottom, at.y + 70);
  });
  for (const [metres, text] of [[.5, '½ m'], [1, '1 m'], [1.5, '1½ m'], [2, '2 m']] as const) {
    const at = project(new THREE.Vector3(CONTROLS.staffX + .1, metres + M / 2, 0));
    const el = document.createElement('div');
    el.className = 'tick'; el.textContent = text;
    el.style.left = `${at.x + 6}px`; el.style.top = `${at.y}px`;
    labels.append(el);
  }
  const top = project(new THREE.Vector3(0, 2.4, 0)).y;
  (window as Window & { __studyBand?: { top: number; bottom: number } }).__studyBand = { top: Math.max(0, Math.round(top)), bottom: Math.min(innerHeight, Math.round(bottom)) };
  (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
} catch (error) {
  document.body.textContent = `Style study failed: ${String(error)}`;
  throw error;
}
