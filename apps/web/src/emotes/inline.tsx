import { createMemo, For, onCleanup, Show, type JSX } from 'solid-js';
import type { EmoteChatInline, InlineEmoteVisual } from '../../../../packages/emotes/src/index';
import type { InlineEmoteImages } from './inline-images';

export { createInlineEmoteImages, type InlineEmoteImages, type ObjectUrlApi } from './inline-images';

/** One verified emote image at chat size; its object URL lives exactly as long as the element. */
export function EmoteImage(props: { visual: InlineEmoteVisual; alt: string; images: InlineEmoteImages; size: number; class?: string }): JSX.Element {
  // Re-runs only when the visual changes; the cleanup lets go of the previous one first.
  const url = createMemo(() => {
    const visual = props.visual;
    onCleanup(() => props.images.release(visual));
    return props.images.acquire(visual);
  });
  return <img class={props.class ?? 'emote-chat-image'} src={url()} alt={props.alt} title={props.alt} width={props.size} height={props.size} draggable={false} decoding="async" />;
}

/**
 * A message's ordered parts at chat size. Text is a text node, never markup. An emote is its verified
 * image with its typed name as alt text; unknown, unavailable or retired emotes stay readable words.
 */
export function EmoteInlineParts(props: { parts: readonly EmoteChatInline[]; images: InlineEmoteImages; size?: number }): JSX.Element {
  return <For each={props.parts}>{part => part.kind === 'text'
    ? <>{part.text}</>
    : <Show when={part.visual} keyed fallback={<span class="emote-chat-alt">{part.alt}</span>}>
      {visual => <EmoteImage visual={visual} alt={part.alt} images={props.images} size={props.size ?? 26} />}
    </Show>}
  </For>;
}

/** The kingdom's parchment speech bubble, carrying inline emotes. */
export function EmoteChatBubble(props: { parts: readonly EmoteChatInline[]; images: InlineEmoteImages; x: number; y: number; label?: string }): JSX.Element {
  return <div class="emote-chat-bubble" style={{ transform: `translate3d(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px, 0) translate(-50%, -100%)` }}>
    <p><EmoteInlineParts parts={props.parts} images={props.images} /></p>
  </div>;
}

/** A message that was one emote, lifted above its sender in a small brass-rimmed token. */
export function EmoteChatPop(props: { visual: InlineEmoteVisual; alt: string; images: InlineEmoteImages; x: number; y: number; scale: number; opacity: number }): JSX.Element {
  return <div class="emote-chat-pop" role="img" aria-label={props.alt}
    style={{ transform: `translate3d(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${props.scale.toFixed(3)})`, opacity: props.opacity.toFixed(3) }}>
    <EmoteImage visual={props.visual} alt={props.alt} images={props.images} size={46} class="emote-chat-pop-image" />
  </div>;
}
