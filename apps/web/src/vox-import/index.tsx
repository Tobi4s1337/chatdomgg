import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { MATERIALS } from '@chatdom/content';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { BuildDraft, BuildError } from '@chatdom/world';
import {
  clampVoxOrigin, defaultVoxOrigin, parseVox, prepareVoxImport, rescaleVoxOrigin, scaleName, voxEditableSpan, voxPlacementError,
  voxScaledSize, voxUprightSize, VOX_IMPORT_LIMITS, VOX_SCALES,
  type VoxFile, type VoxImportError, type VoxImportMaterial, type VoxMaterialEffect, type VoxScale,
} from '@chatdom/vox-import';
import type { BuildImportBridge } from '../build/session';
import './vox-import.css';

interface Chosen { readonly name: string; readonly bytes: number; readonly vox: VoxFile }
interface Transform { readonly model: number; readonly scale: VoxScale; readonly origin: Vec3 }
/** What the same insertion does to a fresh copy of the current draft. Main's preview callback returns no receipt. */
type Trial =
  | { readonly ok: true; readonly existing: number; readonly after: number; readonly changed: number }
  | { readonly ok: false; readonly existing: number; readonly after: number; readonly error: VoxImportError };

const EFFECT_NAMES: Record<VoxMaterialEffect, string> = { metal: 'metal', glass: 'glass', emit: 'glow', blend: 'blend', media: 'cloud', cloud: 'cloud', translucent: 'see-through colour' };
const SCALE_MARKS: Record<VoxScale, string> = { 0.25: '¼', 0.5: '½', 1: '1×', 2: '2×', 4: '4×' };
const AXES = [{ key: 'X', word: 'across' }, { key: 'Y', word: 'up' }, { key: 'Z', word: 'to street' }] as const;
/** Transform changes settle briefly before the clone, validation and worker mesh run again. */
const SETTLE_MS = 70;
const metres = (cells: number) => `${(cells * VOXEL_METRES.build).toLocaleString('en', { maximumFractionDigits: 1 })} m`;
const count = (n: number) => n.toLocaleString('en');
/** A local filename is only ever escaped display text: no control characters, bounded length. */
const displayName = (name: string) => { const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() || 'Unnamed file'; return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean; };
const materialName = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const listed = (words: string[]) => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
const sameTransform = (a: Transform | null, b: Transform | null) => a === b || (!!a && !!b && a.model === b.model && a.scale === b.scale && a.origin.every((n, d) => n === b.origin[d]));

