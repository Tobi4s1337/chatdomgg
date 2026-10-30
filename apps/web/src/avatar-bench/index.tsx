import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { AVATAR_CAPE_LIMITS, AVATAR_LOOK_LIMITS, VOXEL_METRES, type AvatarCapeBlueprint, type AvatarPartBlueprint } from '@chatdom/shared';
import { REST_POSE, REVIEW_LOOKS, assembleLook, compileAvatarPart, findReviewLook, isCapeForm, materialName, type ReviewLook } from '@chatdom/content/avatars';
import { createCitizenRenderer } from '../citizens';
import { createCitizenCapeRenderer } from '../citizens/capes';
import { WALK_STOP, WALK_STOP_FRAMES, phaseName, walkStopState, type BenchMotion } from './walk-stop';
import { BENCH_ANGLES, benchOrientation, capeBounds, createCitizen, createPlinth, frameCamera, restBounds, type BenchAngle, type CitizenStats } from './stage';
import AvatarLineup from './lineup';
import './style.css';

export interface AvatarBenchReport extends CitizenStats {
  readonly look: string;
  readonly group: string;
  readonly label: string;
  readonly angle: BenchAngle;
  readonly hour: number;
  readonly pose: string;
  readonly frame: 'page' | 'still';
  readonly motion: BenchMotion;
  /** Seconds into the walk-to-stop sequence; zero at rest. */
  readonly at: number;
  /** Measured renderer draw calls for the citizen alone, without the plinth, cape included. */
  readonly draws: number;
  readonly cape: { readonly id: string; readonly triangles: number } | null;
  readonly materials: readonly string[];
  readonly limits: typeof AVATAR_LOOK_LIMITS;
}

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomAvatar?: AvatarBenchReport;
    __chatdomAvatarError?: string;
    __chatdomAvatarView?: (angle: BenchAngle, at?: number) => void;
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

function benchBounds(parts: readonly AvatarPartBlueprint[], cape: AvatarCapeBlueprint | null): THREE.Box3 {
  const bounds = restBounds(parts);
  return cape ? bounds.union(capeBounds(cape)) : bounds;
}

