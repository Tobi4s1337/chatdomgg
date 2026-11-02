import { onCleanup, onMount } from 'solid-js';
import type { AtlasFooterSlot } from '../embed';

/** The public-page host owns its footer content and removes its listeners with the returned cleanup. */
export function FooterSlot(props: { mount: AtlasFooterSlot }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const cleanup = props.mount(host);
    onCleanup(() => { if (typeof cleanup === 'function') cleanup(); host.replaceChildren(); });
  });
  return <div ref={element => { host = element; }} class="atlas-footer-slot" data-atlas-footer-slot="true" />;
}
