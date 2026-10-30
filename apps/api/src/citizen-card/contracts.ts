/**
 * The citizen card's lane-local boundary (spec 19). The server owns these runtime checks; the browser imports
 * the public document types only (`import type`), never this module's code.
 *
 * Every reader builds a fresh object from the keys it knows, so an unknown key, a raw source field or a repository
 * extra can never ride along into a public payload. A corrupt record is rejected with a path, never repaired by
 * guessing which part of it was meant.
 */
import {
  CitizenKeySchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema,
  type CitizenKey, type KingdomId, type PersonId,
} from '../../../../packages/shared/src/identity';

export type { CitizenKey, KingdomId, PersonId };

/** Hard ceilings for one public document. Collections page; nothing here is a soft hint. */
export const CARD_LIMITS = {
  /** A person lives in at most three kingdoms; their own castle is separate (World-Tree rule 9). */
  homes: 3,
  /** Rows in one collection page (stamps, pieces, honours, guestbook entries). */
  pageEntries: 40,
  /** Opaque cursor length. */
  cursor: 256,
  /** Asset revisions a card's public views may depend on. */
  dependencies: 96,
  name: 128,
  login: 64,
  place: 96,
  alt: 240,
  path: 512,
  guestbookText: 500,
} as const;

export type EpochMs = number;
export type CardOrigin = 'live' | 'simulated';
export type CardOffice = 'monarch' | 'moderator' | 'vip';
export type SubTier = 1 | 2 | 3;

/** Person revision: sign-in disclosure, homes, travel privacy. Citizen revision: this kingdom's card and house. */
export interface CardRevision { readonly person: number; readonly citizen: number }
/** Bytes come only from the approved asset port for this exact revision. */
export interface CardAssetRef { readonly id: string; readonly revision: number; readonly alt: string }

export interface CardHome {
  readonly kingdomId: KingdomId;
  readonly kingdomName: string;
  readonly home: string;
  readonly street: string | null;
  readonly image: CardAssetRef | null;
  /** Host-validated same-origin path, never an arbitrary URL. */
  readonly path: string | null;
}

export type CardCollection<T> =
  | { readonly availability: 'known'; readonly entries: readonly T[]; readonly next: string | null }
  | { readonly availability: 'unavailable' };

export interface CardStamp {
  readonly id: string;
  readonly kind: 'visit' | 'raid';
  readonly kingdomId: KingdomId;
  readonly kingdomName: string;
  readonly at: EpochMs;
  readonly path: string | null;
}

/** Display facts about one accepted piece. Not an executable plan and not proof of ownership. */
export interface CardPiece {
  readonly id: string;
  readonly name: string;
  readonly kind: 'forged' | 'imported';
  readonly image: CardAssetRef | null;
  readonly makerName: string | null;
  readonly kingdomName: string | null;
  readonly firstMadeAt: EpochMs | null;
  readonly originalDesignId: string | null;
  readonly copyOf: string | null;
  readonly importerName: string | null;
  readonly sourceCredit: string | null;
}

export interface CardHonour {
  readonly id: string;
  readonly kind: 'game-win' | 'duskscale';
  readonly name: string;
  /** A witnessed count; a known zero is zero here, an unknown history is an unavailable collection. */
  readonly count: number;
  readonly at: EpochMs | null;
  readonly image: CardAssetRef | null;
}

export interface GuestbookEntry {
  readonly id: string;
  readonly writerName: string;
  readonly at: EpochMs;
  readonly text: string;
}

export interface HousePlaqueDocument {
  readonly id: string;
  readonly builtAt: EpochMs | null;
  readonly visitorCount: number | null;
  readonly pieces: CardCollection<CardPiece>;
  readonly guestbook: CardCollection<GuestbookEntry>;
}

export type CardPassport = { readonly hidden: true } | { readonly hidden: false; readonly stamps: CardCollection<CardStamp> };

export interface CardIdentity {
  /** The current Twitch login. It may change; the card's identity is `key`. */
  readonly login: string;
  readonly name: string;
  /** Their chat colour as `#rrggbb`, or null when Twitch has none for them. */
  readonly colour: string | null;
  /** Supplied office in this kingdom. Subs, Bits and local UI never assign it. */
  readonly office: CardOffice | null;
  readonly portrait: CardAssetRef | null;
}

