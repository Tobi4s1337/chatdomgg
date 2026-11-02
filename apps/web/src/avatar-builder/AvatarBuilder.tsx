import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type JSX } from 'solid-js';
import '@chatdom/ui/kit.css';
import './builder.css';
import type { RealmWardrobeGrant } from '@chatdom/shared';
import {
  checkEarned, earnedOffers, isWorn, randomLook, subLapsed, takeOffPiece, wearPiece,
  type CitizenEntitlements, type CitizenLook, type EarnedOffer, type Hex,
} from '../../../../packages/content/src/avatar-style';
import { TABS, chosenOption, type Control, type Tab, type TabId, type TileOption } from './catalogue';
import { EARNED_GROUPS, GROUP_NOTES, TIER_WORDS, earnedCard, earnedGroup, freshenEarned, tileCard, type BuilderCard, type Emblem } from './cards';
import { commit, createSaveGuard, isUnchanged, reconcileSave, redo, startHistory, undo, type LookHistory } from './draft';
import {
  closeGlyph, closerGlyph, diceGlyph, lockGlyph, redoGlyph, resetGlyph, tabGlyph, turnGlyph, undoGlyph, wholeGlyph,
} from './glyphs';
import { deviceStore, markRevealed, markSeen, seenNew, unrevealed, type DeviceStore } from './memory';
import { harmfulReasons } from './pieces';
import { createThumbPainter, type ThumbPainter, type ThumbRequest } from './thumbs';
import { createTurntable, type FocusRegion, type Turntable } from './turntable';

/*
 * The avatar builder (spec 49 B1–B4), one component for the web page and the Twitch panel. Everything it offers
 * comes from the same catalogue and the same recipe, so both make the same character. A draft is never a saved
 * look: only the look authority saves, and the realm checks earned pieces against verified records. The builder
 * says what the authority said: saving, saved, or the realm's own sentence.
 *
 * Every piece has a card (name, story, tier, how it is earned); choosing one leans the turntable in to where it is
 * worn and eases out again; a piece newly earned since this device last opened the wardrobe gets a short reveal.
 */

export type SaveResult =
  | { readonly ok: true; readonly look: CitizenLook; readonly token?: string | undefined }
  | { readonly ok: false; readonly reason: string };

/** The person's look authority: keep this reference stable for the session and replace it when the person changes. */
export interface LookAuthority {
  save(look: CitizenLook): Promise<SaveResult>;
}

/** The sounds the builder makes: the kingdom audio's control cue (wood, brass, parchment) and a window's light for a reveal. */
export interface BuilderSounds { cue(kind: 'wood' | 'light', options?: { ui?: 'wood' | 'brass' | 'parchment' }): boolean }

export interface AvatarBuilderProps {
  readonly layout: 'page' | 'panel';
  /** The person's approved name, when the surface knows it. */
  readonly name?: string | undefined;
  /** Their saved look; for someone who never saved, the starter they walk in. */
  readonly saved: CitizenLook;
  /** A look to start again from (their Twitch default), when there is one. */
  readonly defaultLook?: CitizenLook | undefined;
  /** Verified records in this kingdom; what can be worn, and how the rest is earned. */
  readonly entitlements: CitizenEntitlements;
  readonly authority: LookAuthority;
  /** Pieces granted on the realm (the Forge's worn twin), listed under Yours. */
  readonly granted?: readonly RealmWardrobeGrant[] | undefined;
  /** Looks already in the town, so the dice never roll a near-twin. */
  readonly town?: readonly CitizenLook[] | undefined;
  readonly sounds?: BuilderSounds | undefined;
  /** No idle motion: captures and reduced motion. */
  readonly still?: boolean | undefined;
  /** Opens on this tab. */
  readonly tab?: TabId | undefined;
  /** Opens close on this region (captures). */
  readonly focus?: FocusRegion | undefined;
  /** Opens with this card shown (captures): a card key. */
  readonly inspect?: string | undefined;
  /** Reveal unlocks this device has not yet seen (default true). */
  readonly reveal?: boolean | undefined;
  /** What this device remembers (reveals, new seals). Default: the page's own storage. */
  readonly memory?: DeviceStore | null | undefined;
  /** Shown as a close button in the header; Escape is the host's. */
  readonly onClose?: (() => void) | undefined;
  readonly closeLabel?: string | undefined;
  readonly onSaved?: ((look: CitizenLook, token: string | undefined) => void) | undefined;
}

