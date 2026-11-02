import { type RaidPennantArchivePage, type Vec3 } from '@chatdom/shared';
import * as THREE from 'three';
import { TINCTURES } from '../atlas/heraldry';
import { bannerRuns, raiderArms } from '../twitch-moments/raid-art';
import './pennant-browser.css';

export interface RaidPennantBrowserState {
  open: boolean;
  loading: boolean;
  page: RaidPennantArchivePage | null;
  error: string | null;
  canOpen: boolean;
}
export interface RaidPennantBrowserSite { foot: Vec3; height: number; radius?: number }
export interface RaidPennantBrowserOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  sites: () => readonly RaidPennantBrowserSite[];
  visible?: (site: RaidPennantBrowserSite) => boolean;
  browser: {
    subscribe(receive: (state: RaidPennantBrowserState) => void): () => void;
    open(): void; older(): void; close(): void; retry(): void;
  };
  signal: AbortSignal;
}

function button(label: string, className: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className; element.textContent = label;
  element.addEventListener('click', action);
  return element;
}
function arms(id: string): SVGSVGElement | null {
  const design = raiderArms(id); if (!design) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 25'); svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('raid-pennant-browser__arms');
  const runs = bannerRuns(design.design, { width: 20, rows: 25, tail: 2, charges: true });
  for (let y = 0; y < runs.length; y++) for (const run of runs[y]!) {
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', String(run.x0)); rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(run.x1 - run.x0)); rect.setAttribute('height', '1');
    rect.setAttribute('fill', TINCTURES[run.tincture].pigment); svg.append(rect);
  }
  return svg;
}
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Where the trigger may rest. The wall's top often sits above the picture, so the trigger is clamped to the canvas
 * edge, where the page keeps its own controls (the Chronicle, the welcome note). It steps below whatever control would
 * cover it, and stays put when stepping down would leave the canvas.
 */
export function raidPennantTriggerTop(trigger: { left: number; top: number; width: number; height: number }, floor: number,
  coverAt: (x: number, y: number) => { bottom: number } | null): number {
  const { left, width, height } = trigger;
  let top = trigger.top;
  if (!(width > 0) || !(height > 0)) return top;
  for (let tries = 0; tries < 4; tries++) {
    let below = -Infinity;
    for (const x of [left + 2, left + width / 2, left + width - 2]) for (const y of [top + 2, top + height - 2]) {
      const cover = coverAt(x, y); if (cover && Number.isFinite(cover.bottom)) below = Math.max(below, cover.bottom);
    }
    if (below === -Infinity) return top;
    if (below + 8 + height > floor - 8) return trigger.top;
    top = below + 8;
  }
  return top;
}

