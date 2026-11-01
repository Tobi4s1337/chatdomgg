import { render } from 'solid-js/web';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { PeopleLabels, type PersonLabel } from './index';

function Review() {
  const [size, setSize] = createSignal({ width: innerWidth, height: innerHeight });
  const resize = () => setSize({ width: innerWidth, height: innerHeight });
  onMount(() => { window.addEventListener('resize', resize); requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }); });
  onCleanup(() => window.removeEventListener('resize', resize));
  const people = (): PersonLabel[] => {
    const { width, height } = size();
    return [
      { id: 'simulated-1', x: width * .3, y: height * .48, distance: 8, self: true, name: 'SIMULATED Ash', speech: [{ kind: 'text', text: 'Hello from the square!' }] },
      { id: 'simulated-2', x: width * .72, y: height * .6, distance: 10, self: false, name: 'SIMULATED River' },
      { id: 'simulated-3', x: width * .76, y: height * .38, distance: 14, self: false, name: 'SIMULATED Rowan', speech: [{ kind: 'text', text: 'Good to see you.' }] },
    ];
  };
  return <><header><h1>People in the street</h1><p>SIMULATED LABEL REVIEW<br />LOCAL ANCHORS · NO CHAT CONNECTION</p></header>
    <PeopleLabels people={people()} reserved={[{ left: 0, top: 0, right: 240, bottom: 100 }]} />
    <div class="review-note">Dots mark the simulated head anchors.</div>
    {people().map(person => <i class="marker" aria-hidden="true" style={{ left: `${person.x}px`, top: `${person.y}px` }} />)}
  </>;
}
render(() => <Review />, document.querySelector('#app')!);
