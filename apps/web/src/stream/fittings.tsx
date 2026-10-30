// Code-drawn fittings for the stream frames: the kingdom's crest and the brass corner
// plates. Same family as the panel: brass strokes on dark walnut, no stock icons.

/** Gradients for the brass, defined once per page. */
export function StreamDefs() {
  return <svg class="stream-defs" aria-hidden="true" width="0" height="0">
    <linearGradient id="stream-brass" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f3d69c" /><stop offset=".35" stop-color="#c69a5c" /><stop offset=".7" stop-color="#8d6537" /><stop offset="1" stop-color="#5f4224" />
    </linearGradient>
    <linearGradient id="stream-enamel" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#3a2a4a" /><stop offset="1" stop-color="#1c1626" />
    </linearGradient>
  </svg>;
}

/** The kingdom's crest: its keep with a flame above, on a shield. It belongs to the kingdom, not to Chatdom. */
export function Crest(props: { class?: string }) {
  return <svg class={`stream-crest ${props.class ?? ''}`} viewBox="0 0 48 56" aria-hidden="true">
    <path d="M4 5h40v22c0 13-9 21-20 26C13 48 4 40 4 27Z" fill="url(#stream-enamel)" stroke="url(#stream-brass)" stroke-width="2.4" stroke-linejoin="round" />
    <path d="M8.5 9h31v18c0 10.5-7 17-15.5 21.2C15.5 44 8.5 37.5 8.5 27Z" fill="none" stroke="#c69a5c" stroke-width=".7" opacity=".45" />
    <g fill="none" stroke="#efcf95" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
      <path d="M14.5 26h4.2v-3.4H22V26h4v-3.4h3.3V26h4.2v12.6L24 43.8l-9.5-5.2Z" />
      <path d="M21 37.5v-5.3a3 3 0 0 1 6 0v5.3" />
    </g>
    <path d="M24 19.6c-3.6-2.5-2.2-5.4 0-7.2.3 3.1 3.7 3.7 0 7.2Z" fill="#f7c779" />
  </svg>;
}

/** A brass corner plate with one rivet, turned to its corner. */
export function Corner(props: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  return <svg class={`stream-corner ${props.at}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M1 1h22l-3 5H6v14l-5 3Z" fill="url(#stream-brass)" stroke="#2b1c10" stroke-width=".8" stroke-linejoin="round" />
    <path d="M2.6 2.6h17.6M2.6 2.6v17" stroke="#fff1cc" stroke-width=".6" opacity=".55" fill="none" />
    <circle cx="4.6" cy="4.6" r="1.5" fill="#4a321b" /><circle cx="4.3" cy="4.3" r=".6" fill="#f7deae" />
  </svg>;
}
