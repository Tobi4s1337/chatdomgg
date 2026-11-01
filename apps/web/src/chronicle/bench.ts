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
  const view = mountChronicle(root, { binding: scene.binding, history: scene.history, simulationNote: 'Castle, streets, civic places and other homes stay as generated in this local record.', onClose: () => {
    cancelAnimationFrame(raf); canvas.hidden = true; closed.hidden = false;
  } });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const render = (at: number) => { scene.render(reducedMotion.matches ? 0 : at); raf = requestAnimationFrame(render); };
  raf = requestAnimationFrame(render); loading.hidden = true;
  Object.assign(window, { __chatdomReady: true, __chronicle: view.replay });
} catch (error) {
  console.error(error); loading.textContent = 'SIMULATED · The Chronicle could not open.';
}