/** Null means not witnessed. A follow date, cumulative months and an active tier are separate facts. */
export interface CardTenure {
  readonly followedAt: EpochMs | null;
  readonly subscribedMonths: number | null;
  readonly activeTier: SubTier | null;
}

/** The public, safe card. This is the only shape that may reach a browser, a stream frame or a share image. */
export interface CitizenCardDocument {
  readonly key: CitizenKey;
  readonly kingdomName: string;
  readonly revision: CardRevision;
  readonly origin: CardOrigin;
  readonly identity: CardIdentity;
  readonly tenure: CardTenure;
  readonly citizenNumber: number | null;
  /** Their home in this kingdom; null for a guest without one. */
  readonly address: { readonly home: string; readonly street: string } | null;
  readonly homes: readonly CardHome[];
  readonly castle: CardHome | null;
  readonly passport: CardPassport;
  readonly pieces: CardCollection<CardPiece>;
  readonly honours: CardCollection<CardHonour>;
  readonly house: HousePlaqueDocument | null;
}

export interface CardDependency { readonly assetId: string; readonly revision: number }

/**
 * A trusted server-only snapshot from witnessed records. Its document may still hold homes and stamps the person
 * has not disclosed; `projectCard()` is the only way out of it.
 */
export interface CardSource {
  readonly document: CitizenCardDocument;
  readonly subjectFirstSignedInAt: EpochMs | null;
  readonly travelsHidden: boolean;
  readonly dependencies: readonly CardDependency[];
}

export class CardContractError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'CardContractError';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Readers

type Reader<T> = (value: unknown, path: string) => T;
const fail = (path: string, message: string): never => { throw new CardContractError(path, message); };

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'expected an object');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return fail(path, 'expected a plain object');
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'missing field');
  return value as Record<string, unknown>;
}

function fromZod<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, what: string): Reader<T> {
  return (value, path) => {
    const result = schema.safeParse(value);
    return result.success ? result.data : fail(path, `expected ${what}`);
  };
}

const readKey = fromZod<CitizenKey>(CitizenKeySchema, 'a citizen key');
const readKingdomId = fromZod<KingdomId>(KingdomIdSchema, 'a kingdom ID');
export const readPersonId = fromZod<PersonId>(PersonIdSchema, 'a person ID');
const readToken = fromZod<string>(TokenSchema, 'a token');
const readEpoch = fromZod<number>(EpochMsSchema, 'Unix milliseconds');
const readUInt = fromZod<number>(UIntSchema, 'a nonnegative safe integer');

// C0/C1 controls (except tab and newlines, checked per field), bidirectional marks, overrides and isolates, and a
// stray byte-order mark can disguise or reorder a public name.
function unsafeCodePoint(code: number): boolean {
  return (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f)
    || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
    || code === 0x061c || code === 0xfeff;
}
const hasUnsafeText = (value: string) => [...value].some(char => unsafeCodePoint(char.codePointAt(0)!));

/** Public display text: trimmed, normalised, bounded by code points, with no controls or direction overrides. */
function text(max: number, options: { multiline?: boolean } = {}): Reader<string> {
  return (value, path) => {
    if (typeof value !== 'string') return fail(path, 'expected text');
    const normalised = value.normalize('NFC');
    if (normalised !== normalised.trim()) fail(path, 'text has surrounding whitespace');
    const length = [...normalised].length;
    if (length < 1 || length > max) fail(path, `text must be 1–${max} characters`);
    if (hasUnsafeText(normalised)) fail(path, 'text has control or direction characters');
    if (!options.multiline && /[\n\r\t]/.test(normalised)) fail(path, 'text must be a single line');
    return normalised;
  };
}

const readLogin: Reader<string> = (value, path) =>
  typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : fail(path, 'expected a Twitch login');

const readColour: Reader<string> = (value, path) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fail(path, 'expected a #rrggbb colour');

/** A same-origin absolute path: one leading slash, no scheme, authority, query, fragment, backslash or dot segment. */
export function isSafePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > CARD_LIMITS.path) return false;
  if (!/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/.test(value)) return false;
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) return false;
  return !value.split('/').some(segment => segment === '.' || segment === '..' || /^%2e/i.test(segment));
}
const readPath: Reader<string> = (value, path) => isSafePath(value) ? value : fail(path, 'expected a same-origin path');

