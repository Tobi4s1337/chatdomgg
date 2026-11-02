import { For, Show, type JSX } from 'solid-js';
import { provenanceLines, type Provenance } from './provenance';
import { STAGED_ALLOWED } from './staged';

/** The glyph pressed into each wax seal: a stage curtain (an owner's staged detail), a turning glass, a flame, a moon, a cracked seal. */
function SealGlyph(props: { state: Provenance }): JSX.Element {
  if (STAGED_ALLOWED && props.state === 'simulated') return <path d="M5 5.5h10M6 5.5c0 4 1.2 7 3 8.6M14 5.5c0 4-1.2 7-3 8.6M6 5.5v9M14 5.5v9" />;
  switch (props.state) {
    case 'connecting': return <path d="M6.5 4.5h7M6.5 15.5h7M7.5 4.5c0 3 5 3.8 5 5.5s-5 2.5-5 5.5M12.5 4.5c0 3-5 3.8-5 5.5s5 2.5 5 5.5" />;
    case 'live': return <path d="M10 15.2c-2.6 0-3.9-1.7-3.9-3.6 0-2.4 2.3-3.4 2.6-6.3 1.8 1.2 2.1 2.7 1.8 4 1-.4 1.6-1.2 1.8-2 1.2 1.2 1.6 2.6 1.6 4.2 0 2-1.4 3.7-3.9 3.7Z" />;
    case 'resting': return <path d="M12.6 4.6a5.6 5.6 0 1 0 2.8 9.2 4.6 4.6 0 0 1-2.8-9.2Z" />;
    case 'lost': return <path d="M10 4.2 8.6 7.6l2.3 1.6-1.8 3 1.4 3.6M5.6 9.4h2.2M12.6 11.6h2" />;
    default: return null;
  }
}

function Seal(props: { state: Provenance; small?: boolean }): JSX.Element {
  return <svg class="cd-seal" classList={{ 'cd-seal-small': !!props.small }} data-seal={props.state} viewBox="0 0 20 20" aria-hidden="true">
    <path class="cd-seal-wax" d="M10 .9c1.4 0 2 1 3.2 1.3 1.3.3 2.5-.3 3.4.6s.5 2 .9 3.2c.4 1.2 1.4 1.8 1.4 3.3s-1 2-1.3 3.2c-.3 1.3.3 2.4-.6 3.3s-2.1.5-3.3.9c-1.2.4-1.8 1.4-3.3 1.4s-2.1-1-3.3-1.4c-1.2-.4-2.4 0-3.3-.9s-.4-2-.8-3.3C2.6 12.1 1 11.4 1 10s1.2-2.1 1.5-3.3c.3-1.2-.3-2.4.6-3.3.9-.9 2-.4 3.2-.8C7.6 2.2 8.5.9 10 .9Z" />
    <circle class="cd-seal-rim" cx="10" cy="10" r="6.9" />
    <g class="cd-seal-glyph"><SealGlyph state={props.state} /></g>
  </svg>;
}

/**
 * One quiet parchment slip that tells where the people on this surface come from. Purely presentational: the
 * owner passes the real feed state, whether staged content is on screen and any product note; the seal never
 * infers any of them. A real feed always presses its one line. With no lines (a staged night without an owner's
 * detail) the element stays in place, with the same role and data attributes for stable references, but is
 * hidden so nothing shows. `data-practice` stays `true` whenever the owner reports staged content.
 */
export function ProvenanceSeal(props: { state: Provenance; simulated?: boolean; detail?: string; class?: string }): JSX.Element {
  const lines = () => provenanceLines(props);
  const empty = () => lines().length === 0;
  return <div class={`cd-provenance${props.class ? ` ${props.class}` : ''}`} role="status" aria-atomic="true"
    data-provenance={props.state} data-practice={STAGED_ALLOWED && (props.state === 'simulated' || props.simulated) ? 'true' : undefined}
    hidden={empty()} style={{ display: empty() ? 'none' : undefined }}>
    <For each={lines()}>{(line, index) => <p class="cd-provenance-line" data-seal={line.seal}>
      <Seal state={line.seal} small={index() > 0} />
      <span class="cd-provenance-words"><strong class="cd-provenance-word">{line.word}</strong><Show when={line.note}><small class="cd-provenance-note">{line.note}</small></Show></span>
    </p>}</For>
  </div>;
}
