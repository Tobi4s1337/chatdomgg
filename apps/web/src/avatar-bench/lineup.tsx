import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { VOXEL_METRES } from '@chatdom/shared';
import { REST_POSE, assembleLook, findReviewLineup, findReviewLook, type ReviewLineup, type ReviewLook } from '@chatdom/content/avatars';
import { createCitizenCapeRenderer } from '../citizens/capes';
import { BENCH_ANGLES, benchOrientation, createCitizen, createPlinth, framePoints, type BenchAngle, type Citizen } from './stage';

export interface AvatarLineupReport {
  readonly lineup: string;
  readonly looks: readonly string[];
  readonly angle: BenchAngle;
  readonly hour: number;
  readonly distance: ReviewLineup['distance'];
  readonly silhouette: boolean;
  readonly triangles: number;
  readonly draws: number;
  /** Tallest figure on screen in CSS pixels, so street distance is a measured size, not a claim. */
  readonly figurePixels: number;
}

declare global {
  interface Window { __chatdomLineup?: AvatarLineupReport }
}

/** The kingdom's street camera: 43° lens, about fifteen metres from the people it watches, 20° above them. */
const STREET = { fov: 43, distance: 15, elevation: 20 * Math.PI / 180 } as const;
/** Spacing between figures (metres): wide enough for a flared cape or paired twists. */
const SPACING = 1.15;
/** Unadorned height plus the tallest hair, for framing and row spacing. */
const FIGURE = 1.85;
/** Plinth scale in a lineup: its radius stays inside half the spacing. */
const PLINTH = .62;
const SILHOUETTE_PAPER = '#e9dcc2';

interface Slot { readonly look: ReviewLook; readonly position: THREE.Vector3 }

/**
 * Lays the figures out on a grid facing the camera. Close lineups use one row when the frame is wide
 * and as many rows as keep figures large when it is tall; rows step back far enough that the row
 * behind is never hidden. Street lineups stand in one row across the street, as far off as the
 * kingdom camera, so nobody is judged from behind a neighbour.
 */
function layout(looks: readonly ReviewLook[], distance: ReviewLineup['distance'], aspect: number, rise: number): Slot[] {
  let columns = looks.length;
  if (distance === 'close') {
    let best = 0;
    for (let c = 1; c <= looks.length; c++) {
      const rows = Math.ceil(looks.length / c);
      // Each row behind shows a full figure plus a gap above the one in front of it.
      const scale = Math.min(aspect / (c * SPACING), 1 / (Math.cos(rise) * (FIGURE + (rows - 1) * (FIGURE + .35)) + .3));
      if (scale > best + 1e-9) { best = scale; columns = c; }
    }
  }
  // Depth between rows: in an orthographic view the back row's feet clear the front row's heads.
  const depth = (FIGURE + .35) / Math.tan(rise);
  return looks.map((look, i) => {
    const row = Math.floor(i / columns), column = i % columns;
    const inRow = Math.min(columns, looks.length - row * columns);
    return { look, position: new THREE.Vector3((column - (inRow - 1) / 2) * SPACING, 0, -row * depth) };
  });
}