/** Bring one MagicaVoxel object into this private draft. Owns file, object and transform choice; never editor truth. */
export default function VoxImport(props: BuildImportBridge) {
  const [open, setOpen] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [chosen, setChosen] = createSignal<Chosen | null>(null);
  const [model, setModel] = createSignal<number | null>(null);
  const [scale, setScale] = createSignal<VoxScale>(1);
  const [origin, setOrigin] = createSignal<Vec3 | null>(null);
  const [error, setError] = createSignal<VoxImportError | null>(null);
  const [revision, setRevision] = createSignal(props.draft.revision);
  let input: HTMLInputElement | undefined, readToken = 0, previewing = false;

  const policy = () => props.draft.policy;
  const materials = (): VoxImportMaterial[] => policy().palette.flatMap(id => {
    const m = MATERIALS.materials.find(m => m.id === id);
    return m && id !== 0 ? [{ id, name: m.name, colour: m.colour }] : [];
  });
  const source = createMemo(() => { const file = chosen(), index = model(); return file && index !== null ? file.vox.models[index] ?? null : null; });
  const upright = createMemo(() => { const m = source(); return m?.count ? voxUprightSize(m) : null; });
  const span = () => voxEditableSpan(policy());
  /** Sizes whose whole box fits the editable plot and whose enlarged blocks fit the allowance before any expansion. */
  const fitsAt = (u: Vec3, cells: number, s: VoxScale) => voxScaledSize(u, s).every((n, d) => n <= span()[d]!) && cells * Math.max(1, s) ** 3 <= policy().maxVoxels;
  const fits = (s: VoxScale) => { const u = upright(), m = source(); return !!u && !!m && fitsAt(u, m.count, s); };
  const size = createMemo(() => { const u = upright(); return u ? voxScaledSize(u, scale()) : null; });
  const placed = createMemo(() => { const s = size(); return s ? origin() ?? defaultVoxOrigin(s, policy()) : null; });

  // Displayed controls answer at once; the clone, blueprint and preview follow a short settle.
  const live = createMemo<Transform | null>(() => { const index = model(), at = placed(); return index !== null && at ? { model: index, scale: scale(), origin: at } : null; }, null, { equals: sameTransform });
  const [settled, setSettled] = createSignal<Transform | null>(null, { equals: sameTransform });
  let settle: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(live, (next, previous) => {
    clearTimeout(settle);
    if (!next || !previous || next.model !== previous.model) setSettled(next);
    else settle = setTimeout(() => setSettled(next), SETTLE_MS);
  }));
  const settling = () => !sameTransform(live(), settled());

  const prepared = createMemo(() => {
    const file = chosen(), t = settled();
    if (!file || !t) return null;
    return prepareVoxImport({ file: file.vox, model: t.model, materials: materials(), styleId: policy().styleId, scale: t.scale, origin: t.origin, destination: policy() });
  });
  const accepted = () => { const result = prepared(); return result?.ok ? result : null; };
  const rejected = () => { const result = prepared(); return result && !result.ok ? result.error : null; };

  const trial = createMemo<Trial | null>(() => {
    const result = accepted();
    revision();
    if (!result) return null;
    const { blueprint, origin: at, summary } = result, { size: lattice, maxVoxels } = policy();
    const copy = new BuildDraft(policy(), props.draft.serialize()), before = copy.voxelCount, cells = copy.cloneVoxels();
    let existing = 0;
    for (let z = at[2]; z < at[2] + blueprint.size[2]; z++) for (let y = at[1]; y < at[1] + blueprint.size[1]; y++) {
      const row = at[0] + lattice[0] * (y + lattice[1] * z);
      for (let x = 0; x < blueprint.size[0]; x++) if (cells[row + x]) existing++;
    }
    const after = before - existing + summary.cells;
    const placement = voxPlacementError(summary.placement, policy());
    if (placement) return { ok: false, existing, after, error: placement };
    try {
      const change = copy.insertBlueprint(blueprint, at);
      return { ok: true, existing, after: change.voxelCount, changed: change.changed };
    } catch (failure) {
      const error: VoxImportError = failure instanceof BuildError && failure.code === 'budget'
        ? { code: 'budget', message: `This needs ${count(after - maxVoxels)} more blocks than your home allows.`, remedy: 'Choose a smaller size, or clear some blocks from your home first.' }
        : { code: 'placement', message: failure instanceof BuildError ? failure.message : 'This placement could not be checked.', remedy: 'Move it or choose another size; your home has not changed.' };
      return { ok: false, existing, after, error };
    }
  });
  const refused = () => { const t = trial(); return t && !t.ok ? t.error : null; };

  function clearPreview() { if (previewing) { previewing = false; props.onPreview(null, [0, 0, 0]); } }
  // An invalid placement is still shown: main's preview outlines the exact box in its refusal colour.
  createEffect(on([accepted, revision], ([result]) => {
    if (result) { previewing = true; props.onPreview(result.blueprint, result.origin); } else clearPreview();
  }));
  // Ordinary building can change the draft under an open preview; the summary and preview follow it.
  const watch = setInterval(() => { if (props.draft.revision !== revision()) setRevision(props.draft.revision); }, 300);
  onCleanup(() => { readToken++; clearInterval(watch); clearTimeout(settle); clearPreview(); });

  function pick(index: number) {
    const m = chosen()?.vox.models[index];
    if (!m?.count) return;
    const u = voxUprightSize(m);
    batch(() => { setModel(index); setOrigin(null); setScale(VOX_SCALES.filter(s => s <= 1 && fitsAt(u, m.count, s)).at(-1) ?? 1); });
  }
  function resize(next: VoxScale) {
    const u = upright(), from = size(), at = placed();
    if (!u || !from || !at || next === scale()) return;
    batch(() => { setOrigin(rescaleVoxOrigin(at, from, voxScaledSize(u, next), policy())); setScale(next); });
  }
  function move(axis: number, value: number) {
    const s = size(), at = placed();
    if (!s || !at || !Number.isFinite(value)) return;
    const next = [...at] as [number, number, number]; next[axis] = value;
    setOrigin(clampVoxOrigin(next, s, policy()));
  }

  async function choose(file: File | undefined) {
    const token = ++readToken;
    batch(() => { setChosen(null); setModel(null); setOrigin(null); setError(null); });
    if (input) input.value = '';
    if (!file) return;
    if (file.size > VOX_IMPORT_LIMITS.fileBytes) {
      setError({ code: 'too-large', message: `This file is ${(file.size / 1048576).toFixed(1)} MiB; the limit is ${VOX_IMPORT_LIMITS.fileBytes / 1048576} MiB.`, remedy: 'Export just the object you want to bring in, or a smaller version of it.' });
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (token !== readToken) return;
      const result = parseVox(bytes);
      if (!result.ok) { setError(result.error); return; }
      const filled = result.file.models.filter(m => m.count);
      setChosen({ name: displayName(file.name), bytes: file.size, vox: result.file });
      if (filled.length === 1) pick(filled[0]!.index);
    } catch {
      if (token === readToken) setError({ code: 'not-vox', message: 'This file could not be read from your device.', remedy: 'Choose it again, or save a fresh copy from MagicaVoxel.' });
    } finally { if (token === readToken) setReading(false); }
  }
  function putAway() { readToken++; batch(() => { setReading(false); setChosen(null); setModel(null); setOrigin(null); setError(null); setOpen(false); }); }

  const notices = createMemo(() => {
    const file = chosen()?.vox, result = accepted(), out: string[] = [];
    if (!file) return out;
    const scene = file.scene;
    if (scene && (file.models.length > 1 || scene.instanced || scene.animated)) {
      const left = [file.models.length > 1 ? 'scene placement' : '', scene.instanced ? 'instances' : '', scene.animated ? 'animation' : ''].filter(Boolean);
      out.push(`This file arranges its objects as a scene. Only the chosen object’s own blocks come in; ${listed(left)} stay behind.`);
    } else if (scene) out.push('This file also stores a scene layout. Only the object’s own blocks come in.');
    if (file.paletteSource === 'default') out.push('No palette was saved, so MagicaVoxel’s default colours are matched.');
    if (result?.summary.effects.length) out.push(`Its ${listed(result.summary.effects.map(e => EFFECT_NAMES[e]))} become plain kingdom materials; MagicaVoxel’s material effects stay behind.`);
    return out;
  });
  const relative = (axis: number) => (placed()?.[axis] ?? 0) - policy().editableFrom[axis]!;
  const grounded = () => placed()?.[1] === policy().editableFrom[1];

  return <section class="vox-import" classList={{ open: open(), placing: !!size() }} aria-label="Bring in a MagicaVoxel object">
    <Show when={open()} fallback={<button class="vox-import-tab" onClick={() => setOpen(true)} aria-expanded="false">
      <Carving /><span><b>Bring in a carving</b><small>MagicaVoxel .vox</small></span></button>}>
      <header class="vox-import-head">
        <Carving />
        <div><p>From your workbench</p><h3>Bring in a carving</h3></div>
        <button class="vox-import-close" onClick={putAway} aria-label="Put the carving away"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </header>
      <label class="vox-import-pick" classList={{ busy: reading() }}>
        <input ref={element => { input = element; }} type="file" accept=".vox" disabled={reading()} onChange={event => void choose(event.currentTarget.files?.[0])} data-vox-file />
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h6l2 2h8v10H4Z M12 17v-6m-3 3 3-3 3 3" /></svg>
        <span>{reading() ? 'Reading the file…' : chosen() ? 'Choose another .vox' : 'Choose a .vox file'}</span>
      </label>
      <Show when={error()}>{failure => <div class="vox-import-error" role="alert" data-vox-error={failure().code}><b>{failure().message}</b><span>{failure().remedy}</span><small>Your home has not changed.</small></div>}</Show>
      <Show when={chosen()}>{file => <>
        <p class="vox-import-file"><span>{file().name}</span><small>{count(Math.ceil(file().bytes / 1024))} KB · v{file().vox.version}</small></p>
        <Show when={file().vox.models.length > 1}>
          <fieldset class="vox-import-models"><legend>{file().vox.models.length} objects in this file · choose one</legend>
            <For each={file().vox.models}>{m => <label classList={{ selected: model() === m.index, empty: !m.count }}>
              <input type="radio" name="vox-model" checked={model() === m.index} disabled={!m.count} onChange={() => pick(m.index)} />
              <span>Object {m.index + 1}</span><small>{m.count ? `${m.size.join(' × ')} · ${count(m.count)} blocks` : 'empty'}</small>
            </label>}</For>
          </fieldset>
        </Show>
        <Show when={size()}><div class="vox-import-fit" data-vox-fit>
          <div class="vox-import-row">
            <span class="vox-import-label" id="vox-size">Size</span>
            <div class="vox-import-scales" role="group" aria-labelledby="vox-size">
              <For each={VOX_SCALES}>{s => <button type="button" aria-pressed={scale() === s} disabled={!fits(s)} data-vox-scale={s}
                title={fits(s) ? scaleName(s) : `${scaleName(s)} does not fit your plot`} onClick={() => resize(s)}>{SCALE_MARKS[s]}</button>}</For>
            </div>
            <button type="button" class="vox-import-ground" disabled={grounded()} onClick={() => move(1, policy().editableFrom[1])} data-vox-ground>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m-4-4 4 4 4-4M4 19h16" /></svg>Ground</button>
          </div>
          <div class="vox-import-axes">
            <For each={AXES}>{(axis, index) => <Stepper key={axis.key} word={axis.word} value={relative(index())}
              onSet={value => move(index(), value + policy().editableFrom[index()]!)} />}</For>
          </div>
        </div></Show>
        <Show when={rejected()}>{failure => <div class="vox-import-error" role="alert" data-vox-error={failure().code}><b>{failure().message}</b><span>{failure().remedy}</span></div>}</Show>
        <Show when={refused()}>{failure => <div class="vox-import-error placement" role="status" data-vox-error={failure().code}>
          <b>{failure().message}</b><span>{failure().remedy}</span></div>}</Show>
        <Show when={accepted()}>{ok => <div class="vox-import-summary" classList={{ settling: settling(), invalid: !!refused() }} data-vox-summary data-vox-placement={refused() ? 'outside' : 'inside'}>
          <dl>
            <div class="wide"><dt>Stands here</dt><dd>{ok().summary.size.join(' × ')}<small>{ok().summary.size.map(metres).join(' · ')}</small></dd></div>
            <div><dt>Blocks</dt><dd>{count(ok().summary.cells)}</dd></div>
            <div classList={{ short: (trial()?.after ?? 0) > policy().maxVoxels }}><dt>Left</dt><dd data-vox-remaining>{count(policy().maxVoxels - (trial()?.after ?? 0))}<small>of {count(policy().maxVoxels)}</small></dd></div>
          </dl>
          <p class="vox-import-replace" data-vox-replace>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12v12H4Z" stroke-dasharray="2.4 2" /><path d="m8 8 4-4h8v12l-4 4m0-12 4-4" /></svg>
            <span>Clears the whole {ok().summary.size.join(' × ')} space, air included{trial()?.existing ? <>; <b>{count(trial()!.existing)}</b> of your blocks there are replaced.</> : '; nothing of yours is there.'}</span>
          </p>
          <Show when={ok().summary.reduced}><p class="vox-import-note quiet">{scaleName(ok().summary.scale)} merges {1 / ok().summary.scale}×{1 / ok().summary.scale}×{1 / ok().summary.scale} source blocks into one; fine detail softens.</p></Show>
          <ul class="vox-import-swatches" aria-label="Kingdom materials it becomes"><For each={ok().summary.materials}>{m => <li title={`${m.name} · ${count(m.cells)} blocks`}>
            <span class="from"><For each={m.sources.slice(0, 3)}>{c => <i style={{ background: c }} />}</For></span>
            <span class="to" style={{ '--swatch': m.colour }} /><small>{materialName(m.name)}</small>
          </li>}</For></ul>
          <p class="vox-import-source">MagicaVoxel {ok().summary.sourceSize.join(' × ')} · stood upright {ok().summary.uprightSize.join(' × ')}</p>
        </div>}</Show>
        <For each={notices()}>{text => <p class="vox-import-note">{text}</p>}</For>
        <Show when={file().vox.models.length > 1 && model() === null}><p class="vox-import-note quiet">Choose an object to see it on your plot.</p></Show>
      </>}</Show>
      <p class="vox-import-foot">SIMULATED · private draft · stays in this browser</p>
    </Show>
  </section>;
}

