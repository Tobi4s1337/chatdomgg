import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { AVATAR_LOOK_LIMITS, VOXEL_METRES } from '@chatdom/shared';
import { REST_POSE, assembleLook, findReviewLineup, materialName, type ReviewLineup } from '@chatdom/content/avatars';
import { createCitizenCapeRenderer } from '../citizens/capes';
import { BENCH_ANGLES, benchOrientation, capeBounds, createCitizen, createPlinth, frameCamera, restBounds, type BenchAngle, type CitizenStats } from './stage';

export interface AvatarLineupReport {
  readonly lineup: string;
  readonly angle: BenchAngle;
  readonly hour: number;
  readonly silhouette: boolean;
  /** Measured per citizen: parts, cells and meshed triangles from the production worker. */
  readonly looks: readonly (CitizenStats & { readonly look: string; readonly cape: boolean })[];
  /** Renderer draw calls for the whole row of citizens, plinths hidden. */
  readonly draws: number;
  readonly limits: typeof AVATAR_LOOK_LIMITS;
}

declare global {
  interface Window {
    __chatdomLineup?: AvatarLineupReport;
  }
}

/** Centre-to-centre spacing along the row, in metres: room for the broad family and the widest hair. */
const SPACING = 1.3;
/** Flat ink for silhouettes: a dark plum on parchment, never pure black on white. */
const INK = '#2d2530', PARCHMENT = '#ebe1cb';

/**
 * Unlit ink for the production voxel meshes. Their vertices are packed into integer attributes (no
 * `position`), so a stock material draws nothing; this decodes the same cell position and chunk bits as
 * the voxel material's vertex stage and paints every fragment one flat colour.
 */
function voxelInk(scale: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uScale: { value: scale }, uInk: { value: new THREE.Color(INK) } },
    vertexShader: `
      in uint aPacked; in uint aMaterial; uniform float uScale;
      void main() {
        vec3 p = vec3(float(aPacked & 63u), float((aPacked >> 6u) & 63u), float((aPacked >> 12u) & 63u));
        p += 32. * vec3(float((aMaterial >> 16u) & 31u), float((aMaterial >> 21u) & 31u), float((aMaterial >> 26u) & 31u));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p * uScale, 1.);
      }`,
    fragmentShader: `
      out vec4 inkColour; uniform vec3 uInk;
      void main() { inkColour = linearToOutputTexel(vec4(uInk, 1.)); }`,
  });
}

/**
 * A row of SIMULATED review people at street distance, sharing one turntable angle and one hour.
 * Each citizen is built exactly as on the single-look bench (rig groups, production mesher, avatar
 * material, main's cape renderer); the row only places them side by side.
 */
