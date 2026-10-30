import type { JSX } from 'solid-js';
import type { DuskCourtRole } from './ports';

/*
 * Inked marks for the campfire, drawn for it in one hand: round caps, one stroke weight, no fills
 * except the warm dot that means a flame. They inherit currentColor so they sit on parchment or
 * brass alike.
 */

export type GlyphName = DuskCourtRole | 'magistrate' | 'quill' | 'voice' | 'gallery' | 'lantern' | 'lantern-out' | 'ember';

const PATHS: Record<GlyphName, () => JSX.Element> = {
  // A snuffer's cone on its long handle, settling over a wick.
  snuffer: () => <><path d="M5 19h14" /><path d="M12 19v-4" /><path d="M8.5 11.5 12 6l3.5 5.5Z" /><path d="M14 8.6 20 4.5" /><path d="M12 14.2c-.9-.6-.9-1.4 0-2" opacity=".6" /></>,
  // An open eye under a watchman's lantern brim.
  watchman: () => <><path d="M3 13c2.6-4 5.6-6 9-6s6.4 2 9 6c-2.6 4-5.6 6-9 6s-6.4-2-9-6Z" /><circle cx="12" cy="13" r="2.6" /><path d="M8 4.5h8" /></>,
  // A lantern lifted on a lamplighter's hooked pole.
  lamplighter: () => <><path d="M5 21 15 6.5" /><path d="M15 6.5c1-1.6 3-1.8 4-.4" /><path d="M17 8.5v2" /><path d="M15 11h4l-.5 5.5h-3Z" /><circle cx="17" cy="13.8" r=".9" fill="currentColor" stroke="none" /></>,
  // A fool's cap of three points, each with its bell.
  fool: () => <><path d="M5 18c0-3 3-4 7-4s7 1 7 4Z" /><path d="M6 15 3.5 7.5 9 13" /><path d="M12 14 12 4.5" /><path d="M18 15l2.5-7.5L15 13" /><circle cx="3.5" cy="6.5" r="1.1" /><circle cx="12" cy="3.6" r="1.1" /><circle cx="20.5" cy="6.5" r="1.1" /></>,
  // A cottage with a crooked chimney and a lit window.
  townsfolk: () => <><path d="M4.5 20.5v-8l7.5-6.5 7.5 6.5v8Z" /><path d="M15.5 9V5.2h2.2v5.7" /><path d="M10.2 20.5v-4.3h3.6v4.3" /><rect x="7" y="12.6" width="2.6" height="2.4" fill="currentColor" stroke="none" opacity=".8" /></>,
  magistrate: () => <><path d="M4.5 17.5 3.5 8.5l5 4 3.5-6.5 3.5 6.5 5-4-1 9Z" /><path d="M5 20.5h14" /></>,
  quill: () => <><path d="M20 3.5C12.5 5 7.5 10.5 5.5 18.5" /><path d="M20 3.5c-.5 5.5-4.5 10-10.5 11.5" /><path d="M4 20.5l1.5-2" /></>,
  voice: () => <><path d="M9 9.5v5" /><path d="M12 7v10" /><path d="M15 9.5v5" /><path d="M6 11v2" /><path d="M18 11v2" /></>,
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
