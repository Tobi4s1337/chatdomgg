import type { CitizenEntitlements } from '@chatdom/content/avatar-style';
import type { KingdomId, PersonId, RealmWardrobeGrant } from '@chatdom/shared';

export type LookOrigin = 'live' | 'simulated';
export type WardrobeSlot = RealmWardrobeGrant['slot'];

/** A person's current look as stored: the token and its canonical recipe bytes. */
export interface StoredLook { readonly token: string; readonly recipe: string; readonly savedAt: number }

/** A grant as stored: the recipe stays canonical JSON until it is read out. */
export interface StoredGrant {
  readonly pieceId: string; readonly slot: WardrobeSlot; readonly source: 'forge';
  readonly title: string; readonly recipe: string; readonly grantedAt: number;
}

/**
 * Durable look storage. Recipes are immutable rows keyed by token; each person has at most one current look.
 * Every method either completes or throws; a throw means nothing changed.
 */
export interface LookRepository {
  /** The recipe a token stands for, or null when no one ever saved it. */
  recipe(token: string): Promise<string | null>;
  current(personId: PersonId, origin: LookOrigin): Promise<StoredLook | null>;
  /** Stores the recipe if new (never rewriting one) and makes it the person's look, in one transaction. */
  save(personId: PersonId, origin: LookOrigin, token: string, recipe: string): Promise<StoredLook>;
  /** Idempotent per person and piece: a repeated grant returns the first one unchanged. */
  grant(personId: PersonId, origin: LookOrigin, grant: Omit<StoredGrant, 'grantedAt'>): Promise<StoredGrant>;
  /** Newest first, at most `limit`. */
  grants(personId: PersonId, origin: LookOrigin, limit: number): Promise<readonly StoredGrant[]>;
}

/** The signed-in person behind a request, and the CSRF token their session expects on a write. */
export interface LookSession { readonly personId: PersonId; readonly csrfToken: string }

/**
 * Resolves the browser's Chatdom session from its Cookie header, exactly as the kingdom entry trusts it: unrevoked,
 * unexpired by database time and of this realm's origin. Null for no session or one that cannot be used here;
 * a throw is storage trouble.
 */
export interface LookSessions { resolve(cookieHeader: string): Promise<LookSession | null> }

/**
 * What a person's verified records allow in one kingdom. `closed`: the kingdom exists but its records cannot be
 * read right now (its founded scene is not prepared on this realm); `unknown`: no such founded kingdom here.
 */
export type LookRecordsResult =
  | { readonly kind: 'records'; readonly entitlements: CitizenEntitlements }
  | { readonly kind: 'closed' }
  | { readonly kind: 'unknown' };

export interface LookRecords { entitlements(personId: PersonId, kingdomId: KingdomId): Promise<LookRecordsResult> }

export type LookSaved = (event: { readonly personId: PersonId; readonly token: string; readonly savedAt: number }) => void;