/** One axis: hold − or + to keep moving, or type a whole number. */
function Stepper(props: { key: string; word: string; value: number; onSet(value: number): void }) {
  let timer: ReturnType<typeof setTimeout> | undefined, field: HTMLInputElement | undefined;
  const stop = () => { clearTimeout(timer); timer = undefined; };
  onCleanup(stop);
  const hold = (step: number) => (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault(); stop();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    props.onSet(props.value + step);
    let delay = 380;
    const tick = () => { props.onSet(props.value + step); delay = Math.max(45, delay * .78); timer = setTimeout(tick, delay); };
    timer = setTimeout(tick, delay);
  };
  const commit = () => { const n = Number.parseInt(field?.value ?? '', 10); if (Number.isFinite(n)) props.onSet(n); if (field) field.value = String(props.value); };
  const button = (step: number, label: string, path: string) => <button type="button" aria-label={`${label} ${props.key}`} onPointerDown={hold(step)}
    onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onClick={event => { if (event.detail === 0) props.onSet(props.value + step); }}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg></button>;
  return <div class="vox-import-axis" data-vox-axis={props.key}>
    <span class="vox-import-axis-name"><b>{props.key}</b>{props.word}</span>
    <div class="vox-import-step">
      {button(-1, 'Decrease', 'M6 12h12')}
      <input ref={element => { field = element; }} type="text" inputmode="numeric" aria-label={`${props.key} position, ${props.word}, in blocks`} value={props.value}
        onChange={commit} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); props.onSet(props.value + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 8 : 1)); }
        }} />
      {button(1, 'Increase', 'M6 12h12M12 6v12')}
    </div>
  </div>;
}

function Carving() {
  return <svg class="vox-import-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Zm0 0v9m8-4.5L12 12 4 7.5M12 12v9" /><path d="M8 9.8v3.6l2.4 1.4" /></svg>;
}
