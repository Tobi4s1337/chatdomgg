import { createMemo, createSignal, createUniqueId, For, Show, type JSX } from 'solid-js';
import { crestStep, crestTabStop, isCrestKey } from './crest-keys';

export type Crest = 'hearth' | 'tide' | 'grove';
export interface CrestOption<T extends string> {
  value: T;
  name: string;
  crest: Crest;
  /** A second short word under the name, such as the realm's style. */
  note?: string;
  /** This crest rests and cannot be chosen; the group's hint says why. */
  disabled?: boolean | undefined;
}

/** The device engraved on each seal: a hearth with its flame, three tides, a grove oak. Code-native, no images. */
function CrestDevice(props: { crest: Crest }): JSX.Element {
  switch (props.crest) {
    case 'hearth': return <>
      <path class="cd-crest-line" d="M12.5 28.5v-8.6a7.5 7.5 0 0 1 15 0v8.6M10 28.5h20M14.5 13.5l1.6 1.6M25.5 13.5l-1.6 1.6" />
      <path class="cd-crest-fill" d="M20 27.2c-2.5 0-3.8-1.6-3.8-3.4 0-2.3 2.2-3.1 2.5-5.9 1.8 1.1 2.1 2.6 1.8 3.8.9-.4 1.6-1.1 1.8-2 1.1 1.1 1.5 2.5 1.5 4.1 0 1.9-1.3 3.4-3.8 3.4Z" />
    </>;
    case 'tide': return <>
      <path class="cd-crest-line" d="M10 16.5c2.4-2 4.6-2 6.8 0s4.5 2 6.6 0 4.4-2 6.6 0M10 21.5c2.4-2 4.6-2 6.8 0s4.5 2 6.6 0 4.4-2 6.6 0M12.5 26.5c2-1.7 3.9-1.7 5.8 0s3.8 1.7 5.7 0" />
      <circle class="cd-crest-fill" cx="25.5" cy="11.5" r="1.6" />
    </>;
    case 'grove': return <>
      <path class="cd-crest-fill" d="M20 9.5c3.9 0 6.3 2.7 6.3 5.8 2 .7 3 2.3 3 4.2 0 2.7-2.3 4.6-4.9 4.6h-8.8c-2.6 0-4.9-1.9-4.9-4.6 0-1.9 1-3.5 3-4.2 0-3.1 2.4-5.8 6.3-5.8Z" />
      <path class="cd-crest-line" d="M20 22.5v7.5M16.5 30h7M20 25.5l-2.4-2.2M20 24.4l2.6-2.4" />
    </>;
  }
}

function CrestMark(props: { crest: Crest }): JSX.Element {
  return <svg class="cd-crest-mark" viewBox="0 0 40 40" aria-hidden="true">
    <circle class="cd-crest-ring" cx="20" cy="20" r="18.6" />
    <circle class="cd-crest-field" cx="20" cy="20" r="14.6" />
    <path class="cd-crest-shine" d="M8.6 14.4A12.6 12.6 0 0 1 19 7.5" />
    <g class="cd-crest-device"><CrestDevice crest={props.crest} /></g>
  </svg>;
}

/**
 * Crest seals on a wood rail: an accessible radio group that replaces a native select. One tab stop (the chosen
 * crest); arrows, Home and End walk the rail; Space or Enter chooses. Choosing is the only thing that calls
 * `onChange`, and the wood cue is the owner's callback, so the owner's audio policy (unlock, mute) decides sound.
 */
export function CrestChoice<T extends string>(props: {
  label: string;
  value: T;
  disabled?: boolean | undefined;
  /** Words shown while the whole rail rests. Required wording, never opacity alone. */
  disabledReason?: string | undefined;
  hint?: string | undefined;
  options: readonly CrestOption<T>[];
  onChange(value: T): void;
  onCue?(cue: 'wood'): void;
  class?: string | undefined;
}): JSX.Element {
  const id = createUniqueId(), labelId = `cd-crests-${id}`, hintId = `cd-crests-hint-${id}`;
  const [focused, setFocused] = createSignal(-1);
  const buttons: HTMLButtonElement[] = [];
  const open = createMemo(() => props.options.map(option => !option.disabled));
  const chosen = () => props.options.findIndex(option => option.value === props.value);
  const stop = () => focused() >= 0 ? focused() : crestTabStop(chosen(), open());
  const note = () => props.disabled ? props.disabledReason : props.hint;

  function choose(option: CrestOption<T>) {
    if (props.disabled || option.disabled || option.value === props.value) return;
    props.onCue?.('wood');
    props.onChange(option.value);
  }
  function keydown(event: KeyboardEvent, index: number) {
    if (!isCrestKey(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = crestStep(event.key, index, props.disabled ? props.options.map(() => true) : open());
    buttons[next]?.focus();
  }

  return <div class={`cd-crests cd-kit${props.class ? ` ${props.class}` : ''}`} data-disabled={props.disabled ? 'true' : undefined}>
    <p class="cd-crests-label" id={labelId}>{props.label}</p>
    <div class="cd-crest-rail" role="radiogroup" aria-labelledby={labelId} aria-describedby={note() ? hintId : undefined}
      aria-disabled={props.disabled ? 'true' : undefined}
      onFocusOut={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(-1); }}>
      <For each={props.options}>{(option, index) => <button ref={element => { buttons[index()] = element; }} type="button" role="radio"
        class="cd-crest" data-crest={option.crest} aria-checked={option.value === props.value ? 'true' : 'false'}
        aria-disabled={props.disabled || option.disabled ? 'true' : undefined} tabIndex={stop() === index() ? 0 : -1}
        onFocus={() => setFocused(index())} onKeyDown={event => keydown(event, index())} onClick={() => choose(option)}>
        <CrestMark crest={option.crest} />
        <span class="cd-crest-words"><span class="cd-crest-name">{option.name}</span><Show when={option.note}><span class="cd-crest-note">{option.note}</span></Show></span>
      </button>}</For>
    </div>
    <Show when={note()}><p class="cd-crests-hint" id={hintId}>{note()}</p></Show>
  </div>;
}