export function isCursor(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= CARD_LIMITS.cursor && /^[A-Za-z0-9_-]+$/.test(value);
}
const readCursor: Reader<string> = (value, path) => isCursor(value) ? value : fail(path, 'expected an opaque cursor');

function nullable<T>(reader: Reader<T>): Reader<T | null> {
  return (value, path) => value === null ? null : reader(value, path);
}

function oneOf<const T extends readonly (string | number | boolean)[]>(options: T): Reader<T[number]> {
  return (value, path) => (options as readonly unknown[]).includes(value) ? value as T[number] : fail(path, `expected one of ${options.join(', ')}`);
}

function list<T>(reader: Reader<T>, max: number): Reader<readonly T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) return fail(path, 'expected a list');
    if (value.length > max) fail(path, `at most ${max} entries`);
    return value.map((item, index) => reader(item, `${path}[${index}]`));
  };
}

function uniqueIds<T extends { readonly id: string }>(entries: readonly T[], path: string): readonly T[] {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.id)) fail(`${path}[${index}].id`, 'duplicate entry');
    seen.add(entry.id);
  }
  return entries;
}

export const readRevision: Reader<CardRevision> = (value, path) => {
  const v = record(value, path, ['person', 'citizen']);
  return { person: readUInt(v.person, `${path}.person`), citizen: readUInt(v.citizen, `${path}.citizen`) };
};

export const readAssetRef: Reader<CardAssetRef> = (value, path) => {
  const v = record(value, path, ['id', 'revision', 'alt']);
  return { id: readToken(v.id, `${path}.id`), revision: readUInt(v.revision, `${path}.revision`), alt: text(CARD_LIMITS.alt)(v.alt, `${path}.alt`) };
};

const readHome: Reader<CardHome> = (value, path) => {
  const v = record(value, path, ['kingdomId', 'kingdomName', 'home', 'street', 'image', 'path']);
  return {
    kingdomId: readKingdomId(v.kingdomId, `${path}.kingdomId`),
    kingdomName: text(CARD_LIMITS.name)(v.kingdomName, `${path}.kingdomName`),
    home: text(CARD_LIMITS.place)(v.home, `${path}.home`),
    street: nullable(text(CARD_LIMITS.place))(v.street, `${path}.street`),
    image: nullable(readAssetRef)(v.image, `${path}.image`),
    path: nullable(readPath)(v.path, `${path}.path`),
  };
};

export function readCollection<T extends { readonly id: string }>(reader: Reader<T>): Reader<CardCollection<T>> {
  return (value, path) => {
    if (typeof value === 'object' && value !== null && (value as { availability?: unknown }).availability === 'unavailable') {
      record(value, path, ['availability']);
      return { availability: 'unavailable' };
    }
    const v = record(value, path, ['availability', 'entries', 'next']);
    if (v.availability !== 'known') fail(`${path}.availability`, 'expected known or unavailable');
    const entries = uniqueIds(list(reader, CARD_LIMITS.pageEntries)(v.entries, `${path}.entries`), `${path}.entries`);
    return { availability: 'known', entries, next: nullable(readCursor)(v.next, `${path}.next`) };
  };
}

export const readStamp: Reader<CardStamp> = (value, path) => {
  const v = record(value, path, ['id', 'kind', 'kingdomId', 'kingdomName', 'at', 'path']);
  return {
    id: readToken(v.id, `${path}.id`),
    kind: oneOf(['visit', 'raid'] as const)(v.kind, `${path}.kind`),
    kingdomId: readKingdomId(v.kingdomId, `${path}.kingdomId`),
    kingdomName: text(CARD_LIMITS.name)(v.kingdomName, `${path}.kingdomName`),
    at: readEpoch(v.at, `${path}.at`),
    path: nullable(readPath)(v.path, `${path}.path`),
  };
};

