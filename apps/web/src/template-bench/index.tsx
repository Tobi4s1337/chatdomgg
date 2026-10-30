import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { getEnvironment } from '@chatdom/render';
import { BuildDraft, BuildError } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';
import {
  BUILD_TEMPLATE_FORMS, BUILD_TEMPLATE_KIT_LABELS, BUILD_TEMPLATE_LABELS, BUILD_TEMPLATE_STYLES, BUILD_TEMPLATE_TIERS,
  BUILD_TEMPLATE_TIER_LABELS, TEMPLATE_REVIEW, createBuildTemplate, isBuildTemplateFinished, templateId,
} from '../../../../packages/content/src/templates';
import { createKingdomSound } from '../kingdom/sound';
import { pickBuildCell } from '../build/pick';
import { BENCH_ANGLES, FINISHED_CHOICES, allowance, readSelection, reviewEditCell, reviewPolicy, type BenchAngle, type BenchSelection, type TemplateChoice } from './selection';
import { createTemplateStage, type TemplateStage } from './stage';
import './style.css';

type Mode = 'preview' | 'draft';

export interface TemplateBenchReport {
  readonly asset: string;
  readonly style: string; readonly form: string; readonly tier: string;
  readonly angle: BenchAngle; readonly hour: number; readonly seed: string;
  /** Preview renders a prospective copy; draft renders the plot's own cells. */
  readonly mode: Mode;
  readonly plot: string;
  readonly boxes: number;
  /** Occupied source cells of what is shown, counted by the draft itself. */
  readonly occupied: number;
  readonly allowance: number; readonly remaining: number;
  readonly triangles: number; readonly chunks: number; readonly draws: number; readonly windows: number;
  readonly draft: {
    readonly revision: number; readonly voxelCount: number; readonly canUndo: boolean; readonly canRedo: boolean;
    readonly history: readonly string[]; readonly edited: Vec3 | null;
    /** The shape most recently begun on this plot. */
    readonly chosen: string | null;
  };
  readonly rejection: string | null;
}

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomTemplates?: TemplateBenchReport;
    __chatdomTemplatesError?: string;
  }
}

const HOURS = [{ hour: 19, name: 'Dusk' }, { hour: 12, name: 'Noon' }, { hour: 0, name: 'Night' }] as const;
const ANGLE_NAMES: Record<BenchAngle, string> = { front: 'Front', side: 'Side', back: 'Back', cutaway: 'Cutaway' };
const number = (n: number) => n.toLocaleString('en');

/** One local review plot per kit and tier. Its history mirrors the draft's own undo stack, step for step. */
interface Plot { readonly draft: BuildDraft; done: string[]; undone: string[]; edited: Vec3 | null; chosen: string | null }

