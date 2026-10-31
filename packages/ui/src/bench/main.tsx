import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { ProvenanceSeal, type Provenance } from '../index';
import '../kit.css';
import './bench.css';

/** Every state the seal can press, with typed facts. Nothing here is a real feed: the whole bench is SIMULATED. */
const CASES: readonly { title: string; state: Provenance; simulated?: boolean; detail?: string }[] = [
  { title: 'A practice night', state: 'simulated' },
  { title: 'Practice night, owner note', state: 'simulated', detail: 'practice night' },
  { title: 'Finding the feed', state: 'connecting' },
  { title: 'Chat is here', state: 'live' },
  { title: 'Stream resting', state: 'resting' },
  { title: 'Feed lost', state: 'lost' },
  { title: 'Live chat, practice Forge', state: 'live', simulated: true, detail: 'practice Forge' },
  { title: 'Feed lost, practice home', state: 'lost', simulated: true, detail: 'practice home' },
];

function Bench() {
  return <main class="kb">
    <header class="kb-head cd-plate">
      <p class="cd-label kb-eyebrow">Carved kit · isolated bench</p>
      <h1>Provenance seal</h1>
      <p class="kb-sim"><b>SIMULATED</b> typed states, no real feed, Forge or save behind any of them.</p>
    </header>
    <section class="kb-grid" aria-label="Seal states">
      <For each={CASES}>{entry => <figure class="kb-sky">
        <ProvenanceSeal state={entry.state} {...(entry.simulated ? { simulated: true } : {})} {...(entry.detail ? { detail: entry.detail } : {})} />
        <figcaption>{entry.title}</figcaption>
      </figure>}</For>
    </section>
    <section class="kb-materials cd-plate cd-kit" aria-label="Materials">
      <div class="cd-slip kb-slip"><p class="cd-label">Parchment slip</p><p>Body text stays readable: fourteen pixels of Alegreya on parchment.</p></div>
      <button class="kb-key cd-focus" type="button" data-bench-focus>Brass focus</button>
      <p class="kb-type"><span class="kb-story">Storybook heading</span><span class="cd-label">Small caps label</span></p>
    </section>
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing bench root');
render(() => <Bench />, root);
void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; })));
