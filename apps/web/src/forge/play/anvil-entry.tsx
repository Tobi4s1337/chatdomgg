import { onCleanup, onMount, Show } from 'solid-js';
import { openForge, type ForgeHandle } from './panel';

/**
 * The anvil in the walk until play's HUD slot lands (SEAMS.md §1). In a founded kingdom, stepping up to the anvil opens
 * the same wish box play's slot will open; elsewhere the anvil keeps the chat line. The walk released the pointer when
 * the anvil opened; closing the wish box ends the anvil visit, which hands the pointer back to the walk.
 */
export function AnvilEntry(props: { readonly kingdomId?: string | undefined; readonly onLeave: () => void }) {
  return (
    <Show when={props.kingdomId} keyed fallback={<ChatLine onLeave={props.onLeave} />}>
      {kingdomId => <WishBox kingdomId={kingdomId} onLeave={props.onLeave} />}
    </Show>
  );
}

function WishBox(props: { readonly kingdomId: string; readonly onLeave: () => void }) {
  let root: HTMLDivElement | undefined;
  let wish: ForgeHandle | undefined, ending = false;
  onMount(() => {
    if (!root) return;
    // The visit ending from the walk disposes the box; only the box's own close ends the visit.
    wish = openForge({ root, kingdomId: props.kingdomId, onClosed: () => { if (!ending) props.onLeave(); },
      // The walk owns pointer lock (SEAMS.md §1): it released the pointer for the anvil and takes it back on leave.
      releasePointer: () => {}, restorePointer: () => {} }, 'anvil');
  });
  onCleanup(() => { ending = true; wish?.dispose(); });
  return <div ref={node => { root = node; }} />;
}

function ChatLine(props: { readonly onLeave: () => void }) {
  return (
    <section class="forge-panel" role="dialog" aria-label="At the anvil">
      <div class="forge-panel-top"><span class="forge-eyebrow">THE FORGE</span><button onClick={() => props.onLeave()} aria-label="Leave the anvil">×</button></div>
      <h2>Give the smith a wish.</h2>
      <p class="forge-message">Write <code>!forge a chimney shaped like a sleeping dragon</code> in Twitch chat. When the fire is awake and you have a coal, your words can become part of your home.</p>
      <p class="forge-footnote">The anvil listens to chat. Escape returns you to the street.</p>
      <button class="forge-submit" onClick={() => props.onLeave()}>Back to the street</button>
    </section>
  );
}
