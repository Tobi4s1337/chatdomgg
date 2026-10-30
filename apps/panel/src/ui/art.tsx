// Code-drawn fittings for the panel: the wax seal, the window, engraved glyphs and
// the closed shutters. One family: brass strokes, warm light, no emoji or stock icons.
import { Show } from 'solid-js';

/** Filters shared by the panel's parchment and wax: rough deckled edges, cast once per page. */
export function PanelDefs() {
  return <svg class="cp-defs" aria-hidden="true" width="0" height="0">
    <radialGradient id="cp-wax-fill" cx="38%" cy="32%" r="70%">
      <stop offset="0" stop-color="#b7473a" /><stop offset=".55" stop-color="#8a2a20" /><stop offset="1" stop-color="#5a1712" />
    </radialGradient>
    <radialGradient id="cp-glow" cx="50%" cy="62%" r="62%">
      <stop offset="0" stop-color="#fff0c4" /><stop offset=".45" stop-color="#ffc66e" /><stop offset="1" stop-color="#d47a2c" />
    </radialGradient>
    <filter id="cp-deckle" x="-4%" y="-8%" width="108%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="4" />
      <feDisplacementMap in="SourceGraphic" scale="3.2" />
    </filter>
    <filter id="cp-wax" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.18" numOctaves="2" seed="9" />
      <feDisplacementMap in="SourceGraphic" scale="2.4" />
    </filter>
  </svg>;
}

/** The kingdom's wax seal. `blank` is pressed without a crest: no kingdom has been told to us. */
export function Seal(props: { blank?: boolean }) {
  return <svg class="cp-seal" viewBox="0 0 48 48" aria-hidden="true">
    <g filter="url(#cp-wax)">
      <circle cx="24" cy="24" r="21.5" fill="url(#cp-wax-fill)" />
      <circle cx="24" cy="24" r="16.5" fill="none" stroke="#5c1a13" stroke-width="1.6" opacity=".55" />
      <circle cx="24" cy="24" r="16.5" fill="none" stroke="#e08c74" stroke-width=".6" opacity=".35" transform="translate(-.5 -.6)" />
    </g>
    <Show when={!props.blank} fallback={<circle cx="24" cy="24" r="9" fill="none" stroke="#e8a38e" stroke-width=".8" opacity=".3" />}>
      {/* The realm mark: a keep with a flame above it, the same mark the kingdom wears. */}
      <g fill="none" stroke-linejoin="round" stroke-linecap="round">
        <path d="M16.5 22.5h3v-2.5h2.4v2.5h4.2v-2.5h2.4v2.5h3v9.2L24 35.6l-7.5-3.9Z" stroke="#4d140e" stroke-width="2.1" transform="translate(.5 .7)" opacity=".7" />
        <path d="M16.5 22.5h3v-2.5h2.4v2.5h4.2v-2.5h2.4v2.5h3v9.2L24 35.6l-7.5-3.9Z" stroke="#f0b09c" stroke-width="1.2" />
        <path d="M21.6 31.6v-4.2h4.8v4.2" stroke="#f0b09c" stroke-width="1" />
        <path d="M24 18.4c-2.6-1.8-1.6-3.9 0-5.2.2 2.3 2.7 2.7 0 5.2Z" fill="#f6c9a0" stroke="none" />
      </g>
    </Show>
  </svg>;
}

/** An arched four-pane window. Lit, it glows with someone home. */
export function WindowGlyph(props: { lit: boolean; pending?: boolean }) {
  return <svg class="cp-window-glyph" classList={{ lit: props.lit, pending: !!props.pending }} viewBox="0 0 40 44" aria-hidden="true">
    <path class="frame" d="M7 41V17a13 13 0 0 1 26 0v24Z" />
    <path class="pane" d="M10 38.5V17.5a10 10 0 0 1 20 0v21Z" />
    <path class="pane-lit" d="M10 38.5V17.5a10 10 0 0 1 20 0v21Z" />
    <path class="mullion" d="M20 8v31M10 24h20" />
    <path class="sill" d="M4.5 41.5h31" />
  </svg>;
}

