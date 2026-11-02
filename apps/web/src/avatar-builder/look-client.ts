import { z } from 'zod';
import {
  KingdomIdSchema, REALM_LOOK_ROUTES, RealmLookMineReplySchema, RealmLookSaveReplySchema, RealmLookSaveRequestSchema,
  type KingdomId, type RealmWardrobeGrant,
} from '@chatdom/shared';
import { REALM_AUTH_ROUTES, RealmSessionReplySchema } from '@chatdom/shared/realm';
import {
  CREST_SHAPES, FORGED_MOTIFS, parseLook, starterLookRecipe, type CitizenEntitlements, type CitizenLook,
} from '../../../../packages/content/src/avatar-style';
import { realmSignInUrl } from '../realm/adapters/entry';
import type { LookAuthority, SaveResult } from './AvatarBuilder';

/*
 * The builder's way to the realm's look store (packages/shared/src/look-store.ts). The person is always the signed-in
 * session's; nothing here ever names one. A save is a success only when the realm says so in a reply that checks out:
 * a refusal carries the realm's own sentence, and anything unreadable is said plainly and never treated as saved.
 */

export type LookFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What the realm holds for the signed-in person, with the records the server checks a save against. */
export type LookMine =
  | { readonly status: 'anonymous'; readonly signInUrl: string }
  | {
    readonly status: 'saved'; readonly token: string; readonly look: CitizenLook; readonly savedAt: number;
    readonly entitlements: CitizenEntitlements; readonly granted: readonly RealmWardrobeGrant[];
  }
  | {
    /** Signed in, never saved: they walk in this starter. */
    readonly status: 'none'; readonly starter: string; readonly look: CitizenLook;
    readonly entitlements: CitizenEntitlements; readonly granted: readonly RealmWardrobeGrant[];
  };

export type LookSaveOutcome =
  | { readonly ok: true; readonly token: string; readonly look: CitizenLook; readonly savedAt: number }
  | { readonly ok: false; readonly code: string; readonly reason: string };

/** Why the look store could not be read: said in the kingdom's voice, safe to show as it is. */
export class LookStoreError extends Error {
  constructor(readonly kind: 'unreachable' | 'untrusted' | 'refused', message: string) { super(message); this.name = 'LookStoreError'; }
}

export interface LookClient {
  /** The person's look and records (`kingdomId` names whose records); anonymous when nobody is signed in. */
  mine(kingdomId?: KingdomId | null, signal?: AbortSignal): Promise<LookMine>;
  /** Saves through the realm. Never throws: an unreachable or unreadable realm is a refusal in plain words. */
  save(look: CitizenLook, kingdomId?: KingdomId | null): Promise<LookSaveOutcome>;
  /** The builder's authority for this person and kingdom. `onSaved` hears every save the realm accepted. */
  authority(kingdomId: KingdomId | null, onSaved?: (saved: { readonly token: string; readonly look: CitizenLook }) => void): LookAuthority;
}

export interface LookClientOptions {
  readonly fetch?: LookFetch;
  /** Origin prefix for the realm's routes; empty means the page's own origin. */
  readonly base?: string;
  /** Where sign-in should return to (a local path). Defaults to the page's own path. */
  readonly returnTo?: () => string;
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toLowerCase() as `#${string}`);
const pair = z.tuple([hex, hex]);
const when = z.number().int().nonnegative();
const name = z.string().min(1).max(120);
const momentKingdom = z.strictObject({ name, colours: pair });

