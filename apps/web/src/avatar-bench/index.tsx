import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { AVATAR_LOOK_LIMITS, VOXEL_METRES } from '@chatdom/shared';
import { REST_POSE, REVIEW_LOOKS, assembleLook, findReviewLook, materialName, type ReviewLook } from '../../../../packages/content/src/avatars';
import { BENCH_ANGLES, benchOrientation, createCitizen, createPlinth, frameCamera, type BenchAngle, type CitizenStats } from './stage';
import './style.css';

export interface AvatarBenchReport extends CitizenStats {
  readonly look: string;
  readonly group: string;
  readonly label: string;
  readonly angle: BenchAngle;
  readonly hour: number;
  readonly pose: string;
  readonly frame: 'page' | 'still';
  /** Measured renderer draw calls for the citizen alone, without the plinth. */
  readonly draws: number;
  readonly materials: readonly string[];
  readonly limits: typeof AVATAR_LOOK_LIMITS;
}

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomAvatar?: AvatarBenchReport;
    __chatdomAvatarError?: string;
    __chatdomAvatarView?: (angle: BenchAngle) => void;
  }
}

const HOURS = [{ hour: 19, name: 'Dusk' }, { hour: 12, name: 'Noon' }, { hour: 0, name: 'Night' }] as const;

function describe(look: ReviewLook): { term: string; value: string }[] {
  return [
    { term: 'Body', value: look.body },
    { term: 'Skin', value: materialName(look.skin) },
    { term: 'Hair', value: look.hair ? `${look.hair.form} · ${materialName(look.hair.swatch)}` : 'none' },
    { term: 'Wearing', value: ['neutral garb', ...look.wear.map(w => `${w.id} (${w.style}${w.subscription ? `, ${w.subscription}` : ''})`)].join(' · ') },
  ];
}

