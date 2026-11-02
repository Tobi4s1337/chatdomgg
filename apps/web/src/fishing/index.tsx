import { onCleanup, onMount } from 'solid-js';
import { mountPierBench, type PierBench, type PierBenchWindow } from './bench';
import { fishSheet } from './fish-bench';
import { FURNISHING_ANGLES, furnishingSheet } from './furnishing-sheet';
import { mountBagBench } from '../bag/bench';
import { mountPlayHud, type PlayHud } from './play-hud';
import { mountPierSoundBench } from './sound/bench';
import { mountFishingUiBench } from './ui/bench';
import { createSteppedTimers } from './ui/stepped';
import './register-items';

export default function PierReview() {
  const query = new URLSearchParams(location.search);
  const view = query.get('view');
  const sheet = view === 'fish' ? fishSheet(query) : null;
  const kit = view === 'furnishings' ? furnishingSheet(query) : null;
  const playing = view === 'play';
  let canvas!: HTMLCanvasElement, hud!: HTMLDivElement;
  let host: PierBench | undefined, play: PlayHud | undefined, unmount: (() => void) | undefined;
  let ended = false;
  const fail = (error: unknown) => { (window as PierBenchWindow).__chatdomPierError = error instanceof Error ? error.message : String(error); console.error('The pier could not be drawn.', error); };
  onMount(() => {
    if (view === 'ui') { unmount = mountFishingUiBench(hud, query); return; }
    if (view === 'bag') { unmount = mountBagBench(hud, query); return; }
    if (view === 'sound') { unmount = mountPierSoundBench(hud); return; }
    // A recording (`clip=1`) runs the overlay's beats on the stage's paused, stepped clock, frame by frame.
    const timers = playing && query.get('clip') === '1' ? createSteppedTimers() : undefined;
    if (playing) play = mountPlayHud(hud, { personId: '1001', kingdomName: 'Willowmere', hold: query.get('hold') === '1', ...(timers ? { timers } : {}) });
    void mountPierBench(canvas, query, play ? { hud, ui: play.ui, sound: play.sound, portrait: play.portrait, onGrant: play.onGrant, attach: play.attach,
      ...(timers ? { onClock: timers.at } : {}) } : undefined).then(bench => {
      if (ended) bench.dispose(); else { host = bench; (window as PierBenchWindow).__chatdomPier = bench; }
    }).catch(fail);
  });
  onCleanup(() => { ended = true; host?.dispose(); play?.dispose(); unmount?.(); });
  return <div style={{ position: 'fixed', inset: 0, background: '#282b36', overflow: 'hidden' }}>
    {!['ui', 'bag', 'sound'].includes(view ?? '') && <canvas ref={element => { canvas = element; }} style={{ width: '100%', height: '100%', display: 'block', 'touch-action': 'none' }} aria-label="The fishing pier" />}
    <div ref={element => { hud = element; }} style={{ position: 'absolute', inset: 0, 'pointer-events': ['bag', 'sound'].includes(view ?? '') ? 'auto' : 'none' }} />
    {sheet && <div style={{ position: 'absolute', inset: 0, 'pointer-events': 'none', color: '#e8ddc6', 'font-family': 'Georgia, serif' }}>
      <div style={{ height: '48px', display: 'flex', 'align-items': 'center', 'justify-content': 'space-around', 'font-size': '16px' }}><span>Three-quarter · dusk</span><span>Profile</span><span>Reverse</span></div>
      <div style={{ height: 'calc(100% - 48px)', display: 'grid', 'grid-template-rows': `repeat(${sheet.length}, 1fr)` }}>
        {sheet.map(entry => <div style={{ display: 'flex', 'align-items': 'end', 'justify-content': 'center', 'padding-bottom': '8px', 'font-size': '18px', 'border-bottom': '1px solid #50554f' }}>{entry.name}</div>)}
      </div>
    </div>}
    {kit && <div style={{ position: 'absolute', inset: 0, 'pointer-events': 'none', color: '#e8ddc6', 'font-family': 'Georgia, serif' }}>
      <div style={{ height: '40px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-size': '18px', 'letter-spacing': '.04em' }}>{kit.title}</div>
      <div style={{ height: '32px', display: 'grid', 'grid-template-columns': `repeat(${kit.columns.length}, 1fr)`, 'align-items': 'center', 'text-align': 'center', 'font-size': '15px' }}>{kit.columns.map(name => <span>{name}</span>)}</div>
      <div style={{ height: 'calc(100% - 80px)', display: 'grid', 'grid-template-rows': `repeat(${FURNISHING_ANGLES.length}, 1fr)` }}>
        {FURNISHING_ANGLES.map(angle => <div style={{ display: 'flex', 'align-items': 'end', 'padding': '0 0 8px 12px', 'font-size': '14px', opacity: .8, 'border-bottom': '1px solid #50554f' }}>{angle}</div>)}
      </div>
    </div>}
  </div>;
}
