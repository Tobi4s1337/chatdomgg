import { createEffect, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { ScrollLeaf } from './controls';
import { anvilMark, awayMark, cornerCap, doorMark, flourish } from './marks';
import { BuildPage, HelpPage, ProviderPage, SettingsPage, WayHomePage, type PageProps } from './pages';
import { folio } from './words';
import { CardPage } from '../card/CardPage';
import { MapPage } from '../map/MapPage';

export type LedgerPhase = 'opening' | 'open' | 'closing';

const typing = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const plain = (event: KeyboardEvent) => !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

/**
 * The ledger: a walnut-boarded book with brass corners, its contents on the left leaf and the open page on the
 * right. Its front board swings open on the gutter; pages turn from the gutter. On a phone it is one full-height
 * leaf with its contents as a rail of tabs and the way back under the thumb.
 */
export function LedgerBook(props: PageProps & { phase: LedgerPhase }): JSX.Element {
  let root!: HTMLDivElement;
  const tabs = new Map<string, HTMLButtonElement>();
  const state = props.state;
  const current = () => state().tabs.find(tab => tab.id === state().page) ?? state().tabs[0]!;
  const at = () => Math.max(0, state().tabs.findIndex(tab => tab.id === state().page));
  const reduced = () => props.settings().reducedMotion;

  const show = (id: string, focus: boolean) => queueMicrotask(() => {
    const tab = tabs.get(id);
    if (!tab) return;
    if (focus) tab.focus({ preventScroll: true });
    // On the phone rail the chosen tab slides into view; on the left leaf this does nothing.
    tab.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  });
  onMount(() => show(state().page, true));
  createEffect(on(() => state().page, page => show(page, root.contains(document.activeElement) && document.activeElement?.getAttribute('role') === 'tab'), { defer: true }));

  // While a key plate listens, every key goes to it first, before the walk or the browser's shortcuts can act.
  createEffect(on(() => state().capture, action => {
    if (!action) return;
    const listen = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      props.ledger.pressKey(event.code || event.key);
    };
    const away = (event: PointerEvent) => {
      const plate = (event.target as Element | null)?.closest?.('[data-key-action]');
      if (!plate || plate.getAttribute('data-key-action') !== action) props.ledger.cancelCapture();
    };
    window.addEventListener('keydown', listen, true);
    window.addEventListener('pointerdown', away, true);
    onCleanup(() => { window.removeEventListener('keydown', listen, true); window.removeEventListener('pointerdown', away, true); });
  }));

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      // Holding Escape in fullscreen is the browser's way out; only the first press belongs to the ledger.
      if (event.repeat || event.defaultPrevented) return;
      if (props.ledger.escape()) event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Keys pressed inside the book never walk the street behind it.
    event.stopPropagation();
    if (event.defaultPrevented || !plain(event) || typing(event.target) || state().capture || event.repeat) return;
    const keys = props.settings().keys;
    if (keys.ledger && event.code === keys.ledger) { event.preventDefault(); props.ledger.close(); }
    else if (keys.fullscreen && event.code === keys.fullscreen && props.cursor().canFullscreen) { event.preventDefault(); props.ledger.toggleFullscreen(); }
  }
  function tabKey(event: KeyboardEvent, id: string) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = props.ledger.step(id, event.key);
    if (!next) return;
    event.preventDefault();
    if (next === state().page) { tabs.get(next)?.focus({ preventScroll: true }); return; }
    props.ledger.select(next);
    show(next, true);
  }
  // A click on the dimmed kingdom (that also began there) is one click back to the street.
  let pressedOutside = false;
  const scrimDown = (event: PointerEvent) => { pressedOutside = event.target === event.currentTarget; };
  const scrimClick = (event: MouseEvent) => { if (pressedOutside && event.target === event.currentTarget) props.ledger.resume(event); pressedOutside = false; };
  // Focus stays inside the open book: Tab past either end wraps round.
  const wrap = (to: 'first' | 'last') => {
    const focusable = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], a[href], input, textarea, select')]
      .filter(element => !element.closest('.pl-sentinel') && element.getClientRects().length > 0);
    (to === 'first' ? focusable[0] : focusable[focusable.length - 1])?.focus({ preventScroll: true });
  };

  return <div ref={element => { root = element; }} class="pl-ledger cd-kit" role="dialog" aria-modal="true" aria-labelledby="pl-ledger-name"
    data-phase={props.phase} data-reduced={reduced() ? 'true' : undefined} onKeyDown={keydown}>
    <div class="pl-scrim" onPointerDown={scrimDown} onClick={scrimClick} />
    <span class="pl-sentinel" tabIndex={0} onFocus={() => wrap('last')} />
    <div class="pl-book">
      <div class="pl-boards" aria-hidden="true">
        <span class="pl-corner" data-corner="tl">{cornerCap()}</span><span class="pl-corner" data-corner="tr">{cornerCap()}</span>
        <span class="pl-corner" data-corner="bl">{cornerCap()}</span><span class="pl-corner" data-corner="br">{cornerCap()}</span>
        <span class="pl-clasp" />
      </div>
      <div class="pl-leaves">
        <div class="pl-leaf pl-leaf-contents">
          <header class="pl-title">
            <p class="pl-eyebrow"><Show when={props.play.ctx.self} fallback="Kept for a visitor">{self => `Kept by ${self().publicName}`}</Show></p>
            <h2 class="pl-name" id="pl-ledger-name">The Ledger</h2>
            {flourish()}
          </header>
          <nav class="pl-contents" aria-label="Pages of the ledger">
            <div class="pl-tabs" role="tablist" aria-orientation="vertical" aria-label="Pages">
              <For each={state().tabs}>{(tab, index) => <button type="button" role="tab" class="pl-tab" id={`pl-tab-${tab.id}`}
                ref={element => { tabs.set(tab.id, element); onCleanup(() => { if (tabs.get(tab.id) === element) tabs.delete(tab.id); }); }}
                aria-selected={tab.id === state().page ? 'true' : 'false'} aria-controls="pl-page" tabIndex={tab.id === state().page ? 0 : -1}
                onClick={() => props.ledger.select(tab.id)} onKeyDown={event => tabKey(event, tab.id)} data-tab={tab.id}>
                <span class="pl-tab-name">{tab.title}</span><span class="pl-tab-leader" aria-hidden="true" />
                <span class="pl-tab-folio" aria-hidden="true">{folio(index() + 1)}</span>
              </button>}</For>
            </div>
            <Show when={state().forge}>
              <button type="button" class="pl-tab pl-tab-away" onClick={() => props.ledger.openForge()} aria-label="The Forge (closes the ledger)">
                {anvilMark()}<span class="pl-tab-name">The Forge</span><span class="pl-tab-leader" aria-hidden="true" />{awayMark()}
              </button>
            </Show>
          </nav>
          <div class="pl-way-back">
            <button type="button" class="pl-back" onClick={event => props.ledger.resume(event)}>
              <span class="pl-back-mark">{doorMark()}</span>
              <span class="pl-back-words"><span class="pl-back-title">Back to the street</span>
                <span class="pl-back-hint">{props.cursor().state === 'touch' ? 'Tap to walk on' : 'Click to walk on'}</span></span>
            </button>
            <p class="pl-escape-hint" aria-hidden="true">Escape closes the ledger</p>
          </div>
        </div>
        <div class="pl-gutter" aria-hidden="true" />
        <section class="pl-leaf pl-leaf-page" id="pl-page" role="tabpanel" aria-labelledby={`pl-tab-${current().id}`}>
          <header class="pl-page-head">
            <p class="pl-eyebrow">Folio {folio(at() + 1)}</p>
            <h2 class="pl-page-title">{current().title}</h2>
          </header>
          <Show when={current().id} keyed>{page =>
            <ScrollLeaf label={current().title} class="pl-page-scroll">
              <div class="pl-page-body" data-page={page}>
                <Switch fallback={<Show when={current().provider} keyed>{provider => <ProviderPage provider={provider} ctx={props.play.ctx} />}</Show>}>
                  <Match when={current().id === 'settings'}><SettingsPage {...props} /></Match>
                  <Match when={current().id === 'way-home'}><WayHomePage {...props} /></Match>
                  <Match when={current().id === 'card'}><CardPage ctx={props.play.ctx} cue={surface => props.play.cue(surface)} reducedMotion={reduced} /></Match>
                  <Match when={current().id === 'map'}><MapPage map={() => props.play.map?.() ?? null} {...(props.play.lights ? { lights: props.play.lights } : {})}
                    cue={surface => props.play.cue(surface)} reducedMotion={reduced} /></Match>
                  <Match when={current().id === 'build'}><BuildPage {...props} /></Match>
                  <Match when={current().id === 'help'}><HelpPage {...props} /></Match>
                </Switch>
              </div>
            </ScrollLeaf>}
          </Show>
          <Show when={state().turn.n} keyed>{n => <span class="pl-turn" data-turn={n} data-dir={state().turn.dir > 0 ? 'next' : 'back'} aria-hidden="true" />}</Show>
          <p class="pl-folio-foot" aria-hidden="true">{folio(at() + 1)}</p>
        </section>
      </div>
      <div class="pl-cover" aria-hidden="true"><span class="pl-cover-plate"><span class="pl-cover-title">The Ledger</span></span></div>
    </div>
    <span class="pl-sentinel" tabIndex={0} onFocus={() => wrap('first')} />
  </div>;
}