type Status = { readonly kind: 'idle' | 'saving' | 'saved' | 'error'; readonly message?: string };
/** A card with the look it shows: the draft wearing that piece. */
interface Shown { readonly card: BuilderCard; readonly preview: CitizenLook }

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

/** A small render of the option on your own citizen. */
function Thumb(props: { painter: ThumbPainter; request: ThumbRequest; alt: string; locked?: boolean; class?: string }): JSX.Element {
  const [url, setUrl] = createSignal<string | null>(null);
  createEffect(() => {
    const request = props.request, controller = new AbortController();
    props.painter.paint(request, controller.signal).then(setUrl, () => undefined);
    onCleanup(() => controller.abort());
  });
  return <span class={`ab-thumb ${props.class ?? ''}`} classList={{ 'ab-thumb-locked': !!props.locked, 'ab-thumb-waiting': !url() }}>
    <Show when={url()}>{u => <img src={u()} alt={props.alt} draggable={false} />}</Show>
  </span>;
}

/** A badge drawn large from its own cells, on a brass boss (pins) or a ribbon bar (ribbons). */
export function EmblemMark(props: { emblem: Emblem; class?: string }): JSX.Element {
  const cell = 10, pad = props.emblem.kind === 'pin' ? 7 : 5;
  const w = props.emblem.width * cell + pad * 2, h = props.emblem.height * cell + pad * 2;
  return <span class={`ab-emblem ${props.class ?? ''}`} data-emblem={props.emblem.kind}>
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {props.emblem.kind === 'pin'
        ? <circle class="ab-emblem-boss" cx={w / 2} cy={h / 2} r={w / 2 - .8} />
        : <rect class="ab-emblem-bar" x=".8" y=".8" width={w - 1.6} height={h - 1.6} rx="2.4" />}
      <For each={props.emblem.cells}>{c => <g transform={`translate(${pad + c.x * cell} ${pad + c.y * cell})`}>
        <rect class="ab-emblem-cell" width={cell} height={cell} fill={c.colour} />
        <path class="ab-emblem-lit" d={`M.9 ${cell - .9}V.9H${cell - .9}`} />
        <path class="ab-emblem-shade" d={`M.9 ${cell - .9}H${cell - .9}V.9`} />
      </g>}</For>
    </svg>
    <Show when={props.emblem.caption}>{caption => <span class="ab-emblem-caption">{caption()}</span>}</Show>
  </span>;
}

/** The progress toward an earned piece: a brass meter with the words beside it. */
function Meter(props: { progress: NonNullable<EarnedOffer['progress']> }): JSX.Element {
  const share = () => Math.min(100, props.progress.have / Math.max(1, props.progress.need) * 100);
  return <span class="ab-meter" role="img" aria-label={`${props.progress.have} of ${props.progress.need} ${props.progress.unit}`}>
    <span class="ab-meter-track"><span class="ab-meter-fill" style={{ width: `${share()}%` }} /></span>
    <span class="ab-meter-words">{props.progress.have} of {props.progress.need} {props.progress.unit}</span>
  </span>;
}

/** The card of the piece being looked at: what it is, its story, its tier, how it is earned. */
function ItemCard(props: { shown: Shown; painter: ThumbPainter; dim: boolean; compact: boolean; settle: number }): JSX.Element {
  const card = () => props.shown.card;
  const state = () => {
    const e = card().earned;
    return !e ? null : !e.unlocked ? 'locked' : e.worn ? 'worn' : 'yours';
  };
  return <aside class="ab-card" data-tier={card().tier} data-state={state() ?? undefined} data-settle={props.settle % 2} aria-live="polite" aria-label={`${card().name}: ${TIER_WORDS[card().tier]}`}>
    <Show when={!props.compact}>
      <div class="ab-card-art">
        <Thumb painter={props.painter} alt="" class="ab-card-thumb" locked={state() === 'locked'}
          request={{ look: props.shown.preview, view: card().view, size: 176, dim: props.dim || !!card().earned?.dim }} />
        <Show when={card().emblem}>{emblem => <EmblemMark emblem={emblem()} class="ab-card-emblem" />}</Show>
      </div>
    </Show>
    <div class="ab-card-words">
      <p class="ab-card-part"><span>{card().part}</span><span class="ab-card-tier" data-tier={card().tier}>{TIER_WORDS[card().tier]}</span>
        <Show when={card().isNew}><span class="ab-new ab-new-inline">New</span></Show></p>
      <h2 class="ab-card-name">{card().name}</h2>
      <Show when={card().earned} fallback={<Show when={card().story}>{story => <p class="ab-card-story">{story()}</p>}</Show>}>{earned => <>
        <Show when={earned().unlocked && card().story}>{story => <p class="ab-card-story">{story()}{earned().dim ? '. Dimmed while the sub rests.' : ''}</p>}</Show>
        <Show when={!props.compact || !earned().unlocked}><p class="ab-card-how">{earned().how}</p></Show>
        <Show when={!earned().unlocked && earned().progress}>{p => <Meter progress={p()} />}</Show>
      </>}</Show>
    </div>
    <Show when={state()}>{s => <span class="ab-card-seal" data-state={s()}>{s() === 'locked' ? lockGlyph() : null}<span>{s() === 'worn' ? 'Worn' : s() === 'yours' ? 'Yours' : 'Not yet'}</span></span>}</Show>
  </aside>;
}

