import { createUniqueId } from 'solid-js';

/**
 * The card's small inked marks: one family, drawn for the card at a 24-unit grid with a 1.6 nib, round ends.
 * They sit beside facts as an engraver's marginalia, never as the fact itself.
 */
const PATHS = {
  /** A hanging lantern: following, the light they keep here. */
  follow: 'M12 2.8v2.4M9 5.2h6M8.2 8.4c0-1.8 1.7-3.2 3.8-3.2s3.8 1.4 3.8 3.2v7.2c0 1.6-1.7 2.9-3.8 2.9s-3.8-1.3-3.8-2.9zM8.2 9.4h7.6M8.2 14.6h7.6M12 11.2c-.9 1-.9 2 0 2.6.9-.6.9-1.6 0-2.6zM10 18.4l-.6 2.6h5.2l-.6-2.6',
  /** A pennant on a staff: a subscription, flown for them. */
  subscribed: 'M6.5 3v18M6.5 4.2h11.2l-3 3.9 3 3.9H6.5M9.4 7.2l1 .9-1 .9',
  /** A gabled house with a lit door. */
  home: 'M3.6 11.4 12 4.4l8.4 7M5.8 9.6V20h12.4V9.6M10.2 20v-4.6a1.8 1.8 0 0 1 3.6 0V20M16.4 6.2V4.2h1.8v3.5',
  /** A crown: the monarch's own seat. */
  crown: 'M4 17.5h16M4.8 17.5 3.6 8l4.6 4L12 5.5l3.8 6.5 4.6-4-1.2 9.5M12 13.2v.1',
  /** A rosette with two tails: what they earned and wear. */
  worn: 'M12 3.6a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2zM12 6.4a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM9.5 12.2 7.8 20.4l2.6-1.4 1.4 2.4.6-6M14.5 12.2l1.7 8.2-2.6-1.4-1.4 2.4-.6-6',
  /** A quill, for a card still being read. */
  quill: 'M19.5 3.5c-6 1-10.5 5.6-12.2 12.6M19.5 3.5c-.4 5.2-4.4 9.6-10.6 11.1M7.3 16.1 5 20.5M9.6 10.8l3.4.6M11.6 7.8l3 .5',
} as const;

export type MarkName = keyof typeof PATHS;

export function Mark(props: { name: MarkName; class?: string }) {
  return <svg class={`cc-mark ${props.class ?? ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[props.name]} /></svg>;
}

/** A cast brass corner with two rivets, drawn once and turned for each corner. */
export function BrassCorner(props: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const id = `cc-brass-${createUniqueId()}`;
  return <svg class={`cc-corner cc-corner--${props.corner}`} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f6dd97" /><stop offset=".28" stop-color="#cf9f48" />
        <stop offset=".62" stop-color="#9a6c26" /><stop offset="1" stop-color="#5e3f14" />
      </linearGradient>
      <radialGradient id={`${id}-rivet`} cx=".35" cy=".3" r=".75">
        <stop offset="0" stop-color="#fff0be" /><stop offset=".45" stop-color="#c8963e" /><stop offset="1" stop-color="#4f3410" />
      </radialGradient>
    </defs>
    <path d="M2 2h50c2 0 3 1.2 2.4 3.1L50 14c-.8 2-2.4 2.8-4.6 2.8H22c-3 0-5.2 2.2-5.2 5.2v23.4c0 2.2-.8 3.8-2.8 4.6L5.1 54.4C3.2 55 2 54 2 52z"
      fill={`url(#${id})`} stroke="#3d2a0e" stroke-width="1.4" />
    <path d="M5.5 5.5h44.6M5.5 5.5v44.6" stroke="#fff3c6" stroke-opacity=".55" stroke-width="1.2" fill="none" />
    <path d="M9 9.5h33M9.5 9v33" stroke="#5a3d12" stroke-opacity=".5" stroke-width=".9" fill="none" stroke-dasharray="1.6 2.4" />
    <circle cx="11" cy="11" r="3.3" fill={`url(#${id}-rivet)`} stroke="#3d2a0e" stroke-width=".8" />
    <circle cx="36" cy="10" r="2.4" fill={`url(#${id}-rivet)`} stroke="#3d2a0e" stroke-width=".7" />
    <circle cx="10" cy="36" r="2.4" fill={`url(#${id}-rivet)`} stroke="#3d2a0e" stroke-width=".7" />
  </svg>;
}

/** An inked flourish that parts the name from the facts. */
export function Flourish() {
  return <svg class="cc-flourish" viewBox="0 0 240 18" aria-hidden="true" preserveAspectRatio="xMinYMid meet">
    <path d="M2 9h86c8 0 10-6 16-6s7 5 3 6.6c-3 1.2-6-1.2-3.8-3.4M238 9h-86c-8 0-10 6-16 6s-7-5-3-6.6c3-1.2 6 1.2 3.8 3.4M112 9c2.6-3.6 5.4-5.4 8-5.4s5.4 1.8 8 5.4c-2.6 3.6-5.4 5.4-8 5.4s-5.4-1.8-8-5.4z" />
  </svg>;
}