/** A DOM reading surface attached to an existing visible wall; it owns no world input. */
export function mountRaidPennantBrowser(options: RaidPennantBrowserOptions): { dispose(): void } {
  const { canvas, camera, browser, signal } = options;
  const layer = document.createElement('div'); layer.className = 'raid-pennant-browser';
  const trigger = button('Read the pennants', 'raid-pennant-browser__trigger', () => browser.open());
  trigger.hidden = true; layer.append(trigger);
  const panel = document.createElement('section'); panel.className = 'raid-pennant-browser__panel';
  panel.hidden = true; panel.setAttribute('aria-label', 'Pennants at the gate');
  layer.append(panel); document.body.append(layer);
  let state: RaidPennantBrowserState = { open: false, loading: false, page: null, error: null, canOpen: false };
  let frame = 0, disposed = false, visible = false;
  const point = new THREE.Vector3(), cameraPoint = new THREE.Vector3();
  const box = new THREE.Box3(), projection = new THREE.Matrix4(), frustum = new THREE.Frustum();
  let previousFocus: HTMLElement | null = null;

  function render(next: RaidPennantBrowserState) {
    const wasOpen = state.open; state = next;
    if (!wasOpen && next.open) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.hidden = !next.open; trigger.hidden = next.open || !next.canOpen || !visible;
    if (!next.open) {
      panel.replaceChildren();
      if (wasOpen && previousFocus?.isConnected && visible && !document.pointerLockElement) previousFocus.focus();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const focusClass = panel.contains(active) ? active?.className : null;
    const header = document.createElement('header'); header.className = 'raid-pennant-browser__header';
    const kicker = document.createElement('span'); kicker.className = 'raid-pennant-browser__kicker'; kicker.textContent = 'THE GATE · A RECORD OF VISITS';
    const title = document.createElement('h2'); title.textContent = 'Pennants at the gate';
    const close = button('Close', 'raid-pennant-browser__close', () => browser.close());
    header.append(kicker, title, close);
    const body = document.createElement('div'); body.className = 'raid-pennant-browser__body';
    body.setAttribute('aria-live', 'polite');
    if (next.page && next.page.items.length > 0) {
      const list = document.createElement('ol'); list.className = 'raid-pennant-browser__list';
      for (const item of next.page.items.slice(0, 12)) {
        const row = document.createElement('li'); row.className = 'raid-pennant-browser__row';
        const mark = arms(item.from.kingdomId); if (mark) row.append(mark);
        const words = document.createElement('div'); words.className = 'raid-pennant-browser__words';
        const name = document.createElement('strong'); name.textContent = item.from.name;
        const date = document.createElement('time'); date.dateTime = new Date(item.occurredAt).toISOString();
        date.textContent = dateFormat.format(item.occurredAt);
        words.append(name, date); row.append(words); list.append(row);
      }
      body.append(list);
    }
    const status = document.createElement('p'); status.className = 'raid-pennant-browser__message';
    status.setAttribute('role', 'status');
    if (next.loading) status.textContent = 'Turning the pages…';
    else if (next.error) status.textContent = 'The visits could not be read just now.';
    else if (!next.page || next.page.items.length === 0) status.textContent = 'No visits are recorded here yet.';
    else status.textContent = next.page.next === null ? 'No earlier visits' : `${next.page.items.length} ${next.page.items.length === 1 ? 'visit' : 'visits'}`;
    body.append(status);
    if (next.error && !next.loading) body.append(button('Retry', 'raid-pennant-browser__retry', () => browser.retry()));
    const footer = document.createElement('footer'); footer.className = 'raid-pennant-browser__footer';
    footer.append(button('Recent visits', 'raid-pennant-browser__recent', () => browser.close()));
    if (next.page?.next != null) {
      const older = button('Earlier visits', 'raid-pennant-browser__older', () => { if (!state.loading) browser.older(); });
      older.setAttribute('aria-disabled', String(next.loading)); footer.append(older);
    }
    panel.replaceChildren(header, body, footer);
    if (!wasOpen) close.focus();
    else if (focusClass) {
      const restored = panel.querySelector<HTMLElement>(`.${String(focusClass).split(' ')[0]}`);
      (restored ?? panel.querySelector<HTMLElement>('.raid-pennant-browser__recent') ?? close).focus();
    }
  }
  const unsubscribe = browser.subscribe(render);
  function hideWhenUnavailable() {
    if (document.hidden || document.pointerLockElement) {
      visible = false; trigger.hidden = true;
      if (state.open) browser.close();
    }
  }
  document.addEventListener('visibilitychange', hideWhenUnavailable);
  document.addEventListener('pointerlockchange', hideWhenUnavailable);
  function position() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    let anchor: { x: number; y: number } | null = null;
    if (!document.hidden && !document.pointerLockElement && rect.width > 0 && rect.height > 0) {
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      for (const site of options.sites()) {
        if (!site.foot.every(Number.isFinite) || !Number.isFinite(site.height) || site.height <= 0) continue;
        try { if (options.visible && !options.visible(site)) continue; } catch { continue; }
        const radius = Number.isFinite(site.radius) && site.radius! > 0 ? site.radius! : 1.5;
        const [x, y, z] = site.foot;
        box.min.set(x - radius, y, z - radius); box.max.set(x + radius, y + site.height, z + radius);
        if (!frustum.intersectsBox(box)) continue;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const px of [box.min.x, box.max.x]) for (const py of [box.min.y, box.max.y]) for (const pz of [box.min.z, box.max.z]) {
          point.set(px, py, pz);
          cameraPoint.copy(point).applyMatrix4(camera.matrixWorldInverse);
          if (cameraPoint.z >= 0) continue;
          point.project(camera);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
        if (minX > 1 || maxX < -1 || minY > 1 || maxY < -1 || !Number.isFinite(minX)) continue;
        const screenX = (Math.max(-1, minX) + Math.min(1, maxX)) / 2;
        const screenY = Math.min(1, maxY);
        anchor = { x: rect.left + (screenX + 1) * rect.width / 2, y: rect.top + (1 - screenY) * rect.height / 2 }; break;
      }
    }
    visible = anchor !== null;
    if (!visible && state.open) browser.close();
    trigger.hidden = !visible || !state.canOpen || state.open;
    if (anchor) {
      const left = Math.max(rect.left + 8, Math.min(anchor.x - trigger.offsetWidth / 2, rect.right - trigger.offsetWidth - 8));
      const top = clearOfPage(left, Math.max(rect.top + 8, Math.min(anchor.y - trigger.offsetHeight - 10, rect.bottom - trigger.offsetHeight - 8)), rect);
      trigger.style.left = `${left}px`; trigger.style.top = `${top}px`;
      if (state.open) {
        panel.style.maxWidth = `${Math.max(0, rect.width - 16)}px`;
        panel.style.maxHeight = `${Math.max(0, Math.min(650, rect.height - 16))}px`;
        const width = panel.offsetWidth, height = panel.offsetHeight;
        panel.style.left = `${Math.max(rect.left + 8, Math.min(anchor.x - width / 2, rect.right - width - 8))}px`;
        panel.style.top = `${Math.max(rect.top + 8, Math.min(anchor.y - height - 10, rect.bottom - height - 8))}px`;
      }
    }
    frame = requestAnimationFrame(position);
  }
  /** What page control covers a point above the canvas: the first one over it that is not this layer's own. */
  function coverAt(x: number, y: number): { bottom: number } | null {
    for (const element of document.elementsFromPoint(x, y)) {
      if (layer.contains(element)) continue;
      if (element === canvas || element.contains(canvas)) return null;
      return element.getBoundingClientRect();
    }
    return null;
  }
  function clearOfPage(left: number, top: number, rect: DOMRect): number {
    if (typeof document.elementsFromPoint !== 'function') return top;
    return raidPennantTriggerTop({ left, top, width: trigger.offsetWidth, height: trigger.offsetHeight }, rect.bottom, coverAt);
  }
  function dispose() {
    if (disposed) return; disposed = true; cancelAnimationFrame(frame); unsubscribe();
    signal.removeEventListener('abort', dispose);
    document.removeEventListener('visibilitychange', hideWhenUnavailable);
    document.removeEventListener('pointerlockchange', hideWhenUnavailable); layer.remove();
  }
  if (signal.aborted) dispose(); else { signal.addEventListener('abort', dispose, { once: true }); frame = requestAnimationFrame(position); }
  return { dispose };
}