/** `CitizenEntitlements` as the realm sends them; anything else is not trusted. */
export const CitizenEntitlementsSchema = z.strictObject({
  origin: z.enum(['live', 'simulated']),
  kingdom: z.strictObject({ id: z.string().min(1).max(128), name, colours: pair }),
  followedMonths: z.number().int().nonnegative().max(1200),
  sub: z.strictObject({ tier: z.enum(['prime', '1', '2', '3']), months: z.number().int().nonnegative().max(1200), active: z.boolean() }).nullable(),
  founder: z.boolean(),
  keepsakes: z.array(z.strictObject({
    id: z.string().min(1).max(128), name, earnedAt: when,
    kingdom: z.strictObject({ name, shape: z.enum(CREST_SHAPES), colours: pair }),
  })).max(500),
  forged: z.array(z.strictObject({ id: z.string().min(1).max(128), title: name, forgedAt: when, motif: z.enum(FORGED_MOTIFS), palette: pair })).max(500),
  moments: z.array(z.union([
    z.strictObject({ id: z.string().min(1).max(128), kind: z.literal('cheer-storm'), at: when, kingdom: momentKingdom }),
    z.strictObject({ id: z.string().min(1).max(128), kind: z.literal('raid'), at: when, kingdom: momentKingdom, from: momentKingdom }),
  ])).max(500),
});

const UNREACHABLE = 'The realm cannot be reached just now. Your look is not saved yet; try again in a moment.';
const UNTRUSTED = 'The realm answered in a way we cannot trust, so your look is not saved. Try again in a moment.';
const SIGNED_OUT = 'You are signed out. Sign in with Twitch to save your look.';

async function json(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!/^application\/(?:[\w.-]+\+)?json$/i.test(type)) return undefined;
  try { return await response.json(); } catch { return undefined; }
}

const own = (): string => (typeof location === 'undefined' ? '/' : `${location.pathname}${location.search}`);

