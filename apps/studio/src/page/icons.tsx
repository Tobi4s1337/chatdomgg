// Icons. Twitch's own icons are read at run time from the reference capture in the media folder (never committed);
// the few the logged-out capture cannot show (whispers, a filled heart, the hype train, the raid and sub marks) are
// our own drawings below, in Twitch's 20 px icon grid.
import type { JSX } from 'solid-js';
import { MEDIA } from '../types';

export type TwitchIcon =
  | 'logo' | 'kebab' | 'search' | 'prime' | 'user' | 'collapse-left' | 'collapse-right' | 'community' | 'gift' | 'star'
  | 'viewers' | 'share' | 'verified' | 'popout' | 'settings' | 'bits' | 'emote' | 'info' | 'reply' | 'reply-button'
  | 'heart' | 'chevron' | 'points' | 'bell';

let table: Record<string, string> = {};

/** Loads Twitch's icons once; the page waits for this before its first frame. */
export const iconsReady: Promise<void> = fetch(`${MEDIA}/reference/icons/icons.json`)
  .then(res => (res.ok ? res.json() : {}))
  .then((json: Record<string, string>) => {
    // The logo carries hover animations; a still frame needs none of them.
    table = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.replace(/<\/?animate\w*\b[^>]*>/g, '')]));
  })
  .catch(() => { table = {}; });

/** One of Twitch's icons at `size` CSS px, coloured by `fill` (currentColor by default). */
export function Icon(props: { name: TwitchIcon; size: number; fill?: string; class?: string }): JSX.Element {
  return (
    <span class={`tw-svg ${props.class ?? ''}`} style={{ width: `${props.size}px`, height: `${props.size}px`, fill: props.fill ?? 'currentColor' }}
      innerHTML={table[props.name] ?? ''} />
  );
}

/** Our own drawings for what the capture could not show. All on a 24 unit grid like Twitch's. */
const OWN = {
  whispers: 'M3 4h18v13h-6.586L12 19.414 9.586 17H3V4Zm2 2v9h5.414L12 16.586 13.586 15H19V6H5Z',
  'heart-filled': 'M12 6.429 13.036 5.423A5.076 5.076 0 0 1 16.57 4H17c2.761 0 5 2.175 5 4.857v.417a4.788 4.788 0 0 1-1.465 3.434L12 21l-8.536-8.292A4.788 4.788 0 0 1 2 9.274v-.417C2 6.175 4.239 4 7 4h.429c1.326 0 2.597.512 3.535 1.422L12 6.429Z',
  'star-filled': 'M12 2.5l2.94 6.24 6.81.85-5 4.72 1.27 6.75L12 17.77l-6.02 3.29 1.27-6.75-5-4.72 6.81-.85L12 2.5Z',
  train: 'M6 3h9a4 4 0 0 1 4 4v8a3 3 0 0 1-2.02 2.84L19 20v1h-2.2l-2.1-3H9.3l-2.1 3H5v-1l2.02-2.16A3 3 0 0 1 5 15V4a1 1 0 0 1 1-1Zm1 3v5h10V7a1 1 0 0 0-1-1H7Zm1.5 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  raid: 'M4 20h16v-2H4v2Zm1.5-4h13l1.5-9-4.5 3.5L12 4l-3.5 6.5L4 7l1.5 9Z',
  megaphone: 'M3 9v6h3l6 4V5L6 9H3Zm11-1.5v9a4.5 4.5 0 0 0 0-9ZM14 3v2a7 7 0 0 1 0 14v2a9 9 0 0 0 0-18Z',
  sparkle: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Zm6 11 .9 2.6 2.6.9-2.6.9L18 20l-.9-2.6-2.6-.9 2.6-.9L18 13Z',
} as const;
export type OwnIcon = keyof typeof OWN;

export function OwnIcon(props: { name: OwnIcon; size: number; fill?: string; class?: string }): JSX.Element {
  return (
    <span class={`tw-svg ${props.class ?? ''}`} style={{ width: `${props.size}px`, height: `${props.size}px`, fill: props.fill ?? 'currentColor' }}>
      <svg viewBox="0 0 24 24" width="100%" height="100%"><path fill-rule="evenodd" d={OWN[props.name]} /></svg>
    </span>
  );
}
