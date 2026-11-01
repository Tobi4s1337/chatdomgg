import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { ProvenanceSeal } from '@chatdom/ui';
import '@chatdom/ui/kit.css';
import './builder.css';
import {
  checkEarned, earnedOffers, isWorn, randomLook, subLapsed, takeOffPiece, wearPiece,
  type CitizenEntitlements, type CitizenLook, type EarnedOffer, type Hex,
} from '../../../../packages/content/src/avatar-style';
import { TABS, type Control, type TabId, type TileOption } from './catalogue';
import { commit, createSaveGuard, isUnchanged, reconcileSave, redo, startHistory, undo, type LookHistory } from './draft';
import { createThumbPainter, type ThumbPainter, type ThumbRequest } from './thumbs';
import { createTurntable, type Turntable } from './turntable';

/*
 * The avatar builder (spec 49 B1–B4), one component for the web page and the Twitch panel. Everything it offers
 * comes from the same catalogue and the same recipe, so both make the same character. A draft is never a saved
 * look: only the look authority main supplies saves, and it checks earned pieces against verified records.
 */

export type SaveResult = { readonly ok: true; readonly look: CitizenLook } | { readonly ok: false; readonly reason: string };

/** The person's look authority: keep this reference stable for the session and replace it when the person changes. */
export interface LookAuthority {
  readonly origin: 'live' | 'simulated';
  save(look: CitizenLook): Promise<SaveResult>;
}

/** The sounds the builder makes: the kingdom audio's control cue (wood, brass, parchment). */
export interface BuilderSounds { cue(kind: 'wood', options: { ui: 'wood' | 'brass' | 'parchment' }): boolean }

export interface AvatarBuilderProps {
  readonly layout: 'page' | 'panel';
  /** The person's display name. */
  readonly name: string;
  /** Their saved look; for someone who never saved, their Twitch default. */
  readonly saved: CitizenLook;
  /** Their Twitch default (`twitchDefaultLook`), to start again from. */
  readonly defaultLook: CitizenLook;
  /** Verified records in this kingdom; what can be worn, and how the rest is earned. */
  readonly entitlements: CitizenEntitlements;
  readonly authority: LookAuthority;
  /** Looks already in the town, so the dice never roll a near-twin. */
  readonly town?: readonly CitizenLook[] | undefined;
  readonly sounds?: BuilderSounds | undefined;
  /** No idle motion: captures and reduced motion. */
  readonly still?: boolean | undefined;
  /** Opens on this tab. */
  readonly tab?: TabId | undefined;
  readonly onSaved?: ((look: CitizenLook) => void) | undefined;
}

type Status = { readonly kind: 'idle' | 'saving' | 'saved' | 'error'; readonly message?: string };

/** Radio groups use one tab stop; arrow keys move focus and select the next choice. */
function radioKeys(e: KeyboardEvent & { currentTarget: HTMLDivElement }): void {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step || !(e.target instanceof HTMLButtonElement)) return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
  const index = buttons.indexOf(e.target);
  if (index < 0 || !buttons.length) return;
  e.preventDefault();
  const next = buttons[(index + step + buttons.length) % buttons.length]!;
  next.focus();
  next.click();
}

/** A tile: a small render of the option on your own citizen. */
function Thumb(props: { painter: ThumbPainter; request: ThumbRequest; alt: string; locked?: boolean }): JSX.Element {
  const [url, setUrl] = createSignal<string | null>(null);
  createEffect(() => {
    const request = props.request, controller = new AbortController();
    props.painter.paint(request, controller.signal).then(setUrl, () => undefined);
    onCleanup(() => controller.abort());
  });
  return <span class="ab-thumb" classList={{ 'ab-thumb-locked': !!props.locked, 'ab-thumb-waiting': !url() }}>
    <Show when={url()}>{u => <img src={u()} alt={props.alt} draggable={false} />}</Show>
  </span>;
}