export default function TemplateBench() {
  let host!: HTMLDivElement;
  let stage: TemplateStage | undefined;
  let disposed = false, sequence = 0;
  const sound = createKingdomSound();
  const plots = new Map<string, Plot>();
  let initial: BenchSelection | undefined, refused: string | undefined;
  try { initial = readSelection(window.location.search); } catch (error) { refused = error instanceof Error ? error.message : String(error); }

  const [choice, setChoice] = createSignal<TemplateChoice | undefined>(initial);
  const [angle, setAngle] = createSignal<BenchAngle>(initial?.angle ?? 'front');
  const [hour, setHour] = createSignal(initial?.hour ?? 19);
  const [mode, setMode] = createSignal<Mode>('preview');
  const [busy, setBusy] = createSignal(true);
  const [status, setStatus] = createSignal(refused ? '' : 'Laying out the plot…');
  const [failure, setFailure] = createSignal<string | undefined>(refused);
  const [rejection, setRejection] = createSignal<string | null>(null);
  const [report, setReport] = createSignal<TemplateBenchReport>();
  const seed = initial?.seed ?? 'chatdom-templates';
  const sky = createMemo(() => { const e = getEnvironment(hour()); return `linear-gradient(180deg, ${e.zenith} 0%, ${e.horizon} 74%, ${e.fog} 100%)`; });

  const plotKey = (c: TemplateChoice) => `${c.style}-${c.tier}`;
  const plot = (c: TemplateChoice): Plot => {
    const key = plotKey(c);
    let entry = plots.get(key);
    if (!entry) { entry = { draft: new BuildDraft(reviewPolicy(c.style, c.tier)), done: [], undone: [], edited: null, chosen: null }; plots.set(key, entry); }
    return entry;
  };

  const kits = BUILD_TEMPLATE_STYLES.filter(style => FINISHED_CHOICES.some(c => c.style === style));
  const forms = () => BUILD_TEMPLATE_FORMS.filter(form => FINISHED_CHOICES.some(c => c.style === choice()?.style && c.form === form));
  const tiers = () => BUILD_TEMPLATE_TIERS.filter(tier => FINISHED_CHOICES.some(c => c.style === choice()?.style && c.form === choice()?.form && c.tier === tier));

  function remember(): void {
    const c = choice();
    if (!c) return;
    const query = new URLSearchParams({ style: c.style, form: c.form, tier: c.tier, angle: angle(), hour: String(hour()), seed });
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
  }

  function fail(error: unknown): void {
    if (disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    window.__chatdomTemplatesError = message;
    setFailure(message); setBusy(false);
    console.error(message);
  }

  /** Meshes what the reviewer is looking at, finishes the frame and only then reports readiness. */
  async function refresh(): Promise<void> {
    const c = choice();
    if (!c || !stage || disposed) return;
    const token = ++sequence;
    window.__chatdomReady = false; setBusy(true); remember();
    const entry = plot(c), id = templateId(c.style, c.form, c.tier), review = TEMPLATE_REVIEW[id]!;
    const blueprint = createBuildTemplate(c.style, c.form, c.tier);
    // A prospective copy: the plot's own draft and history stay exactly as they are until “Begin here”.
    let prospective: BuildDraft | undefined = new BuildDraft(entry.draft.policy, entry.draft.serialize());
    try { prospective.insertBlueprint(blueprint, [0, 0, 0]); if (mode() === 'preview') setRejection(null); }
    catch (error) {
      if (!(error instanceof BuildError)) throw error;
      if (mode() === 'preview') setRejection(error.message);
      prospective = undefined;
    }
    const shown = mode() === 'preview' && prospective ? prospective : entry.draft;
    const compiled = shown.compile();
    stage.mark(mode() === 'draft' && entry.draft.voxelCount > 0 ? entry.edited : null);
    const meshed = await stage.show(compiled.asset, (prospective ?? shown).cloneVoxels(), review.threshold[1], angle());
    if (!meshed || token !== sequence || disposed) return;
    const draws = await stage.settle();
    if (token !== sequence || disposed) return;
    const draft = entry.draft, budget = allowance(c.tier);
    const next: TemplateBenchReport = {
      asset: id, style: c.style, form: c.form, tier: c.tier, angle: angle(), hour: hour(), seed, mode: mode(), plot: draft.policy.plotId,
      boxes: blueprint.boxes.length, occupied: shown.voxelCount, allowance: budget, remaining: budget - shown.voxelCount,
      triangles: meshed.triangles, chunks: meshed.chunks, draws, windows: compiled.windows.length,
      draft: { revision: draft.revision, voxelCount: draft.voxelCount, canUndo: draft.canUndo, canRedo: draft.canRedo, history: [...entry.done], edited: entry.edited, chosen: entry.chosen },
      rejection: rejection(),
    };
    setReport(next); window.__chatdomTemplates = next;
    host.dataset.asset = id; host.dataset.mode = next.mode; host.dataset.angle = next.angle; host.dataset.revision = String(draft.revision);
    setStatus(''); setBusy(false);
    window.__chatdomReady = true;
  }
  const run = () => { void refresh().catch(fail); };

  function select(next: Partial<TemplateChoice>): void {
    const c = choice();
    if (!c || busy()) return;
    let merged = { ...c, ...next };
    // Changing kit or shape keeps the nearest finished size rather than inventing one.
    if (!isBuildTemplateFinished(merged.style, merged.form, merged.tier)) {
      const fallback = FINISHED_CHOICES.find(f => f.style === merged.style && f.form === merged.form) ?? FINISHED_CHOICES.find(f => f.style === merged.style);
      if (!fallback) return;
      merged = { ...fallback };
    }
    sound.unlock(); sound.cue('light');
    setChoice(merged); setMode('preview'); setRejection(null); run();
  }

  function begin(): void {
    const c = choice();
    if (!c || busy()) return;
    const entry = plot(c);
    sound.unlock();
    try {
      entry.draft.insertBlueprint(createBuildTemplate(c.style, c.form, c.tier), [0, 0, 0]);
      entry.done.push(`Began with ${BUILD_TEMPLATE_LABELS[c.form].title.toLowerCase()}`); entry.undone = []; entry.edited = null;
      entry.chosen = templateId(c.style, c.form, c.tier);
      setRejection(null); setMode('draft'); sound.cue('wood');
    } catch (error) {
      if (!(error instanceof BuildError)) throw error;
      setRejection(error.message); sound.cue('wave');
    }
    run();
  }

  function carve(cell: Vec3, label: string): void {
    const c = choice();
    if (!c || busy()) return;
    const entry = plot(c);
    sound.unlock();
    try {
      entry.draft.apply({ kind: 'erase', from: [...cell], to: [cell[0] + 1, cell[1] + 1, cell[2] + 1] });
      entry.done.push(label); entry.undone = []; entry.edited = cell; sound.cue('wood');
    } catch (error) {
      if (!(error instanceof BuildError)) throw error;
      setRejection(error.message); sound.cue('wave');
    }
    setMode('draft'); run();
  }

  function carveBesideDoor(): void {
    const c = choice();
    if (!c) return;
    carve(reviewEditCell(plot(c).draft, c), 'Carved a wall block beside the door');
  }

  function history(step: 'undo' | 'redo'): void {
    const c = choice();
    if (!c || busy()) return;
    const entry = plot(c);
    if (step === 'undo' ? !entry.draft.canUndo : !entry.draft.canRedo) return;
    sound.unlock(); sound.cue('wood');
    if (step === 'undo') { entry.draft.undo(); entry.undone.push(entry.done.pop()!); }
    else { entry.draft.redo(); entry.done.push(entry.undone.pop()!); }
    setMode('draft'); run();
  }

  function onPointer(event: PointerEvent): void {
    const c = choice();
    if (!c || !stage || mode() !== 'draft' || busy() || angle() === 'cutaway') return;
    const entry = plot(c);
    const hit = pickBuildCell(stage.pick(event.clientX, event.clientY).ray, entry.draft, stage.modelMatrix);
    if (hit && !hit.floor) carve(hit.cell, 'Carved a block');
  }

  function onKey(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
    event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo');
  }

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomTemplates; delete window.__chatdomTemplatesError;
    if (refused) { window.__chatdomTemplatesError = refused; console.error(refused); return; }
    const c = choice()!;
    window.addEventListener('keydown', onKey);
    const resize = () => stage?.resize();
    window.addEventListener('resize', resize);
    onCleanup(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', resize); });
    void (async () => {
      const created = await createTemplateStage(host, plot(c).draft.policy, hour(), `${BUILD_TEMPLATE_LABELS[c.form].title}, ${BUILD_TEMPLATE_KIT_LABELS[c.style]}`);
      if (disposed) { created.dispose(); return; }
      stage = created;
      stage.renderer.domElement.addEventListener('pointerup', onPointer);
      setStatus('Carving the shape on the build lattice…');
      await refresh();
    })().catch(fail);
  });
  onCleanup(() => { disposed = true; sequence++; stage?.dispose(); window.__chatdomReady = false; });

  const view = (next: BenchAngle) => { if (busy() || next === angle()) return; setAngle(next); run(); };
  const light = (next: number) => {
    if (busy() || next === hour() || !stage) return;
    setHour(next); stage.setHour(next); run();
  };

  const label = () => { const c = choice(); return c ? BUILD_TEMPLATE_LABELS[c.form] : undefined; };
  /** The plot already holds this very shape and the reviewer is looking at it. */
  const begun = () => { const r = report(); return !!r && r.mode === 'draft' && r.draft.voxelCount > 0 && r.draft.chosen === r.asset; };
  const meter = () => { const r = report(); return r ? Math.min(100, r.occupied / r.allowance * 100) : 0; };

  return <section class="template-bench" style={{ background: sky() }} data-busy={busy() ? 'true' : 'false'}>
    <div ref={element => { host = element; }} class="template-stage">
      <Show when={!failure()}>
        <p class="template-stage-label"><b>LOCAL REVIEW</b> {mode() === 'preview' ? 'Preview · your draft is unchanged' : report()?.draft.voxelCount === 0 ? 'Your draft · an empty plot' : 'Your draft'} · {ANGLE_NAMES[angle()]}{angle() === 'cutaway' ? ' · roof and upper walls lifted for review' : ''}</p>
      </Show>
    </div>
    <aside class="template-panel" aria-label="Starting shapes">
      <p class="template-eyebrow">CHATDOM · WHERE TO BEGIN</p>
      <Show when={label()} fallback={<h1 class="template-title">A starting shape</h1>}>{l => <>
        <h1 class="template-title">{l().title}</h1>
        <p class="template-kit">{BUILD_TEMPLATE_KIT_LABELS[choice()!.style]} · {BUILD_TEMPLATE_TIER_LABELS[choice()!.tier]}</p>
        <p class="template-hint">{l().hint}</p>
      </>}</Show>

      <Show when={choice()}>
        <div class="template-choices">
          <div class="template-group" role="group" aria-label="Kit">
            <span>Kit</span>
            <For each={kits}>{style => <button type="button" aria-pressed={choice()?.style === style} disabled={busy()} onClick={() => select({ style })}>{BUILD_TEMPLATE_KIT_LABELS[style]}</button>}</For>
          </div>
          <div class="template-group" role="group" aria-label="Shape">
            <span>Shape</span>
            <For each={forms()}>{form => <button type="button" aria-pressed={choice()?.form === form} disabled={busy()} onClick={() => select({ form })}>{BUILD_TEMPLATE_LABELS[form].title}</button>}</For>
          </div>
          <div class="template-group" role="group" aria-label="Size">
            <span>Size</span>
            <For each={tiers()}>{tier => <button type="button" aria-pressed={choice()?.tier === tier} disabled={busy()} onClick={() => select({ tier })}>{BUILD_TEMPLATE_TIER_LABELS[tier]}</button>}</For>
          </div>
        </div>

        <Show when={report()}>{r => <div class="template-allowance">
          <div class="template-meter" role="meter" aria-valuemin={0} aria-valuemax={r().allowance} aria-valuenow={r().occupied} aria-label="Blocks used of this plot’s allowance"><i style={{ width: `${meter()}%` }} /></div>
          <p><strong>{number(r().occupied)}</strong> of {number(r().allowance)} blocks · <strong>{number(r().remaining)}</strong> left for your own additions</p>
        </div>}</Show>

        <div class="template-actions">
          <button type="button" class="template-begin" disabled={busy() || begun()} onClick={begin}>{begun() ? 'Begun · now make it yours' : (report()?.draft.voxelCount ?? 0) > 0 ? 'Begin with this shape instead' : 'Begin with this shape'}</button>
          <Show when={report()?.mode === 'preview' && (report()?.draft.canUndo ?? false)}>
            <button type="button" disabled={busy()} onClick={() => { setMode('draft'); run(); }}>Back to my draft</button>
          </Show>
        </div>

        <Show when={rejection()}>{message => <div class="template-rejection" role="alert"><strong>The plot refused this shape.</strong> {message()} Your draft is unchanged.</div>}</Show>

        <div class="template-edit" role="group" aria-label="Try an edit">
          <button type="button" disabled={busy() || report()?.mode !== 'draft' || !report()?.draft.voxelCount} onClick={carveBesideDoor}>Carve the block beside the door</button>
          <button type="button" disabled={busy() || !report()?.draft.canUndo} onClick={() => history('undo')} aria-keyshortcuts="Control+Z">Undo</button>
          <button type="button" disabled={busy() || !report()?.draft.canRedo} onClick={() => history('redo')} aria-keyshortcuts="Control+Shift+Z">Redo</button>
        </div>
        <p class="template-tip">{mode() === 'draft' ? 'Every block of this shape is yours to change. Tap a wall to carve a block; undo puts it back.' : 'Previewing never touches your draft. Begin here to make these blocks your own.'}</p>

        <Show when={report()}>{r => <ol class="template-ledger" aria-label="Draft history">
          <Show when={r().draft.history.length} fallback={<li class="template-ledger-empty">An empty plot. Nothing has been placed yet.</li>}>
            <For each={r().draft.history}>{step => <li>{step}</li>}</For>
          </Show>
        </ol>}</Show>

        <div class="template-views">
          <div class="template-group" role="group" aria-label="View">
            <For each={BENCH_ANGLES}>{a => <button type="button" aria-pressed={angle() === a} disabled={busy()} onClick={() => view(a)}>{ANGLE_NAMES[a]}</button>}</For>
          </div>
          <div class="template-group" role="group" aria-label="Light">
            <For each={HOURS}>{h => <button type="button" aria-pressed={hour() === h.hour} disabled={busy()} onClick={() => light(h.hour)}>{h.name}</button>}</For>
          </div>
        </div>

        <Show when={report()}>{r => <p class="template-facts">
          {r().asset} · {number(r().boxes)} boxes · {number(r().triangles)} triangles · {r().draws} draw · {r().windows} windows · draft revision {r().draft.revision}
        </p>}</Show>
      </Show>
      <p class="template-foot">A local content review. This plot lives only in this tab: nothing here is signed in, owned, saved or published.</p>
    </aside>
    <Show when={failure() || (busy() && status())}>
      <div class="template-status" role={failure() ? 'alert' : 'status'}>
        <strong>{failure() ? 'This starting shape cannot be shown' : 'At the building table'}</strong>
        <p>{failure() ?? status()}</p>
        <Show when={failure() && refused}><a href={window.location.pathname}>Show the first finished shape</a></Show>
      </div>
    </Show>
  </section>;
}
