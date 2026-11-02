import { createSignal, createUniqueId, For, Show } from 'solid-js';
import type { PreviewWorld } from '../data/preview';

const ITEMS = [
  { id: 'live', name: 'Live', description: 'Vermilion marks streams on air.' },
  { id: 'founded', name: 'Founded', description: 'A founded kingdom drawn from life.' },
  { id: 'waiting', name: 'Waiting land', description: 'Pencil marks waiting land.' },
  { id: 'road', name: 'Road', description: 'Ink roads remember witnessed raids.' },
  { id: 'home', name: 'Your home', description: 'A key marks your own home.' },
] as const;
type KeyItem = (typeof ITEMS)[number];

/** Each hand-inked device belongs to the same engraved family, with pigment reserved for live. */
function KeyGlyph(props: { kind: KeyItem['id'] }) {
  return (
    <svg class="atlas-key-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <Show when={props.kind === 'live'}>
        <ellipse class="atlas-key-pigment" cx="19" cy="29" rx="14" ry="7" />
        <path d="M17 32V7m0 2c6 2 10-2 17 1l-4 4 4 4c-6-2-11 2-17 0" />
        <path class="atlas-key-pennant" d="M17 9c6 2 10-2 17 1l-4 4 4 4c-6-2-11 2-17 0z" />
      </Show>
      <Show when={props.kind === 'founded'}>
        <path d="M7 31V17l4-4 4 4v14M15 31V13l5-6 5 6v18M25 31V17l4-4 4 4v14M4 32h32M8 17h6M26 17h6M18 15h4M19 31v-7h3v7" />
        <path class="atlas-key-brass" d="M20 3v4m0-4h6l-2 2 2 2h-6" />
      </Show>
      <Show when={props.kind === 'waiting'}>
        <path class="atlas-key-pencil" d="M5 29c3-6 7-3 10-8s6-4 10 0 5 1 9 7M6 33h28M10 34h4m3 0h4m3 0h5" />
        <path d="m24 8 4-4 4 4-4 4-4-4zm0 0-11 11-2 6 6-2 11-11" />
      </Show>
      <Show when={props.kind === 'road'}>
        <path d="M5 29c7 0 7-9 14-9s6 8 15 0" />
        <circle cx="6" cy="29" r="2.4" /><circle cx="34" cy="20" r="2.4" />
        <path class="atlas-key-pencil" d="M7 33c8 0 8-9 14-9s6 8 13 1" />
      </Show>
      <Show when={props.kind === 'home'}>
        <circle cx="13" cy="13" r="5.5" /><circle class="atlas-key-brass" cx="13" cy="13" r="2.3" />
        <path d="m17 17 14 14m-4-4 3-3m0 6 3-3M7 31h14m-9-3h8" />
      </Show>
    </svg>
  );
}

/** A compact legend that keeps its explanation close to the device being inspected. */
export function LegendBody(props: { world: PreviewWorld }) {
  void props.world;
  const [hovered, setHovered] = createSignal<KeyItem['id'] | null>(null);
  const [focused, setFocused] = createSignal<KeyItem['id'] | null>(null);
  const [chosen, setChosen] = createSignal<KeyItem['id'] | null>(null);
  const id = createUniqueId();
  const current = () => ITEMS.find(item => item.id === (hovered() ?? focused() ?? chosen()));
  return (
    <div class="atlas-key-legend" on:keydown={(event) => {
      if (event.key === 'Escape' && (hovered() || focused() || chosen())) {
        event.stopPropagation();
        setHovered(null); setFocused(null); setChosen(null);
      }
    }}>
      <div class="atlas-key-glyphs" role="group" aria-label="Map symbols">
        <For each={ITEMS}>{(item) => (
          <button
            type="button"
            class="atlas-key-glyph-button cd-focus"
            data-atlas-key-glyph={item.id}
            aria-label={item.name}
            aria-describedby={current()?.id === item.id ? `atlas-key-note-${id}` : undefined}
            aria-pressed={chosen() === item.id}
            on:pointerenter={(event) => { if (event.pointerType !== 'touch') setHovered(item.id); }}
            on:pointerleave={() => setHovered(null)}
            on:focus={() => setFocused(item.id)}
            on:blur={() => setFocused(null)}
            on:click={() => setChosen(chosen() === item.id ? null : item.id)}
          ><KeyGlyph kind={item.id} /></button>
        )}</For>
      </div>
      <Show when={current()}>{item => (
        <p id={`atlas-key-note-${id}`} class="atlas-key-hint" data-atlas-key-detail="true" role="status">{item().description}</p>
      )}</Show>
    </div>
  );
}
