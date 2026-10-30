import { Show, createSignal, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import type { PromptView } from './view';
import './prompt.css';

/** Screen placement for the prompt: CSS px of the anchor, already projected by the scene. */
export interface PromptPlacement { readonly x: number; readonly y: number }
/** Keep the plaque this far inside the viewport edges. */
const EDGE = 12;

/**
 * The small carved invitation beside the thing being used. One verb, E on a brass key, and the same action as a
 * 44 px tap target. It never takes focus from the world and never shows IDs or debug words.
 */
export function InteractionPrompt(props: {
  readonly view: Accessor<PromptView | null>;
  readonly at: Accessor<PromptPlacement | null>;
  readonly coarse: boolean;
  readonly onUse: () => void;
}) {
  let plaque: HTMLDivElement | undefined;
  const style = () => {
    const at = props.at();
    if (!at) return { visibility: 'hidden' as const };
    const width = plaque?.offsetWidth ?? 0, height = plaque?.offsetHeight ?? 0;
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = Math.min(Math.max(at.x, EDGE + width / 2), vw - EDGE - width / 2);
    const y = Math.min(Math.max(at.y, EDGE + height), vh - EDGE);
    return { transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)` };
  };
  return (
    <Show when={props.view()}>
      {view => (
        <div class="ix-prompt" ref={element => { plaque = element; }} data-tone={view().tone} data-ix-prompt style={style()} role="group" aria-label="Interaction">
          <button
            type="button" class="ix-plaque" tabindex={-1} disabled={!view().actionable}
            aria-keyshortcuts={view().actionable && !props.coarse ? 'E' : undefined}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.preventDefault(); if (view().actionable) props.onUse(); }}
          >
            <Show when={view().tone === 'ready' && !props.coarse}><kbd class="ix-key" aria-hidden="true">E</kbd></Show>
            <Show when={view().tone === 'pending'}><i class="ix-ember" aria-hidden="true" /></Show>
            <span class="ix-words">
              <Show when={view().caption}>{caption => <small class="ix-caption">{caption()}</small>}</Show>
              <span class="ix-verb" aria-live="polite">{view().words}</span>
            </span>
          </button>
          <i class="ix-stem" aria-hidden="true" />
        </div>
      )}
    </Show>
  );
}

export interface PromptMount {
  update(view: PromptView | null, at: PromptPlacement | null): void;
  dispose(): void;
}
/** Explicit mount/update/dispose for a scene that drives the prompt from its frame loop. */
export function mountInteractionPrompt(host: HTMLElement, options: { readonly onUse: () => void; readonly coarse?: boolean }): PromptMount {
  const [view, setView] = createSignal<PromptView | null>(null, { equals: same });
  const [at, setAt] = createSignal<PromptPlacement | null>(null, { equals: (a, b) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5) });
  const layer = document.createElement('div');
  layer.className = 'ix-layer';
  host.append(layer);
  const coarse = options.coarse ?? window.matchMedia('(pointer: coarse)').matches;
  const stop = render(() => <InteractionPrompt view={view} at={at} coarse={coarse} onUse={options.onUse} />, layer);
  return {
    update(next, placement) { setView(next); setAt(next ? placement : null); },
    dispose() { stop(); layer.remove(); },
  };
}
function same(a: PromptView | null, b: PromptView | null): boolean {
  return a === b || (!!a && !!b && a.tone === b.tone && a.words === b.words && a.caption === b.caption && a.actionable === b.actionable && a.targetId === b.targetId);
}
