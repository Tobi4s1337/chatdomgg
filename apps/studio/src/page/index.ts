// The Twitch page replica. `mountPage(root)` returns a view whose `render(state)` draws exactly that state: the same
// state gives the same pixels, nothing moves on its own, and the promise resolves once layout is done, every image
// is decoded and every embedded frame has loaded.
import { createMemo, createSignal, type JSX } from 'solid-js';
import { createComponent, render as solidRender } from 'solid-js/web';
import { MEDIA, type PageRects, type PageState, type Rect } from '../types';
import { iconsReady } from './icons';
import { GEOMETRY, Page, type PageRefs } from './Page';
import css from './page.css?inline';

export interface PageView {
  render(state: PageState): Promise<void>;
  rects(): PageRects;
}
export { GEOMETRY };

/** Classes and marks inside our own frames that say SIMULATED; the teaser is staged footage and shows none. */
const HIDE_MARKS = [
  '.cp-tag.simulated', '.cp-simulated-note', '.cpp-chip', '.cpc-portrait-note', '.gcs-simulated', '.stream-bench-simulated',
  '[class*="source-mark"]', '[data-source-mark]',
].join(', ');
const MARK_TEXT = /^\s*simulated\b/i;

/** Hides SIMULATED chips and notes in a same-origin frame, now and whenever its content changes. */
function hideMarks(frame: HTMLIFrameElement): void {
  let doc: Document | null = null;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc?.documentElement) return;
  const owned = doc as Document & { __studioMarks?: boolean };
  if (!owned.__studioMarks) {
    owned.__studioMarks = true;
    const style = doc.createElement('style');
    style.textContent = `${HIDE_MARKS} { display: none !important; } [data-studio-hidden] { visibility: hidden !important; }`;
    (doc.head ?? doc.documentElement).appendChild(style);
    new MutationObserver(() => sweep(doc!)).observe(doc.documentElement, { subtree: true, childList: true, characterData: true });
  }
  sweep(doc);
}

/** Text that starts with "Simulated" in a small element (a chip or a fine-print note) is hidden in place. */
function sweep(doc: Document): void {
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!MARK_TEXT.test(node.textContent ?? '')) continue;
    const host = node.parentElement;
    if (host && !host.hasAttribute('data-studio-hidden') && (host.textContent ?? '').length < 240) host.setAttribute('data-studio-hidden', '');
  }
}

/** A macrotask that no virtual clock controls: yields to the browser without timers or animation frames. */
const yieldTask = () => new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(0); });

async function decoded(img: HTMLImageElement): Promise<void> {
  if (!img.getAttribute('src')) return;
  if (!img.complete) await new Promise<void>(resolve => { img.addEventListener('load', () => resolve(), { once: true }); img.addEventListener('error', () => resolve(), { once: true }); });
  if (img.naturalWidth > 0) await img.decode().catch(() => {});
}

async function loadFonts(): Promise<void> {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${MEDIA}/reference/fonts/fonts.css`;
  await new Promise<void>(resolve => { link.onload = () => resolve(); link.onerror = () => resolve(); document.head.appendChild(link); });
  await Promise.all(['400 14px Inter', '600 14px Inter', '700 14px Inter', '600 12px Inter', '500 18px Roobert', '600 14px Roobert', '700 18px Roobert']
    .map(font => document.fonts.load(font).catch(() => [])));
  await document.fonts.ready;
}

export function mountPage(root: HTMLElement): PageView {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const ready = Promise.all([iconsReady, loadFonts()]);

  const refs: PageRefs = {};
  const [state, setState] = createSignal<PageState | null>(null, { equals: false });
  const loads = new WeakMap<HTMLIFrameElement, { src: string; done: Promise<void> }>();
  let current: PageState | null = null;

  const onPanelLoad = (frame: HTMLIFrameElement) => hideMarks(frame);
  // The root returns an accessor, so the page mounts once the first state arrives and is reused after that.
  solidRender(() => {
    const mounted = createMemo(() => state() !== null);
    return (() => (mounted() ? createComponent(Page, { get state() { return state()!; }, refs, onPanelLoad }) : null)) as unknown as JSX.Element;
  }, root);

  /** The load of a frame's current document, plus the panel's own ready flag when it has one. */
  function frameLoaded(frame: HTMLIFrameElement | undefined): Promise<void> {
    if (!frame || !frame.isConnected) return Promise.resolve();
    const src = frame.getAttribute('src') ?? '';
    const known = loads.get(frame);
    if (known && known.src === src) return known.done;
    const done = new Promise<void>(resolve => {
      const finish = () => resolve();
      if (frame.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.href.endsWith(src)) finish();
      else frame.addEventListener('load', finish, { once: true });
    }).then(async () => {
      const win = frame.contentWindow as (Window & { __chatdomReady?: boolean }) | null;
      const drawn = () => win?.__chatdomReady === true || !!frame.contentDocument?.querySelector('[data-ready="true"]');
      // Wait for the embedded app to say it has drawn. Its module graph loads in real time and it signals from a
      // requestAnimationFrame, so flush zero-length frames of the virtual clock (time does not move) and sleep in
      // real time between checks. The bound is generous; a frame that misses it throws rather than recording a
      // half-drawn panel.
      const clock = (globalThis as { __virtualClock?: { advance(ms: number): void; realSleep(ms: number): Promise<void> } }).__virtualClock;
      for (let i = 0; i < 2400 && win && !drawn(); i++) {
        if (clock) { clock.advance(0); await clock.realSleep(25); } else await yieldTask();
      }
      if (win && !drawn() && clock) throw new Error(`${src}: the embedded app never said it had drawn`);
      hideMarks(frame);
    });
    loads.set(frame, { src, done });
    return done;
  }

  /** Twitch keeps the newest chat at the bottom once the list overflows; until then it fills from the top. */
  function anchorChat(): void {
    const list = refs.chatList, scroller = refs.chatScroller;
    if (!list || !scroller) return;
    list.style.transform = 'none';
    const offset = Math.min(0, scroller.clientHeight - list.offsetHeight);
    list.style.transform = offset ? `translateY(${offset}px)` : 'none';
  }

  return {
    async render(next: PageState): Promise<void> {
      await ready;
      current = next;
      setState(next);
      anchorChat();
      const images = [...root.querySelectorAll('img')];
      await Promise.all([...images.map(decoded), frameLoaded(refs.panelFrame), frameLoaded(refs.playerFrame)]);
      if (current !== next) return;
      // Images inside chat have fixed boxes, but anchor again in case a late font or image changed a line's height.
      anchorChat();
      if (refs.panelFrame) hideMarks(refs.panelFrame);
      if (refs.playerFrame) hideMarks(refs.playerFrame);
    },
    rects(): PageRects {
      const s = current;
      const page = root.getBoundingClientRect();
      const zoom = s?.camera.zoom ?? 1;
      const tx = s ? 960 - s.camera.cx * zoom : 0, ty = s ? 540 - s.camera.cy * zoom : 0;
      const untransform = (el: Element | undefined): Rect => {
        if (!el) return { x: 0, y: 0, width: 0, height: 0 };
        const r = el.getBoundingClientRect();
        return { x: (r.x - page.x - tx) / zoom, y: (r.y - page.y - ty) / zoom, width: r.width / zoom, height: r.height / zoom };
      };
      return {
        player: untransform(refs.player),
        chat: untransform(root.querySelector('.chat-column') ?? undefined),
        panel: untransform(refs.panelFrame),
      };
    },
  };
}
