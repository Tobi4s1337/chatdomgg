// The streamer's side of the panel (`Twitch.md` §16): config chooses what viewers see, live
// config can Hide the panel's moments during a stream. Today no kingdom service can save a
// choice, carry Hide to viewers' panels or bring viewer content to review, so each of those
// says so plainly, beside a SIMULATED night where every choice really takes effect. Twitch's
// role in this view never grants a royal act: those stay on the throne.
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { createFixtureAdapter } from './adapters/fixture';
import { openSimulationWire } from './adapters/simulation';
import { connectHelper } from './helper';
import { ALL_SECTIONS, type Sections } from './model';
import Panel from './Panel';
import { DEFAULT_SHELF, SHELF_MENU } from './shelf-menu';
import { PanelDefs, Seal } from './ui/art';
import './panel.css';
import './config.css';

type ReadyWindow = Window & { __chatdomReady?: boolean };

const SECTION_ROWS: readonly { id: keyof Sections; name: string; detail: string }[] = [
  { id: 'night', name: 'The night', detail: 'Tonight’s moments beside the picture, and last night’s between streams.' },
  { id: 'home', name: 'Your home', detail: 'Each viewer’s home card, opened from their window.' },
  { id: 'acts', name: 'Crowd acts', detail: 'One tap for the vote, errand or dragon chat is already doing.' },
  { id: 'shelf', name: 'The shelf', detail: 'A small fixed menu of moments, where Bits are on.' },
];

const bits = (n: number) => n.toLocaleString('en-US');