export default function LineupBench() {
  let host!: HTMLDivElement;
  let disposed = false;
  let disposeScene: (() => void) | undefined;
  const params = new URLSearchParams(window.location.search);
  const lineupId = params.get('lineup') ?? '';
  const frame = params.get('frame') === 'still' ? 'still' : 'page';
  const initialAngle = (params.get('angle') ?? 'front') as BenchAngle;
  const rawHour = Number(params.get('hour') ?? 19);
  const hour = Number.isFinite(rawHour) ? rawHour : 19;
  const [angle, setAngle] = createSignal<BenchAngle>(initialAngle);
  const [status, setStatus] = createSignal('Gathering the citizens…');
  const [failed, setFailed] = createSignal(false);
  const [labels, setLabels] = createSignal<{ text: string; x: number; y: number }[]>([]);
  let lineup: ReviewLineup | undefined;
  try { lineup = findReviewLineup(lineupId); } catch { lineup = undefined; }
  const silhouette = lineup?.silhouette ?? false;
  const environment = getEnvironment(hour);
  const sky = silhouette ? PARCHMENT : `linear-gradient(180deg, ${environment.zenith} 0%, ${environment.horizon} 78%, ${environment.fog} 100%)`;

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomLineup;
    delete window.__chatdomAvatarError;
    void (async () => {
      if (!lineup) throw new Error(`There is no review lineup called “${lineupId}”.`);
      if (!BENCH_ANGLES.includes(initialAngle)) throw new Error('Choose front, side or back as the viewing angle.');
      const looks = lineup.looks.map(look => ({ look, ...assembleLook(look) }));
      const pool = new VoxelWorkerPool({ size: 2 });
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError = () => { throw new Error('Avatar shader compilation failed.'); };
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = silhouette ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.domElement.setAttribute('aria-label', `${lineup.title}, simulated review people`);
      host.append(renderer.domElement);
      const material = createVoxelMaterial(MATERIALS, 'avatar');
      material.setEnvironment(environment);
      const ink = new THREE.MeshBasicMaterial({ color: INK }), packedInk = voxelInk(VOXEL_METRES.avatar);
      const scene = new THREE.Scene();
      // Silhouettes repaint every mesh flat: packed voxel meshes with the decoding ink, anything else (cloth) plainly.
      const inkAll = (): void => scene.traverse(node => {
        if (node instanceof THREE.Mesh) node.material = node.geometry.getAttribute('aPacked') ? packedInk : ink;
      });
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
      const released: (() => void)[] = [() => pool.dispose(), () => material.dispose(), () => ink.dispose(), () => packedInk.dispose(), () => renderer.dispose(), () => renderer.domElement.remove()];
      disposeScene = () => { delete window.__chatdomAvatarView; for (const release of released.splice(0).reverse()) release(); };
      setStatus(`Carving ${looks.length} citizens on the avatar lattice…`);
      const plinth = await createPlinth(pool, material);
      released.push(() => plinth.geometry.dispose());
      const capes = looks.some(item => item.cape) ? createCitizenCapeRenderer(scene, { registry: MATERIALS, material, capacity: looks.length }) : undefined;
      if (capes) released.push(() => capes.dispose());
      const slots: { slot: THREE.Group; stand: THREE.Group; back: THREE.Object3D; bounds: THREE.Box3; label: string }[] = [];
      const stats: AvatarLineupReport['looks'][number][] = [];
      for (const { look, parts, cape } of looks) {
        const citizen = await createCitizen(pool, material, parts, REST_POSE, 1);
        released.push(() => citizen.dispose());
        if (disposed) return;
        const slot = new THREE.Group(), stand = new THREE.Group();
        const base = plinth.clone();
        base.visible = !silhouette;
        stand.add(base, citizen.root);
        slot.add(stand);
        scene.add(slot);
        const bounds = restBounds(parts);
        if (cape) bounds.union(capeBounds(cape));
        slots.push({ slot, stand, back: citizen.attachments.get('back')!, bounds, label: look.note });
        stats.push({ look: look.id, cape: Boolean(cape), ...citizen.stats });
      }
      const place = (): THREE.Box3 => {
        const view = benchOrientation(environment, angle());
        const right = new THREE.Vector3(0, 1, 0).cross(view.camera).normalize();
        const framed = new THREE.Box3();
        capes?.beginFrame(0);
        for (const [i, item] of slots.entries()) {
          item.slot.position.copy(right).multiplyScalar((i - (slots.length - 1) / 2) * SPACING);
          item.stand.rotation.y = view.yaw;
          item.slot.updateMatrixWorld(true);
          framed.union(item.bounds.clone().applyMatrix4(item.stand.matrixWorld));
          const cape = looks[i]!.cape;
          if (capes && cape) capes.add({ id: looks[i]!.look.id, heading: view.yaw, distance: 0, speed: 0 }, cape, item.back.matrixWorld);
        }
        capes?.endFrame();
        return framed;
      };
      const draw = (): void => {
        const width = host.clientWidth, height = host.clientHeight;
        renderer.setSize(width, height);
        frameCamera(camera, place(), benchOrientation(environment, angle()).camera, width / height, frame === 'still' ? .74 : .7, frame === 'still' ? .04 : 0);
        if (silhouette) inkAll();
        renderer.render(scene, camera);
        // Name each citizen under its feet, where the plinth meets the ground; a row too tight to read loses its names.
        // Silhouettes have no plinth, so their names drop below the lowest point of the figure instead.
        const feet = slots.map(item => new THREE.Vector3().setFromMatrixPosition(item.slot.matrixWorld).project(camera));
        const lowest = slots.map(item => {
          const box = item.bounds, corner = new THREE.Vector3();
          let y = Infinity;
          for (let i = 0; i < 8; i++) y = Math.min(y, corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(item.stand.matrixWorld).project(camera).y);
          return y;
        });
        const gap = feet.length > 1 ? Math.abs(feet[1]!.x - feet[0]!.x) / 2 * width : width;
        setLabels(gap < 96 ? [] : slots.map((item, i) => ({ text: item.label, x: (feet[i]!.x + 1) / 2 * width, y: (1 - (silhouette ? lowest[i]! : feet[i]!.y)) / 2 * height })));
      };
      if (disposed) return;
      window.addEventListener('resize', draw);
      released.push(() => window.removeEventListener('resize', draw));
      draw();
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      // Measure the citizens' own draws with every plinth hidden, then render the full frame.
      for (const item of slots) item.stand.children[0]!.visible = false;
      renderer.render(scene, camera);
      const draws = renderer.info.render.calls;
      for (const item of slots) item.stand.children[0]!.visible = !silhouette;
      draw();
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (disposed) return;
      draw();
      renderer.getContext().finish();
      const publish = (): void => {
        window.__chatdomLineup = { lineup: lineup!.id, angle: angle(), hour, silhouette, looks: stats, draws, limits: AVATAR_LOOK_LIMITS };
        host.dataset.lineup = lineup!.id;
        host.dataset.angle = angle();
      };
      window.__chatdomAvatarView = next => {
        if (!BENCH_ANGLES.includes(next)) throw new Error('Unknown avatar view.');
        window.__chatdomReady = false;
        setAngle(next);
        draw();
        renderer.getContext().finish();
        publish();
        window.__chatdomReady = true;
      };
      publish();
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

  const swatches = (): string => lineup ? [...new Set(lineup.looks.map(look => materialName(look.skin)))].join(' · ') : '';

  return <section class={`avatar-bench avatar-bench--still avatar-lineup${silhouette ? ' avatar-lineup--silhouette' : ''}`} style={{ background: sky }}>
    <div ref={element => { host = element; }} class="avatar-bench-stage" />
    <p class="avatar-still-label"><b>SIMULATED</b> {lineup?.title ?? lineupId} · {angle()}{silhouette ? '' : ` · ${hour}:00`} · street distance{frame === 'page' && !silhouette ? ` · skins ${swatches()}` : ''}</p>
    <Show when={!status()}>
      <For each={labels()}>{label => <span class="avatar-lineup-name" style={{ left: `${label.x}px`, top: `${label.y + 14}px` }}>{label.text}</span>}</For>
    </Show>
    <Show when={status()}>
      <div class="avatar-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The lineup could not be shown' : 'At the fitting bench'}</strong><p>{status()}</p></div>
    </Show>
  </section>;
}
