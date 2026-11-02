import { createMemo, createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js';
import type { BuildToolsState } from '@chatdom/shared';
import type { AudioCue } from '@chatdom/audio';
import type { BuildPiece } from '../build/pieces';
import type { BuildRackProps } from '../build/Surface';
import { BRUSHES, TOOLS, allowanceWords, draftWords, materialName, pieceShelf, privateDraft, rackHeading, shelveMaterials, welcomeWords } from './copy';
import { brushMark, drawerMark, leaveMark, redoMark, toolMarks, undoMark, welcomeMark } from './marks';
import { piecePicture } from './picture';
import '@chatdom/ui/kit.css';
import './build-tools.css';

const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = apple ? '⌘' : 'Ctrl';
/** Matches the thumb-rack breakpoints in build-tools.css (upright and sideways phones), where the shelves fold into drawers. */
const PHONE = '(max-width: 600px), (max-height: 560px)';
const ROAM: Record<string, (at: number, last: number) => number> = {
  ArrowLeft: at => at - 1, ArrowUp: at => at - 1, ArrowRight: at => at + 1, ArrowDown: at => at + 1, Home: () => 0, End: (_, last) => last,
};
/**
 * Arrow keys walk focus along one row of fittings (tools, samples, brush, pieces) without choosing anything.
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
const samePieces = (a: readonly BuildPiece[] | null, b: readonly BuildPiece[] | null) => a === b || !!a && !!b && a.length === b.length && a.every((p, i) => p === b[i]);
type Drawer = 'materials' | 'pieces';

/** The citizen's tool rack. Every fact on it comes from the build core; it holds no edit state of its own. */
export default function BuildToolsRack(props: BuildRackProps) {
  const [state, setState] = createSignal<BuildToolsState>(props.controller.snapshot());
  onCleanup(props.controller.subscribe(next => setState(() => next)));
  const locked = () => !privateDraft(state().mode);
  const draft = () => draftWords(state().mode);
  const welcome = () => welcomeWords(state().mode, state().publishing);
  const tool = () => TOOLS.find(item => item.id === state().tool) ?? TOOLS[0]!;
  const brush = () => BRUSHES.find(item => item.cells === state().brush) ?? BRUSHES[0]!;
  const allowance = () => allowanceWords(state().occupied, state().budget);
  // Each core notice is a fresh snapshot; keep the swatch buttons (and the focus inside them) unless the palette really changed.
  const materials = createMemo(() => state().materials, undefined, { equals: sameMaterials });
  const shelves = createMemo(() => shelveMaterials(materials()));
  const chosen = () => materials().find(item => item.id === state().material);
  const chosenName = () => chosen() ? materialName(chosen()!.name) : '';
  // Pieces and the piece on preview are the core's; every notice re-reads them.
  const pieces = createMemo(() => { state(); return pieceShelf(props.rack?.pieces()); }, null, { equals: samePieces });
  const previewing = () => { state(); return props.rack?.previewing() ?? null; };
  const shown = () => { const id = previewing(); return id === null ? undefined : pieces()?.find(piece => piece.id === id); };
  const colourOf = (material: number) => materials().find(item => item.id === material)?.colour;

  // View-only state: the phone drawer (and whether it has been folded once) and a hover preview of a swatch's name.
  const [wanted, setDrawer] = createSignal<Drawer | null>(null);
  /** A pieces drawer whose pieces were withdrawn folds itself away rather than standing open and empty. */
  const drawer = (): Drawer | null => wanted() === 'pieces' && !pieces() ? null : wanted();
  // Beside the home on a wide screen, materials and pieces share one shelf well under two carved tabs.
  const [tab, setTab] = createSignal<Drawer>('materials');
  const shelfTab = (): Drawer => pieces() ? tab() : 'materials';
  const [shut, setShut] = createSignal(false);
  const [peek, setPeek] = createSignal<number | null>(null);
  const peeked = () => { const id = peek(); const item = id === null || id === state().material ? undefined : materials().find(m => m.id === id); return item && materialName(item.name); };
  const palette = createUniqueId(), pieceTray = createUniqueId(), tabIds = { materials: createUniqueId(), pieces: createUniqueId() };
  let materialOpener: HTMLButtonElement | undefined, pieceOpener: HTMLButtonElement | undefined, shelf: HTMLDivElement | undefined, tray: HTMLDivElement | undefined;
  const phone = typeof window !== 'undefined' ? window.matchMedia(PHONE) : undefined;
  const widened = () => { if (!phone?.matches) setDrawer(null); };
  phone?.addEventListener('change', widened);
  onCleanup(() => phone?.removeEventListener('change', widened));
  /** Presses that change only the rack still sound, through the kingdom's own cue; the core sounds its own actions. */
  const sound = (kind: AudioCue = 'wood') => props.rack?.cue(kind);
  function openDrawer(kind: Drawer) {
    setDrawer(kind); sound();
    const host = kind === 'materials' ? shelf : tray;
    const target = host?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? host?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    target?.focus({ preventScroll: true });
  }
  function closeDrawer() {
    const kind = drawer(); if (!kind) return;
    setDrawer(null); setShut(true); sound();
    (kind === 'materials' ? materialOpener : pieceOpener)?.focus({ preventScroll: true });
  }
  function drawerKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !drawer() || !phone?.matches) return;
    event.preventDefault(); event.stopPropagation(); closeDrawer();
  }
  onCleanup(() => { if (previewing() !== null) props.rack?.preview(null); });
  function chooseTab(kind: Drawer, focus = false) {
    if (shelfTab() !== kind) { setTab(kind); sound(); }
    if (focus) document.getElementById(tabIds[kind])?.focus({ preventScroll: true });
  }
  function tabKey(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next: Drawer | undefined = event.key === 'ArrowLeft' || event.key === 'Home' ? 'materials' : event.key === 'ArrowRight' || event.key === 'End' ? 'pieces' : undefined;
    if (!next) return;
    event.preventDefault(); chooseTab(next, true);
  }
  function choosePiece(piece: BuildPiece) { sound(); props.rack?.preview(previewing() === piece.id ? null : piece.id); }
  function putBack() { sound(); props.rack?.preview(null); }
  function setIn(piece: BuildPiece) { if (!props.rack?.place(piece.id)) sound(); }

  // A disabled history key says why in words; on the icon-only thumb row the dimmed arrow keeps its place.
  const why = () => locked() ? 'Not open' : 'Nothing yet';
  const drawerTitle = () => drawer() === 'pieces' ? 'Your pieces' : chosenName();

  return <aside class="bt-rack cd-plate cd-kit" classList={{ 'bt-locked': locked(), 'bt-has-pieces': !!pieces(), 'bt-drawer-open': !!drawer(), 'bt-drawer-shut': shut() && !drawer() }}
    data-drawer={drawer() ?? undefined} aria-label="Build tools" data-build-tools-rack>
    <header class="bt-head">
      <div class="bt-plate">
        <h2 class="bt-owner">{rackHeading(props.ownerName)}</h2>
        <p class="bt-privacy"><b>{draft().title}</b><span class="bt-privacy-detail">{draft().detail}</span></p>
      </div>
      <button class="bt-key bt-leave" onClick={() => props.controller.leave()} aria-label="Return to the street" aria-keyshortcuts="Escape">
        {leaveMark()}<span>Street</span><kbd>Esc</kbd>
      </button>
    </header>

    <p class="bt-slip" role="status">
      <Show when={state().status} keyed>{status => <span class="bt-slip-text">{status}</span>}</Show>
      <Show when={state().dirty}><span class="bt-slip-note">{draft().unsent}</span></Show>
    </p>

    <div class="bt-tools" role="group" aria-label="Tool" onKeyDown={roam}>
      <For each={TOOLS}>{item => <button class="bt-tool" disabled={locked()} aria-pressed={state().tool === item.id} aria-label={item.name} aria-keyshortcuts={item.key}
        onClick={() => props.controller.tool(item.id)}>{toolMarks[item.id]()}<span class="bt-tool-name">{item.name}</span><kbd>{item.key}</kbd></button>}</For>
    </div>
    <p class="bt-hint bt-tool-help">
      <Show when={!locked()} fallback={draft().detail}><b>{tool().name}.</b> {tool().hint}</Show>
    </p>

    <button ref={el => { materialOpener = el; }} class="bt-opener bt-material-opener" aria-expanded={drawer() === 'materials'} aria-controls={palette}
      onClick={() => drawer() === 'materials' ? closeDrawer() : openDrawer('materials')}>
      <i class="bt-chip" style={{ '--bt-swatch': chosen()?.colour ?? 'transparent' }} />
      <span class="bt-opener-text"><small>Material</small><span>{chosenName()}</span></span>
      {drawerMark(drawer() === 'materials')}
    </button>
    <Show when={pieces()}>{list => <button ref={el => { pieceOpener = el; }} class="bt-opener bt-piece-opener" aria-expanded={drawer() === 'pieces'} aria-controls={pieceTray}
      onClick={() => drawer() === 'pieces' ? closeDrawer() : openDrawer('pieces')}>
      <span class="bt-opener-text"><small>Your pieces</small><span>{list().length === 1 ? 'One piece' : `${list().length} pieces`}</span></span>
      {drawerMark(drawer() === 'pieces')}
    </button>}</Show>

    <div class="bt-drawer-head">
      <div class="bt-drawer-title">
        <p><span>{drawerTitle()}</span></p>
        <p class="bt-readout">{tool().name} · {brush().label}</p>
      </div>
      <button class="bt-key bt-close" onClick={closeDrawer}>{drawerMark(true)}<span>Close</span></button>
    </div>

    <Show when={pieces()}>{list => <div class="bt-tabs" role="tablist" aria-label="Shelves" onKeyDown={tabKey}>
      <button id={tabIds.materials} class="bt-tab" role="tab" aria-selected={shelfTab() === 'materials'} aria-controls={palette} tabIndex={shelfTab() === 'materials' ? 0 : -1}
        onClick={() => chooseTab('materials')}>Materials<i class="bt-chip" style={{ '--bt-swatch': chosen()?.colour ?? 'transparent' }} /></button>
      <button id={tabIds.pieces} class="bt-tab" role="tab" aria-selected={shelfTab() === 'pieces'} aria-controls={pieceTray} tabIndex={shelfTab() === 'pieces' ? 0 : -1}
        onClick={() => chooseTab('pieces')}>Your pieces<span class="bt-count">{list().length}</span></button>
    </div>}</Show>

    <section class="bt-materials" id={palette} aria-label="Materials" role={pieces() ? 'tabpanel' : undefined} aria-labelledby={pieces() ? tabIds.materials : undefined}
      classList={{ 'bt-shelf-shown': shelfTab() === 'materials' }} onKeyDown={drawerKey}>
      <h3 class="bt-label"><b class="bt-label-word">Materials</b><i class="bt-chip" style={{ '--bt-swatch': chosen()?.colour ?? 'transparent' }} /><span class="bt-chosen">{chosenName()}</span><Show when={peeked()}>{name => <em class="bt-peek">{name()}</em>}</Show></h3>
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
    </section>
    <Show when={pieces()}>{list => <section class="bt-pieces" id={pieceTray} role="tabpanel" aria-labelledby={tabIds.pieces}
      classList={{ 'bt-shelf-shown': shelfTab() === 'pieces' }} onKeyDown={drawerKey}>
      <div ref={el => { tray = el; }} class="bt-piece-row" role="group" aria-label="Pieces to set in" onKeyDown={roam}>
        <For each={list()}>{piece => {
          const picture = piece.picture ? null : piecePicture(piece.blueprint, colourOf);
          return <button class="bt-piece" disabled={locked()} aria-pressed={previewing() === piece.id} aria-label={piece.name} onClick={() => choosePiece(piece)}>
            <span class="bt-piece-picture">
              <Show when={piece.picture} fallback={<Show when={picture}>{art => <svg viewBox={art().viewBox} aria-hidden="true">
                <For each={art().faces}>{face => <polygon points={face.points} fill={face.fill} />}</For></svg>}</Show>}>
                {src => <img src={src()} alt="" loading="lazy" draggable={false} />}
              </Show>
            </span>
            <span class="bt-piece-name">{piece.name}</span>
          </button>;
        }}</For>
      </div>
      <Show when={shown()} keyed>{piece => <div class="bt-piece-slip">
        <p class="bt-piece-title"><b>{piece.name}</b><Show when={piece.note}>{note => <span>{note()}</span>}</Show></p>
        <p class="bt-piece-help">Shown where it will stand. Setting it in takes its space on your plot; Undo brings back what was there.</p>
        <div class="bt-piece-actions">
          <button class="bt-key bt-set" onClick={() => setIn(piece)}>Set it in</button>
          <button class="bt-key bt-put-back" onClick={putBack}>Put it back</button>
        </div>
      </div>}</Show>
    </section>}</Show>

    <div class="bt-shape">
      <div class="bt-field">
        <h3 class="bt-label" aria-hidden="true">Block</h3>
        <div class="bt-seg" role="group" aria-label="Block size" onKeyDown={roam}>
          <For each={BRUSHES}>{item => <button disabled={locked()} aria-pressed={state().brush === item.cells} aria-label={item.name}
            onClick={() => props.controller.brush(item.cells)}>{brushMark(item.cells)}<span>{item.label}</span></button>}</For>
        </div>
      </div>
      <button class="bt-key bt-history bt-undo" disabled={locked() || !state().canUndo} onClick={() => props.controller.undo()} aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z">
        {undoMark()}<span>Undo</span><Show when={!locked() && state().canUndo} fallback={<small class="bt-why">{why()}</small>}><kbd>{mod} Z</kbd></Show>
      </button>
      <button class="bt-key bt-history bt-redo" disabled={locked() || !state().canRedo} onClick={() => props.controller.redo()} aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y">
        {redoMark()}<span>Redo</span><Show when={!locked() && state().canRedo} fallback={<small class="bt-why">{why()}</small>}><kbd>{mod} ⇧ Z</kbd></Show>
      </button>
    </div>

    <div class="bt-allowance" role="meter" aria-label="Allowance" aria-valuemin={0} aria-valuemax={state().budget} aria-valuenow={state().occupied}
      aria-valuetext={allowance().spoken} classList={{ 'bt-allowance-near': allowance().near }}>
      <p class="bt-allowance-words" aria-hidden="true">
        <span class="bt-allowance-name">Allowance</span>
        <span class="bt-allowance-used"><b>{allowance().used}</b><span class="bt-long"> blocks</span></span>
        <span class="bt-allowance-left">{allowance().left}</span>
      </p>
      <span class="bt-gauge" aria-hidden="true"><i style={{ width: `${allowance().fraction * 100}%` }} /></span>
    </div>

    <button class="bt-welcome" disabled={locked() || state().publishing} aria-busy={state().publishing} onClick={() => { sound(); void props.controller.publish(); }}>
      {welcomeMark()}
      <span class="bt-welcome-text">
        <span>{welcome().title}</span>
        <small><span class="bt-long">{welcome().detail}</span><span class="bt-short">{welcome().short}</span></small>
      </span>
    </button>
    <Show when={!locked()}><p class="bt-hint bt-camera">Right-drag to look around · scroll to step closer</p></Show>
  </aside>;
}
