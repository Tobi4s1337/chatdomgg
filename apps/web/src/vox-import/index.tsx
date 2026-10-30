import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { MATERIALS } from '@chatdom/content';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { parseVox, prepareVoxImport, VOX_IMPORT_LIMITS, type VoxFile, type VoxImportError, type VoxImportMaterial, type VoxMaterialEffect } from '@chatdom/vox-import';
import type { BuildImportBridge } from '../build/session';
import './vox-import.css';

interface Chosen { readonly name: string; readonly bytes: number; readonly vox: VoxFile }

const EFFECT_NAMES: Record<VoxMaterialEffect, string> = { metal: 'metal', glass: 'glass', emit: 'glow', blend: 'blend', media: 'cloud', cloud: 'cloud', translucent: 'see-through colour' };
const metres = (cells: number) => `${(cells * VOXEL_METRES.build).toLocaleString('en', { maximumFractionDigits: 1 })} m`;
const count = (n: number) => n.toLocaleString('en');
/** A local filename is only ever escaped display text: no control characters, bounded length. */
const displayName = (name: string) => { const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() || 'Unnamed file'; return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean; };
const materialName = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const listed = (words: string[]) => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** Bring one MagicaVoxel object into this private draft. Owns file, object and transform choice; never editor truth. */
export default function VoxImport(props: BuildImportBridge) {
  const [open, setOpen] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [chosen, setChosen] = createSignal<Chosen | null>(null);
  const [model, setModel] = createSignal<number | null>(null);
  const [error, setError] = createSignal<VoxImportError | null>(null);
  let input: HTMLInputElement | undefined, readToken = 0, previewing = false;

  const materials = (): VoxImportMaterial[] => props.draft.policy.palette.flatMap(id => {
    const m = MATERIALS.materials.find(m => m.id === id);
    return m && id !== 0 ? [{ id, name: m.name, colour: m.colour }] : [];
  });
  const origin = (size: Vec3): Vec3 => {
    const { editableFrom: from, editableTo: to } = props.draft.policy;
    return [Math.floor((from[0] + to[0] - size[0]) / 2), from[1], Math.max(from[2], to[2] - size[2])];
  };
  const prepared = createMemo(() => {
    const file = chosen(), index = model();
    if (!file || index === null) return null;
    const { policy } = props.draft, first = prepareVoxImport({ file: file.vox, model: index, materials: materials(), styleId: policy.styleId, scale: 1, origin: [0, 0, 0], destination: { size: policy.size, maxVoxels: policy.maxVoxels } });
    if (!first.ok) return first;
    return { ...first, origin: origin(first.blueprint.size) };
  });

  const accepted = () => { const result = prepared(); return result?.ok ? result : null; };
  const rejected = () => { const result = prepared(); return result && !result.ok ? result.error : null; };

  function clearPreview() { if (previewing) { previewing = false; props.onPreview(null, [0, 0, 0]); } }
  createEffect(() => {
    const result = prepared();
    if (result?.ok) { previewing = true; props.onPreview(result.blueprint, result.origin); } else clearPreview();
  });
  onCleanup(() => { readToken++; clearPreview(); });

  async function choose(file: File | undefined) {
    const token = ++readToken;
    setChosen(null); setModel(null); setError(null);
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
      if (filled.length === 1) setModel(filled[0]!.index);
    } catch {
      if (token === readToken) setError({ code: 'not-vox', message: 'This file could not be read from your device.', remedy: 'Choose it again, or save a fresh copy from MagicaVoxel.' });
    } finally { if (token === readToken) setReading(false); }
  }
  function putAway() { readToken++; setReading(false); setChosen(null); setModel(null); setError(null); setOpen(false); }

  const notices = createMemo(() => {
    const file = chosen()?.vox, result = prepared(), out: string[] = [];
    if (!file) return out;
    const scene = file.scene;
    if (scene && (file.models.length > 1 || scene.instanced || scene.animated)) {
      const left = [file.models.length > 1 ? 'scene placement' : '', scene.instanced ? 'instances' : '', scene.animated ? 'animation' : ''].filter(Boolean);
      out.push(`This file arranges its objects as a scene. Only the chosen object’s own blocks come in; ${listed(left)} stay behind.`);
    } else if (scene) out.push('This file also stores a scene layout. Only the object’s own blocks come in.');
    if (file.paletteSource === 'default') out.push('No palette was saved, so MagicaVoxel’s default colours are matched.');
    if (result?.ok && result.summary.effects.length) out.push(`Its ${listed(result.summary.effects.map(e => EFFECT_NAMES[e]))} become plain kingdom materials; MagicaVoxel’s material effects stay behind.`);
    return out;
  });

  return <section class="vox-import" classList={{ open: open() }} aria-label="Bring in a MagicaVoxel object">
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
              <input type="radio" name="vox-model" checked={model() === m.index} disabled={!m.count} onChange={() => setModel(m.index)} />
              <span>Object {m.index + 1}</span><small>{m.count ? `${m.size.join(' × ')} · ${count(m.count)} blocks` : 'empty'}</small>
            </label>}</For>
          </fieldset>
        </Show>
        <For each={notices()}>{text => <p class="vox-import-note">{text}</p>}</For>
        <Show when={rejected()}>{failure => <div class="vox-import-error" role="alert" data-vox-error={failure().code}><b>{failure().message}</b><span>{failure().remedy}</span></div>}</Show>
        <Show when={accepted()}>{ok => <div class="vox-import-summary" data-vox-summary>
          <dl>
            <div><dt>MagicaVoxel</dt><dd>{ok().summary.sourceSize.join(' × ')}</dd></div>
            <div><dt>Stands here</dt><dd>{ok().summary.size.join(' × ')}<small>{ok().summary.size.map(metres).join(' · ')}</small></dd></div>
            <div><dt>Blocks</dt><dd>{count(ok().summary.cells)}</dd></div>
          </dl>
          <ul class="vox-import-swatches" aria-label="Kingdom materials it becomes"><For each={ok().summary.materials}>{m => <li title={`${m.name} · ${count(m.cells)} blocks`}>
            <span class="from"><For each={m.sources.slice(0, 3)}>{c => <i style={{ background: c }} />}</For></span>
            <span class="to" style={{ '--swatch': m.colour }} /><small>{materialName(m.name)}</small>
          </li>}</For></ul>
        </div>}</Show>
        <Show when={file().vox.models.length > 1 && model() === null}><p class="vox-import-note quiet">Choose an object to see it on your plot.</p></Show>
      </>}</Show>
      <p class="vox-import-foot">SIMULATED · private draft · nothing leaves this browser</p>
    </Show>
  </section>;
}

function Carving() {
  return <svg class="vox-import-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Zm0 0v9m8-4.5L12 12 4 7.5M12 12v9" /><path d="M8 9.8v3.6l2.4 1.4" /></svg>;
}