export function createLookClient(options: LookClientOptions = {}): LookClient {
  const get: LookFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.base ?? '';
  const PRIVATE: RequestInit = { credentials: 'same-origin', cache: 'no-store' };
  let csrf: string | null = null;

  /** The csrf token of a signed-in session, or null when nobody is signed in. */
  async function session(signal?: AbortSignal): Promise<string | null> {
    let response: Response;
    try { response = await get(`${base}${REALM_AUTH_ROUTES.session}`, { ...PRIVATE, ...(signal ? { signal } : {}), method: 'GET', headers: { Accept: 'application/json' } }); }
    catch (error) { if (signal?.aborted) throw error; throw new LookStoreError('unreachable', 'The realm cannot be reached just now.'); }
    if (!response.ok) throw new LookStoreError('unreachable', 'The realm cannot read your visit just now.');
    const reply = RealmSessionReplySchema.safeParse(await json(response));
    if (!reply.success) throw new LookStoreError('untrusted', 'The realm answered in a way we cannot trust.');
    if (reply.data.status === 'anonymous' || reply.data.expiresAt <= Date.now()) { csrf = null; return null; }
    return csrf = reply.data.csrfToken;
  }

  async function mine(kingdomId?: KingdomId | null, signal?: AbortSignal): Promise<LookMine> {
    const signInUrl = () => realmSignInUrl((options.returnTo ?? own)());
    if (!(await session(signal))) return { status: 'anonymous', signInUrl: signInUrl() };
    const query = kingdomId ? `?kingdom=${encodeURIComponent(KingdomIdSchema.parse(kingdomId))}` : '';
    let response: Response;
    try { response = await get(`${base}${REALM_LOOK_ROUTES.mine}${query}`, { ...PRIVATE, ...(signal ? { signal } : {}), method: 'GET', headers: { Accept: 'application/json' } }); }
    catch (error) { if (signal?.aborted) throw error; throw new LookStoreError('unreachable', 'The wardrobe cannot be reached just now.'); }
    if (response.status === 401) return { status: 'anonymous', signInUrl: signInUrl() };
    if (!response.ok) throw new LookStoreError(response.status === 403 || response.status === 400 ? 'refused' : 'unreachable', 'The wardrobe would not open just now.');
    const reply = RealmLookMineReplySchema.safeParse(await json(response));
    if (!reply.success) throw new LookStoreError('untrusted', 'The wardrobe answered in a way we cannot trust.');
    const data = reply.data;
    if (data.status === 'anonymous') return { status: 'anonymous', signInUrl: signInUrl() };
    const entitlements = CitizenEntitlementsSchema.safeParse(data.entitlements);
    if (!entitlements.success) throw new LookStoreError('untrusted', 'The wardrobe sent records we cannot trust.');
    const records = entitlements.data as CitizenEntitlements;
    if (data.status === 'saved') {
      let look: CitizenLook;
      try { look = parseLook(data.look); } catch { throw new LookStoreError('untrusted', 'The wardrobe sent a look we cannot read.'); }
      return { status: 'saved', token: data.token, look, savedAt: data.savedAt, entitlements: records, granted: data.granted };
    }
    const starter = starterLookRecipe(data.starter);
    if (!starter) throw new LookStoreError('untrusted', 'The wardrobe named a starter look we do not know.');
    return { status: 'none', starter: data.starter, look: parseLook(starter), entitlements: records, granted: data.granted };
  }

  async function put(token: string, look: CitizenLook, kingdomId: KingdomId | null | undefined): Promise<Response> {
    const body = RealmLookSaveRequestSchema.parse({ version: 1, look, ...(kingdomId ? { kingdomId } : {}) });
    return get(`${base}${REALM_LOOK_ROUTES.mine}`, {
      ...PRIVATE, method: 'PUT', body: JSON.stringify(body),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-csrf-token': token },
    });
  }

  async function save(look: CitizenLook, kingdomId?: KingdomId | null): Promise<LookSaveOutcome> {
    let token: string | null;
    try { token = csrf ?? await session(); } catch (error) {
      return { ok: false, code: 'unavailable', reason: error instanceof LookStoreError && error.kind === 'untrusted' ? UNTRUSTED : UNREACHABLE };
    }
    if (!token) return { ok: false, code: 'unauthenticated', reason: SIGNED_OUT };
    let response: Response;
    try {
      response = await put(token, look, kingdomId);
      // A session renewed since the token was read: read it once more and try once more.
      if (response.status === 403 && csrf === token) {
        const fresh = await session();
        if (!fresh) return { ok: false, code: 'unauthenticated', reason: SIGNED_OUT };
        if (fresh !== token) response = await put(fresh, look, kingdomId);
      }
    } catch { return { ok: false, code: 'unavailable', reason: UNREACHABLE }; }
    const reply = RealmLookSaveReplySchema.safeParse(await json(response));
    if (!reply.success) {
      if (response.status === 401) { csrf = null; return { ok: false, code: 'unauthenticated', reason: SIGNED_OUT }; }
      return { ok: false, code: 'unavailable', reason: response.ok ? UNTRUSTED : UNREACHABLE };
    }
    const data = reply.data;
    if (!data.ok) {
      if (data.code === 'unauthenticated') csrf = null;
      return { ok: false, code: data.code, reason: data.reason };
    }
    // A success the client cannot read back is not a success it may show.
    if (!response.ok) return { ok: false, code: 'unavailable', reason: UNTRUSTED };
    let saved: CitizenLook;
    try { saved = parseLook(data.look); } catch { return { ok: false, code: 'unavailable', reason: UNTRUSTED }; }
    return { ok: true, token: data.token, look: saved, savedAt: data.savedAt };
  }

  return {
    mine, save,
    authority(kingdomId, onSaved) {
      return {
        async save(look): Promise<SaveResult> {
          const outcome = await save(look, kingdomId);
          if (!outcome.ok) return { ok: false, reason: outcome.reason };
          try { onSaved?.({ token: outcome.token, look: outcome.look }); } catch (error) { console.error('A saved look could not be passed on', error); }
          return { ok: true, look: outcome.look, token: outcome.token };
        },
      };
    },
  };
}

/** `?kingdom=<id>` from a query string, or null. */
export function kingdomFromQuery(search: string): KingdomId | null {
  const raw = new URLSearchParams(search).get('kingdom');
  const parsed = raw ? KingdomIdSchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : null;
}
