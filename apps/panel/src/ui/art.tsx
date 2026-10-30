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
    <radialGradient id="cp-ember" cx="50%" cy="80%" r="75%">
      <stop offset="0" stop-color="#d9873a" /><stop offset=".6" stop-color="#7a3c1e" /><stop offset="1" stop-color="#2b1f2c" />
    </radialGradient>
    <radialGradient id="cp-table-top" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#8a5d38" /><stop offset=".7" stop-color="#5e3d24" /><stop offset="1" stop-color="#3f2817" />
    </radialGradient>
    <radialGradient id="cp-candle" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffd890" stop-opacity=".9" /><stop offset="1" stop-color="#ffb04a" stop-opacity="0" />
    </radialGradient>
    <clipPath id="cp-pane-clip" clipPathUnits="userSpaceOnUse"><path d="M10 38.5V17.5a10 10 0 0 1 20 0v21Z" /></clipPath>
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

/**
 * An arched four-pane window. Lit, it glows with someone home. Kindling, its panes
 * catch one after another; an ember is a window resting or unconfirmed, warm but low.
 */
export function WindowGlyph(props: { lit: boolean; pending?: boolean; ember?: boolean; kindling?: boolean }) {
  return <svg class="cp-window-glyph" classList={{ lit: props.lit, pending: !!props.pending, ember: !!props.ember, kindling: !!props.kindling }} viewBox="0 0 40 44" aria-hidden="true">
    <path class="frame" d="M7 41V17a13 13 0 0 1 26 0v24Z" />
    <path class="pane" d="M10 38.5V17.5a10 10 0 0 1 20 0v21Z" />
    <g class="panes-lit" clip-path="url(#cp-pane-clip)">
      <rect class="pane-lit" x="10" y="7" width="10" height="17" />
      <rect class="pane-lit" x="20" y="7" width="10" height="17" />
      <rect class="pane-lit" x="10" y="24" width="10" height="15" />
      <rect class="pane-lit" x="20" y="24" width="10" height="15" />
    </g>
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

export function ForgeGlyph() {
  return <svg class="cp-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 10.5h12.5c0 2-1.6 3.2-3.8 3.6v2.4h1.8v2.5H7.6v-2.5h1.8v-2.4c-2.6-.4-4.9-1.8-4.9-3.6Z" /><path d="M17 10.5h2.5" /><path d="m15.5 4.5-1 2.2m3.4-.8-1.9 1.6m-3.6-3.4.2 2.3" /></svg>;
}

/** Leaves Twitch: an arrow out of a frame, beside every link that opens chatdom.gg. */
export function LeaveGlyph() {
  return <svg class="cp-glyph leave" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5h5v5M18.5 5.5 11 13" /><path d="M16.5 13.5v4a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V9.5A1.5 1.5 0 0 1 7 8h4" /></svg>;
}

/**
 * A tavern table from above: the round top, a candle when a game is on, and its seats.
 * Taken seats glow warm, free ones are empty rings. Seats are a fact of the room, never a count of the audience.
 */
export function TableArt(props: { seats: number; taken: number; playing: boolean }) {
  const seat = (i: number) => {
    const angle = -Math.PI / 2 + (i / props.seats) * Math.PI * 2;
    return { x: 24 + Math.cos(angle) * 18, y: 24 + Math.sin(angle) * 18 };
  };
  return <svg class="cp-table-art" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="25" r="12.5" fill="#0006" />
    <circle cx="24" cy="24" r="12" fill="url(#cp-table-top)" stroke="#2e1d11" stroke-width="1.2" />
    <circle cx="24" cy="24" r="9" fill="none" stroke="#c99a5c" stroke-width=".5" opacity=".45" />
    <Show when={props.playing}>
      <circle cx="24" cy="24" r="7" fill="url(#cp-candle)" />
      <circle cx="24" cy="24" r="1.6" fill="#fff1c9" />
    </Show>
    {Array.from({ length: props.seats }, (_, i) => {
      const { x, y } = seat(i);
      return i < props.taken
        ? <circle class="seat taken" cx={x} cy={y} r="3.4" />
        : <circle class="seat" cx={x} cy={y} r="3" />;
    })}
  </svg>;
}

/**
 * The forge from the street: a brick hearth, fire or banked embers, and its anvils.
 * Working anvils carry a glowing piece and sparks; idle ones stand cold.
 */
export function ForgeArt(props: { burning: boolean; total: number; working: number }) {
  const width = 280, spacing = Math.min(64, (width - 40) / Math.max(1, props.total));
  const start = width / 2 - (spacing * (props.total - 1)) / 2;
  return <svg class="cp-forge-art" classList={{ burning: props.burning }} viewBox={`0 0 ${width} 92`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <radialGradient id="cp-fire" cx="50%" cy="85%" r="70%">
        <stop offset="0" stop-color="#fff0c0" /><stop offset=".3" stop-color="#ffb04a" /><stop offset=".7" stop-color="#c2461c" /><stop offset="1" stop-color="#3a1810" />
      </radialGradient>
      <radialGradient id="cp-banked" cx="50%" cy="90%" r="70%">
        <stop offset="0" stop-color="#b8542a" /><stop offset=".45" stop-color="#5a2416" /><stop offset="1" stop-color="#1c0f0b" />
      </radialGradient>
      <radialGradient id="cp-forge-wash" cx="50%" cy="40%" r="60%">
        <stop offset="0" stop-color="#ff9a3c" stop-opacity=".35" /><stop offset="1" stop-color="#ff9a3c" stop-opacity="0" />
      </radialGradient>
      <pattern id="cp-brick" width="20" height="10" patternUnits="userSpaceOnUse">
        <rect width="20" height="10" fill="#5a3324" />
        <path d="M0 .5h20M0 5.5h20M10 .5v5M0 5.5v5M20 5.5v5" stroke="#2a160f" stroke-width="1" />
        <path d="M1 1.5h8M11 6.5h8" stroke="#8a5a3e" stroke-width=".6" opacity=".6" />
      </pattern>
    </defs>
    <rect width={width} height="92" fill="#1a110c" />
    <Show when={props.burning}><rect width={width} height="92" fill="url(#cp-forge-wash)" /></Show>
    {/* The hearth: a brick arch with the fire or the banked embers inside. */}
    <path d={`M${width / 2 - 62} 62V28a62 22 0 0 1 124 0v34Z`} fill="url(#cp-brick)" />
    <path d={`M${width / 2 - 36} 62V36a36 16 0 0 1 72 0v26Z`} fill={props.burning ? 'url(#cp-fire)' : 'url(#cp-banked)'} />
    <path d={`M${width / 2 - 36} 62V36a36 16 0 0 1 72 0v26`} fill="none" stroke="#1a0d08" stroke-width="2.5" />
    <Show when={props.burning}>
      <path class="flame" d={`M${width / 2 - 14} 62c-2-10 6-12 5-22 6 6 9 10 9 16 3-4 2-8 1-12 7 6 9 12 7 18Z`} fill="#ffd27a" opacity=".85" />
    </Show>
    <rect y="62" width={width} height="30" fill="#2a1c14" />
    <path d={`M0 62.5h${width}`} stroke="#6a4a32" stroke-width="1" opacity=".7" />
    {Array.from({ length: props.total }, (_, i) => {
      const x = start + i * spacing, hot = i < props.working;
      return <g transform={`translate(${x} 0)`} classList={{ anvil: true, hot }}>
        <ellipse cx="0" cy="86" rx="17" ry="3" fill="#0008" />
        <path d="M-16 66h26c4 0 9-1.5 11-4h-5v-1H-16Z" fill={hot ? '#5d5f66' : '#45464c'} transform="translate(0 4)" />
        <path d="M-9 71h14v5h4v8h-22v-8h4Z" fill={hot ? '#4b4c52' : '#38393e'} />
        <path d="M-16 69.5h26" stroke={hot ? '#ffcf8a' : '#7d7f86'} stroke-width="1" opacity={hot ? '.9' : '.5'} />
        <Show when={hot}>
          <rect x="-8" y="66.5" width="12" height="3" rx="1" fill="#ffb24d" />
          <g class="sparks"><circle cx="-2" cy="60" r="1" /><circle cx="5" cy="57" r=".8" /><circle cx="-7" cy="56" r=".7" /><circle cx="1" cy="52" r=".6" /></g>
        </Show>
      </g>;
    })}
  </svg>;
}

/** A coal in the scuttle: held and warm, or an empty place. */
export function CoalArt(props: { held: boolean; damp?: boolean }) {
  return <svg class="cp-coal" classList={{ held: props.held, damp: !!props.damp }} viewBox="0 0 28 22" aria-hidden="true">
    <ellipse cx="14" cy="19" rx="11" ry="2.4" fill="#0007" />
    <Show when={props.held} fallback={<path d="M5 14.5 8 7.5l6-3 7 2.5 2.5 7-4 4.5H9.5Z" fill="none" stroke="#8d6a45" stroke-width="1" stroke-dasharray="2 2" />}>
      <path d="M5 14.5 8 7.5l6-3 7 2.5 2.5 7-4 4.5H9.5Z" fill="#231a17" stroke="#0d0907" stroke-width="1" />
      <path d="M8 7.5l6-3 7 2.5-5 3Z" fill="#3a2e2a" />
      <path class="heat" d="M10 16.5l3-4 4 1.5 3-3" fill="none" stroke="#ff9d42" stroke-width="1.1" stroke-linecap="round" />
    </Show>
  </svg>;
}
