import { onCleanup, onMount } from 'solid-js';
import { mountPierBench, type PierBench, type PierBenchWindow } from './bench';
import { fishSheet } from './fish-bench';

export default function PierReview() {
  const query = new URLSearchParams(location.search);
  const sheet = query.get('view') === 'fish' ? fishSheet(query) : null;
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
    {sheet && <div style={{ position: 'absolute', inset: 0, 'pointer-events': 'none', color: '#e8ddc6', 'font-family': 'Georgia, serif' }}>
      <div style={{ height: '48px', display: 'flex', 'align-items': 'center', 'justify-content': 'space-around', 'font-size': '16px' }}><span>Three-quarter · dusk</span><span>Profile</span><span>Reverse</span></div>
      <div style={{ height: 'calc(100% - 48px)', display: 'grid', 'grid-template-rows': `repeat(${sheet.length}, 1fr)` }}>
        {sheet.map(entry => <div style={{ display: 'flex', 'align-items': 'end', 'justify-content': 'center', 'padding-bottom': '8px', 'font-size': '18px', 'border-bottom': '1px solid #50554f' }}>{entry.name}</div>)}
      </div>
    </div>}
  </div>;
}
