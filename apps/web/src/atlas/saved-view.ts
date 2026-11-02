import type { AtlasView } from './embed';
import { foundIds } from './map/found';

/** The camera part of a saved view, ready for the map (which clamps it to the land and the zoom range). */
export interface SavedCamera { x: number; y: number; scale: number }

/** A Twitch channel ID: digits only. A saved view's selection is nothing else. */
const CHANNEL_ID = /^[0-9]{1,20}$/;
/** Generous bounds a real camera never leaves; anything outside is a damaged or forged value. */
const MAX_COORD = 1e7;
const MIN_SCALE = 1e-6;
const MAX_SCALE = 1e4;

/**
 * Read a view the page saved earlier (`handle.view()`, carried through sign-in in session storage). It comes back
 * only for the same survey revision: positions are not comparable across revisions, so an older view falls back to
 * the map's own start. Anything malformed falls back the same way and never throws.
 */
export function savedView(value: unknown, mapId: string): { camera: SavedCamera; selected: string | null; found: string[] } | null {
  if (!value || typeof value !== 'object' || !mapId) return null;
  const view = value as Partial<Record<keyof AtlasView, unknown>>;
  if (view.mapId !== mapId) return null;
  const { x, y, scale } = view;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof scale !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD || scale < MIN_SCALE || scale > MAX_SCALE) return null;
  const selected = typeof view.selected === 'string' && CHANNEL_ID.test(view.selected) ? view.selected : null;
  // Found channels come back as IDs only; each is read again from the register before it is drawn.
  return { camera: { x, y, scale }, selected, found: foundIds(view.found) };
}

/**
 * The page's own requests to move the map (`restore`, `flyTo`): only the newest may still act. Beginning one cancels
 * the one before, so a late card reply from an earlier request can never reopen its card over a newer view.
 */
export class LatestRequest {
  private current: AbortController | null = null;

  /** Start a request; its signal aborts when a newer one begins or any of `signals` aborts. */
  begin(...signals: (AbortSignal | undefined)[]): AbortSignal {
    this.current?.abort();
    const controller = new AbortController();
    this.current = controller;
    const all = signals.filter((signal): signal is AbortSignal => !!signal);
    return all.length ? AbortSignal.any([controller.signal, ...all]) : controller.signal;
  }
}
