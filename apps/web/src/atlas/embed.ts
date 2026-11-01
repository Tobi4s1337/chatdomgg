import type { AtlasGateHost } from '../raid-gate/ports';

export type AtlasMode = 'hero' | 'explore' | 'gate';
export type AtlasTarget = { login: string } | { channelId: string };
/** Mount owned footer content; its cleanup runs on hero mode or disposal. Never called for a hero. */
export type AtlasFooterSlot = (element: HTMLElement) => void | (() => void);
export interface AtlasMountOptions {
  mode: AtlasMode;
  focus?: AtlasTarget | null;
  routing?: 'url' | 'memory';
  onExplore?: (view: AtlasView) => void;
  base?: string;
  signal?: AbortSignal;
  slots?: { footer?: AtlasFooterSlot };
}
export interface AtlasView { x: number; y: number; scale: number; selected: string | null; mapId: string }
export type AtlasReadyState = 'map' | 'still' | 'failed';
export interface AtlasHandle {
  readonly mode: AtlasMode;
  readonly ready: Promise<AtlasReadyState>;
  readonly gate: AtlasGateHost | null;
  view(): AtlasView;
  flyTo(target: AtlasTarget, options?: { openCard?: boolean; signal?: AbortSignal }): Promise<boolean>;
  setMode(mode: 'hero' | 'explore'): void;
  dispose(): void;
}

/** Internal scene boundary. This module deliberately has no runtime imports. */
export interface AtlasScene {
  view(): AtlasView;
  flyTo: AtlasHandle['flyTo'];
  setMode(mode: 'hero' | 'explore'): void;
  dispose(): void;
}

export function mountAtlas(el: HTMLElement, options: AtlasMountOptions): AtlasHandle {
  // Gate is introduced with its authority-driven finder in AM11; don't pretend it is an explore map.
  if (options.mode === 'gate') throw new Error('Atlas gate mode is not available yet');
  let mode = options.mode;
  let scene: AtlasScene | null = null;
  let disposed = false;
  let resolveReady!: (state: AtlasReadyState) => void;
  const ready = new Promise<AtlasReadyState>(resolve => { resolveReady = resolve; });
  const root = document.createElement('div');
  root.dataset.chatdomAtlas = '';
  root.dataset.atlasMode = mode;
  root.dataset.atlasReady = 'loading';
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#e2d3ae' });
  el.append(root);
  const controller = new AbortController();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    options.signal?.removeEventListener('abort', dispose);
    scene?.dispose();
    scene = null;
    root.remove();
    resolveReady('failed');
  };
  if (options.signal?.aborted) dispose();
  else options.signal?.addEventListener('abort', dispose, { once: true });
  const loading = disposed ? Promise.resolve() : import('./scene').then(module => {
    if (disposed) return;
    scene = module.mountScene(root, { ...options, mode, signal: controller.signal }, state => {
      if (disposed) return;
      root.dataset.atlasReady = state;
      resolveReady(state);
    });
  }).catch(() => {
    if (disposed) return;
    root.dataset.atlasReady = 'failed';
    root.textContent = 'The map room is closed. Try again in a moment.';
    root.style.cssText += ';display:grid;place-items:center;padding:24px;color:#3b2f25;font:20px Georgia,serif;text-align:center';
    resolveReady('failed');
  });
  return {
    get mode() { return mode; }, ready, gate: null,
    view: () => scene?.view() ?? { x: 0, y: 0, scale: 1, selected: null, mapId: '' },
    async flyTo(target, flyOptions) {
      await loading;
      if (disposed || flyOptions?.signal?.aborted || !scene) return false;
      await ready;
      return !disposed && !flyOptions?.signal?.aborted ? scene.flyTo(target, flyOptions) : false;
    },
    setMode(next) {
      if (disposed) return;
      mode = next;
      root.dataset.atlasMode = next;
      scene?.setMode(next);
    },
    dispose,
  };
}

/** Warm only the module and immutable world head; mounting remains the only operation that draws. */
export async function preloadAtlas(options?: { base?: string }): Promise<void> {
  const [{ fetchPointer, fetchWorld }] = await Promise.all([import('./data/preview'), import('./scene')]);
  const source = { base: options?.base ?? '/map-data', fetch: globalThis.fetch.bind(globalThis) };
  const pointer = await fetchPointer(source);
  await fetchWorld(source, pointer);
}