export const readPiece: Reader<CardPiece> = (value, path) => {
  const v = record(value, path, ['id', 'name', 'kind', 'image', 'makerName', 'kingdomName', 'firstMadeAt', 'originalDesignId', 'copyOf', 'importerName', 'sourceCredit']);
  const name = text(CARD_LIMITS.name);
  return {
    id: readToken(v.id, `${path}.id`),
    name: name(v.name, `${path}.name`),
    kind: oneOf(['forged', 'imported'] as const)(v.kind, `${path}.kind`),
    image: nullable(readAssetRef)(v.image, `${path}.image`),
    makerName: nullable(name)(v.makerName, `${path}.makerName`),
    kingdomName: nullable(name)(v.kingdomName, `${path}.kingdomName`),
    firstMadeAt: nullable(readEpoch)(v.firstMadeAt, `${path}.firstMadeAt`),
    originalDesignId: nullable(readToken)(v.originalDesignId, `${path}.originalDesignId`),
    copyOf: nullable(readToken)(v.copyOf, `${path}.copyOf`),
    importerName: nullable(name)(v.importerName, `${path}.importerName`),
    sourceCredit: nullable(text(CARD_LIMITS.alt))(v.sourceCredit, `${path}.sourceCredit`),
  };
};

export const readHonour: Reader<CardHonour> = (value, path) => {
  const v = record(value, path, ['id', 'kind', 'name', 'count', 'at', 'image']);
  return {
    id: readToken(v.id, `${path}.id`),
    kind: oneOf(['game-win', 'duskscale'] as const)(v.kind, `${path}.kind`),
    name: text(CARD_LIMITS.name)(v.name, `${path}.name`),
    count: readUInt(v.count, `${path}.count`),
    at: nullable(readEpoch)(v.at, `${path}.at`),
    image: nullable(readAssetRef)(v.image, `${path}.image`),
  };
};

export const readGuestbookEntry: Reader<GuestbookEntry> = (value, path) => {
  const v = record(value, path, ['id', 'writerName', 'at', 'text']);
  return {
    id: readToken(v.id, `${path}.id`),
    writerName: text(CARD_LIMITS.name)(v.writerName, `${path}.writerName`),
    at: readEpoch(v.at, `${path}.at`),
    text: text(CARD_LIMITS.guestbookText, { multiline: true })(v.text, `${path}.text`),
  };
};

const readHouse: Reader<HousePlaqueDocument> = (value, path) => {
  const v = record(value, path, ['id', 'builtAt', 'visitorCount', 'pieces', 'guestbook']);
  return {
    id: readToken(v.id, `${path}.id`),
    builtAt: nullable(readEpoch)(v.builtAt, `${path}.builtAt`),
    visitorCount: nullable(readUInt)(v.visitorCount, `${path}.visitorCount`),
    pieces: readCollection(readPiece)(v.pieces, `${path}.pieces`),
    guestbook: readCollection(readGuestbookEntry)(v.guestbook, `${path}.guestbook`),
  };
};

const readPassport: Reader<CardPassport> = (value, path) => {
  if (typeof value === 'object' && value !== null && (value as { hidden?: unknown }).hidden === true) {
    record(value, path, ['hidden']);
    return { hidden: true };
  }
  const v = record(value, path, ['hidden', 'stamps']);
  if (v.hidden !== false) fail(`${path}.hidden`, 'expected a boolean');
  return { hidden: false, stamps: readCollection(readStamp)(v.stamps, `${path}.stamps`) };
};

const readIdentity: Reader<CardIdentity> = (value, path) => {
  const v = record(value, path, ['login', 'name', 'colour', 'office', 'portrait']);
  return {
    login: readLogin(v.login, `${path}.login`),
    name: text(CARD_LIMITS.name)(v.name, `${path}.name`),
    colour: nullable(readColour)(v.colour, `${path}.colour`),
    office: nullable(oneOf(['monarch', 'moderator', 'vip'] as const))(v.office, `${path}.office`),
    portrait: nullable(readAssetRef)(v.portrait, `${path}.portrait`),
  };
};

const readTenure: Reader<CardTenure> = (value, path) => {
  const v = record(value, path, ['followedAt', 'subscribedMonths', 'activeTier']);
  const tenure = {
    followedAt: nullable(readEpoch)(v.followedAt, `${path}.followedAt`),
    subscribedMonths: nullable(readUInt)(v.subscribedMonths, `${path}.subscribedMonths`),
    activeTier: nullable(oneOf([1, 2, 3] as const))(v.activeTier, `${path}.activeTier`),
  };
  if (tenure.subscribedMonths !== null && tenure.subscribedMonths > 1200) fail(`${path}.subscribedMonths`, 'more months than a century');
  return tenure;
};

