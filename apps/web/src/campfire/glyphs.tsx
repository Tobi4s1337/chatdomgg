import type { JSX } from 'solid-js';
import type { DuskCourtRole } from '@chatdom/shared';

/*
 * Inked marks for the campfire, drawn for it in one hand: round caps, one stroke weight, no fills except the warm dot
 * that means a flame. They inherit currentColor so they sit on parchment or brass alike.
 */

export type GlyphName = DuskCourtRole | 'magistrate' | 'gallery' | 'lantern' | 'lantern-out' | 'ember';

const PATHS: Record<GlyphName, () => JSX.Element> = {
  // A wolf's head in profile: pricked ears, a long muzzle.
  wolf: () => <><path d="M5 19.5 6.5 13 5 5.5l4 3.5h4.5L17 6l-.5 5 3.5 3-2.5 1.5H14l-2 4Z" /><circle cx="13.6" cy="11" r=".8" fill="currentColor" stroke="none" /></>,
  // An open eye under a watchman's lantern brim.
  watchman: () => <><path d="M3 13c2.6-4 5.6-6 9-6s6.4 2 9 6c-2.6 4-5.6 6-9 6s-6.4-2-9-6Z" /><circle cx="12" cy="13" r="2.6" /><path d="M8 4.5h8" /></>,
  // A cottage with a crooked chimney and a lit window.
  townsfolk: () => <><path d="M4.5 20.5v-8l7.5-6.5 7.5 6.5v8Z" /><path d="M15.5 9V5.2h2.2v5.7" /><path d="M10.2 20.5v-4.3h3.6v4.3" /><rect x="7" y="12.6" width="2.6" height="2.4" fill="currentColor" stroke="none" opacity=".8" /></>,
  magistrate: () => <><path d="M4.5 17.5 3.5 8.5l5 4 3.5-6.5 3.5 6.5 5-4-1 9Z" /><path d="M5 20.5h14" /></>,
  gallery: () => <><path d="M3.5 18c1.6-3 3.6-4.5 6-4.5s4.4 1.5 6 4.5" /><circle cx="9.5" cy="9" r="2.7" /><path d="M15.5 13.6c1.3-.2 2.5 0 3.5.7 1 .7 1.6 1.9 2 3.2" /><circle cx="16.5" cy="9.5" r="2.1" /></>,
  lantern: () => <><path d="M9 7.5h6l1 9.5H8Z" /><path d="M10 7.5 12 4.5l2 3" /><path d="M7.5 19.5h9" /><path d="M12 15.8c-1.5-1-1.4-2.6 0-4 1.4 1.4 1.5 3 0 4Z" fill="currentColor" stroke="none" /></>,
  'lantern-out': () => <><path d="M9 7.5h6l1 9.5H8Z" /><path d="M10 7.5 12 4.5l2 3" /><path d="M7.5 19.5h9" /><path d="M12 14.5c-.8-.8.8-1.6 0-2.6" opacity=".7" /></>,
  ember: () => <><path d="M12 19.5c-3.5 0-5-2.3-5-4.6 0-3 3-4.4 4-8.4 2.2 1.8 6 5 6 8.6 0 2.4-1.6 4.4-5 4.4Z" /><path d="M12 17.5c-1.3 0-2-.9-2-1.8 0-1.3 1.3-1.8 2-3.3 1 .9 2 1.9 2 3.3 0 1-.7 1.8-2 1.8Z" fill="currentColor" stroke="none" opacity=".75" /></>,
};

export function Glyph(props: { name: GlyphName; class?: string; title?: string }) {
  return <svg class={`campfire-glyph ${props.class ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden={props.title ? undefined : 'true'} role={props.title ? 'img' : undefined}>
    {props.title ? <title>{props.title}</title> : null}
    {PATHS[props.name]()}
  </svg>;
}