export default function AvatarBench() {
  let host!: HTMLDivElement;
  let disposed = false;
  let disposeScene: (() => void) | undefined;
  const params = new URLSearchParams(window.location.search);
  const lookId = params.get('look') ?? 'citizen-a';
  const frame = params.get('frame') === 'still' ? 'still' : 'page';
  const focus = params.get('focus') === 'head' ? 'head' : 'body';
  const initialAngle = (params.get('angle') ?? 'front') as BenchAngle;
  const rawHour = Number(params.get('hour') ?? 19);
  const hour = Number.isFinite(rawHour) ? rawHour : 19;
  const [angle, setAngle] = createSignal<BenchAngle>(initialAngle);
  const [status, setStatus] = createSignal('Fitting the citizen…');
  const [failed, setFailed] = createSignal(false);
  const [report, setReport] = createSignal<AvatarBenchReport>();
  let look: ReviewLook | undefined;
  try { look = findReviewLook(lookId); } catch { look = undefined; }
  const environment = getEnvironment(hour);
  const sky = `linear-gradient(180deg, ${environment.zenith} 0%, ${environment.horizon} 78%, ${environment.fog} 100%)`;

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomAvatar;
    delete window.__chatdomAvatarError;
    void (async () => {
      if (!look) throw new Error(`There is no review look called “${lookId}”.`);
      if (!BENCH_ANGLES.includes(initialAngle)) throw new Error('Choose front, side or back as the viewing angle.');
      const parts = assembleLook(look);
      const pool = new VoxelWorkerPool({ size: 2 });
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError = () => { throw new Error('Avatar shader compilation failed.'); };
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.domElement.setAttribute('aria-label', `${look.label}, ${look.note}`);
      host.append(renderer.domElement);
      const material = createVoxelMaterial(MATERIALS, 'avatar');
      material.setEnvironment(environment);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
      disposeScene = () => { delete window.__chatdomAvatarView; pool.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
      setStatus('Carving each part on the avatar lattice…');
      const citizen = await createCitizen(pool, material, parts, REST_POSE, 1);
      const plinth = await createPlinth(pool, material);
      const stand = new THREE.Group();
      const draw = (): void => {
        const width = host.clientWidth, height = host.clientHeight;
        renderer.setSize(width, height);
        const view = benchOrientation(environment, angle());
        stand.rotation.y = view.yaw;
        stand.updateMatrixWorld(true);
        const bounds = citizen.bounds.clone().applyMatrix4(stand.matrixWorld);
        // Close-up framing keeps the head and shoulders: everything above the chest bone.
        if (focus === 'head') bounds.min.y = 13 * VOXEL_METRES.avatar;
        frameCamera(camera, bounds, view.camera, width / height, frame === 'still' ? .86 : .8, frame === 'still' ? .06 : 0);
        renderer.render(scene, camera);
      };
      // Cleanup during the awaits above has already released the base; only the meshes remain.
      if (disposed) { citizen.dispose(); plinth.geometry.dispose(); return; }
      const releaseBase = disposeScene;
      disposeScene = () => { window.removeEventListener('resize', draw); citizen.dispose(); plinth.geometry.dispose(); releaseBase(); };
      stand.add(citizen.root, plinth);
      scene.add(stand);
      window.addEventListener('resize', draw);
      draw();
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      // Measure the citizen's own draws with the plinth hidden, then render the full frame.
      plinth.visible = false;
      renderer.render(scene, camera);
      const draws = renderer.info.render.calls;
      plinth.visible = true;
      draw();
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (disposed) return;
      draw();
      renderer.getContext().finish();
      const materials = [...new Set(parts.flatMap(p => p.boxes.map(b => b.material)))].filter(Boolean).sort((a, b) => a - b).map(materialName);
      const publish = (): void => {
        const next: AvatarBenchReport = { look: look!.id, group: look!.group, label: look!.label, angle: angle(), hour, pose: REST_POSE.id, frame, ...citizen.stats, draws, materials, limits: AVATAR_LOOK_LIMITS };
        setReport(next);
        host.dataset.look = next.look;
        host.dataset.angle = next.angle;
        window.__chatdomAvatar = next;
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

  const query = (changes: Record<string, string>): string => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    return `?${next}`;
  };

  return <section class={`avatar-bench avatar-bench--${frame}`} style={{ background: sky }}>
    <div ref={element => { host = element; }} class="avatar-bench-stage" />
    <Show when={frame === 'still'}>
      <p class="avatar-still-label"><b>SIMULATED</b> {look?.label ?? lookId} · {look?.note ?? ''} · {angle()}{focus === 'head' ? ' · close' : ''} · {hour}:00</p>
    </Show>
    <Show when={frame === 'page'}>
      <aside class="avatar-panel">
        <p class="avatar-eyebrow">CHATDOM · AVATAR WORKSHOP</p>
        <div class="avatar-title">
          <h1>{look?.label ?? 'Unknown look'}</h1>
          <span class="avatar-simulated" title="A review fixture, not a real person">SIMULATED</span>
        </div>
        <p class="avatar-note">{look?.note}</p>
        <Show when={look}>
          <dl class="avatar-facts"><For each={describe(look!)}>{row => <><dt>{row.term}</dt><dd>{row.value}</dd></>}</For></dl>
        </Show>
        <div class="avatar-controls" role="group" aria-label="View">
          <For each={BENCH_ANGLES}>{a => <button type="button" aria-pressed={angle() === a} onClick={() => window.__chatdomAvatarView?.(a)}>{a}</button>}</For>
        </div>
        <div class="avatar-controls" role="group" aria-label="Light">
          <For each={HOURS}>{h => <a href={query({ hour: String(h.hour) })} aria-current={h.hour === hour ? 'true' : undefined}>{h.name}</a>}</For>
        </div>
        <Show when={report()}>{r => <p class="avatar-stats">{r().parts} parts · {r().occupiedCells.toLocaleString('en')} cells · {r().triangles.toLocaleString('en')} triangles · {r().draws} draws<br /><small>Look budget {AVATAR_LOOK_LIMITS.maxParts} parts · {AVATAR_LOOK_LIMITS.maxOccupiedCells.toLocaleString('en')} cells · {AVATAR_LOOK_LIMITS.maxTriangles.toLocaleString('en')} triangles</small></p>}</Show>
        <nav class="avatar-looks" aria-label="Review looks">
          <For each={REVIEW_LOOKS}>{item => <a href={query({ look: item.id })} aria-current={item.id === lookId ? 'true' : undefined}><span>{item.group}</span>{item.note}</a>}</For>
        </nav>
        <p class="avatar-foot">Library parts on a simulated review person. Nothing here is owned, claimed or worn by anyone.</p>
      </aside>
    </Show>
    <Show when={status()}>
      <div class="avatar-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The citizen could not be shown' : 'At the fitting bench'}</strong><p>{status()}</p></div>
    </Show>
  </section>;
}
