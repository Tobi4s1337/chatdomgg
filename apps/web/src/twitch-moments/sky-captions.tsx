import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { ScreenCaption } from './view';
import { boundCaptionPoint } from './caption-bounds';
import './sky-captions.css';

/**
 * The credit for a moment, drawn over the stream picture: a small walnut plate on a brass pin under the thing it
 * names, with the person's name in the stream's display face and what the kingdom did in italic. Positions come
 * from the view (`ScreenCaption.x/y`, CSS pixels of the picture); the plate never covers the light it describes,
 * because the view already hangs sky captions under the bursts. Mount it inside the element the canvas fills.
 */
export function SkyCaptions(props: { captions: readonly ScreenCaption[] }) {
  return <div class="sky-captions" aria-live="polite">
    <For each={props.captions}>{caption => <Caption caption={caption} />}</For>
  </div>;
}

function Caption(props: { caption: ScreenCaption }) {
  let element!: HTMLDivElement;
  const [point, setPoint] = createSignal({ x: props.caption.x, y: props.caption.y });
  onMount(() => {
    const picture = element.parentElement!;
    const update = () => setPoint(boundCaptionPoint(props.caption,
      { width: element.offsetWidth, height: element.offsetHeight }, { width: picture.clientWidth, height: picture.clientHeight }));
    const observer = new ResizeObserver(update); observer.observe(element); observer.observe(picture);
    createEffect(update);
    onCleanup(() => observer.disconnect());
  });
  return <div ref={node => { element = node; }} class="sky-caption" style={{ left: `${point().x}px`, top: `${point().y}px`, opacity: props.caption.opacity }}>
        <i class="sky-caption-pin" aria-hidden="true" />
        <strong>{props.caption.title}</strong>
        <span>{props.caption.line}</span>
        <Show when={props.caption.detail}><em>{props.caption.detail}</em></Show>
      </div>;
}
