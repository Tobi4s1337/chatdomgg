import { Show, type JSX } from 'solid-js';
import type { FoundedKingdom } from '../data/kingdoms';
import { GateIcon, walkPath } from './Register';
import { OPENING_LINE, WAY_IN_LABEL } from './opening';

/**
 * The always-visible way from the map into Chatdom, carved into the title plate under the search: it walks
 * straight into a founded kingdom (the door's first), whose gate asks for Twitch sign-in. Without a founded
 * kingdom to lead to it is not drawn at all, never as a dead link.
 */
export function WayIn(props: { kingdom: FoundedKingdom | null }): JSX.Element {
  return (
    <Show when={props.kingdom}>
      {(kingdom) => (
        <a class="atlas-way-in" href={walkPath(kingdom().kingdomId)} data-atlas-walk="way-in" data-atlas-chrome="way-in">
          <GateIcon />
          <span class="atlas-way-in-label">{WAY_IN_LABEL}</span>
          <span class="atlas-way-in-name" dir="auto">{kingdom().name}</span>
          <svg class="atlas-way-in-go" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
        </a>
      )}
    </Show>
  );
}

/** The one-line opening caption: a parchment slip under the title plate, gone at the first card or its ×. */
export function Opening(props: { onDismiss: () => void }): JSX.Element {
  return (
    <p class="atlas-opening" role="note" data-atlas-chrome="opening">
      <span>{OPENING_LINE}</span>
      <button type="button" class="atlas-opening-x" aria-label="Dismiss" on:click={() => props.onDismiss()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>
      </button>
    </p>
  );
}