/** A carved switch: a brass knob in a wooden slot, with its state in words beside it. */
function Lever(props: { on: boolean; label: string; onWords?: string; offWords?: string; disabled?: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" class="cfg-lever" aria-checked={props.on} aria-label={props.label} disabled={props.disabled} onClick={() => props.onToggle()}>
    <span class="cfg-slot" aria-hidden="true"><i /></span>
    <span class="cfg-lever-words">{props.on ? props.onWords ?? 'Shown' : props.offWords ?? 'Hidden'}</span>
  </button>;
}

function Sheet(props: { title: string; eyebrow?: string; class?: string; children: JSX.Element }) {
  return <section class={`cfg-sheet ${props.class ?? ''}`} aria-label={props.title}>
    <Show when={props.eyebrow}><p class="cp-label">{props.eyebrow}</p></Show>
    <h2 class="cfg-title">{props.title}</h2>
    {props.children}
  </section>;
}

/** Why something real cannot happen yet, in one line, with no button pretending otherwise. */
function Unavailable(props: { children: JSX.Element }) {
  return <p class="cfg-unavailable" role="note"><strong>Not available yet</strong><span>{props.children}</span></p>;
}

/** The panel at its real 318 x 496, scaled down only when the page is narrower than the panel. */
function Preview(props: { children: JSX.Element; caption: string }) {
  let holder: HTMLDivElement | undefined;
  const [scale, setScale] = createSignal(1);
  onMount(() => {
    const fit = () => setScale(Math.min(1, (holder?.clientWidth ?? 318) / 318));
    const observer = new ResizeObserver(fit);
    observer.observe(holder!);
    fit();
    onCleanup(() => observer.disconnect());
  });
  return <figure class="cfg-preview">
    <div class="cfg-preview-holder" ref={element => { holder = element; }} style={{ height: `${Math.round(496 * scale())}px` }}>
      <div class="cfg-preview-scale" style={{ transform: `scale(${scale()})` }}>{props.children}</div>
    </div>
    <figcaption class="cfg-caption">{props.caption}</figcaption>
  </figure>;
}

export default function Config(props: { live: boolean }) {
  const helper = connectHelper();
  const outside = () => helper.status().kind === 'absent';
  const [sections, setSections] = createSignal<Sections>(ALL_SECTIONS);
  const [chosen, setChosen] = createSignal<readonly string[]>(DEFAULT_SHELF);
  const [hidden, setHidden] = createSignal(false);
  // The SIMULATED night every choice on this page acts on. A viewer's real panel is never touched.
  const preview = createFixtureAdapter('vote');
  // Live config is the simulated night's host: a simulated panel opened beside it asks whether its moments are hidden.
  const wire = props.live ? openSimulationWire(message => { if (message.kind === 'ask') wire?.post({ kind: 'hide', hidden: hidden() }); }) : null;
  onCleanup(() => wire?.close());

  const toggleSection = (id: keyof Sections) => {
    const next = { ...sections(), [id]: !sections()[id] };
    setSections(next);
    preview.configure({ sections: next });
  };
  const toggleProduct = (sku: string) => {
    const next = chosen().includes(sku) ? chosen().filter(item => item !== sku) : [...chosen(), sku];
    setChosen(next);
    preview.configure({ products: next });
  };
  const toggleHide = () => {
    const next = !hidden();
    setHidden(next);
    preview.configure({ hidden: next });
    wire?.post({ kind: 'hide', hidden: next });
  };

  // Ready once the faces are in and the preview panel has drawn its picture.
  const [previewReady, setPreviewReady] = createSignal(false);
  onMount(() => {
    document.documentElement.classList.add('cp-document', 'cp-config-document');
    (window as ReadyWindow).__chatdomReady = false;
  });
  const markReady = () => {
    setPreviewReady(true);
    void document.fonts.ready.then(() => requestAnimationFrame(() => { (window as ReadyWindow).__chatdomReady = true; }));
  };
  onCleanup(() => {
    document.documentElement.classList.remove('cp-document', 'cp-config-document');
    (window as ReadyWindow).__chatdomReady = false;
  });

  const shelfOn = () => sections().shelf;
  const offered = () => shelfOn() && chosen().length > 0;

  return <div class="cp cp-config" data-chatdom-panel-config data-live={props.live ? 'true' : 'false'} data-hidden={hidden() ? 'true' : 'false'} data-preview={previewReady() ? 'ready' : 'drawing'}>
    <PanelDefs />
    <header class="cp-head cfg-head">
      <Seal blank />
      <div class="cp-title">
        <h1 class="cp-name">{props.live ? 'Tonight’s panel' : 'Your panel'}</h1>
        <p class="cp-motto">{outside() ? 'Opens on Twitch' : props.live ? 'While you are live' : 'Under your video'}</p>
      </div>
      <span class="cp-tag quiet">Not connected</span>
    </header>

    <div class="cfg-page">
      <div class="cfg-settings">
        <Show when={props.live} fallback={
          <>
            <Sheet title="Connect your kingdom" eyebrow="First">
              <p class="cfg-body">The panel shows the kingdom your chat lives in. It opens for viewers once your channel’s kingdom is founded and connected.</p>
              <Unavailable>Founding is not open yet, so there is nowhere to send you. This page links to it the day it opens.</Unavailable>
            </Sheet>

            <Sheet title="What viewers see" eyebrow="Simulated preview">
              <ul class="cfg-rows">
                <For each={SECTION_ROWS}>{row =>
                  <li class="cfg-row">
                    <span class="cfg-row-words"><strong>{row.name}</strong><small>{row.detail}</small></span>
                    <Lever on={sections()[row.id]} label={row.name} onToggle={() => toggleSection(row.id)} />
                  </li>}
                </For>
              </ul>
              <p class="cfg-fine">Every viewer can always light their window: it is free, and it is not a section.</p>
            </Sheet>

            <Sheet title="The shelf" eyebrow="Simulated preview" class="cfg-shelf">
              <p class="cfg-body">Choose from the fixed menu. Every moment is seen by the whole kingdom, on stream and in every panel. Nothing lasts past a day.</p>
              <ul class="cfg-menu" classList={{ off: !shelfOn() }}>
                <For each={SHELF_MENU}>{item =>
                  <li>
                    <button type="button" role="checkbox" class="cfg-item" aria-checked={chosen().includes(item.sku)} disabled={!shelfOn()} onClick={() => toggleProduct(item.sku)}>
                      <span class="cfg-tick" aria-hidden="true" />
                      <span class="cfg-item-words"><strong>{item.title}</strong><small>{item.stays ? `${item.stays} for a day` : 'For the moment only'}</small></span>
                      <span class="cfg-bits">{bits(item.bits)}<small>Bits</small></span>
                    </button>
                  </li>}
                </For>
              </ul>
              <p class="cfg-fine">{shelfOn()
                ? offered() ? 'Shown only where Twitch says Bits are on, and only while the stream view runs.' : 'With nothing chosen, viewers see no shelf.'
                : 'The shelf is hidden from viewers.'}</p>
            </Sheet>

            <Unavailable>Saving needs the kingdom service, which is not connected yet. Nothing on this page is saved, and viewers’ panels do not change.</Unavailable>
          </>}>
          <Sheet title="Hide panel moments" eyebrow="During the stream" class="cfg-hide">
            <p class="cfg-body">Hide pauses every crowd act and the shelf in viewers’ panels at once. Windows, homes and the night stay.</p>
            <div class="cfg-hide-row">
              <Lever on={hidden()} label="Hide panel moments" onWords="Hidden" offWords="Showing" onToggle={toggleHide} />
              <p class="cfg-hide-state" role="status">{hidden() ? 'No crowd act or shelf shows in the simulated panels.' : 'Crowd acts and the shelf are open in the simulated panels.'}</p>
            </div>
            <p class="cfg-fine cfg-simulated">Simulated: Hide acts on the simulated night below and any simulated panel open beside it.</p>
            <Unavailable>Viewers’ real panels cannot be reached until the kingdom service is connected.</Unavailable>
          </Sheet>

          <Sheet title="Viewer content" eyebrow="To review">
            <p class="cfg-body">Homes and Forge pieces made by viewers wait here for you to keep or remove, with their makers’ names.</p>
            <Unavailable>Nothing can reach this queue until the kingdom service is connected, so nothing waits and nothing is approved.</Unavailable>
          </Sheet>

          <p class="cfg-fine cfg-throne">Royal acts, from Show and Busy to raids and crowning, stay on your throne. This page has none.</p>
        </Show>
      </div>

      <Preview caption={props.live
        ? 'A simulated viewer’s panel tonight. Hide clears its vote and shelf.'
        : 'A simulated viewer’s panel. These choices change only this picture.'}>
        <Panel adapter={preview} embedded onReady={markReady} />
      </Preview>
    </div>
  </div>;
}
