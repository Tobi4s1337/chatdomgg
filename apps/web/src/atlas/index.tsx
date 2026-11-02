import { onCleanup, onMount } from 'solid-js';
import { mountAtlas, type AtlasHandle } from './embed';

/** The public page uses exactly the same mount as the front page's embedded map. */
export default function Atlas() {
  let host!: HTMLDivElement;
  let handle: AtlasHandle | undefined;
  onMount(() => {
    document.title = 'The Atlas of Kingdoms · Chatdom';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#e2d3ae');
    window.__chatdomReady = false;
    handle = mountAtlas(host, { mode: 'explore', routing: 'url' });
    void handle.ready.then(() => { if (handle) window.__chatdomReady = true; });
  });
  onCleanup(() => { handle?.dispose(); handle = undefined; });
  return <div ref={value => { host = value; }} style={{ position: 'fixed', inset: '0' }} />;
}
