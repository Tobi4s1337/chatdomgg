import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import '@chatdom/ui/kit.css';
import './builder.css';
import './look.css';
import type { CitizenLook, Hex } from '../../../../packages/content/src/avatar-style';
import type { BuilderSounds, SaveResult } from './AvatarBuilder';
import { mirrorGlyph } from './glyphs';
import { mirrorPicks } from './mirror-picks';
import { createThumbPainter } from './thumbs';
import type { PortraitView } from './portrait-renderer';
import { createTurntable, type Turntable } from './turntable';

/*
 * The mirror on your first walk (decision 22): before you take control, a carved mirror shows your own citizen and
 * offers three quick picks (hair, top, colour). "That's me" saves them as your real look on the realm; "Later" keeps
 * the look you arrived in. Mounted by play's arrival step, and by any intro that wants the same moment.
 */

export type MirrorOutcome = 'saved' | 'later' | 'skipped';

export interface MirrorProps {
  /** The person's approved name, on the plaque under the glass. */
  readonly name?: string | undefined;
  /** The look they arrive in (their starter). */
  readonly look: CitizenLook;
  /** Saves through the realm; the mirror shows exactly what it answers. */
  readonly save: (look: CitizenLook) => Promise<SaveResult>;
  readonly onDone: (outcome: MirrorOutcome, saved?: { readonly look: CitizenLook; readonly token: string | undefined }) => void;
  readonly sounds?: BuilderSounds | undefined;
  readonly still?: boolean | undefined;
}

