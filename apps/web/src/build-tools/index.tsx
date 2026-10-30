import { createMemo, createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js';
import type { BuildToolsController, BuildToolsState } from '@chatdom/shared';
import { BRUSHES, MIRRORS, TOOLS, materialName, mirrorWord, shelveMaterials } from './copy';
import { brushMark, drawerMark, leaveMark, mirrorMark, redoMark, toolMarks, undoMark, welcomeMark } from './marks';
import './build-tools.css';

const count = new Intl.NumberFormat('en-GB');
const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = apple ? '⌘' : 'Ctrl';
/** Matches the thumb-rack breakpoints in build-tools.css (upright and sideways phones), where the palette folds into a drawer. */
const PHONE = '(max-width: 600px), (max-height: 560px)';
const ROAM: Record<string, (at: number, last: number) => number> = {
  ArrowLeft: at => at - 1, ArrowUp: at => at - 1, ArrowRight: at => at + 1, ArrowDown: at => at + 1, Home: () => 0, End: (_, last) => last,
};
/**
 * Arrow keys walk focus along one row of fittings (tools, samples, brush, mirror) without choosing anything.
 * Tab still reaches every fitting, and the core's own keys pass through untouched.
 */
function roam(event: KeyboardEvent) {
  const step = ROAM[event.key];
  if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const row = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(item => item.getClientRects().length);
  const at = row.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  row[Math.max(0, Math.min(row.length - 1, step(at, row.length - 1)))]!.focus({ preventScroll: true });
}
type Materials = BuildToolsState['materials'];
const sameMaterials = (a: Materials, b: Materials) => a.length === b.length && a.every((m, i) => m.id === b[i]!.id && m.name === b[i]!.name && m.colour === b[i]!.colour);

/** The citizen's tool rack. Every fact on it comes from the build core; it holds no edit state of its own. */
export default function BuildToolsRack(props: { controller: BuildToolsController }) {
  const [state, setState] = createSignal<BuildToolsState>(props.controller.snapshot());
  onCleanup(props.controller.subscribe(next => setState(() => next)));
  const locked = () => state().mode !== 'SIMULATED';
  const tool = () => TOOLS.find(item => item.id === state().tool) ?? TOOLS[0]!;
  const brush = () => BRUSHES.find(item => item.cells === state().brush) ?? BRUSHES[0]!;
  const mirror = () => MIRRORS.find(item => item.value === state().mirror) ?? MIRRORS[0]!;
  const used = () => Math.min(1, state().occupied / Math.max(1, state().budget));
  // Each core notice is a fresh snapshot; keep the swatch buttons (and the focus inside them) unless the palette really changed.
  const materials = createMemo(() => state().materials, undefined, { equals: sameMaterials });
  const shelves = createMemo(() => shelveMaterials(materials()));
  const chosen = () => materials().find(item => item.id === state().material);
  const chosenName = () => chosen() ? materialName(chosen()!.name) : '';

  // View-only state: the phone drawer (and whether it has been folded once) and a hover preview of a swatch's name.
  const [drawer, setDrawer] = createSignal(false);
  const [shut, setShut] = createSignal(false);
  const [peek, setPeek] = createSignal<number | null>(null);
  const peeked = () => { const id = peek(); const item = id === null || id === state().material ? undefined : materials().find(m => m.id === id); return item && materialName(item.name); };
  const palette = createUniqueId();
  let opener: HTMLButtonElement | undefined, shelf: HTMLDivElement | undefined;
  const phone = typeof window !== 'undefined' ? window.matchMedia(PHONE) : undefined;
  const widened = () => { if (!phone?.matches) setDrawer(false); };
  phone?.addEventListener('change', widened);
  onCleanup(() => phone?.removeEventListener('change', widened));
  function openDrawer() {
    setDrawer(true);
    shelf?.querySelector<HTMLButtonElement>('.bt-swatch[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  function closeDrawer() { setDrawer(false); setShut(true); opener?.focus({ preventScroll: true }); }
  function drawerKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !drawer() || !phone?.matches) return;
    event.preventDefault(); event.stopPropagation(); closeDrawer();
  }

  return <aside class="bt-rack" classList={{ 'bt-locked': locked(), 'bt-drawer-open': drawer(), 'bt-drawer-shut': shut() && !drawer() }} aria-label="Build tools" data-build-tools-rack>
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
      <Show when={state().status} keyed>{status => <span class="bt-slip-text">{status}</span>}</Show>
      <Show when={state().dirty}><span class="bt-slip-note">Changes the street hasn’t seen</span></Show>
    </p>

    <div class="bt-tools" role="group" aria-label="Tool" onKeyDown={roam}>
      <For each={TOOLS}>{item => <button class="bt-tool" disabled={locked()} aria-pressed={state().tool === item.id} aria-label={item.name} aria-keyshortcuts={item.key}
        onClick={() => props.controller.tool(item.id)}>{toolMarks[item.id]()}<span class="bt-tool-name">{item.name}</span><kbd>{item.key}</kbd></button>}</For>
    </div>
    <p class="bt-hint bt-tool-help"><b>{tool().name}.</b> {tool().hint}</p>

    <button ref={el => { opener = el; }} class="bt-opener" aria-expanded={drawer()} aria-controls={palette} onClick={() => drawer() ? closeDrawer() : openDrawer()}>
      <i class="bt-chip" style={{ '--bt-swatch': chosen()?.colour ?? 'transparent' }} />
      <span class="bt-opener-text"><small>Material</small><span>{chosenName()}</span></span>
      {drawerMark(drawer())}
    </button>

    <div class="bt-materials" id={palette} onKeyDown={drawerKey}>
      <div class="bt-drawer-head">
        <div class="bt-drawer-title">
          <p><small>Materials</small><span>{chosenName()}</span></p>
          <p class="bt-readout">{tool().name} · {brush().label} · {mirrorWord(state().mirror)}</p>
        </div>
        <button class="bt-key bt-close" onClick={closeDrawer}>{drawerMark(true)}<span>Close</span></button>
      </div>
      <p class="bt-label">Material<span>{chosenName()}</span><Show when={peeked()}>{name => <em class="bt-peek">{name()}</em>}</Show></p>
      <div ref={el => { shelf = el; }} class="bt-swatches" role="group" aria-label="Kingdom materials" onKeyDown={roam} onPointerLeave={() => setPeek(null)}>
        <For each={shelves()}>{group => <div class="bt-shelf" role="group" aria-label={group.name}>
          <span class="bt-shelf-name" aria-hidden="true">{group.name}</span>
          <div class="bt-shelf-row">
            <For each={group.items}>{item => <button class="bt-swatch" disabled={locked()} aria-pressed={state().material === item.id} aria-label={materialName(item.name)}
              style={{ '--bt-swatch': item.colour }} onClick={() => props.controller.material(item.id)}
              onPointerEnter={() => setPeek(item.id)} onFocus={() => setPeek(item.id)} onBlur={() => setPeek(null)}><i /></button>}</For>
          </div>
        </div>}</For>
      </div>
    </div>

    <div class="bt-shape">
      <div class="bt-field">
        <p class="bt-label">Block</p>
        <div class="bt-seg" role="group" aria-label="Block size" onKeyDown={roam}>
          <For each={BRUSHES}>{item => <button disabled={locked()} aria-pressed={state().brush === item.cells} aria-label={item.name}
            onClick={() => props.controller.brush(item.cells)}>{brushMark(item.cells)}<span>{item.label}</span></button>}</For>
        </div>
      </div>
      <div class="bt-field">
        <p class="bt-label">Mirror</p>
        <div class="bt-seg" role="group" aria-label="Mirror" onKeyDown={roam}>
          <For each={MIRRORS}>{item => <button disabled={locked()} aria-pressed={state().mirror === item.value} aria-label={item.name}
            onClick={() => props.controller.mirror(item.value)}>{mirrorMark(item.value)}<span>{item.label}</span></button>}</For>
        </div>
      </div>
    </div>
    <p class="bt-hint bt-mirror-help">{mirror().help}</p>

    <div class="bt-ledger">
      <button class="bt-key bt-history bt-undo" disabled={locked() || !state().canUndo} onClick={() => props.controller.undo()} aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z">
        {undoMark()}<span>Undo</span><kbd>{mod} Z</kbd>
      </button>
      <button class="bt-key bt-history bt-redo" disabled={locked() || !state().canRedo} onClick={() => props.controller.redo()} aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y">
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
