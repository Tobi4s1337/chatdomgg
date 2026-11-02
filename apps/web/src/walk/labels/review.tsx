import { render } from 'solid-js/web';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { PeopleLabels, publishSpeech, type PersonLabel } from './index';

/** Dev bench for the label layer: fixed anchors, one walker speaking, one home speaking. No chat connection. */
function Review() {
  let canvas!: HTMLCanvasElement;
  const [size, setSize] = createSignal({ width: innerWidth, height: innerHeight });
  const resize = () => setSize({ width: innerWidth, height: innerHeight });
  const people = (): PersonLabel[] => {
    const { width, height } = size();
    return [
      { id: 'walker:ash', walkerId: 'ash', slot: 1, x: width * .3, y: height * .48, distance: 8, self: true, name: 'Ash' },
      { id: 'walker:river', walkerId: 'river', x: width * .72, y: height * .6, distance: 10, self: false, name: 'River' },
    ];
  };
  const home = () => ({ x: size().width * .62, y: size().height * .34 });
  onMount(() => {
    window.addEventListener('resize', resize);
    let frame = 0;
    const tick = () => {
      const { width, height } = size();
      publishSpeech(canvas, { at: performance.now(), width, height, speech: [
        { slot: 1, cueId: 'ash-1', from: 'walker', name: null, parts: [{ kind: 'text', text: 'Hello from the square!' }] },
        { slot: 7, cueId: 'rowan-1', from: 'home', name: 'Rowan', parts: [{ kind: 'text', text: 'Good to see the lamps lit again.' }], ...home(), distance: 14, visibility: 1 },
      ] });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }));
    onCleanup(() => cancelAnimationFrame(frame));
  });
  onCleanup(() => window.removeEventListener('resize', resize));
  return <>
    <canvas ref={element => { canvas = element; }} class="review-canvas" aria-hidden="true" />
    <header><h1>People in the street</h1><p>Label review<br />Fixed anchors · no chat connection</p></header>
    <PeopleLabels people={people()} reserved={[{ left: 0, top: 0, right: 240, bottom: 100 }]} />
    <div class="review-note">Dots mark the head and door anchors.</div>
    {[...people(), home()].map(anchor => <i class="marker" aria-hidden="true" style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }} />)}
  </>;
}
render(() => <Review />, document.querySelector('#app')!);
