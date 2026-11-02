import { createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createForgeRitualView } from '../forge/ritual-view';
import { createForgeRefusalPresentation, FORGE_MOOD_CAPTION_CLASS, FORGE_MOOD_DURATION, type ForgeRefusalBeat } from '../forge/refusal';
import { forgeMoodPhase } from '../forge/refusal/timeline';
import '../forge/refusal/caption.css';
import { forgeDiorama } from './diorama';
import { parseForgeRefusalBench, type ForgeRefusalBenchState } from './params';
import './style.css';

/** What a capture can check. It describes the shot only; a public beat has nothing else to report. */
export interface ForgeRefusalBenchReport extends ForgeRefusalBenchState {
  phase: string;
  /** Whether the viewer asked for reduced motion; with `motion=auto` the adapter follows it. */
  prefersReduced: boolean;
  caption: { text: string; hidden: boolean; overflow: boolean };
  draws: number;
  triangles: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomForgeRefusal?: ForgeRefusalBenchReport;
    __chatdomForgeRefusalError?: string;
  }
}

/** The kingdom's work-surface height on main's anvil stage, in metres above its plinth. */
const ANVIL: readonly [number, number, number] = [0, 1.45, 0];

/** A self-contained preview of the forge's public mood in an empty market square. */
export default function ForgeRefusalBench() {
  let host!: HTMLDivElement;
  let caption!: HTMLParagraphElement;
  let disposed = false;
  let dispose: (() => void) | undefined;
  let preview: (() => void) | undefined;
  const [status, setStatus] = createSignal('Sweeping the square…');
  const [failed, setFailed] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  const [readout, setReadout] = createSignal('The forge is at rest');
  const input = parseForgeRefusalBench(window.location.search);

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomForgeRefusal;
    delete window.__chatdomForgeRefusalError;
    void (async () => {
      const grade = getEnvironment(input.hour);
      const pool = new VoxelWorkerPool({ size: 2 });
      const scene = new THREE.Scene();
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError = () => { throw new Error('A forge shader failed to compile.'); };
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.setAttribute('aria-label', 'The forge on an empty market square');
      host.append(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(43, 1, 0.15, 400);
      const atmosphere = createAtmosphere(scene);
      const clay = createVoxelMaterial(MATERIALS, 'build');
      clay.setEnvironment(grade);
      const stage = createForgeRitualView(scene, clay);
      // The adapter's root: identity transform, only the square's own meshes and the mood's group.
      const root = new THREE.Group();
      scene.add(root);
      const geometries: THREE.BufferGeometry[] = [];
      const mood = createForgeRefusalPresentation({ root, anvil: ANVIL, caption, motion: input.motion });
      let frameRequest = 0, started = 0;
      dispose = () => {
        cancelAnimationFrame(frameRequest);
        window.removeEventListener('resize', resize);
        mood.dispose(); stage.dispose(); atmosphere.dispose(); pool.dispose();
        geometries.forEach(g => g.dispose()); clay.dispose(); renderer.dispose(); renderer.domElement.remove();
      };

      const aim = () => {
        const width = host.clientWidth, height = host.clientHeight, portrait = width < height;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        // The anonymous forge shot: the plinth, the anvil and room above it for the puff.
        const target = new THREE.Vector3(0.15, portrait ? 1.35 : 1.05, 0);
        const halfV = THREE.MathUtils.degToRad(camera.fov / 2), halfH = Math.atan(Math.tan(halfV) * camera.aspect);
        const distance = Math.max(2.15 / Math.tan(halfV), 2.35 / Math.tan(halfH)) * (portrait ? 1.08 : 1.24);
        camera.position.copy(target).addScaledVector(new THREE.Vector3(7, 3.6, 11).normalize(), distance);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
      };
      const draw = (t: number | null) => {
        atmosphere.update(input.hour, 0, camera, new THREE.Vector3(0, 40, -60), 0);
        renderer.render(scene, camera);
        renderer.getContext().finish();
        const box = caption.getBoundingClientRect();
        window.__chatdomForgeRefusal = {
          ...input, at: t, phase: t === null ? 'idle' : forgeMoodPhase(t), prefersReduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          caption: { text: caption.textContent ?? '', hidden: caption.hidden, overflow: !caption.hidden && (box.left < 0 || box.right > window.innerWidth || box.top < 0 || box.bottom > window.innerHeight || caption.scrollWidth > caption.clientWidth + 1) },
          draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, width: host.clientWidth, height: host.clientHeight,
        };
      };
      const resize = () => { aim(); draw(window.__chatdomForgeRefusal?.at ?? null); };

      setStatus('Setting the market stalls out…');
      for (const dressing of forgeDiorama()) {
        const result = await pool.submit({ kind: 'blueprint', blueprint: dressing.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (disposed) return;
        if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned nothing for ${dressing.blueprint.id}.`);
        const geometry = geometryFromChunks(result.chunks, 'build');
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, clay.material);
        mesh.position.set(...dressing.position);
        mesh.rotation.y = dressing.yaw;
        mesh.frustumCulled = false;
        root.add(mesh);
      }
      const beat: ForgeRefusalBeat = { kind: 'refusal', variant: input.variant };
      aim();
      await renderer.compileAsync(scene, camera);
      if (disposed) return;

      // A host clock for the live preview. The adapter itself only ever sees elapsed seconds.
      const tick = () => {
        const t = (performance.now() - started) / 1000;
        mood.update(t);
        draw(Math.min(t, FORGE_MOOD_DURATION));
        setReadout(t < FORGE_MOOD_DURATION ? `${phaseWords[forgeMoodPhase(t)]} · ${t.toFixed(1)} s` : 'Settled · the forge is itself again');
        if (t < FORGE_MOOD_DURATION) frameRequest = requestAnimationFrame(tick);
        else { setPlaying(false); draw(null); }
      };
      preview = () => {
        if (disposed || playing()) return;
        setPlaying(true);
        // A fixed review frame leaves its sampled beat active; end it so the preview is admitted from zero.
        mood.update(FORGE_MOOD_DURATION);
        mood.play(beat);
        started = performance.now();
        frameRequest = requestAnimationFrame(tick);
      };

      if (input.at !== null) {
        // A fixed review frame: admit the beat, sample it once at the requested second.
        mood.play(beat);
        mood.update(input.at);
        setReadout(input.at < FORGE_MOOD_DURATION ? `${phaseWords[forgeMoodPhase(input.at)]} · ${input.at.toFixed(2)} s` : 'Settled · the forge is itself again');
      }
      draw(input.at);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (disposed) return;
      draw(input.at);
      window.addEventListener('resize', resize);
      setStatus('');
      window.__chatdomReady = true;
    })().catch(error => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      window.__chatdomForgeRefusalError = message;
      setStatus(message); setFailed(true);
      console.error(message);
    });
  });
  onCleanup(() => { disposed = true; dispose?.(); window.__chatdomReady = false; });

  return <section class="frb">
    <div ref={element => { host = element; }} class="frb-stage" />
    <header class="frb-head">
      <span>CHATDOM · THE FORGE’S MOOD</span>
      <small>Public beat preview · {String(input.hour).padStart(2, '0')}:00{input.motion === 'reduced' ? ' · reduced motion' : ''}</small>
    </header>
    <div class="frb-caption-slot"><p ref={element => { caption = element; }} class={FORGE_MOOD_CAPTION_CLASS} /></div>
    <aside class="frb-card" aria-label="Preview controls">
      <p class="frb-eyebrow">No request</p>
      <p class="frb-note">Plays an already-admitted, nameless public beat. Nothing was asked, judged or refused here, and no gate or delay runs.</p>
      <button type="button" disabled={playing() || status() !== ''} onClick={() => preview?.()}>Preview the forge’s mood <span aria-hidden="true">✦</span></button>
      <p class="frb-readout">{readout()}</p>
      <p class="frb-quiet">Silent bench · the shared forge cue is not connected here.</p>
    </aside>
    {status() && <div class="frb-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The forge could not be shown' : 'At the forge'}</strong><p>{status()}</p></div>}
  </section>;
}

const phaseWords: Record<string, string> = { anticipation: 'A little breath', cough: 'The cough', sulk: 'The sulk', recovery: 'Pulling itself together', settled: 'Settled' };
