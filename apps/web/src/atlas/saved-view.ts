import type { AtlasView } from './embed';

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
export function savedView(value: unknown, mapId: string): { camera: SavedCamera; selected: string | null } | null {
  if (!value || typeof value !== 'object' || !mapId) return null;
  const view = value as Partial<Record<keyof AtlasView, unknown>>;
  if (view.mapId !== mapId) return null;
  const { x, y, scale } = view;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof scale !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD || scale < MIN_SCALE || scale > MAX_SCALE) return null;
  const selected = typeof view.selected === 'string' && CHANNEL_ID.test(view.selected) ? view.selected : null;
  return { camera: { x, y, scale }, selected };
}
