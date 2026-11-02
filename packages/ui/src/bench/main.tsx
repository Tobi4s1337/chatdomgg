import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { CrestChoice, ParchmentField, ProvenanceSeal, type CrestOption, type Provenance } from '../index';
import '../kit.css';
import './bench.css';

/**
 * Every state the seal can press, with typed facts. Nothing here is a real feed. A staged night without the owner's
 * words presses nothing, so its tile shows only the caption; the seal is still in the DOM, hidden.
 */
const CASES: readonly { key: string; title: string; state: Provenance; simulated?: boolean; detail?: string }[] = [
  { key: 'staged-bare', title: 'Staged night: nothing shows', state: 'simulated' },
  { key: 'staged-words', title: 'Staged night, owner words', state: 'simulated', detail: 'A preview citizen' },
  { key: 'connecting', title: 'Finding the feed', state: 'connecting' },
  { key: 'live', title: 'Chat is here', state: 'live' },
  { key: 'resting', title: 'Stream resting', state: 'resting' },
  { key: 'lost', title: 'Feed lost', state: 'lost' },
  { key: 'live-practice', title: 'Live chat, practice Forge', state: 'live', simulated: true, detail: 'practice Forge' },
  { key: 'lost-practice', title: 'Feed lost, practice home', state: 'lost', simulated: true, detail: 'practice home' },
];

function Bench() {
  return <main class="kb">
    <header class="kb-head cd-plate">
      <p class="cd-label kb-eyebrow">Carved kit · isolated bench</p>
      <h1>Provenance seal</h1>
      <p class="kb-lede">Typed states, with no real feed, Forge or save behind any of them.</p>
    </header>
    <section class="kb-grid" aria-label="Seal states">
      <For each={CASES}>{entry => <figure class="kb-sky" data-case={entry.key}>
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

type Realm = 'hearth' | 'tide' | 'grove';
const REALMS: readonly CrestOption<Realm>[] = [
  { value: 'hearth', name: 'Emberwick', note: 'Hearth', crest: 'hearth' },
  { value: 'tide', name: 'Willowmere', note: 'Tide', crest: 'tide' },
  { value: 'grove', name: 'Mossmere', note: 'Grove', crest: 'grove' },
];

/** The Forge's two fittings in every designed state. Choices and words stay on this page; nothing is sent. */
function ForgeKit() {
  const [realm, setRealm] = createSignal<Realm>('tide'), [cues, setCues] = createSignal(0);
  const [words, setWords] = createSignal('!forge a crescent moon lantern');
  return <section class="kb-forge cd-plate" aria-label="Forge fittings" data-bench-forge>
    <div class="kb-forge-col">
      <CrestChoice label="Visit another kingdom" value={realm()} options={REALMS} onChange={setRealm} onCue={() => setCues(n => n + 1)}
        hint={`Chosen: ${REALMS.find(r => r.value === realm())?.name}. Wood cues: ${cues()}.`} class="kb-crests-live" />
      <button class="kb-key cd-focus" type="button" data-bench-after>After the rail</button>
      <CrestChoice label="Resting rail" value="hearth" options={REALMS} disabled disabledReason="The road rests while a wish is in the fire." onChange={() => { throw new Error('a resting rail chose'); }} class="kb-crests-resting" />
      <CrestChoice label="One crest resting" value="hearth" options={REALMS.map(r => r.value === 'tide' ? { ...r, disabled: true } : r)} hint="Willowmere's road is closed tonight." onChange={() => undefined} class="kb-crests-partial" />
    </div>
    <div class="kb-forge-col">
      <ParchmentField id="kb-words" label="Your words" value={words()} max={240} onInput={setWords} placeholder="!forge a crescent moon lantern" />
      <ParchmentField id="kb-near" label="Near the end" value={'!forge ' + 'a lantern with a moth on it, '.repeat(8).slice(0, 222)} max={240} onInput={() => undefined} />
      <ParchmentField id="kb-invalid" label="Your words" value="!forge a chimney shaped like a sleeping dragon" max={240} invalid="The forge is cold tonight. Please try another night." invalidTag="Only you" onInput={() => undefined} />
      <ParchmentField id="kb-disabled" label="Your words" value="" max={240} disabled hint="The anvil is busy with another wish." placeholder="!forge a crescent moon lantern" onInput={() => undefined} />
    </div>
  </section>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing bench root');
render(() => new URLSearchParams(location.search).get('kit') === 'forge' ? <main class="kb"><header class="kb-head cd-plate"><p class="cd-label kb-eyebrow">Carved kit · isolated bench</p><h1>Forge fittings</h1><p class="kb-lede">Typed states, with no realm travel, request or Forge behind any of them.</p></header><ForgeKit /></main> : <Bench />, root);
void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; })));