export default function AvatarBench() {
  const lineup = new URLSearchParams(window.location.search).get('lineup');
  if (lineup !== null) return <AvatarLineup id={lineup} />;
  let host!: HTMLDivElement;
  let disposed = false;
  let disposeScene: (() => void) | undefined;
  const params = new URLSearchParams(window.location.search);
  const lookId = params.get('look') ?? 'citizen-a';
  const frame = params.get('frame') === 'still' ? 'still' : 'page';
  const focus = params.get('focus') === 'head' ? 'head' : 'body';
  const motion: BenchMotion = params.get('motion') === 'walk-stop' ? 'walk-stop' : 'rest';
  const rawAt = params.get('t');
  // A walk page without a time plays the sequence live; captures always fix the time.
  const live = motion === 'walk-stop' && frame === 'page' && rawAt === null;
  const initialAt = motion === 'rest' ? 0 : Math.max(0, Number(rawAt ?? WALK_STOP_FRAMES[0]) || 0);
  const initialAngle = (params.get('angle') ?? 'front') as BenchAngle;
  const rawHour = Number(params.get('hour') ?? 19);
  const hour = Number.isFinite(rawHour) ? rawHour : 19;
  const [angle, setAngle] = createSignal<BenchAngle>(initialAngle);
  const [at, setAt] = createSignal(initialAt);
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
      const { parts, cape } = assembleLook(look);
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
      const bounds = benchBounds(parts, cape);
      const plinth = await createPlinth(pool, material);
      const stand = new THREE.Group();
      stand.add(plinth);
      scene.add(stand);
      let stats: CitizenStats;
      /** Places the citizen for the current angle and time; returns the world-space framing box. */
      let place: () => THREE.Box3;
      let release: () => void;
      if (motion === 'rest') {
        const citizen = await createCitizen(pool, material, parts, REST_POSE, 1);
        // Main's cloth renderer, fed the posed back socket of the rig groups, standing still.
        const capes = cape ? createCitizenCapeRenderer(scene, { registry: MATERIALS, material, capacity: 1 }) : undefined;
        const back = citizen.attachments.get('back')!;
        stand.add(citizen.root);
        stats = citizen.stats;
        place = () => {
          const view = benchOrientation(environment, angle());
          stand.rotation.y = view.yaw;
          stand.updateMatrixWorld(true);
          if (capes && cape) {
            capes.beginFrame(0);
            capes.add({ id: look!.id, heading: view.yaw, distance: 0, speed: 0 }, cape, back.matrixWorld);
            capes.endFrame();
          }
          return bounds.clone().applyMatrix4(stand.matrixWorld);
        };
        release = () => { capes?.dispose(); citizen.dispose(); };
      } else {
        if (!cape) throw new Error('The walk-to-stop sequence reviews a cape; this look wears none.');
        // Main's walking citizen renderer: its own stride pose, back socket and cloth response.
        const assets = parts.map(blueprint => ({ blueprint, asset: compileAvatarPart(blueprint, 1) }));
        const walker = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [{ id: look.id, parts: assets, cape }], capacity: 1, pool });
        let simulated = -1;
        const sample = (time: number, yaw: number) => {
          const state = walkStopState(time);
          return { id: 'simulated-review-citizen', look: look!.id, position: [0, 0, 0] as const, heading: yaw, distance: state.distance, moving: state.speed / WALK_STOP.speed, speed: state.speed, time };
        };
        place = () => {
          const view = benchOrientation(environment, angle());
          stand.rotation.y = view.yaw;
          stand.updateMatrixWorld(true);
          const target = at();
          // Replay from the start whenever time runs backwards, so a still is the same however it is reached.
          if (target < simulated) simulated = -1;
          for (let time = simulated < 0 ? 0 : simulated + WALK_STOP.step; time < target; time += WALK_STOP.step) walker.update([sample(time, view.yaw)]);
          walker.update([sample(target, view.yaw)]);
          simulated = target;
          return bounds.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(view.yaw));
        };
        const cells = assets.reduce((n, { asset }) => n + asset.voxels.reduce((k, v) => k + (v ? 1 : 0), 0), 0);
        stats = { parts: parts.length, boxes: parts.reduce((n, p) => n + p.boxes.length, 0), occupiedCells: cells, triangles: 0 };
        release = () => walker.dispose();
      }
      const draw = (): void => {
        const width = host.clientWidth, height = host.clientHeight;
        renderer.setSize(width, height);
        const framed = place();
        // Close-up framing keeps the head and shoulders: everything above the chest bone.
        if (focus === 'head') framed.min.y = 13 * VOXEL_METRES.avatar;
        frameCamera(camera, framed, benchOrientation(environment, angle()).camera, width / height, frame === 'still' ? .86 : .8, frame === 'still' ? .06 : 0);
        renderer.render(scene, camera);
      };
      // Cleanup during the awaits above has already released the base; only the meshes remain.
      if (disposed) { release(); plinth.geometry.dispose(); return; }
      const releaseBase = disposeScene;
      let frameRequest = 0;
      disposeScene = () => { window.cancelAnimationFrame(frameRequest); window.removeEventListener('resize', draw); release(); plinth.geometry.dispose(); releaseBase(); };
      window.addEventListener('resize', draw);
      draw();
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      // Measure the citizen's own draws and triangles with the plinth hidden, then render the full frame.
      plinth.visible = false;
      renderer.render(scene, camera);
      const draws = renderer.info.render.calls;
      const capeTriangles = cape ? AVATAR_CAPE_LIMITS.triangles : 0;
      if (motion === 'walk-stop') stats = { ...stats, triangles: renderer.info.render.triangles - capeTriangles };
      plinth.visible = true;
      draw();
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (disposed) return;
      draw();
      renderer.getContext().finish();
      const materials = [...new Set([...parts.flatMap(p => p.boxes.map(b => b.material)), ...(cape ? Object.values(cape.colours) : [])])].filter(Boolean).sort((a, b) => a - b).map(materialName);
      const publish = (): void => {
        const next: AvatarBenchReport = { look: look!.id, group: look!.group, label: look!.label, angle: angle(), hour, pose: motion === 'rest' ? REST_POSE.id : 'walk-stop', frame, motion, at: at(), ...stats, draws, cape: cape ? { id: cape.id, triangles: capeTriangles } : null, materials, limits: AVATAR_LOOK_LIMITS };
        setReport(next);
        host.dataset.look = next.look;
        host.dataset.angle = next.angle;
        window.__chatdomAvatar = next;
      };
      if (live) {
        const start = performance.now();
        const tick = (now: number): void => {
          setAt(Math.round(((now - start) / 1000 % WALK_STOP.loop) * 100) / 100);
          draw();
          frameRequest = window.requestAnimationFrame(tick);
        };
        frameRequest = window.requestAnimationFrame(tick);
      }
      window.__chatdomAvatarView = (next, time) => {
        if (!BENCH_ANGLES.includes(next)) throw new Error('Unknown avatar view.');
        if (time !== undefined && (motion === 'rest' || !Number.isFinite(time) || time < 0)) throw new Error('Only the walk-to-stop sequence takes a time.');
        window.__chatdomReady = false;
        setAngle(next);
        if (time !== undefined) setAt(time);
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
      <p class="avatar-still-label"><b>SIMULATED</b> {look?.label ?? lookId} · {look?.note ?? ''} · {angle()}{focus === 'head' ? ' · close' : ''}{motion === 'walk-stop' ? ` · walk → stop ${at().toFixed(2)} s, ${phaseName(at())}` : ''} · {hour}:00</p>
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
        <Show when={look?.wear.some(w => isCapeForm(w.id))}>
          <div class="avatar-controls" role="group" aria-label="Motion">
            <a href={query({ motion: 'rest' })} aria-current={motion === 'rest' ? 'true' : undefined}>Standing</a>
            <a href={`?${(() => { const next = new URLSearchParams(window.location.search); next.set('motion', 'walk-stop'); next.delete('t'); return next; })()}`} aria-current={motion === 'walk-stop' ? 'true' : undefined}>Walk, then stop</a>
          </div>
          <Show when={motion === 'walk-stop'}><p class="avatar-motion">Walking in place at {WALK_STOP.speed} m/s, stopping at {WALK_STOP.stopAt} s · {at().toFixed(2)} s, {phaseName(at())}. Cloth by the citizen runtime.</p></Show>
        </Show>
        <div class="avatar-controls" role="group" aria-label="Light">
          <For each={HOURS}>{h => <a href={query({ hour: String(h.hour) })} aria-current={h.hour === hour ? 'true' : undefined}>{h.name}</a>}</For>
        </div>
        <Show when={report()}>{r => <p class="avatar-stats">{r().parts} parts · {r().occupiedCells.toLocaleString('en')} cells · {r().triangles.toLocaleString('en')} triangles{r().cape ? ` + ${r().cape!.triangles} cloth` : ''} · {r().draws} draws<br /><small>Look budget {AVATAR_LOOK_LIMITS.maxParts} parts · {AVATAR_LOOK_LIMITS.maxOccupiedCells.toLocaleString('en')} cells · {AVATAR_LOOK_LIMITS.maxTriangles.toLocaleString('en')} triangles</small></p>}</Show>
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
