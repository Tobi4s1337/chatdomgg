import { onCleanup, onMount } from 'solid-js';
import { mountAtlas, type AtlasHandle, type AtlasMountOptions } from '../embed';
import './bench.css';

declare global {
  interface Window {
    __atlasBench?: {
      readonly handle: AtlasHandle | undefined;
      mount(options?: Partial<AtlasMountOptions>, element?: HTMLElement): AtlasHandle;
      dispose(): void;
    };
  }
}
export default function AtlasEmbedBench() {
  let element!: HTMLElement;
  let handle: AtlasHandle | undefined;
  const handles = new Set<AtlasHandle>();
  const query = new URLSearchParams(location.search);
  const mode = query.get('mode') === 'explore' ? 'explore' : 'hero';
  const mount = (options?: Partial<AtlasMountOptions>, target = element) => {
    if (target === element) handle?.dispose();
    const next = mountAtlas(target, { mode, routing: 'memory', onExplore: () => { next.setMode('explore'); }, ...options });
    handles.add(next);
    if (target === element) handle = next;
    return next;
  };
  onMount(() => {
    document.title = 'Atlas embed · Chatdom';
    window.__atlasBench = { get handle() { return handle; }, mount, dispose() { handle?.dispose(); handle = undefined; } };
    if (!query.has('lazy')) {
      const current = mount();
      void current.ready.then(() => { window.__chatdomReady = true; });
    }
  });
  onCleanup(() => { for (const current of handles) current.dispose(); delete window.__atlasBench; });
  return <div class="atlas-embed-bench">
    <header><a href="/map">Chatdom · Atlas</a><p>A living map of Twitch</p></header>
    <section ref={value => { element = value; }} class="atlas-embed-bench-map" aria-label="Atlas embed" />
    <footer><span>Scroll the page. Explore the land.</span><button onClick={() => handle?.setMode(handle.mode === 'hero' ? 'explore' : 'hero')}>Turn the map</button></footer>
  </div>;
}