export function AvatarBuilder(props: AvatarBuilderProps): JSX.Element {
  const panel = () => props.layout === 'panel';
  const [history, setHistory] = createSignal<LookHistory>(startHistory(props.saved));
  const [saved, setSaved] = createSignal<CitizenLook>(props.saved);
  const [active, setActive] = createSignal<TabId>(props.tab ?? 'hair');
  const [status, setStatus] = createSignal<Status>({ kind: 'idle' });
  const [pending, setPending] = createSignal<symbol | null>(null);
  const [uncertain, setUncertain] = createSignal(false);
  const [portrait, setPortrait] = createSignal<string | null>(null);
  const look = () => history().present;
  const dim = () => subLapsed(props.entitlements);
  const offers = createMemo(() => earnedOffers(props.entitlements));
  const unearned = createMemo(() => checkEarned(look(), props.entitlements));
  const changed = () => !isUnchanged(look(), saved());
  const painter = createThumbPainter();
  const saveGuard = createSaveGuard();
  const tileSize = () => (panel() ? 96 : 128);
  let canvas: HTMLCanvasElement | undefined;
  let turntable: Turntable | null = null;
  const still = props.still || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const sound = (ui: 'wood' | 'brass' | 'parchment') => props.sounds?.cue('wood', { ui });
  const edit = (next: CitizenLook, mergeKey: string | null = null) => {
    setHistory(h => commit(h, next, mergeKey));
    if (status().kind !== 'saving') setStatus({ kind: 'idle' });
  };
  const doUndo = () => { setHistory(undo); sound('wood'); };
  const doRedo = () => { setHistory(redo); sound('wood'); };
  const roll = () => { edit(randomLook(Math.random, look(), props.town ?? [])); sound('brass'); };
  const restart = () => { edit(props.defaultLook); sound('wood'); };

  // A refreshed saved look becomes the new baseline. Preserve any local draft.
  createEffect(on(() => props.saved, next => {
    if (isUnchanged(next, saved())) return;
    saveGuard.invalidate();
    setHistory(h => isUnchanged(h.present, saved()) ? startHistory(next) : h);
    setSaved(next);
    setStatus({ kind: 'idle' });
  }, { defer: true }));
  createEffect(on(() => props.authority, () => {
    saveGuard.invalidate();
    setSaved(props.saved);
    setHistory(startHistory(props.saved));
    setPending(null);
    setUncertain(false);
    setStatus({ kind: 'idle' });
  }, { defer: true }));

  const save = async () => {
    if (unearned().length || pending()) return;
    const submitted = look();
    const ticket = saveGuard.ticket();
    const authority = props.authority;
    const request = Symbol('save');
    setPending(request);
    setStatus({ kind: 'saving' });
    sound('wood');
    let result: SaveResult;
    try {
      result = await authority.save(submitted);
    } catch (error) {
      if (!saveGuard.alive()) return;
      setPending(current => current === request ? null : current);
      if (!saveGuard.current(ticket)) return;
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'The look could not be saved.' });
      return;
    }
    if (!saveGuard.alive()) return;
    setPending(current => current === request ? null : current);
    if (!saveGuard.current(ticket)) {
      if (props.authority === authority) setUncertain(true);
      return;
    }
    if (!result.ok) { setStatus({ kind: 'error', message: result.reason }); return; }
    setSaved(result.look);
    setUncertain(false);
    // The authority can return a canonical look. Do not overwrite edits made while saving.
    setHistory(h => reconcileSave(h, submitted, result.look));
    setStatus({ kind: 'saved' });
    props.onSaved?.(result.look);
  };

  onMount(() => {
    if (!canvas) return;
    turntable = createTurntable(canvas, { still });
    createEffect(() => turntable!.setLook(look(), dim()));
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement | null)?.closest('input')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); doRedo(); }
      else if (key === 's') { e.preventDefault(); void save(); }
    };
    addEventListener('keydown', keys);
    onCleanup(() => removeEventListener('keydown', keys));
  });
  onCleanup(() => { saveGuard.dispose(); turntable?.dispose(); painter.dispose(); });

  // The portrait, as the card and passport will show it, repainted shortly after the look settles.
  createEffect(() => {
    const current = look(), lapsed = dim();
    const controller = new AbortController();
    const timer = setTimeout(() => painter.paint({ look: current, view: 'bust', size: panel() ? 128 : 256, dim: lapsed, backdrop: true }, controller.signal).then(setPortrait, () => undefined), 120);
    onCleanup(() => { clearTimeout(timer); controller.abort(); });
  });

  const tab = () => TABS.find(t => t.id === active())!;

  const Tiles = (p: { control: Extract<Control, { kind: 'tiles' }> }) => (
    <div class="ab-tiles" role="radiogroup" aria-label={p.control.label} onKeyDown={radioKeys}>
      <For each={p.control.options}>{(option: TileOption, index) => {
        const chosen = () => option.selected(look());
        return <button type="button" class="ab-tile" role="radio" aria-checked={chosen()} classList={{ 'ab-chosen': chosen() }}
          tabIndex={chosen() || (index() === 0 && !p.control.options.some(o => o.selected(look()))) ? 0 : -1}
          onClick={() => { edit(option.apply(look())); sound('brass'); }}>
          <Thumb painter={painter} alt="" request={{ look: option.apply(look()), view: p.control.view, size: tileSize(), dim: dim() }} />
          <span class="ab-tile-name">{option.label}</span>
        </button>;
      }}</For>
    </div>
  );

  const Swatches = (p: { control: Extract<Control, { kind: 'swatches' }> }) => {
    const current = () => p.control.get(look());
    const known = () => p.control.groups.some(g => g.swatches.some(s => s.hex === current()));
    return <div class="ab-swatches">
      <For each={p.control.groups}>{group => <div class="ab-swatch-group" role="radiogroup" aria-label={`${p.control.label}: ${group.label}`} onKeyDown={radioKeys}>
        <For each={group.swatches}>{(s, index) => <button type="button" class="ab-swatch" role="radio" aria-checked={current() === s.hex} classList={{ 'ab-chosen': current() === s.hex }}
          tabIndex={current() === s.hex || (index() === 0 && !group.swatches.some(option => option.hex === current())) ? 0 : -1}
          style={{ '--ab-swatch': s.hex }} title={s.label} aria-label={s.label} onClick={() => { edit(p.control.set(look(), s.hex)); sound('brass'); }} />}</For>
      </div>}</For>
      <label class="ab-any" classList={{ 'ab-chosen': !known() }} title="Any colour">
        <input type="color" value={current()} aria-label={`${p.control.label}: any colour`}
          onInput={e => edit(p.control.set(look(), e.currentTarget.value.toLowerCase() as Hex), `${p.control.id}:wheel`)} />
        <span class="ab-any-ring" style={{ '--ab-swatch': current() }} />
        <span class="ab-any-word">Any</span>
      </label>
    </div>;
  };

  const groupOf = (o: EarnedOffer) => (o.piece.family === 'ribbons' || o.piece.family === 'hood' ? 'Tenure'
    : o.piece.family === 'pin' ? 'Pins'
      : o.piece.family === 'cape' && o.piece.value.kind !== 'cheer' ? 'Sub pieces' : 'Moments and the Forge');
  const EARNED_GROUPS = ['Tenure', 'Pins', 'Moments and the Forge', 'Sub pieces'] as const;
  const GROUP_NOTES: Record<typeof EARNED_GROUPS[number], string> = {
    Tenure: 'From showing up. Bound to this kingdom.',
    Pins: 'Two at a time. Keepsakes travel with you.',
    'Moments and the Forge': 'Everyone who was there gets the same piece.',
    'Sub pieces': 'Shown on Twitch. They dim when a sub lapses, never vanish.',
  };

  const Earned = () => (
    <div class="ab-earned">
      <For each={EARNED_GROUPS}>{group => {
        const items = () => offers().filter(o => groupOf(o) === group);
        return <section class="ab-earned-group" aria-label={group}>
          <header class="ab-control-head"><h3 class="cd-label">{group}</h3><p class="ab-note">{GROUP_NOTES[group]}</p></header>
          <ul class="ab-earned-list">
            <For each={items()}>{offer => {
              const worn = () => isWorn(look(), offer);
              const preview = () => (offer.unlocked && worn() ? look() : wearPiece(look(), offer.piece));
              const family = offer.piece.family;
              const view = family === 'cape' ? 'back' as const : family === 'hood' ? 'nape' as const : family === 'forgedHat' ? 'bust' as const : 'chest' as const;
              return <li class="ab-earned-item" classList={{ 'ab-locked': !offer.unlocked, 'ab-chosen': offer.unlocked && worn() }}>
                <button type="button" class="ab-earned-button" disabled={!offer.unlocked} aria-pressed={offer.unlocked ? worn() : undefined}
                  aria-label={offer.unlocked ? `${worn() ? 'Take off' : 'Wear'} ${offer.name}` : `${offer.name}, not earned yet`}
                  onClick={() => { edit(worn() ? takeOffPiece(look(), offer.piece) : wearPiece(look(), offer.piece)); sound('brass'); }}>
                  <Thumb painter={painter} alt="" locked={!offer.unlocked} request={{ look: preview(), view, size: tileSize(), dim: offer.dim }} />
                  <Show when={!offer.unlocked}><svg class="ab-lock" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 9V7a4 4 0 0 1 8 0v2" /><rect x="4.5" y="9" width="11" height="8" rx="1.5" /></svg></Show>
                  <Show when={offer.unlocked && worn()}><span class="ab-worn cd-label">Worn</span></Show>
                </button>
                <div class="ab-earned-words">
                  <strong class="ab-earned-name">{offer.name}</strong>
                  <Show when={offer.unlocked} fallback={<span class="ab-earned-how">{offer.earnedBy}</span>}>
                    <span class="ab-earned-story">{offer.story}{offer.dim ? ' · dimmed' : ''}</span>
                  </Show>
                  <Show when={!offer.unlocked && offer.progress}>{p => <span class="ab-progress" role="img" aria-label={`${p().have} of ${p().need} ${p().unit}`}>
                    <span class="ab-progress-bar"><span style={{ width: `${Math.min(100, p().have / p().need * 100)}%` }} /></span>
                    <span class="ab-progress-words">{p().have} of {p().need} {p().unit}</span>
                  </span>}</Show>
                </div>
              </li>;
            }}</For>
          </ul>
        </section>;
      }}</For>
    </div>
  );

  const statusWords = () => {
    const s = status();
    if (pending()) return 'Saving…';
    if (s.kind === 'error') return s.message ?? 'Not saved.';
    if (uncertain()) return 'The saved look changed while saving. Save again or reopen the wardrobe.';
    if (unearned().length) return 'Something worn is not earned yet.';
    if (s.kind === 'saved' && !changed()) return props.authority.origin === 'simulated' ? 'Saved in this preview.' : 'Saved. This is you everywhere.';
    return changed() ? 'Unsaved changes' : 'This is your saved look';
  };

  return (
    <div class="ab cd-kit" classList={{ 'ab-panel': panel(), 'ab-page': !panel() }} data-layout={props.layout}>
      <header class="ab-head cd-plate">
        <div class="ab-title">
          <h1>{panel() ? 'Your citizen' : 'Make your citizen'}</h1>
          <p class="ab-who">{props.name}</p>
        </div>
        <Show when={props.authority.origin === 'simulated' || props.entitlements.origin === 'simulated'}>
          <ProvenanceSeal state="simulated" class="ab-seal" {...(panel() ? {} : { detail: 'A preview citizen. Changes stay in this browser.' })} />
        </Show>
      </header>

      <section class="ab-stage" aria-label="Your citizen, turning">
        <canvas ref={el => { canvas = el; }} class="ab-turntable" tabindex="0" aria-label="Your citizen. Drag, or use the arrow keys, to turn them."
          onKeyDown={e => { if (e.key === 'ArrowLeft') turntable?.nudge(-.3); if (e.key === 'ArrowRight') turntable?.nudge(.3); }} />
        <figure class="ab-portrait">
          <span class="ab-portrait-frame"><Show when={portrait()}>{u => <img src={u()} alt={`${props.name}'s portrait`} />}</Show></span>
          <figcaption class="cd-label">Portrait</figcaption>
        </figure>
        <p class="ab-hint">Drag to turn</p>
      </section>

      <nav class="ab-tabs" aria-label="Parts">
        <For each={TABS}>{t => <button type="button" class="ab-tab cd-label" aria-current={active() === t.id ? 'page' : undefined}
          classList={{ 'ab-tab-earned': t.id === 'earned' }}
          ref={el => createEffect(() => { if (active() === t.id) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); })}
          onClick={() => { setActive(t.id); sound('parchment'); }}>{t.label}</button>}</For>
      </nav>

      <section class="ab-sheet cd-slip" aria-label={tab().label}>
        <Show when={active() !== 'earned'} fallback={<Earned />}>
          <For each={tab().controls}>{control => <Show when={!control.visible || control.visible(look())}>
            <div class="ab-control">
              <header class="ab-control-head"><h3 class="cd-label">{control.label}</h3></header>
              {control.kind === 'tiles' ? <Tiles control={control} /> : <Swatches control={control} />}
            </div>
          </Show>}</For>
        </Show>
      </section>

      <footer class="ab-foot cd-plate">
        <div class="ab-tools">
          <button type="button" class="ab-tool" onClick={doUndo} disabled={!history().past.length} aria-label="Undo" title="Undo (Ctrl+Z)">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 5 3.5 9l4 4M4 9h7.5a5 5 0 0 1 0 10H9" /></svg>
          </button>
          <button type="button" class="ab-tool" onClick={doRedo} disabled={!history().future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 5 4 4-4 4M16 9H8.5a5 5 0 0 0 0 10H11" /></svg>
          </button>
          <button type="button" class="ab-tool ab-dice" onClick={roll} aria-label="Roll a new look" title="Roll a new look, keeping what you earned">
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2.5" /><circle cx="7" cy="7" r=".9" /><circle cx="13" cy="13" r=".9" /><circle cx="10" cy="10" r=".9" /><circle cx="13" cy="7" r=".9" /><circle cx="7" cy="13" r=".9" /></svg>
            <Show when={!panel()}><span>Roll</span></Show>
          </button>
          <Show when={!panel()}>
            <button type="button" class="ab-tool" onClick={restart} title="Start again from the look Twitch gave you" aria-label="Start again from my default">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1M4.2 3.6v3h3" /></svg>
              <span>From my default</span>
            </button>
          </Show>
        </div>
        <p class="ab-status" role="status" aria-live="polite" data-status={status().kind} classList={{ 'ab-warn': !!unearned().length || uncertain() || status().kind === 'error' }}>{statusWords()}</p>
        <button type="button" class="ab-save" onClick={() => void save()} disabled={(!changed() && !uncertain()) || !!unearned().length || !!pending()}>
          <Show when={!pending()} fallback={<span>Saving</span>}>
            <span class="ab-save-long">{panel() ? 'Save' : 'Save my look'}</span><span class="ab-save-short">Save</span>
          </Show>
        </button>
      </footer>
    </div>
  );
}
