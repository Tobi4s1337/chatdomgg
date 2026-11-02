import { createSignal, createUniqueId, onCleanup, onMount, Show } from 'solid-js';
import type { PreviewWorld } from '../data/preview';
import { sealLive, sealWords } from './edition';
import { liveLine, type LiveSummary } from './live-line';
import './survey-seal.css';

/** The survey's glyph: a gatehouse sketched on draft land. */
const SURVEY_GLYPH = 'M8 21h16M10 21V11l6-4 6 4v10M13 21v-6h6v6M12 12h1m6 0h1M16 4v3';
/** A founded edition's glyph: a crown over its band, engraved where the survey's gatehouse stood. */
const EDITION_GLYPH = 'M9 22h14M9.5 19.5h13M9.5 19.5 8.5 11l4.2 3.8L16 8l3.3 6.8 4.2-3.8-1 8.5M16 8V5.8M8.5 11v-.4M23.5 11v-.4';

/**
 * A date and one quiet explanation; the host's footer owns the longer How it works sheet. A survey preview shows the
 * day it was observed; a founded edition its name and founding day in a richer wax.
 */
export function SurveySeal(props: { world: PreviewWorld; summary: LiveSummary | null; still: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);
  const id = createUniqueId();
  let host!: HTMLDivElement;
  const observed = () => props.summary?.status.frameAsOf;
  const tone = () => props.summary ? liveLine(props.summary).tone : 'quiet';
  const live = () => sealLive(observed(), tone() === 'fresh');
  const words = () => sealWords(props.world, props.still);
  onMount(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.contains(event.target)) { setOpen(false); setPinned(false); }
    };
    host.ownerDocument.addEventListener('pointerdown', dismiss);
    onCleanup(() => host.ownerDocument.removeEventListener('pointerdown', dismiss));
  });
  return <div ref={element => { host = element; }} class="atlas-survey-seal" data-atlas-chrome="seal" data-tone={tone()} data-seal-kind={words().kind}>
    <button class="atlas-survey-button" type="button" aria-label="About this map" aria-expanded={open()} aria-describedby={open() ? id : undefined}
      on:pointerenter={() => setOpen(true)} on:pointerleave={() => { if (!pinned()) setOpen(false); }}
      on:focus={() => setOpen(true)} on:blur={() => { if (!pinned()) setOpen(false); }}
      on:click={() => { const next = !pinned(); setPinned(next); setOpen(next); }}
      on:keydown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setPinned(false); } }}>
      <svg class="atlas-survey-wax cd-seal" viewBox="0 0 32 32" aria-hidden="true">
        <path class="cd-seal-wax" d="m16 1 4 1 3.5.2 2.2 3 3 2.3.2 3.5 1.2 4-1 4-.4 3.6-3 2.2-2.3 3-3.5.2-4 1-4-1-3.5-.2-2.3-3-3-2.2-.2-3.6-1.2-4 1-4 .4-3.5 3-2.3 2.2-3 3.6-.2z" />
        <circle class="cd-seal-rim" cx="16" cy="16" r="10.5" />
        <Show when={words().kind !== 'survey'}><circle class="cd-seal-rim atlas-survey-rim-fine" cx="16" cy="16" r="12.4" /></Show>
        <path class="cd-seal-glyph" d={words().kind === 'survey' ? SURVEY_GLYPH : EDITION_GLYPH} />
      </svg>
      <span class="atlas-survey-words"><span>{words().lead} <Show when={words().when.at !== null} fallback={<span class="atlas-survey-rehearsal">{words().when.text}</span>}>
        <time datetime={new Date(words().when.at!).toISOString()}>{words().when.text}</time>
      </Show></span>
        <span class="atlas-survey-live" role="status" aria-label={props.summary ? liveLine(props.summary).text : 'Live state unavailable'}>{live()}</span>
      </span>
    </button>
    <Show when={open()}><p class="atlas-survey-hint" id={id} role="tooltip">{words().hint}</p></Show>
  </div>;
}
