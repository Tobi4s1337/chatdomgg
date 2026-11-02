import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';

/**
 * The ledger's fittings. Each one is drawn in wood, brass and parchment and keeps the semantics of the control it
 * replaces (slider, switch, radio group), so screen readers, keyboards and thumbs all work. None of them calls
 * the settings store itself: the page hands each a value and a verb, and the ledger model writes and sounds it.
 */

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const plain = (event: KeyboardEvent) => !event.altKey && !event.ctrlKey && !event.metaKey;
const KNOB = 12;

/** A carved groove with a brass inlay and a brass knob. Works in whole stops; `onPick` only fires on a new stop. */
export function Slider(props: {
  id: string;
  label: string;
  count: number;
  at: number;
  text: (stop: number) => string;
  onPick: (stop: number) => void;
  /** The stop that is the usual value, marked with a small brass lozenge under the groove. */
  usual?: number;
  /** Stops per Page Up / Page Down. */
  big?: number;
}): JSX.Element {
  let track!: HTMLDivElement;
  const [held, setHeld] = createSignal(false);
  const last = () => Math.max(1, props.count - 1);
  const pick = (stop: number) => { const next = clamp(Math.round(stop), 0, last()); if (next !== props.at) props.onPick(next); };
  // The knob's centre travels inside the groove's rounded ends, KNOB px in from each side.
  const fromPointer = (x: number) => { const box = track.getBoundingClientRect(), run = box.width - KNOB * 2; if (run > 0) pick(((x - box.left - KNOB) / run) * last()); };
  function keydown(event: KeyboardEvent) {
    if (!plain(event)) return;
    const big = props.big ?? Math.max(2, Math.round(props.count / 8));
    const to: Record<string, number> = { ArrowRight: props.at + 1, ArrowUp: props.at + 1, ArrowLeft: props.at - 1, ArrowDown: props.at - 1,
      PageUp: props.at + big, PageDown: props.at - big, Home: 0, End: last() };
    if (!(event.key in to)) return;
    event.preventDefault();
    pick(to[event.key]!);
  }
  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    track.focus({ preventScroll: true });
    track.setPointerCapture?.(event.pointerId);
    setHeld(true);
    fromPointer(event.clientX);
  }
  const move = (event: PointerEvent) => { if (held()) fromPointer(event.clientX); };
  const up = (event: PointerEvent) => { if (!held()) return; setHeld(false); track.releasePointerCapture?.(event.pointerId); };
  const at = (stop: number) => clamp(stop / last(), 0, 1);
  return <div class="pl-control pl-slider" data-held={held() ? 'true' : undefined}>
    <div class="pl-control-head">
      <span class="pl-control-name" id={`${props.id}-label`}>{props.label}</span>
      <span class="pl-readout" aria-hidden="true">{props.text(props.at)}</span>
    </div>
    <div ref={element => { track = element; }} class="pl-slider-track" role="slider" tabIndex={0} aria-labelledby={`${props.id}-label`}
      aria-valuemin={0} aria-valuemax={last()} aria-valuenow={props.at} aria-valuetext={props.text(props.at)}
      style={{ '--pl-f': at(props.at) }} onKeyDown={keydown} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onLostPointerCapture={() => setHeld(false)}>
      <span class="pl-groove"><span class="pl-inlay" /></span>
      <Show when={props.usual !== undefined}><span class="pl-usual" style={{ '--pl-f': at(props.usual!) }} /></Show>
      <span class="pl-knob" />
    </div>
  </div>;
}

/** A brass lever in a wooden slot, with both words engraved and the live one lit. */
export function Switch(props: { label: string; hint?: string | undefined; on: boolean; onToggle: () => void; id: string }): JSX.Element {
  return <button type="button" class="pl-control pl-switch" role="switch" aria-checked={props.on ? 'true' : 'false'}
    aria-labelledby={`${props.id}-label`} aria-describedby={props.hint ? `${props.id}-hint` : undefined} onClick={() => props.onToggle()}>
    <span class="pl-control-words">
      <span class="pl-control-name" id={`${props.id}-label`}>{props.label}</span>
      <Show when={props.hint}><span class="pl-control-hint" id={`${props.id}-hint`}>{props.hint}</span></Show>
    </span>
    <span class="pl-lever" aria-hidden="true">
      <span class="pl-lever-word" data-side="off">Off</span>
      <span class="pl-lever-slot"><span class="pl-lever-knob" /></span>
      <span class="pl-lever-word" data-side="on">On</span>
    </span>
  </button>;
}

export interface ChoiceOption<T extends string> { readonly value: T; readonly words: string; readonly key?: string }

