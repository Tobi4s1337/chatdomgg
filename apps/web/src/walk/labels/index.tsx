import { createComputed, createSignal, For, onCleanup, onMount, Show, untrack, type Accessor } from 'solid-js';
import type { LabelRect } from '../labels';
import { sharedPlaySettings } from '../../play/settings';
import { SPEECH_FRAME_STALE_MS, subscribeSpeech, type SpeechFrame } from './bus';
import { labelLimits, type LabelDensity } from './density';
import { joinSpeech, labelContentKey, type PersonLabel } from './model';
import { createLabelStage, type LabelSize } from './stage';
export { joinSpeech, labelContentKey, labelMeasureKey, peopleFromLabels } from './model';
export { measureReservedElements } from './reserved';
export { publishSpeech, subscribeSpeech, createCanvasProbe, disposeCanvasProbe, projectToCanvas } from './bus';
export { labelLimits } from './density';
export { speechHoldUntil, speechReadingMs } from './timing';
export type { PersonLabel, WalkerLabelInput, SpeechLabelInput } from './model';
export type { SpeechAnchor, SpeechFrame } from './bus';
export type { LabelDensity, LabelLimits } from './density';
import './style.css';

export interface PeopleLabelsProps {
  /** This frame's walkers (and any speech the host still joins itself), projected from the drawn heads. */
  readonly people: readonly PersonLabel[];
  readonly reserved?: readonly LabelRect[];
  /** Optional class for a caller's coordinate layer; in stream strip use `stream-people-labels`. */
  readonly class?: string;
  /** Exposes the actual coordinate layer for measuring caller-owned HUD elements. */
  readonly onRoot?: (root: HTMLElement | null) => void;
  /** Overrides this device's play settings for name and bubble density. */
  readonly density?: { readonly labels?: LabelDensity; readonly bubbles?: LabelDensity };
  /** Overrides this device's reduced-motion setting. */
  readonly reducedMotion?: boolean;
}

interface LabelNode {
  readonly id: string;
  readonly content: Accessor<PersonLabel>;
  readonly setContent: (person: PersonLabel) => void;
  key: string;
  el?: HTMLDivElement;
  size?: LabelSize;
  dirty: boolean;
  observer?: ResizeObserver;
}

/**
 * One layer for names and speech, laid out once per frame.
 *
 * Names arrive as props from the host every frame after its final camera transform; speech arrives on the
 * per-canvas bus from the crowd, projected with the same camera in the same frame (see `bus.ts`). Both land within
 * the scene's animation-frame callback, so a single microtask afterwards joins them, measures any element whose
 * words changed, decides what is shown (`stage.ts`) and writes transforms and opacity directly. Solid renders only
 * when a label's words change, never per frame.
 */