/** Marks a row that cannot show all it holds, so it can fade at its edge. */
function watchOverflow(el: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return;
  const check = () => el.toggleAttribute('data-overflow', el.scrollWidth > el.clientWidth + 1);
  const observer = new ResizeObserver(check);
  observer.observe(el);
  onCleanup(() => observer.disconnect());
  queueMicrotask(check);
}

export function AvatarBuilder(props: AvatarBuilderProps): JSX.Element {
  const panel = () => props.layout === 'panel';
  const memory = props.memory === undefined ? deviceStore() : props.memory;
  // Earned marks survive tenure updates: the draft starts wearing them grown, and the person saves it.
  const grownAtStart = freshenEarned(props.saved, props.entitlements);
  const [history, setHistory] = createSignal<LookHistory>(isUnchanged(grownAtStart, props.saved)
    ? startHistory(props.saved) : commit(startHistory(props.saved), grownAtStart));
  const [grown, setGrown] = createSignal(!isUnchanged(grownAtStart, props.saved));
  const [saved, setSaved] = createSignal<CitizenLook>(props.saved);
  const [active, setActive] = createSignal<TabId>(props.tab ?? 'hair');
  const [status, setStatus] = createSignal<Status>({ kind: 'idle' });
  const [pending, setPending] = createSignal<symbol | null>(null);
  const [uncertain, setUncertain] = createSignal(false);
  const [portrait, setPortrait] = createSignal<string | null>(null);
  const [seen, setSeen] = createSignal<ReadonlySet<string>>(seenNew(memory));
  const [hovered, setHovered] = createSignal<Shown | null>(null);
  const [picked, setPicked] = createSignal<Shown | null>(null);
  const [settle, setSettle] = createSignal(0);
  const [region, setRegion] = createSignal<FocusRegion | null>(props.focus ?? null);
  const [closer, setCloser] = createSignal(!!props.focus);
  const [reveals, setReveals] = createSignal<readonly EarnedOffer[]>([]);
  const [revealAt, setRevealAt] = createSignal(0);
  const [stamp, setStamp] = createSignal(0);
  const look = () => history().present;
  const dim = () => subLapsed(props.entitlements);
  const offers = createMemo(() => earnedOffers(props.entitlements));
  const unearned = createMemo(() => checkEarned(look(), props.entitlements));
  const harmful = createMemo(() => harmfulReasons(look()));
  const changed = () => !isUnchanged(look(), saved());
  const painter = createThumbPainter();
  const saveGuard = createSaveGuard();
  const tileSize = () => (panel() ? 96 : 128);
  let canvas: HTMLCanvasElement | undefined;
  let root: HTMLDivElement | undefined;
  let turntable: Turntable | null = null;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = !!props.still || reduced;

  const sound = (ui: 'wood' | 'brass' | 'parchment') => props.sounds?.cue('wood', { ui });
  const edit = (next: CitizenLook, mergeKey: string | null = null) => {
    setHistory(h => commit(h, next, mergeKey));
    if (status().kind !== 'saving') setStatus({ kind: 'idle' });
  };
  const doUndo = () => { setHistory(undo); sound('wood'); };
  const doRedo = () => { setHistory(redo); sound('wood'); };
  const roll = () => { edit(randomLook(Math.random, look(), props.town ?? [])); sound('brass'); };
  const restart = () => { edit(props.defaultLook ?? saved()); sound('wood'); };

  // The camera leans in to what is being chosen, and eases out once the choosing stops (unless held close).
  let outTimer: ReturnType<typeof setTimeout> | undefined;
  const lean = (to: FocusRegion | null) => {
    clearTimeout(outTimer);
    setRegion(to);
    if (to && !closer() && !still) outTimer = setTimeout(() => setRegion(null), 5200);
  };
  createEffect(() => turntable?.focus(region(), still));

  const tabs = createMemo(() => TABS.filter(t => t.id !== 'yours' || !!props.granted?.length));
  const tab = (): Tab => tabs().find(t => t.id === active()) ?? tabs()[0]!;
  const choose = (id: TabId) => {
    if (id === active()) return;
    setActive(id); setHovered(null); setPicked(null); sound('parchment');
    lean(closer() ? tab().region ?? region() : null);
  };

  // A refreshed saved look becomes the new baseline. Preserve any local draft.
  createEffect(on(() => props.saved, next => {
    if (isUnchanged(next, saved())) return;
    saveGuard.invalidate();
    setHistory(h => isUnchanged(h.present, saved()) ? startHistory(next) : h);
    setSaved(next);
    setGrown(false);
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
    if (unearned().length || harmful().length || pending()) return;
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
      setStatus({ kind: 'error', message: error instanceof Error && error.message ? error.message : 'Your look could not be saved. Try again in a moment.' });
      sound('parchment');
      return;
    }
    if (!saveGuard.alive()) return;
    setPending(current => current === request ? null : current);
    if (!saveGuard.current(ticket)) {
      if (props.authority === authority) setUncertain(true);
      return;
    }
    if (!result.ok) { setStatus({ kind: 'error', message: result.reason }); sound('parchment'); return; }
    setSaved(result.look);
    setUncertain(false);
    setGrown(false);
    // The authority can return a canonical look. Do not overwrite edits made while saving.
    setHistory(h => reconcileSave(h, submitted, result.look));
    setStatus({ kind: 'saved' });
    setStamp(n => n + 1);
    sound('brass');
    props.onSaved?.(result.look, result.token);
  };

  /* ------------------------------------------------------------------ Reveals */
  const revealing = () => reveals()[revealAt()] ?? null;
  const [revealArt, setRevealArt] = createSignal<string | null>(null);
  const showReveal = (index: number) => {
    const offer = reveals()[index];
    setRevealAt(index);
    setRevealArt(null);
    if (!offer) { lean(null); return; }
    markRevealed([offer], props.entitlements.kingdom.id, memory);
    const card = earnedCard(offer, false);
    painter.paint({ look: wearPiece(look(), offer.piece), view: card.view, size: panel() ? 160 : 288, dim: offer.dim, backdrop: true }).then(setRevealArt, () => undefined);
    // A window's light for the moment, the seal's brass as it stamps.
    props.sounds?.cue('light');
    setTimeout(() => { if (revealing() === offer) sound('brass'); }, still ? 0 : 520);
    queueMicrotask(() => root?.querySelector<HTMLButtonElement>('.ab-reveal-wear')?.focus({ preventScroll: true }));
  };
  const nextReveal = (wear: boolean) => {
    const offer = revealing();
    if (!offer) return;
    if (wear) { edit(isWorn(look(), offer) ? look() : wearPiece(look(), offer.piece)); setActive('earned'); }
    sound(wear ? 'brass' : 'parchment');
    showReveal(revealAt() + 1);
  };
  const putAway = () => {
    markRevealed(reveals().slice(revealAt()), props.entitlements.kingdom.id, memory);
    sound('parchment');
    setRevealAt(reveals().length);
    lean(null);
  };

  onMount(() => {
    if (!canvas) return;
    turntable = createTurntable(canvas, { still });
    createEffect(() => turntable!.setLook(look(), dim()));
    turntable.focus(region(), true);
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement | null)?.closest('input') || revealing()) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); doRedo(); }
      else if (key === 's') { e.preventDefault(); void save(); }
    };
    addEventListener('keydown', keys);
    onCleanup(() => removeEventListener('keydown', keys));
    if (props.reveal !== false) {
      const fresh = unrevealed(offers(), props.entitlements.kingdom.id, memory);
      if (fresh.length) {
        const begin = () => { setReveals(fresh); showReveal(0); };
        if (still) begin(); else { const t = setTimeout(begin, 700); onCleanup(() => clearTimeout(t)); }
      }
    }
  });
  onCleanup(() => { clearTimeout(outTimer); saveGuard.dispose(); turntable?.dispose(); painter.dispose(); });

  // The portrait, as the card and passport will show it, repainted shortly after the look settles.
  createEffect(() => {
    const current = look(), lapsed = dim();
    const controller = new AbortController();
    const timer = setTimeout(() => painter.paint({ look: current, view: 'bust', size: panel() ? 128 : 256, dim: lapsed, backdrop: true }, controller.signal).then(setPortrait, () => undefined), 120);
    onCleanup(() => { clearTimeout(timer); controller.abort(); });
  });

  /* ------------------------------------------------------------------ Cards */
  const tileShown = (control: Extract<Control, { kind: 'tiles' }>, option: TileOption): Shown =>
    ({ card: tileCard(control, option, seen()), preview: option.apply(look()) });
  const offerShown = (offer: EarnedOffer): Shown => {
    const worn = isWorn(look(), offer);
    return { card: earnedCard(offer, offer.unlocked && worn), preview: offer.unlocked && worn ? look() : wearPiece(look(), offer.piece) };
  };
  /** The card shown when nothing is hovered or picked: what you wear from the first part of this tab. */
  const resting = createMemo<Shown | null>(() => {
    const t = tab();
    if (t.id === 'earned') {
      const wanted = props.inspect ? offers().find(o => o.key === props.inspect) : undefined;
      const offer = wanted ?? offers().find(o => o.unlocked && isWorn(look(), o)) ?? offers().find(o => o.unlocked) ?? offers()[0];
      return offer ? offerShown(offer) : null;
    }
    for (const control of t.controls) {
      if (control.kind !== 'tiles' || (control.visible && !control.visible(look()))) continue;
      const wanted = props.inspect ? control.options.find(o => tileCard(control, o, seen()).key === props.inspect) : undefined;
      const option = wanted ?? chosenOption(control, look());
      if (option && (wanted || option.id !== 'none')) return tileShown(control, option);
    }
    return null;
  });
  // A picked card follows the draft (worn or not, its preview), so it never shows a stale state.
  const shown = (): Shown | null => hovered() ?? picked() ?? resting();
  const pickTile = (control: Extract<Control, { kind: 'tiles' }>, option: TileOption) => {
    const card = tileCard(control, option, seen());
    if (card.isNew) { markSeen(card.key, memory); setSeen(seenNew(memory)); }
    edit(option.apply(untrack(look)));
    setPicked(tileShown(control, option));
    setSettle(n => n + 1);
    lean(control.region);
    sound('brass');
  };

  /* ------------------------------------------------------------------ Controls */
  const Tiles = (p: { control: Extract<Control, { kind: 'tiles' }> }) => (
    <div class="ab-tiles" role="radiogroup" aria-label={p.control.label} onKeyDown={radioKeys}
      onPointerLeave={() => setHovered(null)}>
      <For each={p.control.options}>{(option: TileOption, index) => {
        const chosen = () => option.selected(look());
        const card = () => tileCard(p.control, option, seen());
        return <button type="button" class="ab-tile" role="radio" aria-checked={chosen()} classList={{ 'ab-chosen': chosen() }}
          data-tier={option.id === 'none' ? undefined : card().tier} data-new={card().isNew ? 'true' : undefined}
          aria-label={`${card().name}${card().tier === 'fun' ? ', just for fun' : ''}${card().isNew ? ', new' : ''}`}
          tabIndex={chosen() || (index() === 0 && !p.control.options.some(o => o.selected(look()))) ? 0 : -1}
          onPointerEnter={() => setHovered(tileShown(p.control, option))}
          onFocus={() => setHovered(tileShown(p.control, option))} onBlur={() => setHovered(null)}
          onClick={() => pickTile(p.control, option)}>
          <Thumb painter={painter} alt="" request={{ look: option.apply(look()), view: p.control.view, size: tileSize(), dim: dim() }} />
          <span class="ab-tile-name">{card().name}</span>
          <Show when={card().isNew}><span class="ab-new" aria-hidden="true">New</span></Show>
        </button>;
      }}</For>
    </div>
  );

  const Swatches = (p: { control: Extract<Control, { kind: 'swatches' }> }) => {
    const current = () => p.control.get(look());
    const known = () => p.control.groups.some(g => g.swatches.some(s => s.hex === current()));
    const pick = (hex: Hex, merge: string | null = null) => { edit(p.control.set(look(), hex), merge); lean(p.control.region); };
    return <div class="ab-swatches">
      <For each={p.control.groups}>{group => <div class="ab-swatch-group" role="radiogroup" aria-label={`${p.control.label}: ${group.label}`} onKeyDown={radioKeys}>
        <For each={group.swatches}>{(s, index) => <button type="button" class="ab-swatch" role="radio" aria-checked={current() === s.hex} classList={{ 'ab-chosen': current() === s.hex }}
          tabIndex={current() === s.hex || (index() === 0 && !group.swatches.some(option => option.hex === current())) ? 0 : -1}
          style={{ '--ab-swatch': s.hex }} title={s.label} aria-label={s.label} onClick={() => { pick(s.hex); sound('brass'); }} />}</For>
      </div>}</For>
      <label class="ab-any" classList={{ 'ab-chosen': !known() }} title="Any colour">
        <input type="color" value={current()} aria-label={`${p.control.label}: any colour`}
          onInput={e => pick(e.currentTarget.value.toLowerCase() as Hex, `${p.control.id}:wheel`)} />
        <span class="ab-any-ring" style={{ '--ab-swatch': current() }} />
        <span class="ab-any-word">Any colour</span>
      </label>
    </div>;
  };

  const Earned = () => (
    <div class="ab-earned">
      <For each={EARNED_GROUPS}>{group => {
        const items = () => offers().filter(o => earnedGroup(o) === group);
        return <Show when={items().length}>
          <section class="ab-group" aria-label={group}>
            <header class="ab-control-head"><h3 class="ab-control-title">{group}</h3><p class="ab-note">{GROUP_NOTES[group]}</p></header>
            <ul class="ab-earned-list" onPointerLeave={() => setHovered(null)}>
              <For each={items()}>{offer => {
                const worn = () => isWorn(look(), offer);
                const card = () => earnedCard(offer, offer.unlocked && worn());
                const state = () => (!offer.unlocked ? 'locked' : worn() ? 'worn' : 'yours');
                const wear = () => {
                  edit(worn() ? takeOffPiece(look(), offer.piece) : wearPiece(look(), offer.piece));
                  setPicked(offerShown(offer));
                  setSettle(n => n + 1);
                  lean(card().region);
                  sound('brass');
                };
                return <li class="ab-earned-item" data-state={state()}>
                  <button type="button" class="ab-earned-button" aria-pressed={worn()}
                    aria-label={offer.unlocked ? `${worn() ? 'Take off' : 'Wear'} ${offer.name}` : `Try on ${offer.name}, not earned yet`}
                    onPointerEnter={() => setHovered(offerShown(offer))} onFocus={() => setHovered(offerShown(offer))} onBlur={() => setHovered(null)}
                    onClick={wear}>
                    <span class="ab-earned-art">
                      <Thumb painter={painter} alt="" locked={!offer.unlocked} request={{ look: offerShown(offer).preview, view: card().view, size: tileSize(), dim: offer.dim }} />
                      <Show when={card().emblem}>{emblem => <EmblemMark emblem={emblem()} class="ab-earned-emblem" />}</Show>
                    </span>
                    <span class="ab-earned-words">
                      <strong class="ab-earned-name">{offer.name}</strong>
                      <Show when={offer.unlocked} fallback={<span class="ab-earned-how">{offer.earnedBy}</span>}>
                        <span class="ab-earned-story">{offer.story}{offer.dim ? '. Dimmed while the sub rests.' : ''}</span>
                      </Show>
                      <Show when={!offer.unlocked && offer.progress}>{p => <Meter progress={p()} />}</Show>
                    </span>
                    <span class="ab-earned-seal" data-state={state()}>{state() === 'locked' ? lockGlyph() : null}<span>{state() === 'worn' ? 'Worn' : state() === 'yours' ? 'Wear' : 'Try on'}</span></span>
                  </button>
                </li>;
              }}</For>
            </ul>
          </section>
        </Show>;
      }}</For>
    </div>
  );

  const Yours = () => (
    <div class="ab-yours">
      <header class="ab-control-head"><h3 class="ab-control-title">Forged by you</h3><p class="ab-note">Each waits here until it can be fitted to your citizen.</p></header>
      <ul class="ab-yours-list">
        <For each={props.granted ?? []}>{grant => <li class="ab-yours-item">
          <span class="ab-yours-mark">{tabGlyph('yours')}</span>
          <span class="ab-earned-words"><strong class="ab-earned-name">{grant.title}</strong>
            <span class="ab-earned-story">Forged {new Date(grant.grantedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, worn {grant.slot === 'held' ? 'in the hand' : grant.slot === 'back' ? 'on the back' : grant.slot === 'neck' ? 'at the neck' : grant.slot === 'badge' ? 'as a badge' : 'as a hat'}</span></span>
        </li>}</For>
      </ul>
    </div>
  );

  /* ------------------------------------------------------------------ Words */
  const statusWords = () => {
    const s = status();
    if (pending()) return 'Saving your look…';
    if (s.kind === 'error') return s.message ?? 'Your look is not saved.';
    if (uncertain()) return 'Your saved look changed while saving. Save again, or close the wardrobe and open it again.';
    if (harmful().length) return harmful()[0]!;
    if (unearned().length) return 'You are trying on something not yet earned. Take it off to save.';
    if (s.kind === 'saved' && !changed()) return 'Saved. This is you, everywhere.';
    if (grown() && changed()) return 'Your earned pieces have grown since you last saved. Save to wear them.';
    return changed() ? 'Not saved yet' : 'This is your saved look';
  };
  const warn = () => !!unearned().length || !!harmful().length || uncertain() || status().kind === 'error';

  const rootKeys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !revealing()) return;
    e.preventDefault(); e.stopPropagation();
    putAway();
  };

  return (
    <div ref={el => { root = el; }} class="ab cd-kit" classList={{ 'ab-panel': panel(), 'ab-page': !panel(), 'ab-still': still }} data-layout={props.layout} onKeyDown={rootKeys}>
      <header class="ab-head cd-plate">
        <div class="ab-title">
          <p class="ab-eyebrow">{props.entitlements.kingdom.name ? `The wardrobe of ${props.entitlements.kingdom.name}` : 'The wardrobe'}</p>
          <h1>{props.name ?? 'Your citizen'}</h1>
        </div>
        <Show when={props.onClose}>{close => <button type="button" class="ab-close" onClick={() => { sound('wood'); close()(); }}>
          {closeGlyph()}<span>{props.closeLabel ?? 'Close'}</span></button>}</Show>
      </header>

      <div class="ab-stage-column">
        <section class="ab-stage" aria-label="Your citizen" data-region={region() ?? 'whole'}>
          <canvas ref={el => { canvas = el; }} class="ab-turntable" tabindex="0" aria-label="Your citizen. Drag, or use the arrow keys, to turn them."
            onKeyDown={e => { if (e.key === 'ArrowLeft') turntable?.nudge(-.3); if (e.key === 'ArrowRight') turntable?.nudge(.3); }} />
          <figure class="ab-portrait">
            <span class="ab-portrait-frame"><Show when={portrait()}>{u => <img src={u()} alt={`${props.name ?? 'Your'} portrait`} />}</Show></span>
            <figcaption>Portrait</figcaption>
          </figure>
          <div class="ab-stage-tools">
            <button type="button" class="ab-stage-tool" aria-pressed={closer()}
              onClick={() => {
                const on = !closer();
                setCloser(on);
                sound('wood');
                lean(on ? region() ?? tab().region ?? shown()?.card.region ?? 'head' : null);
              }}>
              {closer() ? wholeGlyph() : closerGlyph()}<span>{closer() ? 'Whole figure' : 'Look closer'}</span>
            </button>
            <p class="ab-hint">{turnGlyph()}<span>Drag to turn</span></p>
          </div>
        </section>
        <Show when={shown()}>{s => <ItemCard shown={s()} painter={painter} dim={dim()} compact={panel()} settle={settle()} />}</Show>
      </div>

      <nav class="ab-tabs" aria-label="Parts of your look" ref={watchOverflow}>
        <For each={tabs()}>{t => <button type="button" class="ab-tab" aria-current={active() === t.id ? 'page' : undefined} data-tab={t.id}
          ref={el => createEffect(() => { if (active() === t.id) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); })}
          onClick={() => choose(t.id)}>{tabGlyph(t.id)}<span>{t.label}</span></button>}</For>
      </nav>

      <section class="ab-sheet cd-slip" aria-label={tab().label}>
        <Show when={active()} keyed>{id => <div class="ab-leaf" data-tab={id}>
          <Show when={id === 'earned'} fallback={<Show when={id === 'yours'} fallback={
            <For each={tab().controls}>{control => <Show when={!control.visible || control.visible(look())}>
              <div class="ab-control" data-control={control.id}>
                <header class="ab-control-head"><h3 class="ab-control-title">{control.label}</h3></header>
                {control.kind === 'tiles' ? <Tiles control={control} /> : <Swatches control={control} />}
              </div>
            </Show>}</For>}><Yours /></Show>}>
            <Earned />
          </Show>
        </div>}</Show>
      </section>

      <footer class="ab-foot cd-plate">
        <div class="ab-tools">
          <button type="button" class="ab-tool" onClick={doUndo} disabled={!history().past.length} aria-label="Undo" title="Undo (Ctrl+Z)">{undoGlyph()}</button>
          <button type="button" class="ab-tool" onClick={doRedo} disabled={!history().future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">{redoGlyph()}</button>
          <button type="button" class="ab-tool ab-dice" onClick={roll} aria-label="Roll a new look" title="Roll a new look, keeping what you earned">
            {diceGlyph()}<Show when={!panel()}><span>Roll</span></Show>
          </button>
          <Show when={!panel()}>
            <button type="button" class="ab-tool" onClick={restart} disabled={!props.defaultLook && !changed()}
              title={props.defaultLook ? 'Start again from the look Twitch gave you' : 'Back to your saved look'}
              aria-label={props.defaultLook ? 'Start again from my default' : 'Back to my saved look'}>
              {resetGlyph()}<span>{props.defaultLook ? 'From my default' : 'Back to saved'}</span>
            </button>
          </Show>
        </div>
        <p class="ab-status" role="status" aria-live="polite" data-status={pending() ? 'saving' : status().kind} classList={{ 'ab-warn': warn() }}>
          <Show when={status().kind === 'saved' && !changed() && !pending()}><span class="ab-stamp" data-stamp={stamp() % 2} aria-hidden="true" /></Show>
          <span>{statusWords()}</span>
        </p>
        <button type="button" class="ab-save" onClick={() => void save()}
          disabled={(!changed() && !uncertain()) || !!unearned().length || !!harmful().length || !!pending()}>
          <Show when={!pending()} fallback={<span>Saving</span>}>
            <span class="ab-save-long">{panel() ? 'Save' : 'Save my look'}</span><span class="ab-save-short">Save</span>
          </Show>
        </button>
      </footer>

      <Show when={revealing()} keyed>{offer => {
        const card = earnedCard(offer, false);
        const left = () => reveals().length - revealAt() - 1;
        return <div class="ab-reveal" role="dialog" aria-modal="true" aria-labelledby="ab-reveal-name" data-family={offer.piece.family}>
          <div class="ab-reveal-dusk" aria-hidden="true" />
          <div class="ab-reveal-sheet">
            <span class="ab-reveal-rod" aria-hidden="true" />
            <div class="ab-reveal-body">
              <p class="ab-reveal-eyebrow">{reveals().length > 1 ? `Newly earned · ${revealAt() + 1} of ${reveals().length}` : 'Newly earned'}</p>
              <div class="ab-reveal-art">
                <span class="ab-reveal-glow" aria-hidden="true" />
                <span class="ab-reveal-frame"><Show when={revealArt()}>{u => <img src={u()} alt={`You, wearing ${offer.name}`} />}</Show></span>
                <Show when={card.emblem}>{emblem => <EmblemMark emblem={emblem()} class="ab-reveal-emblem" />}</Show>
                <span class="ab-reveal-seal" aria-hidden="true"><span>Yours</span></span>
              </div>
              <h2 class="ab-reveal-name" id="ab-reveal-name">{offer.name}</h2>
              <Show when={offer.story}>{story => <p class="ab-reveal-story">{story()}</p>}</Show>
              <p class="ab-reveal-how">{offer.earnedBy}</p>
              <div class="ab-reveal-actions">
                <button type="button" class="ab-save ab-reveal-wear" onClick={() => nextReveal(true)}>{isWorn(look(), offer) ? 'Keep it on' : 'Wear it now'}</button>
                <button type="button" class="ab-tool ab-reveal-later" onClick={() => nextReveal(false)}>{left() ? 'Next' : 'Keep it for later'}</button>
              </div>
              <Show when={left() > 0}><button type="button" class="ab-reveal-skip" onClick={putAway}>Put the other {left() === 1 ? 'one' : left()} away for now</button></Show>
            </div>
            <span class="ab-reveal-rod ab-reveal-rod-foot" aria-hidden="true" />
          </div>
        </div>;
      }}</Show>
    </div>
  );
}
