import type { EarnedOffer } from '../../../../packages/content/src/avatar-style';

/*
 * What this device remembers about the wardrobe, never about the person: which unlocks it has already revealed (per
 * kingdom, since tenure and sub pieces are bound to one), which new pieces it has already shown with their "new"
 * seal, and whether the mirror was put off for later. The look itself lives on the realm; this is only courtesy.
 */

export interface DeviceStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

const KEY = 'chatdom.wardrobe.v1';
const CAP = 400;

interface Remembered { revealed: Record<string, string[]>; seen: string[]; mirrorLater: boolean }

const blank = (): Remembered => ({ revealed: {}, seen: [], mirrorLater: false });
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(-CAP) : []);

function read(store: DeviceStore | null): Remembered {
  if (!store) return blank();
  try {
    const raw: unknown = JSON.parse(store.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return blank();
    const r = raw as Partial<Record<keyof Remembered, unknown>>;
    const revealed: Record<string, string[]> = {};
    if (r.revealed && typeof r.revealed === 'object') for (const [k, v] of Object.entries(r.revealed)) revealed[k] = strings(v);
    return { revealed, seen: strings(r.seen), mirrorLater: r.mirrorLater === true };
  } catch { return blank(); }
}
function write(store: DeviceStore | null, value: Remembered): void {
  try { store?.setItem(KEY, JSON.stringify(value)); } catch { /* private mode or full: forgetting is harmless */ }
}

/** The page's own storage, or null where there is none (a sandboxed panel, a test). */
export function deviceStore(): DeviceStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** What a reveal remembers for an offer: a new month mark is a new unlock of its own. */
export function revealKey(offer: EarnedOffer): string {
  return offer.piece.family === 'ribbons' ? `${offer.key}:${offer.piece.value.months}` : offer.key;
}

/** Unlocked pieces this device has not yet revealed in this kingdom, in the builder's order. */
export function unrevealed(offers: readonly EarnedOffer[], kingdomId: string, store: DeviceStore | null): readonly EarnedOffer[] {
  const known = new Set(read(store).revealed[kingdomId] ?? []);
  return offers.filter(offer => offer.unlocked && !known.has(revealKey(offer)));
}

export function markRevealed(offers: readonly EarnedOffer[], kingdomId: string, store: DeviceStore | null): void {
  const value = read(store);
  const known = new Set(value.revealed[kingdomId] ?? []);
  for (const offer of offers) known.add(revealKey(offer));
  value.revealed[kingdomId] = [...known].slice(-CAP);
  write(store, value);
}

/** A new piece keeps its "new" seal on this device until it has been tried on once. */
export function seenNew(store: DeviceStore | null): ReadonlySet<string> { return new Set(read(store).seen); }
export function markSeen(pieceKey: string, store: DeviceStore | null): void {
  const value = read(store);
  if (value.seen.includes(pieceKey)) return;
  value.seen = [...value.seen, pieceKey].slice(-CAP);
  write(store, value);
}

export function mirrorPutOff(store: DeviceStore | null): boolean { return read(store).mirrorLater; }
export function putOffMirror(store: DeviceStore | null): void { const value = read(store); value.mirrorLater = true; write(store, value); }
