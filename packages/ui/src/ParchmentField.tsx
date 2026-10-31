import { Show, type JSX } from 'solid-js';
import { allowance } from './allowance';

/**
 * A labelled parchment slip around a real textarea: native editing, IME, spellcheck and maxlength stay the
 * browser's. The allowance is visible; it is announced politely only once room runs short, so typing is quiet.
 */
export function ParchmentField(props: {
  id: string;
  label: string;
  value: string;
  max: number;
  rows?: number;
  disabled?: boolean | undefined;
  /** The reason the words cannot go as they are. Shown in words and tied to the field. */
  invalid?: string | undefined;
  /** A short note under the field; while disabled it should say why. */
  hint?: string | undefined;
  placeholder?: string | undefined;
  /** A small tag before the error, such as "Only you" for a private reply. */
  invalidTag?: string | undefined;
  onInput(value: string): void;
  class?: string | undefined;
}): JSX.Element {
  const room = () => allowance(props.value, props.max);
  const describedBy = () => [props.invalid ? `${props.id}-error` : '', props.hint ? `${props.id}-hint` : '', `${props.id}-allowance`].filter(Boolean).join(' ');
  return <div class={`cd-field cd-kit${props.class ? ` ${props.class}` : ''}`} data-invalid={props.invalid ? 'true' : undefined} data-disabled={props.disabled ? 'true' : undefined}>
    <div class="cd-field-head">
      <label class="cd-field-label" for={props.id}>{props.label}</label>
      <span class="cd-field-allowance" id={`${props.id}-allowance`} data-near={room().near ? 'true' : undefined}>{room().words}</span>
    </div>
    <textarea class="cd-field-input" id={props.id} value={props.value} maxLength={props.max} rows={props.rows ?? 2}
      disabled={props.disabled} placeholder={props.placeholder} aria-invalid={props.invalid ? 'true' : undefined}
      aria-describedby={describedBy()} onInput={event => props.onInput(event.currentTarget.value)} />
    <span class="cd-field-announce" aria-live="polite">{room().near ? room().words : ''}</span>
    <Show when={props.invalid}><p class="cd-field-error" id={`${props.id}-error`}>
      <svg class="cd-field-error-mark" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.2 11 10.4H1Z" /><path d="M6 4.6v2.8M6 8.6v.2" /></svg>
      <span><Show when={props.invalidTag}><b class="cd-field-tag">{props.invalidTag}</b> </Show>{props.invalid}</span>
    </p></Show>
    <Show when={props.hint}><p class="cd-field-hint" id={`${props.id}-hint`}>{props.hint}</p></Show>
  </div>;
}
