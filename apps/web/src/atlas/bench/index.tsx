import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { AtlasGateEvent } from '../../raid-gate/ports';
import type { KingdomId } from '../../../../api/src/raid-gate/contracts';
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
  const asked = query.get('mode');
  const mode = asked === 'explore' || asked === 'gate' ? asked : 'hero';
  // The gate bench opens the finder from a real source channel (tobi4s_ unless `from` names another Twitch ID).
  const from = (/^[0-9]{1,20}$/.test(query.get('from') ?? '') ? query.get('from')! : '129634568') as KingdomId;
  const [said, setSaid] = createSignal<AtlasGateEvent | null>(null);
  let life: AbortController | null = null;
  const mount = (options?: Partial<AtlasMountOptions>, target = element) => {
    if (target === element) handle?.dispose();
    const next = mountAtlas(target, { mode, routing: 'memory', onExplore: () => { next.setMode('explore'); }, ...options });
    handles.add(next);
    if (target === element) handle = next;
    if (next.gate && target === element) {
      life?.abort();
      life = new AbortController();
      next.gate.subscribe(setSaid, life.signal);
      next.gate.open(from, life.signal);
    }
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
  onCleanup(() => { life?.abort(); for (const current of handles) current.dispose(); delete window.__atlasBench; });
  if (mode === 'gate') {
    // The Raid Gate's own full surface: the map and its finder, and what the board told the gate.
    return <div class="atlas-embed-bench" data-bench="gate">
      <section ref={value => { element = value; }} class="atlas-embed-bench-gate" aria-label="Raid Gate map" />
      <Show when={said()}>{(event) => (
        <p class="atlas-embed-bench-said" role="status" data-gate-said={event().kind}>
          {event().kind === 'target' ? `The gate was told: ${(event() as Extract<AtlasGateEvent, { kind: 'target' }>).channel.displayName}` : 'The finder was closed'}
        </p>
      )}</Show>
    </div>;
  }
  return <div class="atlas-embed-bench">
    <header><a href="/map">Chatdom · Atlas</a><p>A living map of Twitch</p></header>
    <section ref={value => { element = value; }} class="atlas-embed-bench-map" aria-label="Atlas embed" />
    <footer><span>Scroll the page. Explore the land.</span><button onClick={() => handle?.setMode(handle.mode === 'hero' ? 'explore' : 'hero')}>Turn the map</button></footer>
  </div>;
}
