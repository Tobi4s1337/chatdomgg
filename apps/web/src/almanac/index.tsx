import { onCleanup, onMount } from 'solid-js';
import '../fishing/register-items';
import { mountAlmanacPage } from './page';
import { createGestureAlmanacSound } from './sound';

/** The kingdom's Almanac, open to anyone: `?kingdom=<id>`, read-only, with its own paper sound after a first touch. */
export default function AlmanacPage() {
  const query = new URLSearchParams(location.search);
  const kingdomId = query.get('kingdom')?.trim() ?? '';
  const open = query.get('page') ?? undefined;
  let host!: HTMLDivElement;
  let unmount: (() => void) | undefined;
  const sound = createGestureAlmanacSound(window);
  onMount(() => {
    document.title = 'The Almanac · Chatdom';
    unmount = mountAlmanacPage(host, { kingdomId, sound, ...(open ? { open } : {}) });
  });
  onCleanup(() => { unmount?.(); sound.dispose(); });
  return <div ref={element => { host = element; }} style={{ position: 'fixed', inset: 0, background: '#120b07', overflow: 'hidden' }} />;
}
