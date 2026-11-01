import { createEffect, createMemo, createSignal, For, Index, onCleanup, onMount, Show } from 'solid-js';
import { layoutWalkLabels, type LabelRect } from '../labels';
import { labelMeasureKey, type PersonLabel } from './model';
export { labelMeasureKey, peopleFromLabels } from './model';
export { measureReservedElements } from './reserved';
export type { PersonLabel, WalkerLabelInput, SpeechLabelInput } from './model';
import './style.css';

export interface PeopleLabelsProps {
  readonly people: readonly PersonLabel[];
  readonly reserved?: readonly LabelRect[];
  /** Optional class for a caller's coordinate layer; in stream strip use `stream-people-labels`. */
  readonly class?: string;
  /** Exposes the actual coordinate layer for measuring caller-owned HUD elements. */
  readonly onRoot?: (root: HTMLElement | null) => void;
}

type Size = { readonly width: number; readonly height: number };
/** One measured layer for both names and speech. The owner supplies current witnessed data every frame. */
export function PeopleLabels(props: PeopleLabelsProps) {
  let root!: HTMLDivElement;
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  const [sizes, setSizes] = createSignal<ReadonlyMap<string, Size>>(new Map());
  const measure = (key: string, size: Size) => setSizes(previous => {
    const old = previous.get(key);
    if (old && old.width === size.width && old.height === size.height) return previous;
    const next = new Map(previous); next.set(key, size); return next;
  });
  const forget = (key: string) => setSizes(previous => {
    if (!previous.has(key)) return previous;
    const next = new Map(previous); next.delete(key); return next;
  });
  onMount(() => {
    const update = () => setViewport({ width: root.clientWidth, height: root.clientHeight });
    update(); props.onRoot?.(root);
    const observer = new ResizeObserver(update); observer.observe(root);
    onCleanup(() => { observer.disconnect(); props.onRoot?.(null); });
  });
  const placed = createMemo(() => {
    const measured = sizes();
    const candidates = props.people.flatMap(person => {
      const size = measured.get(labelMeasureKey(person));
      if (!size || (person.opacity !== undefined && (!(person.opacity > 0) || !Number.isFinite(person.opacity))) || (!person.name && !person.speech?.length)) return [];
      return [{ ...person, speaking: !!person.speech?.length, width: size.width, height: size.height }];
    });
    return new Set(layoutWalkLabels(candidates, viewport(), props.reserved ?? []).map(result => labelMeasureKey(result.anchor)));
  });
  return <div ref={node => { root = node; }} class={`walk-people-labels ${props.class ?? ''}`} aria-label="People in the street">
    <Index each={props.people}>{person => <MeasuredLabel person={person} visible={() => placed().has(labelMeasureKey(person()))} measure={measure} forget={forget} />}</Index>
  </div>;
}

function MeasuredLabel(props: { person: () => PersonLabel; visible: () => boolean; measure: (key: string, size: Size) => void; forget: (key: string) => void }) {
  let element!: HTMLDivElement;
  let lastKey = '';
  const contentKey = createMemo(() => labelMeasureKey(props.person()));
  const update = () => {
    const person = props.person(), key = labelMeasureKey(person);
    if (lastKey && lastKey !== key) props.forget(lastKey);
    lastKey = key;
    // Include the bubble's 7px tail in the collision bounds and leave its tip at the head anchor.
    props.measure(key, { width: element.offsetWidth, height: element.offsetHeight + (person.speech?.length ? 7 : 0) });
  };
  onMount(() => {
    let active = true;
    const observer = new ResizeObserver(update); observer.observe(element);
    createEffect(() => { contentKey(); queueMicrotask(() => { if (active) update(); }); });
    onCleanup(() => { active = false; observer.disconnect(); if (lastKey) props.forget(lastKey); });
  });
  return <div ref={node => { element = node; }} class="walk-person-label" classList={{ 'is-speech': !!props.person().speech?.length }}
    data-walker={props.person().walkerId} data-person={props.person().id} aria-hidden={!props.visible()}
    style={{ left: `${props.person().x}px`, top: `${props.person().y - (props.person().speech?.length ? 7 : 0)}px`,
      visibility: props.visible() ? 'visible' : 'hidden', opacity: props.person().opacity ?? 1 }}>
    <Show when={props.person().speech?.length} fallback={<><span>{props.person().name}</span><Show when={props.person().self}><small class="walk-person-you">you</small></Show></>}>
      <Show when={props.person().name}><small class="walk-person-speaker">{props.person().name}</small></Show>
      <p><For each={props.person().speech}>{part => part.kind === 'text' ? part.text :
        <img src={`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(part.id)}/default/dark/1.0`} alt={part.alt} />}</For></p>
    </Show>
  </div>;
}
