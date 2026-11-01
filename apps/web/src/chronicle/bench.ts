import { createKingdomAudio } from '@chatdom/audio';
import { createSimulatedScene } from './scene';
import { mountChronicle } from './view';

const canvas = document.querySelector<HTMLCanvasElement>('#kingdom')!;
const root = document.querySelector<HTMLElement>('#chronicle-view')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const closed = document.querySelector<HTMLElement>('#closed')!;
let raf = 0;
try {
  const abort = new AbortController();
  const scene = await createSimulatedScene(canvas, { signal: abort.signal, onProgress: fraction => { loading.textContent = `SIMULATED · Opening the Chronicle ${Math.round(fraction * 100)}%`; } });
  const audio = createKingdomAudio();
  const view = mountChronicle(root, { binding: scene.binding, history: scene.history,
    presentationLabel: 'SIMULATED', sound: action => { void audio.unlock().then(ready => { if (ready) audio.cue('wood', { ui: action === 'seek' ? 'parchment' : action === 'close' ? 'brass' : 'wood' }); }); }, simulationNote: 'Castle, streets, other civic places and other homes stay as generated in this local record.', onClose: () => {
    cancelAnimationFrame(raf); canvas.hidden = true; closed.hidden = false; window.setTimeout(() => audio.dispose(), 1500);
  } });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const render = (at: number) => { scene.render(reducedMotion.matches ? 0 : at); raf = requestAnimationFrame(render); };
  raf = requestAnimationFrame(render); loading.hidden = true; loading.textContent = '';
  Object.assign(window, { __chatdomReady: true, __chronicle: view.replay, __chronicleHistory: scene.history,
    __chronicleLightingReady: () => scene.lightingReady(),
    __chronicleRenderPixels: () => { scene.render(0); return canvas.toDataURL(); } });
} catch (error) {
  console.error(error); Object.assign(window, { __chronicleError: true }); loading.textContent = 'SIMULATED · The Chronicle could not open.';
}
