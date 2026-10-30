import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { BuildToolsController, BuildToolsState } from '@chatdom/shared';
import { BRUSHES, MIRRORS, TOOLS, materialName } from './copy';
import { brushMark, leaveMark, mirrorMark, redoMark, toolMarks, undoMark, welcomeMark } from './marks';
import './build-tools.css';

const count = new Intl.NumberFormat('en-GB');
const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = apple ? '⌘' : 'Ctrl';

/** The citizen's tool rack. Every fact on it comes from the build core; it holds no edit state of its own. */
export default function BuildToolsRack(props: { controller: BuildToolsController }) {
  const [state, setState] = createSignal<BuildToolsState>(props.controller.snapshot());
  onCleanup(props.controller.subscribe(next => setState(() => next)));
  const locked = () => state().mode !== 'SIMULATED';
  const tool = () => TOOLS.find(item => item.id === state().tool) ?? TOOLS[0]!;
  const material = () => state().materials.find(item => item.id === state().material);
  const mirror = () => MIRRORS.find(item => item.value === state().mirror) ?? MIRRORS[0]!;
  const used = () => Math.min(1, state().occupied / Math.max(1, state().budget));

  return <aside class="bt-rack" classList={{ 'bt-locked': locked() }} aria-label="Build tools" data-build-tools-rack>
    <header class="bt-head">
      <div class="bt-plate">
        <p class="bt-eyebrow">Build mode</p>
        <h2>Shaping your home</h2>
        <p class="bt-mode"><b>{state().mode}</b><span>{locked() ? 'Building is not open here yet' : 'Private draft in this browser'}</span></p>
      </div>
      <button class="bt-key bt-leave" onClick={() => props.controller.leave()} aria-label="Return to the street" aria-keyshortcuts="Escape">
        {leaveMark()}<span>Street</span><kbd>Esc</kbd>
      </button>
    </header>

    <p class="bt-slip" role="status">
      <span class="bt-slip-text">{state().status}</span>
      <Show when={state().dirty}><span class="bt-slip-note">Changes the street hasn’t seen</span></Show>
    </p>

    <div class="bt-tools" role="group" aria-label="Tool">
      <For each={TOOLS}>{item => <button class="bt-tool" disabled={locked()} aria-pressed={state().tool === item.id} aria-keyshortcuts={item.key}
        onClick={() => props.controller.tool(item.id)}>{toolMarks[item.id]()}<span class="bt-tool-name">{item.name}</span><kbd>{item.key}</kbd></button>}</For>
    </div>
    <p class="bt-hint"><b>{tool().name}.</b> {tool().hint}</p>

    <div class="bt-materials">
      <p class="bt-label">Material<span>{material() ? materialName(material()!.name) : ''}</span></p>
      <div class="bt-swatches" role="group" aria-label="Kingdom materials">
        <For each={state().materials}>{item => <button class="bt-swatch" disabled={locked()} aria-pressed={state().material === item.id} aria-label={materialName(item.name)}
          style={{ '--bt-swatch': item.colour }} onClick={() => props.controller.material(item.id)}><i /></button>}</For>
      </div>
    </div>

    <div class="bt-shape">
      <div class="bt-field">
        <p class="bt-label">Block</p>
        <div class="bt-seg" role="group" aria-label="Block size">
          <For each={BRUSHES}>{item => <button disabled={locked()} aria-pressed={state().brush === item.cells} aria-label={item.name}
            onClick={() => props.controller.brush(item.cells)}>{brushMark(item.cells)}<span>{item.label}</span></button>}</For>
        </div>
      </div>
      <div class="bt-field">
        <p class="bt-label">Mirror</p>
        <div class="bt-seg" role="group" aria-label="Mirror">
          <For each={MIRRORS}>{item => <button disabled={locked()} aria-pressed={state().mirror === item.value} aria-label={item.name}
            onClick={() => props.controller.mirror(item.value)}>{mirrorMark(item.value)}<span>{item.label}</span></button>}</For>
        </div>
      </div>
    </div>
    <p class="bt-hint bt-mirror-help">{mirror().help}</p>

    <div class="bt-ledger">
      <button class="bt-key bt-history" disabled={locked() || !state().canUndo} onClick={() => props.controller.undo()} aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z">
        {undoMark()}<span>Undo</span><kbd>{mod} Z</kbd>
      </button>
      <button class="bt-key bt-history" disabled={locked() || !state().canRedo} onClick={() => props.controller.redo()} aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y">
        {redoMark()}<span>Redo</span><kbd>{mod} ⇧ Z</kbd>
      </button>
      <div class="bt-budget" role="meter" aria-label="Blocks used" aria-valuemin={0} aria-valuemax={state().budget} aria-valuenow={state().occupied}
        aria-valuetext={`${count.format(state().occupied)} of ${count.format(state().budget)} blocks`} classList={{ 'bt-budget-full': used() > .9 }}>
        <span><b>{count.format(state().occupied)}</b><span class="bt-of"> of </span><span class="bt-slash"> / </span>{count.format(state().budget)}<span class="bt-of"> blocks</span></span>
        <i><em style={{ width: `${used() * 100}%` }} /></i>
      </div>
    </div>

    <button class="bt-welcome" disabled={locked() || state().publishing} aria-busy={state().publishing} onClick={() => void props.controller.publish()}>
      {welcomeMark()}<span>{state().publishing ? 'Opening the shutters…' : 'Welcome the street'}</span>
    </button>
    <Show when={!locked()}><p class="bt-hint bt-camera">Right-drag to look around · scroll to step closer</p></Show>
  </aside>;
}