export function MirrorMoment(props: MirrorProps): JSX.Element {
  const [look, setLook] = createSignal<CitizenLook>(props.look);
  const [state, setState] = createSignal<{ kind: 'choosing' | 'saving' | 'saved' } | { kind: 'refused'; reason: string }>({ kind: 'choosing' });
  const picks = mirrorPicks(props.look);
  const painter = createThumbPainter();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = !!props.still || reduced;
  let canvas: HTMLCanvasElement | undefined;
  let turntable: Turntable | null = null;
  let root: HTMLDivElement | undefined;
  const sound = (ui: 'wood' | 'brass' | 'parchment') => props.sounds?.cue('wood', { ui });
  const busy = () => state().kind === 'saving' || state().kind === 'saved';

  onMount(() => {
    if (canvas) {
      turntable = createTurntable(canvas, { still, spin: false, yaw: -.22 });
      createEffect(() => turntable!.setLook(look()));
    }
    queueMicrotask(() => root?.querySelector<HTMLButtonElement>('.lk-mirror-yes')?.focus({ preventScroll: true }));
    if (!still) sound('wood');
  });
  onCleanup(() => { turntable?.dispose(); painter.dispose(); });

  const Pick = (p: { id: string; preview: CitizenLook; label: string; chosen: boolean; onPick: () => void; view?: PortraitView }) => {
    const [url, setUrl] = createSignal<string | null>(null);
    createEffect(() => {
      const controller = new AbortController();
      painter.paint({ look: p.preview, view: p.view ?? 'bust', size: 96 }, controller.signal).then(setUrl, () => undefined);
      onCleanup(() => controller.abort());
    });
    return <button type="button" class="lk-pick" role="radio" aria-checked={p.chosen} aria-label={p.label} classList={{ 'lk-chosen': p.chosen }}
      disabled={busy()} onClick={p.onPick}>
      <span class="ab-thumb" classList={{ 'ab-thumb-waiting': !url() }}><Show when={url()}>{u => <img src={u()} alt="" draggable={false} />}</Show></span>
      <span class="lk-pick-name">{p.label}</span>
    </button>;
  };

  const thatsMe = async () => {
    if (busy()) return;
    setState({ kind: 'saving' });
    sound('wood');
    let result: SaveResult;
    try { result = await props.save(look()); } catch (error) {
      setState({ kind: 'refused', reason: error instanceof Error && error.message ? error.message : 'Your look could not be saved. Try again in a moment.' });
      sound('parchment');
      return;
    }
    if (!result.ok) { setState({ kind: 'refused', reason: result.reason }); sound('parchment'); return; }
    const saved = result.look, token = result.token;
    setLook(saved);
    setState({ kind: 'saved' });
    sound('brass');
    setTimeout(() => props.onDone('saved', { look: saved, token }), still ? 0 : 900);
  };
  const later = () => { if (state().kind === 'saving') return; sound('parchment'); props.onDone('later'); };
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || state().kind === 'saving') return;
    e.preventDefault(); e.stopPropagation();
    sound('parchment');
    props.onDone('skipped');
  };

  const status = () => {
    const s = state();
    return s.kind === 'saving' ? 'Saving your look…' : s.kind === 'saved' ? 'Saved. Step out and be seen.' : s.kind === 'refused' ? s.reason : null;
  };

  return <div ref={el => { root = el; }} class="lk-mirror-scene cd-kit" classList={{ 'ab-still': still }} role="dialog" aria-modal="true" aria-labelledby="lk-mirror-title" onKeyDown={keys}>
    <div class="lk-mirror-dusk" aria-hidden="true" />
    <div class="lk-mirror">
      <figure class="lk-glass-frame">
        <span class="lk-glass-crest" aria-hidden="true">{mirrorGlyph()}</span>
        <span class="lk-glass">
          <canvas ref={el => { canvas = el; }} class="lk-glass-canvas" aria-label="You, in the mirror" />
          <span class="lk-glass-sheen" aria-hidden="true" />
        </span>
        <Show when={props.name}>{name => <figcaption class="lk-glass-plate"><span>{name()}</span></figcaption>}</Show>
      </figure>
      <section class="lk-mirror-card">
        <p class="lk-mirror-eyebrow">Before you step out</p>
        <h2 class="lk-mirror-title" id="lk-mirror-title">Is this you?</h2>
        <p class="lk-mirror-lead">Three quick choices. Everything else waits in your wardrobe, in the ledger.</p>
        <div class="lk-mirror-row">
          <h3 class="lk-mirror-label">Hair</h3>
          <div class="lk-picks" role="radiogroup" aria-label="Hair">
            <For each={picks.hairs}>{option => <Pick id={`hair:${option.id}`} preview={option.apply(look())} label={option.label} chosen={option.selected(look())}
              onPick={() => { setLook(option.apply(look())); setState({ kind: 'choosing' }); sound('brass'); }} />}</For>
          </div>
        </div>
        <div class="lk-mirror-row">
          <h3 class="lk-mirror-label">Top</h3>
          <div class="lk-picks" role="radiogroup" aria-label="Top">
            <For each={picks.tops}>{option => <Pick id={`top:${option.id}`} view="chest" preview={option.apply(look())} label={option.label} chosen={option.selected(look())}
              onPick={() => { setLook(option.apply(look())); setState({ kind: 'choosing' }); sound('brass'); }} />}</For>
          </div>
        </div>
        <div class="lk-mirror-row">
          <h3 class="lk-mirror-label">Colour</h3>
          <div class="ab-swatch-group lk-colours" role="radiogroup" aria-label="Colour of your top">
            <For each={picks.colours}>{s => <button type="button" class="ab-swatch" role="radio" aria-checked={picks.colour.get(look()) === s.hex}
              classList={{ 'ab-chosen': picks.colour.get(look()) === s.hex }} style={{ '--ab-swatch': s.hex }} aria-label={s.label} title={s.label} disabled={busy()}
              onClick={() => { setLook(picks.colour.set(look(), s.hex as Hex)); setState({ kind: 'choosing' }); sound('brass'); }} />}</For>
          </div>
        </div>
        <p class="lk-mirror-status" role="status" aria-live="polite" data-state={state().kind}>{status()}</p>
        <div class="lk-mirror-actions">
          <button type="button" class="ab-save lk-mirror-yes" disabled={busy()} onClick={() => void thatsMe()}>
            {state().kind === 'refused' ? 'Try again' : state().kind === 'saving' ? 'Saving' : "That's me"}
          </button>
          <button type="button" class="ab-tool lk-mirror-later" disabled={state().kind === 'saving'} onClick={later}>Later</button>
        </div>
        <p class="lk-mirror-small">Later keeps the look you arrived in; this mirror will not ask again on this device.</p>
      </section>
    </div>
  </div>;
}