export default function AvatarLineup(props: { id: string }) {
  let host!: HTMLDivElement;
  let disposed = false;
  let disposeScene: (() => void) | undefined;
  const params = new URLSearchParams(window.location.search);
  const rawHour = Number(params.get('hour') ?? 19);
  const hour = Number.isFinite(rawHour) ? rawHour : 19;
  const angle = (params.get('angle') ?? 'front') as BenchAngle;
  const [status, setStatus] = createSignal('Gathering the simulated citizens…');
  const [failed, setFailed] = createSignal(false);
  const [labels, setLabels] = createSignal<{ id: string; text: string; x: number; y: number }[]>([]);
  let lineup: ReviewLineup | undefined;
  try { lineup = findReviewLineup(props.id); } catch { lineup = undefined; }
  const silhouette = Boolean(lineup?.silhouette);
  const environment = getEnvironment(hour);
  const sky = silhouette ? SILHOUETTE_PAPER : `linear-gradient(180deg, ${environment.zenith} 0%, ${environment.horizon} 78%, ${environment.fog} 100%)`;

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomLineup;
    delete window.__chatdomAvatarError;
    void (async () => {
      if (!lineup) throw new Error(`There is no review lineup called “${props.id}”.`);
      if (!BENCH_ANGLES.includes(angle)) throw new Error('Choose front, side or back as the viewing angle.');
      const looks = lineup.looks.map(findReviewLook);
      const pool = new VoxelWorkerPool({ size: 2 });
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.domElement.setAttribute('aria-label', `Simulated lineup: ${lineup.label}`);
      host.append(renderer.domElement);
      const material = createVoxelMaterial(MATERIALS, 'avatar');
      material.setEnvironment(environment);
      const scene = new THREE.Scene();
      const citizens: Citizen[] = [];
      disposeScene = () => { for (const c of citizens) c.dispose(); pool.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };

      const width = host.clientWidth, height = host.clientHeight, aspect = width / height;
      renderer.setSize(width, height);
      const view = benchOrientation(environment, angle);
      const azimuth = Math.atan2(view.camera.x, view.camera.z);
      const rise = lineup.distance === 'street' ? STREET.elevation : Math.asin(view.camera.y);
      const slots = layout(looks, lineup.distance, aspect, rise);
      // The lineup faces the camera; each person turns by the review angle within it, under the hour's light.
      const crowd = new THREE.Group();
      crowd.rotation.y = azimuth;
      scene.add(crowd);
      const plinth = await createPlinth(pool, material);
      const backs: { citizen: Citizen; cape: NonNullable<ReturnType<typeof assembleLook>['cape']>; id: string }[] = [];
      setStatus('Carving each citizen on the avatar lattice…');
      let triangles = 0;
      for (const slot of slots) {
        const { parts, cape } = assembleLook(slot.look);
        const citizen = await createCitizen(pool, material, parts, REST_POSE, 1);
        if (disposed) { citizen.dispose(); return; }
        citizens.push(citizen);
        triangles += citizen.stats.triangles;
        const stand = new THREE.Group();
        stand.position.copy(slot.position);
        stand.rotation.y = view.yaw - azimuth;
        // A smaller plinth each, so neighbours' stones never overlap.
        if (!silhouette) {
          const base = new THREE.Group();
          base.scale.setScalar(PLINTH);
          base.add(plinth.clone());
          stand.add(base);
        }
        stand.add(citizen.root);
        crowd.add(stand);
        if (cape) backs.push({ citizen, cape, id: slot.look.id });
      }
      scene.updateMatrixWorld(true);
      const capes = backs.length ? createCitizenCapeRenderer(scene, { registry: MATERIALS, material, capacity: backs.length }) : undefined;
      if (capes) {
        capes.beginFrame(0);
        for (const { citizen, cape, id } of backs) capes.add({ id, heading: 0, distance: 0, speed: 0 }, cape, citizen.attachments.get('back')!.matrixWorld);
        capes.endFrame();
      }
      const release = disposeScene;
      disposeScene = () => { capes?.dispose(); plinth.geometry.dispose(); release(); };

      // Framing: the corners of the crowd's own box, turned with it, standing on the ground.
      const local = new THREE.Box3();
      for (const slot of slots) local.expandByPoint(slot.position.clone().add(new THREE.Vector3(-SPACING / 2, -.15, -SPACING / 2))).expandByPoint(slot.position.clone().add(new THREE.Vector3(SPACING / 2, FIGURE, SPACING / 2)));
      const corners: THREE.Vector3[] = [];
      for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(crowd.matrixWorld));
      const bounds = new THREE.Box3().setFromPoints(corners);
      let camera: THREE.Camera;
      if (lineup.distance === 'street') {
        const lens = new THREE.PerspectiveCamera(STREET.fov, aspect, .1, 200);
        const centre = bounds.getCenter(new THREE.Vector3()), size = local.getSize(new THREE.Vector3());
        const direction = new THREE.Vector3(Math.sin(azimuth) * Math.cos(rise), Math.sin(rise), Math.cos(azimuth) * Math.cos(rise));
        // Fifteen metres unless the crowd is wider than the lens sees there; then step back, never in.
        const across = Math.atan(Math.tan(THREE.MathUtils.degToRad(STREET.fov) / 2) * aspect);
        const needed = Math.max(size.x, size.z) / 2 / Math.tan(across) / .92 + Math.max(size.x, size.z) / 2;
        lens.position.copy(centre).addScaledVector(direction, Math.max(STREET.distance, needed));
        lens.lookAt(centre);
        camera = lens;
      } else {
        const lens = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 400);
        framePoints(lens, corners, view.camera, aspect, .84, -.02);
        camera = lens;
      }
      camera.updateMatrixWorld(true);
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      renderer.render(scene, camera);
      const draws = renderer.info.render.calls;
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (disposed) return;
      renderer.render(scene, camera);
      renderer.getContext().finish();

      // Name plates under each figure, and the tallest figure's measured height on screen.
      const project = (p: THREE.Vector3): THREE.Vector3 => p.clone().project(camera);
      let figurePixels = 0;
      setLabels(slots.map(slot => {
        const foot = slot.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), azimuth);
        const top = project(foot.clone().setY(24 * VOXEL_METRES.avatar)), ground = project(foot.clone().setY(-.12));
        figurePixels = Math.max(figurePixels, (top.y - ground.y) / 2 * height);
        return { id: slot.look.id, text: slot.look.note, x: (ground.x + 1) / 2 * width, y: (1 - ground.y) / 2 * height };
      }));
      const report: AvatarLineupReport = { lineup: lineup.id, looks: lineup.looks, angle, hour, distance: lineup.distance, silhouette, triangles, draws, figurePixels: Math.round(figurePixels) };
      host.dataset.lineup = lineup.id;
      window.__chatdomLineup = report;
      setStatus('');
      window.__chatdomReady = true;
    })().catch(error => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      window.__chatdomAvatarError = message;
      setStatus(message); setFailed(true);
      console.error(message);
    });
  });
  onCleanup(() => { disposed = true; disposeScene?.(); window.__chatdomReady = false; });

  return <section class={`avatar-lineup${silhouette ? ' avatar-lineup--silhouette' : ''}`} style={{ background: sky }}>
    <div ref={element => { host = element; }} class="avatar-bench-stage" />
    <p class="avatar-still-label"><b>SIMULATED</b> {lineup?.label ?? props.id} · {lineup?.distance === 'street' ? 'street distance' : 'close'} · {angle} · {hour}:00</p>
    <Show when={lineup?.distance !== 'street'}>
      <For each={labels()}>{label => <span class="avatar-lineup-name" style={{ left: `${label.x}px`, top: `${label.y}px` }}>{label.text}</span>}</For>
    </Show>
    <Show when={status()}>
      <div class="avatar-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The lineup could not be shown' : 'At the fitting bench'}</strong><p>{status()}</p></div>
    </Show>
  </section>;
}