export function HomeGlyph() {
  return <svg class="cp-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5M6.5 10v9.5h11V10M10 19.5v-5h4v5" /><path d="M15.5 7.2V5h2v3.8" /></svg>;
}
export function TonightGlyph() {
  return <svg class="cp-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5a7.8 7.8 0 1 0 4 12.6 6.4 6.4 0 0 1-4-12.6Z" /><path d="m18.5 4 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 6l1.5-.5Z" /></svg>;
}
export function TavernGlyph() {
  return <svg class="cp-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8.5h10v11h-10Z" /><path d="M15.5 10.5h1.8a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-1.8" /><path d="M5.5 8.5C5.5 5.8 8 5 10.5 6c2-1.6 5-.6 5 2.5" /><path d="M8.5 11.5v5m4-5v5" /></svg>;
}
export function BackGlyph() {
  return <svg class="cp-glyph back" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" /></svg>;
}

/**
 * Closed shutters: the picture's frame when there is no picture to show.
 * Planks, iron strap hinges and a crescent cut, drawn in the same brass-and-wood family.
 */
export function Shutters() {
  const planks = [0, 1, 2, 3];
  return <svg class="cp-shutters" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="cp-plank" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#4a3424" /><stop offset=".5" stop-color="#3b2a1d" /><stop offset="1" stop-color="#2c1f16" />
      </linearGradient>
      <linearGradient id="cp-gap-light" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#f2b766" stop-opacity="0" /><stop offset=".5" stop-color="#f2b766" stop-opacity=".55" /><stop offset="1" stop-color="#f2b766" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect width="300" height="200" fill="#1b1410" />
    {[0, 1].map(side => <g transform={`translate(${side * 151} 0)`}>
      {planks.map(i => <g>
        <rect x={i * 37.25} y="0" width="36.5" height="200" fill="url(#cp-plank)" />
        <path d={`M${i * 37.25 + 6} 0v200M${i * 37.25 + 21} 0c3 60-2 120 1 200`} stroke="#5e4330" stroke-width=".7" opacity=".55" fill="none" />
        <path d={`M${i * 37.25 + 36.5} 0v200`} stroke="#140e0a" stroke-width="1.2" />
      </g>)}
      <path d="M0 24h149M0 176h149M6 30l137 140" stroke="#2a1e15" stroke-width="12" fill="none" />
      <path d="M0 24h149M0 176h149M6 30l137 140" stroke="#563d2a" stroke-width="10" fill="none" />
      <path d="M0 19.5h149M0 171.5h149" stroke="#7b5b3f" stroke-width="1" opacity=".6" fill="none" />
    </g>)}
    {/* Warm light through the gap between the shutters: someone is inside. */}
    <rect x="148.5" y="0" width="3" height="200" fill="url(#cp-gap-light)" />
    {[24, 176].map(y => <g>
      <rect x="10" y={y - 4} width="58" height="8" rx="2" fill="#24201d" />
      <rect x="10" y={y - 4} width="58" height="2" rx="1" fill="#5b544b" opacity=".5" />
      <circle cx="18" cy={y} r="1.6" fill="#8d8172" /><circle cx="56" cy={y} r="1.6" fill="#8d8172" />
      <rect x="232" y={y - 4} width="58" height="8" rx="2" fill="#24201d" />
      <rect x="232" y={y - 4} width="58" height="2" rx="1" fill="#5b544b" opacity=".5" />
      <circle cx="244" cy={y} r="1.6" fill="#8d8172" /><circle cx="282" cy={y} r="1.6" fill="#8d8172" />
    </g>)}
    {/* A crescent cut through the left shutter, lit from within. */}
    <path d="M80 78a15 15 0 1 0 10 26 12 12 0 0 1-10-26Z" fill="#e9a352" opacity=".85" />
    <path d="M80 78a15 15 0 1 0 10 26 12 12 0 0 1-10-26Z" fill="none" stroke="#120d09" stroke-width="2" />
  </svg>;
}
