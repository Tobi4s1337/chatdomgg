import { For, Show } from 'solid-js';
import { ShieldIcon } from './marks';
import './door.css';

export interface DoorStep { readonly text: string; readonly done: boolean }

/**
 * The door into a holding's land (Atlas.md §7.3): plain parchment with the holding's arms and name in a cartouche,
 * and the real steps of the way in written in ink in the margin as they happen. The Atlas raises it as the map
 * glides into the holding; the kingdom page opens on the same parchment and lets it fade once the world is lit.
 * There is never a bar or a spinner; a step that runs long shows a raven waiting on the cartouche.
 */
export function DoorCartouche(props: {
  id: string;
  name: string;
  /** Under the name: the holding's tier and realm, in small capitals. */
  subtitle: string;
  steps: readonly DoorStep[];
  /** `stamp` the seal falls; `ink` the parchment is up; `wake` the world shows through; `gone` it has lifted. */
  phase: 'stamp' | 'ink' | 'wake' | 'gone';
  /** A step has run long: the raven lands. */
  waiting?: boolean;
  /** A failure, written in the margin in place of the next step, with the way back. */
  failure?: string | null;
  label?: string;
}) {
  return (
    <div class="door" data-phase={props.phase} role="status" aria-live="polite" aria-label={props.label ?? `Entering ${props.name}`}>
      <div class="door-paper" />
      <div class="door-cartouche">
        <div class="door-seal" aria-hidden="true"><ShieldIcon channelId={props.id} width={96} /></div>
        <p class="door-eyebrow">Unfounded land</p>
        <h1 class="door-name">{props.name}</h1>
        <p class="door-subtitle">{props.subtitle}</p>
        <div class="door-rule" aria-hidden="true"><span /><i>❦</i><span /></div>
        <ol class="door-steps">
          <For each={props.steps}>{step => <li data-done={step.done ? 'true' : 'false'}>{step.text}</li>}</For>
          <Show when={props.failure}>{text => <li class="door-failure">{text()} <a href="/map">Return to the Atlas</a></li>}</Show>
        </ol>
        <Show when={props.waiting && !props.failure}>
          <svg class="door-raven" viewBox="0 0 64 40" aria-hidden="true">
            <path d="M6 30c8-2 14-8 20-9 4-.6 7 1 9 3l5-4 9-2-6 4c3 1 5 4 5 7-6-1-10-1-14 1-6 3-14 3-28 0z" />
            <path d="M34 31l-2 6M38 31l1 6" />
          </svg>
        </Show>
      </div>
    </div>
  );
}
