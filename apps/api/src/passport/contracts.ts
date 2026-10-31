/**
 * The passport's read boundary (spec 45). Browser-safe: it imports the frozen `@chatdom/shared/passport` schemas and
 * nothing from the server, so the reader a surface uses on a reply is the same reader the server checks its own
 * reply with before sending.
 *
 * Two reads exist and nothing else: the book (holder, revision, as-of and the first page of each collection, or the
 * hidden variant) and one further page of one collection, read against the book's revision. A page reply carries the
 * revision it belongs to, so a surface never stitches pages of two different snapshots together.
 */
import {
  PassportBondSchema, PassportBookSchema, PassportKeepsakeSchema, PassportStampSchema, PassportVisitSchema,
  type PassportBook,
} from '@chatdom/shared/passport';

export type { PassportBook };
export type VisiblePassportBook = Extract<PassportBook, { visibility: 'visible' }>;
export type HiddenPassportBook = Extract<PassportBook, { visibility: 'hidden' }>;

export const PASSPORT_COLLECTIONS = ['stamps', 'kingdoms', 'bonds', 'keepsakes'] as const;
export type PassportCollection = (typeof PASSPORT_COLLECTIONS)[number];
export type PassportItem<K extends PassportCollection> = VisiblePassportBook[K]['items'][number];
export interface PassportPageOf<K extends PassportCollection> { readonly items: readonly PassportItem<K>[]; readonly nextCursor: string | null }

export const PASSPORT_LIMITS = Object.freeze({
  /** Records in one page of one collection (frozen schema). */
  page: 50,
  /** Opaque cursor length (frozen schema). */
  cursor: 256,
  /** Book revision token length (shared `TokenSchema`). */
  revision: 128,
});

export type PassportRequest =
  | Readonly<{ op: 'book' }>
  | Readonly<{ op: 'page'; collection: PassportCollection; cursor: string; revision: string }>;

export type PassportDenial = 'stale' | 'unavailable' | 'invalid';
export type PassportPageReply = { [K in PassportCollection]: Readonly<{ kind: 'page'; collection: K; revision: string; page: PassportPageOf<K> }> }[PassportCollection];
export type PassportReply =
  | Readonly<{ kind: 'book'; book: PassportBook }>
  | PassportPageReply
  | Readonly<{ kind: 'denied'; code: PassportDenial }>;

const ITEM_SCHEMA = { stamps: PassportStampSchema, kingdoms: PassportVisitSchema, bonds: PassportBondSchema, keepsakes: PassportKeepsakeSchema } as const;
/** The identity of a record inside its collection, the same keys the frozen book checks for duplicates. */
export const RECORD_KEY: { readonly [K in PassportCollection]: (item: PassportItem<K>) => string } = {
  stamps: stamp => stamp.id,
  kingdoms: visit => visit.kingdom.kingdomId,
  bonds: bond => bond.id,
  keepsakes: keepsake => keepsake.id,
};
/** The newest moment a record speaks of, which can never be later than the book's as-of. */
export const RECORD_TIME: { readonly [K in PassportCollection]: (item: PassportItem<K>) => number } = {
  stamps: stamp => stamp.at,
  kingdoms: visit => visit.lastAt,
  bonds: bond => bond.since,
  keepsakes: keepsake => keepsake.earnedAt,
};
const DENIALS: readonly PassportDenial[] = ['stale', 'unavailable', 'invalid'];

type Fields = Readonly<Record<string, unknown>>;
function fields(value: unknown, keys: readonly string[]): Fields | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) return undefined;
  return value as Fields;
}

export const isPassportCollection = (value: unknown): value is PassportCollection => (PASSPORT_COLLECTIONS as readonly unknown[]).includes(value);
const isCursor = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= PASSPORT_LIMITS.cursor;
const isRevision = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= PASSPORT_LIMITS.revision && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);

/** The only way a passport read enters the server. Unknown ops, extra keys and subject fields are refused. */
export function readPassportRequest(value: unknown): PassportRequest | undefined {
  const op = typeof value === 'object' && value !== null ? (value as { op?: unknown }).op : undefined;
  if (op === 'book') return fields(value, ['op']) ? { op } : undefined;
  if (op !== 'page') return undefined;
  const f = fields(value, ['op', 'collection', 'cursor', 'revision']);
  if (!f || !isPassportCollection(f.collection) || !isCursor(f.cursor) || !isRevision(f.revision)) return undefined;
  return { op, collection: f.collection, cursor: f.cursor, revision: f.revision };
}

/** A whole book through the frozen schema; anything it refuses is not a passport. */
export function readPassportBook(value: unknown): PassportBook | undefined {
  const parsed = PassportBookSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** One further page of one collection: each record through its frozen schema, bounded and without duplicates. */
export function readPassportPage<K extends PassportCollection>(collection: K, value: unknown): PassportPageOf<K> | undefined {
  const f = fields(value, ['items', 'nextCursor']);
  if (!f || !Array.isArray(f.items) || f.items.length > PASSPORT_LIMITS.page) return undefined;
  if (f.nextCursor !== null && !isCursor(f.nextCursor)) return undefined;
  const schema = ITEM_SCHEMA[collection];
  const items: PassportItem<K>[] = [];
  for (const item of f.items) {
    const parsed = schema.safeParse(item);
    if (!parsed.success) return undefined;
    items.push(parsed.data as PassportItem<K>);
  }
  const key = RECORD_KEY[collection] as (item: PassportItem<K>) => string;
  if (new Set(items.map(key)).size !== items.length) return undefined;
  // A page that ends its collection must say so with a null cursor; an empty page that claims more is a loop.
  if (items.length === 0 && f.nextCursor !== null) return undefined;
  return { items, nextCursor: f.nextCursor as string | null };
}

/** Re-reads a reply from any transport. Used by the server before sending and by every surface after receiving. */
export function readPassportReply(value: unknown): PassportReply | undefined {
  const kind = typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  if (kind === 'denied') {
    const f = fields(value, ['kind', 'code']);
    return f && DENIALS.includes(f.code as PassportDenial) ? { kind, code: f.code as PassportDenial } : undefined;
  }
  if (kind === 'book') {
    const f = fields(value, ['kind', 'book']);
    const book = f && readPassportBook(f.book);
    return book ? { kind, book } : undefined;
  }
  if (kind === 'page') {
    const f = fields(value, ['kind', 'collection', 'revision', 'page']);
    if (!f || !isPassportCollection(f.collection) || !isRevision(f.revision)) return undefined;
    const page = readPassportPage(f.collection, f.page);
    return page ? { kind, collection: f.collection, revision: f.revision, page } as PassportPageReply : undefined;
  }
  return undefined;
}

/** The hidden variant: no holder, revision, as-of, counts, cursors or history, whatever the source held. */
export const hiddenPassport = (origin: PassportBook['origin']): HiddenPassportBook => ({ version: 1, origin, visibility: 'hidden' });
