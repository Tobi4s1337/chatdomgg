import { createEffect, onCleanup, Show } from 'solid-js';
import type { CardReply } from '../data/directory';
import type { PreviewWorld } from '../data/preview';
import { ChannelFaceSeal } from './Face';
import { faceLand, faceName } from './Register';

/** What a hide or show press is doing: nothing, waiting for the Atlas, or failed with nothing changed. */
export type OwnerPress = 'idle' | 'busy' | 'signed-out' | 'failed';

const failure = (press: OwnerPress) =>
  press === 'signed-out' ? 'Sign in again to change this.' : press === 'failed' ? 'Nothing changed. Try again in a moment.' : null;

/**
 * The quiet line on a streamer's own card, shown only to the signed-in broadcaster of that channel: "Your channel"
 * and one press to leave the map. No confirmation step: showing it again is one press too.
 */
export function OwnerLine(props: { press: OwnerPress; onHide: () => void }) {
  return (
    <div class="atlas-owner-line" data-atlas-owner="line">
      <span class="atlas-owner-mine">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="13" cy="13" r="5.5" /><circle class="atlas-key-brass" cx="13" cy="13" r="2.3" /><path d="m17 17 14 14m-4-4 3-3m0 6 3-3" /></svg>
        Your channel
      </span>
      <button type="button" class="atlas-owner-hide" aria-busy={props.press === 'busy'} disabled={props.press === 'busy'} on:click={() => props.onHide()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM3 13L13 3" /><circle cx="8" cy="8" r="1.8" /></svg>
        {props.press === 'busy' ? 'Hiding…' : 'Hide my channel'}
      </button>
      <Show when={failure(props.press)}>{(text) => <p class="atlas-owner-failed" role="status">{text()}</p>}</Show>
    </div>
  );
}

/**
 * A hidden channel's card, for its own broadcaster's eyes only: the public map, search and roads no longer show it,
 * so this is the one place it is still drawn, with one press to bring it back. It never says why anything else is so.
 */
export function OwnerCard(props: {
  card: CardReply | null;
  channelId: string;
  world: PreviewWorld;
  /** Shown again by its owner, yet still off the map (the operator's list holds it). */
  heldBack: boolean;
  press: OwnerPress;
  onShow: () => void;
  onClose: () => void;
}) {
  let close: HTMLButtonElement | undefined;
  let show: HTMLButtonElement | undefined;
  const face = () => props.card?.channel ?? null;
  const land = () => (face() ? faceLand(face()!, props.world) : null);
  createEffect(() => {
    void props.channelId;
    queueMicrotask(() => (show ?? close)?.focus({ preventScroll: true }));
  });
  const onKey = (event: KeyboardEvent) => {
    const map = close?.closest('[data-chatdom-atlas]');
    if (map && event.target instanceof Node && !map.contains(event.target)) return;
    if (event.key === 'Escape') props.onClose();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  return (
    <section class="atlas-card atlas-card-with-actions atlas-owner-card" aria-labelledby="atlas-card-title" data-kind="owner" data-atlas-owner={props.heldBack ? 'held' : 'hidden'}>
      <button ref={(element) => (close = element)} class="atlas-card-close" type="button" on:click={() => props.onClose()} aria-label="Close card">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
      <header class="atlas-card-head">
        <ChannelFaceSeal channelId={props.channelId} name={face()?.name ?? null} portrait={props.card?.portrait ?? null} />
        <div class="atlas-card-names">
          <p class="atlas-card-status">{props.heldBack ? 'Your channel' : 'Hidden by you'}</p>
          <h2 id="atlas-card-title" dir="auto">{face() ? faceName(face()!) : 'Your channel'}</h2>
          <Show when={face()?.login && face()?.name && face()!.name!.toLowerCase() !== face()!.login}>
            <p class="atlas-card-login">{face()!.login}</p>
          </Show>
        </div>
      </header>
      <div class="atlas-card-scroll" tabindex="0" aria-label="Your channel">
        <Show when={land()}>{(name) => <dl class="atlas-card-facts"><div><dt>Its place</dt><dd>{name()}</dd></div></dl>}</Show>
        <p class="atlas-card-note atlas-owner-note">
          {props.heldBack ? 'It stays off the map for now.' : 'Only you see this card. Nobody finds your channel on the map, in search or on roads.'}
        </p>
      </div>
      <footer class="atlas-card-footer">
        <Show when={!props.heldBack}>
          <div class="atlas-card-actions">
            <button ref={(element) => (show = element)} type="button" class="atlas-button atlas-owner-show" aria-busy={props.press === 'busy'} disabled={props.press === 'busy'} on:click={() => props.onShow()}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.8" /></svg>
              {props.press === 'busy' ? 'Showing…' : 'Show my channel'}
            </button>
            <Show when={failure(props.press)}>{(text) => <p class="atlas-owner-failed" role="status">{text()}</p>}</Show>
          </div>
        </Show>
      </footer>
    </section>
  );
}