/** Validates a public document exactly. The server checks its own projection with it before release. */
export const readCardDocument: Reader<CitizenCardDocument> = (value, path) => {
  const v = record(value, path, ['key', 'kingdomName', 'revision', 'origin', 'identity', 'tenure', 'citizenNumber', 'address', 'homes', 'castle', 'passport', 'pieces', 'honours', 'house']);
  const key = readKey(v.key, `${path}.key`);
  const document: CitizenCardDocument = {
    key: { personId: key.personId, kingdomId: key.kingdomId },
    kingdomName: text(CARD_LIMITS.name)(v.kingdomName, `${path}.kingdomName`),
    revision: readRevision(v.revision, `${path}.revision`),
    origin: oneOf(['live', 'simulated'] as const)(v.origin, `${path}.origin`),
    identity: readIdentity(v.identity, `${path}.identity`),
    tenure: readTenure(v.tenure, `${path}.tenure`),
    citizenNumber: nullable(readUInt)(v.citizenNumber, `${path}.citizenNumber`),
    address: nullable((value, at) => {
      const a = record(value, at, ['home', 'street']);
      return { home: text(CARD_LIMITS.place)(a.home, `${at}.home`), street: text(CARD_LIMITS.place)(a.street, `${at}.street`) };
    })(v.address, `${path}.address`),
    homes: list(readHome, CARD_LIMITS.homes)(v.homes, `${path}.homes`),
    castle: nullable(readHome)(v.castle, `${path}.castle`),
    passport: readPassport(v.passport, `${path}.passport`),
    pieces: readCollection(readPiece)(v.pieces, `${path}.pieces`),
    honours: readCollection(readHonour)(v.honours, `${path}.honours`),
    house: nullable(readHouse)(v.house, `${path}.house`),
  };
  checkHomes(document, path);
  return document;
};

/** Homes are a set of kingdoms, never an array a caller trims by order. */
function checkHomes(document: CitizenCardDocument, path: string): void {
  // A kingdom's ID is its broadcaster's person ID (`kingdomForBroadcaster`): compare them as the decimal strings they are.
  const own = (kingdomId: KingdomId) => String(kingdomId) === String(document.key.personId);
  const kingdoms = new Set<string>();
  for (const [index, home] of document.homes.entries()) {
    if (kingdoms.has(home.kingdomId)) fail(`${path}.homes[${index}]`, 'two homes in one kingdom');
    if (own(home.kingdomId)) fail(`${path}.homes[${index}]`, 'their own kingdom is their castle, not a home');
    kingdoms.add(home.kingdomId);
  }
  if (document.castle && !own(document.castle.kingdomId)) fail(`${path}.castle`, 'a castle stands in its monarch’s own kingdom');
  const here = document.homes.find(home => home.kingdomId === document.key.kingdomId);
  if (document.address && !own(document.key.kingdomId) && !here) fail(`${path}.address`, 'an address here needs this kingdom’s home');
  if (document.identity.office === 'monarch' && !own(document.key.kingdomId)) fail(`${path}.identity.office`, 'the crown stays in its own kingdom');
}

export const readDependency: Reader<CardDependency> = (value, path) => {
  const v = record(value, path, ['assetId', 'revision']);
  return { assetId: readToken(v.assetId, `${path}.assetId`), revision: readUInt(v.revision, `${path}.revision`) };
};

export const readCardSource: Reader<CardSource> = (value, path) => {
  const v = record(value, path, ['document', 'subjectFirstSignedInAt', 'travelsHidden', 'dependencies']);
  if (typeof v.travelsHidden !== 'boolean') fail(`${path}.travelsHidden`, 'expected a boolean');
  return {
    document: readCardDocument(v.document, `${path}.document`),
    subjectFirstSignedInAt: nullable(readEpoch)(v.subjectFirstSignedInAt, `${path}.subjectFirstSignedInAt`),
    travelsHidden: v.travelsHidden as boolean,
    dependencies: list(readDependency, CARD_LIMITS.dependencies)(v.dependencies, `${path}.dependencies`),
  };
};

export function parseCardDocument(value: unknown): CitizenCardDocument { return readCardDocument(value, 'card'); }
export function parseCardSource(value: unknown): CardSource { return readCardSource(value, 'source'); }