export function PeopleLabels(props: PeopleLabelsProps) {
  let root: HTMLDivElement | undefined;
  const nodes = new Map<string, LabelNode>();
  const [list, setList] = createSignal<readonly LabelNode[]>([]);
  const stage = createLabelStage();
  const settings = sharedPlaySettings();
  let density = { labels: settings.get('labels'), bubbles: settings.get('bubbles') }, reduced = settings.get('reducedMotion');
  let speech: { canvas: HTMLCanvasElement; frame: SpeechFrame } | undefined;
  let viewport = { width: 0, height: 0 };
  let scheduled = false, raf = 0, disposed = false;

  const schedule = () => { if (scheduled || disposed) return; scheduled = true; queueMicrotask(flush); };
  /** Only the visible canvas this layer sits beside may speak through it. */
  const owns = (canvas: HTMLCanvasElement) => !!root?.parentElement && canvas.isConnected && canvas.parentElement === root.parentElement
    && canvas.style.visibility !== 'hidden';

  function flush() {
    scheduled = false;
    if (disposed || !root) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const now = performance.now();
    const frame = speech && now - speech.frame.at <= SPEECH_FRAME_STALE_MS && owns(speech.canvas) ? speech.frame : null;
    const people = joinSpeech(untrack(() => props.people), frame);

    let membership = false;
    for (const person of people) {
      const key = labelContentKey(person);
      const node = nodes.get(person.id);
      if (!node) {
        const [content, setContent] = createSignal(person, { equals: false });
        nodes.set(person.id, { id: person.id, content, setContent, key, dirty: true });
        membership = true;
      } else if (node.key !== key) { node.key = key; node.setContent(person); node.dirty = true; }
    }
    // Solid inserts new elements synchronously here, so they can be measured in this same frame.
    if (membership) setList([...nodes.values()]);
    for (const node of nodes.values()) {
      if (!node.dirty || !node.el) continue;
      // Reading layout once per change, before any style is written this frame.
      node.size = { width: node.el.offsetWidth, height: node.el.offsetHeight };
      node.dirty = false;
    }
    const staged = stage.frame({ people, viewport, reserved: untrack(() => props.reserved) ?? [],
      limits: labelLimits(props.density?.labels ?? density.labels, props.density?.bubbles ?? density.bubbles),
      reducedMotion: props.reducedMotion ?? reduced, now, size: person => nodes.get(person.id)?.size });
    let removed = false;
    for (const label of staged) {
      const node = nodes.get(label.id);
      if (!node) continue;
      if (label.removed) { node.observer?.disconnect(); nodes.delete(label.id); removed = true; continue; }
      const el = node.el;
      if (!el) continue;
      const visible = label.opacity > .004;
      el.style.transform = `translate3d(${label.left.toFixed(2)}px,${label.top.toFixed(2)}px,0)`;
      el.style.opacity = visible ? label.opacity.toFixed(3) : '0';
      el.style.visibility = visible ? 'visible' : 'hidden';
      if ((el.getAttribute('aria-hidden') === 'true') !== !label.shown) el.setAttribute('aria-hidden', String(!label.shown));
    }
    if (removed) setList([...nodes.values()]);
    // Keep fades moving when the scene is not publishing (hidden tab, a host without a canvas).
    if (stage.animating) raf = requestAnimationFrame(() => { raf = 0; schedule(); });
  }

  createComputed(() => { void props.people; void props.reserved; void props.density; void props.reducedMotion; schedule(); });
  onMount(() => {
    const layer = root!;
    const resize = () => { viewport = { width: layer.clientWidth, height: layer.clientHeight }; schedule(); };
    resize(); props.onRoot?.(layer);
    const observer = new ResizeObserver(resize); observer.observe(layer);
    const offSpeech = subscribeSpeech((canvas, frame) => { if (!owns(canvas)) return; speech = { canvas, frame }; schedule(); });
    const offSettings = settings.subscribe(next => { density = { labels: next.labels, bubbles: next.bubbles }; reduced = next.reducedMotion; schedule(); });
    onCleanup(() => {
      disposed = true; observer.disconnect(); offSpeech(); offSettings();
      if (raf) cancelAnimationFrame(raf);
      for (const node of nodes.values()) node.observer?.disconnect();
      nodes.clear(); stage.clear(); props.onRoot?.(null);
    });
  });

  const attach = (node: LabelNode, el: HTMLDivElement) => {
    node.el = el; node.dirty = true;
    // Web fonts arriving later change a label's size without changing its words.
    node.observer?.disconnect();
    node.observer = new ResizeObserver(() => { node.dirty = true; schedule(); });
    node.observer.observe(el);
  };

  return <div ref={node => { root = node; }} class={`walk-people-labels ${props.class ?? ''}`} aria-label="People in the street">
    <For each={list()}>{node => <PersonPlate node={node} attach={attach} />}</For>
  </div>;
}

function PersonPlate(props: { node: LabelNode; attach: (node: LabelNode, el: HTMLDivElement) => void }) {
  const person = props.node.content;
  const speaking = () => !!person().speech?.length;
  return <div ref={el => props.attach(props.node, el)} class="walk-person-label" classList={{ 'is-speech': speaking(), 'is-home': speaking() && !!person().home }}
    data-walker={person().walkerId} data-person={person().id} aria-hidden="true" style={{ opacity: 0, visibility: 'hidden' }}>
    <Show when={speaking()} fallback={<><span>{person().name}</span><Show when={person().self}><small class="walk-person-you">you</small></Show></>}>
      <Show when={person().name}><small class="walk-person-speaker">
        <Show when={person().home}><i class="walk-person-window" aria-hidden="true" /></Show>{person().name}
      </small></Show>
      <p><For each={person().speech}>{part => part.kind === 'text' ? part.text :
        <img src={`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(part.id)}/default/dark/1.0`} alt={part.alt} />}</For></p>
    </Show>
  </div>;
}
