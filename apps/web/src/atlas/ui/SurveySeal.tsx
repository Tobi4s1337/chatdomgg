import { createSignal, createUniqueId, onCleanup, onMount, Show } from 'solid-js';
import type { PreviewWorld } from '../data/preview';
import { formatDay, formatTime } from './format';
import { liveLine, type LiveSummary } from './live-line';
import './survey-seal.css';

/** A date and one quiet explanation; the host's footer owns the longer How it works sheet. */
export function SurveySeal(props: { world: PreviewWorld; summary: LiveSummary | null; still: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);
  const id = createUniqueId();
  let host!: HTMLDivElement;
  const observed = () => props.summary?.status.frameAsOf;
  const tone = () => props.summary ? liveLine(props.summary).tone : 'quiet';
  const live = () => observed() != null ? `${tone() === 'fresh' ? 'Live' : 'Held'} ${formatTime(observed()!)}` : 'Live unavailable';
  const description = () => props.still ? 'Still of land awaiting founding.' : 'Survey of land awaiting founding.';
  onMount(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.contains(event.target)) { setOpen(false); setPinned(false); }
    };
    host.ownerDocument.addEventListener('pointerdown', dismiss);
    onCleanup(() => host.ownerDocument.removeEventListener('pointerdown', dismiss));
  });
  return <div ref={element => { host = element; }} class="atlas-survey-seal" data-atlas-chrome="seal" data-tone={tone()}>
    <button class="atlas-survey-button" type="button" aria-label="About this map" aria-expanded={open()} aria-describedby={open() ? id : undefined}
      on:pointerenter={() => setOpen(true)} on:pointerleave={() => { if (!pinned()) setOpen(false); }}
      on:focus={() => setOpen(true)} on:blur={() => { if (!pinned()) setOpen(false); }}
      on:click={() => { const next = !pinned(); setPinned(next); setOpen(next); }}
      on:keydown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setPinned(false); } }}>
      <svg class="atlas-survey-wax cd-seal" viewBox="0 0 32 32" aria-hidden="true">
        <path class="cd-seal-wax" d="m16 1 4 1 3.5.2 2.2 3 3 2.3.2 3.5 1.2 4-1 4-.4 3.6-3 2.2-2.3 3-3.5.2-4 1-4-1-3.5-.2-2.3-3-3-2.2-.2-3.6-1.2-4 1-4 .4-3.5 3-2.3 2.2-3 3.6-.2z" />
        <circle class="cd-seal-rim" cx="16" cy="16" r="10.5" />
        <path class="cd-seal-glyph" d="M8 21h16M10 21V11l6-4 6 4v10M13 21v-6h6v6M12 12h1m6 0h1M16 4v3" />
      </svg>
      <span class="atlas-survey-words"><span>{props.still ? 'Still' : 'Survey'} <time datetime={new Date(props.world.asOf).toISOString()}>{formatDay(props.world.asOf)}</time></span>
        <span class="atlas-survey-live" role="status" aria-label={props.summary ? liveLine(props.summary).text : 'Live state unavailable'}>{live()}</span>
      </span>
    </button>
    <Show when={open()}><p class="atlas-survey-hint" id={id} role="tooltip">{description()}</p></Show>
  </div>;
}
