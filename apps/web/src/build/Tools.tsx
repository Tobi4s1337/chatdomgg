import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { BuildToolsController, BuildTool } from '@chatdom/shared';
import './build.css';

/** Registry names are identifiers ("darkStone"); a citizen reads words. The fallback stands alone, so it keeps its own copy. */
const materialName = (name: string) => { const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return words.charAt(0).toUpperCase() + words.slice(1); };

const toolNames: { id: BuildTool; name: string; path: string }[] = [
  { id: 'place', name: 'Place', path: 'm4 8 8-4 8 4-8 4Zm0 0v9l8 4 8-4V8m-8 4v9' },
  { id: 'erase', name: 'Erase', path: 'm4 14 9-10 7 6-9 10H8Zm3-4 7 6m-3 4h10' },
  { id: 'paint', name: 'Paint', path: 'm14 4 6 5-9 8-4-4Zm-7 9c-5 0-1 6-4 7 5 1 8-1 8-3' },
  { id: 'fill', name: 'Fill', path: 'm5 9 7-6 9 9-7 7Zm0 0L2 6m1 11c-4 5 3 6 3 2m2 2h13' },
];

/** Small functional kit shown while the carved rack loads, or if it cannot; the same facts in the same words, at readable sizes. */
export default function BuildTools(props: { controller: BuildToolsController; ownerName?: string }) {
  const [state, setState] = createSignal(props.controller.snapshot());
  const stop = props.controller.subscribe(setState); onCleanup(stop);
  // The engine's browser-local mode is never shown by name (decision 25); the words say what happens to the work.
  const locked = () => state().mode !== 'SIMULATED';
  const why = () => locked() ? 'not open' : 'nothing yet';
  return <aside class="build-tools" aria-label="Build your home" data-build-tools>
    <header class="build-tools-heading"><div><p>Your own little corner</p><h2>{props.ownerName?.trim() ? `${props.ownerName.trim()}’s home` : 'Your home'}</h2></div><button class="build-close" onClick={() => props.controller.leave()} aria-label="Return to the street"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
    <p class="build-privacy"><b>{locked() ? 'Not open to building yet' : 'Private to you'}</b> <span>{locked() ? 'The tools rest until this street opens to building.' : 'Saved in this browser until the street opens to building.'}</span></p>
    <div class="build-tool-row" role="group" aria-label="Building tool"><For each={toolNames}>{item => <button disabled={locked()} aria-pressed={state().tool === item.id} classList={{ selected: state().tool === item.id }} onClick={() => props.controller.tool(item.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.path} /></svg><span>{item.name}</span></button>}</For></div>
    <div class="build-materials" role="group" aria-label="Kingdom materials"><For each={state().materials}>{item => <button disabled={locked()} classList={{ selected: state().material === item.id }} aria-label={item.name} title={item.name} aria-pressed={state().material === item.id} style={{ '--swatch': item.colour }} onClick={() => props.controller.material(item.id)}><span /></button>}</For><span class="build-material-name">{materialName(state().materials.find(m => m.id === state().material)?.name ?? '')}</span></div>
    <div class="build-settings"><div role="group" aria-label="Brush size"><span>Block</span><For each={[4, 2, 1] as const}>{size => <button disabled={locked()} classList={{ selected: state().brush === size }} aria-pressed={state().brush === size} onClick={() => props.controller.brush(size)}>{size === 4 ? '½ m' : size === 2 ? '¼ m' : '⅛ m'}</button>}</For></div></div>
    <div class="build-history"><button disabled={!state().canUndo || locked()} onClick={() => props.controller.undo()} title="Undo · Ctrl Z" aria-label="Undo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12" /></svg>Undo<Show when={locked() || !state().canUndo}><small>{why()}</small></Show></button><button disabled={!state().canRedo || locked()} onClick={() => props.controller.redo()} title="Redo · Ctrl Shift Z" aria-label="Redo">Redo<Show when={locked() || !state().canRedo}><small>{why()}</small></Show><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" /></svg></button><span>{state().occupied.toLocaleString()} / {state().budget.toLocaleString()}</span></div>
    <div class="build-allowance" role="meter" aria-label="Blocks used" aria-valuenow={state().occupied} aria-valuemin={0} aria-valuemax={state().budget}><i style={{ width: `${Math.min(100, state().occupied / state().budget * 100)}%` }} /></div>
    <p class="build-save-status" role="status">{state().status}<Show when={state().dirty}><small>{locked() ? 'Not on the street' : 'Not yet on your street'}</small></Show></p>
    <button class="build-publish" disabled={state().publishing || locked()} onClick={() => void props.controller.publish()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7M9 6V3H5v6" /></svg><span>{state().publishing ? 'Opening the shutters…' : 'Welcome the street'}<Show when={!locked()}><small>Your street in this browser</small></Show></span></button>
    <p class="build-hint">{locked() ? 'The tools rest until live building opens on this street.' : 'Click or drag to build · right-drag to look · Esc to walk'}</p>
  </aside>;
}
