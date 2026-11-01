import { onCleanup, onMount } from 'solid-js';
import { mountPierBench, type PierBench, type PierBenchWindow } from './bench';

export default function PierReview() {
  let canvas!: HTMLCanvasElement;
  let host: PierBench | undefined;
  let ended = false;
  onMount(() => {
    void mountPierBench(canvas, new URLSearchParams(location.search)).then(bench => {
      if (ended) bench.dispose(); else { host = bench; (window as PierBenchWindow).__chatdomPier = bench; }
    }).catch(error => { (window as PierBenchWindow).__chatdomPierError = error instanceof Error ? error.message : String(error); console.error('The pier could not be drawn.', error); });
  });
  onCleanup(() => { ended = true; host?.dispose(); });
  return <div style={{ position: 'fixed', inset: 0, background: '#282b36' }}>
    <canvas ref={element => { canvas = element; }} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="The fishing pier" />
  </div>;
}