/** Pressed wooden plates on a rail; the chosen one is a raised parchment plate. A radio group under the hood. */
export function Choice<T extends string>(props: {
  id: string;
  label: string;
  hint?: string | undefined;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChoose: (value: T) => void;
}): JSX.Element {
  const plates: HTMLButtonElement[] = [];
  const chosen = () => Math.max(0, props.options.findIndex(option => option.value === props.value));
  function keydown(event: KeyboardEvent, index: number) {
    if (!plain(event)) return;
    const n = props.options.length;
    const to: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: n - 1 };
    if (!(event.key in to)) return;
    event.preventDefault();
    const next = (to[event.key]! + n) % n;
    plates[next]?.focus({ preventScroll: true });
    props.onChoose(props.options[next]!.value);
  }
  return <div class="pl-control pl-choice">
    <div class="pl-control-head">
      <span class="pl-control-name" id={`${props.id}-label`}>{props.label}</span>
      <Show when={props.hint}><span class="pl-control-hint" id={`${props.id}-hint`}>{props.hint}</span></Show>
    </div>
    <div class="pl-choice-rail" role="radiogroup" aria-labelledby={`${props.id}-label`} aria-describedby={props.hint ? `${props.id}-hint` : undefined}
      style={{ '--pl-count': props.options.length }}>
      <For each={props.options}>{(option, index) => <button type="button" role="radio" class="pl-choice-plate"
        ref={element => { plates[index()] = element; }} aria-checked={option.value === props.value ? 'true' : 'false'}
        tabIndex={chosen() === index() ? 0 : -1} onKeyDown={event => keydown(event, index())}
        onClick={() => { if (option.value !== props.value) props.onChoose(option.value); }}>
        <span class="pl-choice-words">{option.words}</span>
        <Show when={option.key}><span class="pl-keycap pl-keycap-small" aria-hidden="true">{option.key}</span></Show>
      </button>}</For>
    </div>
  </div>;
}

/** An ivory keycap set in a brass rim, with the key's printed name. */
export function Keycap(props: { name: string; small?: boolean }): JSX.Element {
  return <kbd class="pl-keycap" classList={{ 'pl-keycap-small': !!props.small, 'pl-keycap-wide': [...props.name].length > 2 }}>{props.name}</kbd>;
}

/**
 * A long leaf that scrolls inside itself. The browser's scrollbar is hidden; a brass rod with a sliding bead is drawn
 * in the margin and can be dragged. The edges fade where there is more to read. Wheel, touch and keys stay native.
 */
export function ScrollLeaf(props: { label: string; children: JSX.Element; class?: string }): JSX.Element {
  let view!: HTMLDivElement, rail!: HTMLDivElement;
  const [m, setM] = createSignal({ need: false, size: 1, pos: 0 });
  /** The bead never shrinks below a thumb's worth of the rod. */
  const bead = () => Math.max(.16, m().size);
  const measure = () => {
    const room = view.scrollHeight - view.clientHeight;
    setM({ need: room > 2, size: view.scrollHeight ? view.clientHeight / view.scrollHeight : 1, pos: room > 0 ? view.scrollTop / room : 0 });
  };
  let drag: { y: number; top: number; id: number } | null = null;
  function grab(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    drag = { y: event.clientY, top: view.scrollTop, id: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  function beadMove(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const track = rail.clientHeight * (1 - bead());
    if (track <= 0) return;
    view.scrollTop = drag.top + (event.clientY - drag.y) / track * (view.scrollHeight - view.clientHeight);
  }
  const beadUp = () => { drag = null; };
  function rod(event: PointerEvent) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const box = rail.getBoundingClientRect(), beadTop = box.top + m().pos * box.height * (1 - bead());
    view.scrollBy({ top: (event.clientY < beadTop ? -1 : 1) * view.clientHeight * .85, behavior: 'smooth' });
  }
  onMount(() => {
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(view);
    if (view.firstElementChild) observer?.observe(view.firstElementChild);
    onCleanup(() => observer?.disconnect());
  });
  return <div class={`pl-scroll${props.class ? ` ${props.class}` : ''}`} data-need={m().need ? 'true' : undefined}
    data-top={m().pos <= .002 ? 'true' : undefined} data-end={m().pos >= .998 ? 'true' : undefined}>
    <div ref={element => { view = element; }} class="pl-scroll-view" tabIndex={0} role="region" aria-label={props.label} onScroll={measure}>
      <div class="pl-scroll-body">{props.children}</div>
    </div>
    <div ref={element => { rail = element; }} class="pl-rail" aria-hidden="true" onPointerDown={rod}>
      <span class="pl-rail-bead" style={{ height: `${bead() * 100}%`, top: `${m().pos * (1 - bead()) * 100}%` }}
        onPointerDown={grab} onPointerMove={beadMove} onPointerUp={beadUp} onPointerCancel={beadUp} />
    </div>
  </div>;
}
