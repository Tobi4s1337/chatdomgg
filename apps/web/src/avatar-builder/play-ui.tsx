import { For, Match, Show, Switch, createEffect, createResource, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import '@chatdom/ui/kit.css';
import './builder.css';
import './look.css';
import {
  earnedOffers, isWorn, type CitizenEntitlements, type CitizenLook,
} from '../../../../packages/content/src/avatar-style';
import type { KingdomId } from '@chatdom/shared';
import { AvatarBuilder, EmblemMark, type BuilderSounds } from './AvatarBuilder';
import { TABS, chosenOption } from './catalogue';
import { earnedCard, tileCard } from './cards';
import { mirrorGlyph } from './glyphs';
import { LookStoreError, type LookClient, type LookMine } from './look-client';
import { putOffMirror, seenNew, type DeviceStore } from './memory';
import { MirrorMoment, type MirrorOutcome } from './Mirror';
import { createPortraitRenderer } from './portrait-renderer';

/*
 * The wardrobe as play mounts it: the ledger's "Your look" page, the full builder over the street, and the mirror on
 * a first walk. Loaded only when one of them opens, so the street never waits for the wardrobe.
 */

export interface LookUiDeps {
  readonly client: LookClient;
  readonly memory: DeviceStore | null;
  readonly sounds: BuilderSounds | undefined;
  /** A save the realm accepted: the renderer's library learns the token at once. */
  readonly saved: (token: string | undefined, look: CitizenLook) => void;
  /** Saves heard by open pages (the ledger page's portrait). */
  readonly onSaved: (listener: (look: CitizenLook, token: string | undefined) => void) => () => void;
}

/* ------------------------------------------------------------------ What you wear, in words */

export interface WornLine { readonly part: string; readonly name: string; readonly emblem?: ReturnType<typeof earnedCard>['emblem'] }

/** The pieces a look wears, by part, named as their cards name them; earned pieces last, with their badges. */
export function wornLines(look: CitizenLook, entitlements: CitizenEntitlements | null): readonly WornLine[] {
  const lines: WornLine[] = [];
  const seen = seenNew(null);
  for (const tab of TABS) for (const control of tab.controls) {
    if (control.kind !== 'tiles' || !control.piece) continue;
    const option = chosenOption(control, look);
    if (!option || option.id === 'none') continue;
    lines.push({ part: control.label === 'Style' ? 'Hair' : control.label, name: tileCard(control, option, seen).name });
  }
  if (entitlements) for (const offer of earnedOffers(entitlements)) {
    if (!offer.unlocked || !isWorn(look, offer)) continue;
    const card = earnedCard(offer, true);
    lines.push({ part: 'Earned', name: offer.name, emblem: card.emblem });
  }
  return lines;
}

/* ------------------------------------------------------------------ Shared states */

/** The wardrobe's closed doors: while it unlocks, when it cannot, and when nobody is signed in. */
export function WardrobeDoors(props: {
  state: 'loading' | 'error' | 'anonymous'; message?: string | undefined; signInUrl?: string | undefined;
  onRetry?: (() => void) | undefined; onClose?: (() => void) | undefined; closeLabel?: string | undefined;
}): JSX.Element {
  return <div class="lk-doors cd-kit" data-state={props.state}>
    <div class="lk-door lk-door-left" aria-hidden="true"><span class="lk-door-panel" /><span class="lk-door-panel" /></div>
    <div class="lk-door lk-door-right" aria-hidden="true"><span class="lk-door-panel" /><span class="lk-door-panel" /></div>
    <span class="lk-keyhole" aria-hidden="true" />
    <div class="lk-door-note" role={props.state === 'error' ? 'alert' : 'status'}>
      <Switch>
        <Match when={props.state === 'loading'}>
          <span class="lk-note-mark lk-note-lamp" aria-hidden="true" />
          <p class="lk-note-title">Unlocking your wardrobe…</p>
        </Match>
        <Match when={props.state === 'error'}>
          <p class="lk-note-title">The wardrobe stays shut</p>
          <p class="lk-note-words">{props.message ?? 'The wardrobe cannot be opened just now.'}</p>
          <div class="lk-note-actions">
            <Show when={props.onRetry}>{retry => <button type="button" class="ab-save" onClick={() => retry()()}>Try again</button>}</Show>
            <Show when={props.onClose}>{close => <button type="button" class="ab-tool" onClick={() => close()()}>{props.closeLabel ?? 'Close'}</button>}</Show>
          </div>
        </Match>
        <Match when={props.state === 'anonymous'}>
          <span class="lk-note-mark" aria-hidden="true">{mirrorGlyph()}</span>
          <p class="lk-note-title">Make your citizen</p>
          <p class="lk-note-words">Sign in with Twitch to dress the citizen who walks your kingdoms. Your look is saved to you, and it is the same person on the street, on stream, on your card and in the panel.</p>
          <div class="lk-note-actions">
            <a class="ab-save lk-signin" href={props.signInUrl ?? '#'}><span class="lk-twitch" aria-hidden="true" />Sign in with Twitch</a>
          </div>
        </Match>
      </Switch>
    </div>
  </div>;
}

/* ------------------------------------------------------------------ The builder, from the realm */

/** Reads the realm and shows the builder for the signed-in person, or the doors that say why not. */
export function RealmWardrobe(props: {
  client: LookClient; kingdomId: KingdomId | null; name?: string | undefined; layout: 'page' | 'panel';
  sounds?: BuilderSounds | undefined; memory: DeviceStore | null;
  onClose?: (() => void) | undefined; closeLabel?: string | undefined;
  onSaved?: ((token: string | undefined, look: CitizenLook) => void) | undefined;
  onReady?: (() => void) | undefined;
}): JSX.Element {
  const [attempt, setAttempt] = createSignal(0);
  const [mine] = createResource(attempt, async (): Promise<LookMine> => props.client.mine(props.kingdomId));
  const error = () => {
    const e = mine.error as unknown;
    return e instanceof LookStoreError ? e.message : e ? 'The wardrobe cannot be opened just now.' : undefined;
  };
  createEffect(() => { if (mine.state === 'ready') props.onReady?.(); });
  return <Switch fallback={<WardrobeDoors state="loading" />}>
    <Match when={mine.error}>
      <WardrobeDoors state="error" message={error()} onRetry={() => setAttempt(n => n + 1)} onClose={props.onClose} closeLabel={props.closeLabel} />
    </Match>
    <Match when={mine.state === 'ready' && mine()}>{reply => {
      const r = reply();
      if (r.status === 'anonymous') return <WardrobeDoors state="anonymous" signInUrl={r.signInUrl} />;
      const authority = props.client.authority(props.kingdomId, saved => props.onSaved?.(saved.token, saved.look));
      return <AvatarBuilder layout={props.layout} name={props.name} saved={r.look} entitlements={r.entitlements} granted={r.granted}
        authority={authority} sounds={props.sounds} memory={props.memory} onClose={props.onClose} closeLabel={props.closeLabel} />;
    }}</Match>
  </Switch>;
}

/* ------------------------------------------------------------------ Over the street */

let openOverlay: { close(): void } | null = null;

/** The full builder over the street, its doors swinging open once the realm has answered. */
export function openBuilderOverlay(options: {
  deps: LookUiDeps; kingdomId: KingdomId; name?: string | undefined; onClosed: () => void;
  /** The close button's words: where closing takes you. */
  closeLabel?: string;
}): { close(): void } {
  if (openOverlay) return openOverlay;
  const host = document.createElement('div');
  host.className = 'lk-overlay';
  document.body.appendChild(host);
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let disposeRender: (() => void) | null = null;
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
    event.preventDefault();
    handle.close();
  };
  const handle = {
    close() {
      if (openOverlay !== handle) return;
      openOverlay = null;
      removeEventListener('keydown', escape);
      options.deps.sounds?.cue('wood', { ui: 'wood' });
      disposeRender?.();
      host.remove();
      try { previous?.focus({ preventScroll: true }); } catch { /* the page moved on */ }
      options.onClosed();
    },
  };
  openOverlay = handle;
  addEventListener('keydown', escape);
  options.deps.sounds?.cue('wood', { ui: 'wood' });
  const narrow = () => innerWidth <= 360 && innerHeight <= 560;
  disposeRender = render(() => {
    const [open, setOpen] = createSignal(false);
    onMount(() => host.focus?.());
    return <div class="lk-overlay-frame" data-open={open() ? 'true' : 'false'}>
      <RealmWardrobe client={options.deps.client} kingdomId={options.kingdomId} name={options.name} layout={narrow() ? 'panel' : 'page'}
        sounds={options.deps.sounds} memory={options.deps.memory} closeLabel={options.closeLabel ?? 'Back to the street'} onClose={() => handle.close()}
        onSaved={options.deps.saved} onReady={() => { if (!open()) { setOpen(true); options.deps.sounds?.cue('wood', { ui: 'wood' }); } }} />
    </div>;
  }, host);
  return handle;
}

