/**
 * The place a visitor was in, kept across the trip to Twitch's sign-in. The sign-in service returns only to plain
 * paths (no query, no fragment), so the rest of the view travels in sessionStorage: written just before leaving and
 * read once on the way back. A view older than the sign-in itself (ten minutes, plus slack) is ignored.
 */
import type { SignInOutcome } from './signin';

export const RETURN_VIEW_KEY = 'chatdom:return-view:v1';
const MAX_AGE_MS = 15 * 60_000;
const PATH = /^\/(?:[a-z0-9_-]{1,40}(?:\/[a-z0-9_-]{1,40}){0,3})?$/;
const SECTION = /^[a-z][a-z0-9-]{0,39}$/;
const KINGDOM = /^[1-9][0-9]{0,31}$/;

export interface ReturnView {
  /** The page, as a plain path on this origin. */
  readonly path: string;
  /** The id of the section that was in view, when the page has sections. */
  readonly section?: string;
  /** The scroll position in CSS pixels, for pages without sections. */
  readonly scrollY?: number;
  /** A view handle's own state (the Atlas's position, zoom and open card), stored as given and returned untouched. */
  readonly view?: Readonly<Record<string, unknown>>;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const session = (): Store | null => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

/** Stores the view just before the browser leaves for sign-in. Storage may be off; then the trip simply loses it. */
export function rememberReturnView(view: ReturnView, store: Store | null = session(), now = Date.now()): void {
  if (!store || !PATH.test(view.path)) return;
  const kept: Record<string, unknown> = { path: view.path, at: now };
  if (view.section && SECTION.test(view.section)) kept.section = view.section;
  if (typeof view.scrollY === 'number' && Number.isFinite(view.scrollY) && view.scrollY >= 0) kept.scrollY = Math.round(view.scrollY);
  if (view.view && typeof view.view === 'object') kept.view = view.view;
  try { store.setItem(RETURN_VIEW_KEY, JSON.stringify(kept)); } catch { /* storage full or off: the view is not kept */ }
}

/** Returns the stored view once and forgets it, or null when none is fresh and well formed. */
export function takeReturnView(store: Store | null = session(), now = Date.now()): ReturnView | null {
  if (!store) return null;
  let raw: string | null;
  try { raw = store.getItem(RETURN_VIEW_KEY); store.removeItem(RETURN_VIEW_KEY); } catch { return null; }
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.path !== 'string' || !PATH.test(v.path) || typeof v.at !== 'number' || now - v.at > MAX_AGE_MS || v.at - now > 60_000) return null;
  return {
    path: v.path,
    ...(typeof v.section === 'string' && SECTION.test(v.section) ? { section: v.section } : {}),
    ...(typeof v.scrollY === 'number' && Number.isFinite(v.scrollY) && v.scrollY >= 0 ? { scrollY: v.scrollY } : {}),
    ...(v.view && typeof v.view === 'object' && !Array.isArray(v.view) ? { view: v.view as Record<string, unknown> } : {}),
  };
}

/**
 * The view the walk-in gate keeps. The gate's own address (`/?walk=1&kingdom=<id>`) has a query, which the sign-in
 * service refuses, so sign-in returns to the front page and the front page carries the visitor on to the gate.
 */
export function walkReturnView(kingdomId: string): ReturnView {
  if (!KINGDOM.test(kingdomId)) throw new Error('walkReturnView needs a kingdom id');
  return { path: '/', view: { walk: kingdomId } };
}

/** The walk-in gate of one kingdom, with the way back from Twitch carried along so the gate can say what happened. */
export function walkHref(kingdomId: string, outcome: SignInOutcome | null = null): string {
  if (!KINGDOM.test(kingdomId)) throw new Error('walkHref needs a kingdom id');
  return `/?walk=1&kingdom=${kingdomId}${outcome ? `&signin=${outcome}` : ''}`;
}

/**
 * Where a view taken on the way back from sign-in continues to, from the page sign-in returned to (`here`): the
 * walk-in gate it was kept for, or the page sign-in could not return to, with the outcome carried along. Null when
 * the view belongs to this page, so the page restores it in place.
 */
export function returnDestination(view: ReturnView, here: string, outcome: SignInOutcome | null = null): string | null {
  const walk = view.view?.walk;
  if (typeof walk === 'string' && KINGDOM.test(walk)) return walkHref(walk, outcome);
  if (view.path === here) return null;
  return `${view.path}${outcome ? `?signin=${outcome}` : ''}`;
}