/* ------------------------------------------------------------------ The ledger page */

export function mountLedgerPage(host: HTMLElement, options: {
  deps: LookUiDeps; kingdomId: KingdomId; name: string; open: () => void;
}): () => void {
  return render(() => <LedgerLook {...options} />, host);
}

function LedgerLook(props: { deps: LookUiDeps; kingdomId: KingdomId; name: string; open: () => void }): JSX.Element {
  const [attempt, setAttempt] = createSignal(0);
  const [mine, { mutate }] = createResource(attempt, async () => props.deps.client.mine(props.kingdomId));
  const [portrait, setPortrait] = createSignal<string | null>(null);
  const renderer = createPortraitRenderer();
  onCleanup(() => renderer.dispose());
  onCleanup(props.deps.onSaved((look, token) => {
    const current = mine();
    if (current && current.status !== 'anonymous') {
      mutate({ status: 'saved', token: token ?? (current.status === 'saved' ? current.token : ''), look, savedAt: Date.now(), entitlements: current.entitlements, granted: current.granted });
    }
  }));
  createEffect(() => {
    const reply = mine.state === 'ready' ? mine() : undefined;
    if (!reply || reply.status === 'anonymous') return;
    const timer = setTimeout(() => {
      try { setPortrait(renderer.render(reply.look, 256, { view: 'bust' }).toDataURL('image/png')); } catch { setPortrait(null); }
    }, 0);
    onCleanup(() => clearTimeout(timer));
  });
  const reply = () => (mine.state === 'ready' ? mine() : undefined);
  const lines = () => { const r = reply(); return r && r.status !== 'anonymous' ? wornLines(r.look, r.entitlements) : []; };
  return <div class="lk-ledger">
    <Switch fallback={<div class="lk-ledger-wait" role="status"><span class="lk-note-mark lk-note-lamp" aria-hidden="true" /><p class="pl-lead">Fetching your look from the realm…</p></div>}>
      <Match when={mine.error}>
        <div class="lk-ledger-wait" role="alert">
          <p class="pl-lead">{mine.error instanceof LookStoreError ? (mine.error as LookStoreError).message : 'Your look cannot be fetched just now.'}</p>
          <button type="button" class="pl-action" onClick={() => setAttempt(n => n + 1)}><span>Try again</span></button>
        </div>
      </Match>
      <Match when={reply()?.status === 'anonymous'}>
        <div class="lk-ledger-wait"><p class="pl-lead">Your visit has ended. Sign in with Twitch again to dress your citizen.</p></div>
      </Match>
      <Match when={reply()}>{r => <div class="lk-ledger-spread">
        <figure class="lk-ledger-portrait">
          <span class="lk-ledger-frame"><Show when={portrait()}>{u => <img src={u()} alt={`${props.name}, as everyone sees you`} />}</Show></span>
          <figcaption class="lk-ledger-name">{props.name}</figcaption>
        </figure>
        <div class="lk-ledger-words">
          <p class="pl-lead">{r().status === 'none'
            ? 'You still wear the look you arrived in. Make it yours: it is the same person on the street, on stream, on your card and in the panel.'
            : 'This is you, everywhere: on the street, on stream, on your card and in the panel.'}</p>
          <section class="pl-section lk-ledger-wearing">
            <header class="pl-section-head"><h3 class="pl-section-title">What you wear</h3></header>
            <ul class="lk-wearing" role="list">
              <For each={lines()}>{line => <li class="lk-wearing-row"><span class="lk-wearing-part">{line.part}</span><span class="lk-wearing-leader" aria-hidden="true" />
                <span class="lk-wearing-name">{line.name}</span><Show when={line.emblem}>{emblem => <EmblemMark emblem={emblem()} class="lk-wearing-emblem" />}</Show></li>}</For>
            </ul>
          </section>
          <button type="button" class="pl-action lk-open" onClick={() => props.open()}>{mirrorGlyph()}<span>Open the wardrobe</span></button>
        </div>
      </div>}</Match>
    </Switch>
  </div>;
}

/* ------------------------------------------------------------------ The mirror, on arrival */

export function runMirror(host: HTMLElement, options: {
  deps: LookUiDeps; kingdomId: KingdomId; name: string; look: CitizenLook; still?: boolean;
}): Promise<MirrorOutcome> {
  return new Promise(resolve => {
    const layer = document.createElement('div');
    layer.className = 'lk-mirror-layer';
    host.appendChild(layer);
    const authority = options.deps.client.authority(options.kingdomId, saved => options.deps.saved(saved.token, saved.look));
    let dispose: (() => void) | null = null;
    const done = (outcome: MirrorOutcome) => {
      if (outcome === 'later') putOffMirror(options.deps.memory);
      dispose?.(); layer.remove();
      resolve(outcome);
    };
    dispose = render(() => <MirrorMoment name={options.name} look={options.look} save={look => authority.save(look)} sounds={options.deps.sounds}
      still={options.still} onDone={outcome => done(outcome)} />, layer);
  });
}
