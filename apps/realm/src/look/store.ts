import { checkEarned, wornPieces, type CitizenEntitlements, type CitizenLook } from '@chatdom/content/avatar-style';
import {
  PersonIdSchema, RealmLookSaveRequestSchema, RealmWardrobeGrantSchema, isLookToken, starterCitizenLook,
  type KingdomId, type LOOK_SAVE_REFUSALS, type PersonId, type RealmLookMineReply, type RealmLookRecipeReply, type RealmLookSaveReply, type RealmWardrobeGrant,
} from '@chatdom/shared';
import { canonicalJson } from '../persistence/codec';
import type { LookOrigin, LookRecords, LookRepository, LookSaved, StoredGrant, WardrobeSlot } from './ports';
import { LOOK_LIMITS, canonicalLook, isStarterToken, starterLookRecipe } from './token';

export type LookRefusal = typeof LOOK_SAVE_REFUSALS[number];
export interface LookSaveOutcome { readonly status: number; readonly reply: RealmLookSaveReply }
export type LookRecipeOutcome =
  | { readonly status: 'found'; readonly reply: RealmLookRecipeReply; readonly immutable: boolean }
  | { readonly status: 'missing' }
  | { readonly status: 'malformed' };

/** What the Forge hands over when a forged piece becomes wearable (decision 24). */
export interface WardrobeGrantInput {
  readonly personId: string;
  readonly pieceId: string;
  readonly slot: WardrobeSlot;
  readonly title: string;
  readonly recipe: unknown;
  readonly source: 'forge';
}

export interface LookStoreOptions {
  readonly repository: LookRepository;
  readonly records: LookRecords;
  readonly origin: LookOrigin;
  /** Safety §3.1: the reasons a combination may not be worn, empty when it may. */
  readonly harmful?: (look: CitizenLook) => readonly string[];
  readonly savesPerMinute?: number;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export const LOOK_STORE_LIMITS = { savesPerMinute: 20, grantsShown: 64, recipeCache: 1_024, rateBook: 10_000 } as const;

const HTTP: Readonly<Record<LookRefusal, number>> = {
  unauthenticated: 401, forbidden: 403, malformed: 400, unearned: 403, unsuitable: 422, busy: 429, unavailable: 503,
};

/** Sentences the person reads. Plain, kind, and always say what happened to their look. */
export const LOOK_REASONS = {
  unauthenticated: 'Sign in with Twitch to keep your look. It is saved to you, so it walks with you everywhere.',
  forbidden: 'This save did not come from your Chatdom page, so your look was left as it was. Reload the page and try again.',
  malformed: 'We could not read that look, so your look was left as it was.',
  unsuitable: 'That combination cannot be worn in the kingdom. Try a different piece; your look was left as it was.',
  busy: 'You have changed your look a lot just now. Take a breath and save again in a minute.',
  unavailable: 'Your look could not be kept just now. Nothing was changed; try again in a moment.',
  closed: 'This kingdom\'s records are not open just now, so pieces earned there cannot be checked. Your look was left as it was; try again once you are walking there.',
  noKingdom: 'Earned pieces are worn from the kingdom where they were earned. Open your look from inside that kingdom to wear them; your look was left as it was.',
  unknownKingdom: 'We could not find that kingdom here, so its earned pieces cannot be worn yet. Your look was left as it was.',
} as const;

export function refusal(code: LookRefusal, reason: string = LOOK_REASONS[code as keyof typeof LOOK_REASONS]): LookSaveOutcome {
  return { status: HTTP[code], reply: { version: 1, ok: false, code, reason: reason.length > 400 ? `${reason.slice(0, 399)}…` : reason } };
}

/** `checkEarned` lines ("Not earned: the tenure hood.") as one sentence for the person. */
function unearnedReason(problems: readonly string[]): string {
  const pieces = problems.map(line => line.replace(/^Not earned: /, '').replace(/\.$/, ''));
  const list = pieces.length > 1 ? `${pieces.slice(0, -1).join(', ')} and ${pieces.at(-1)}` : pieces[0];
  return `The kingdom's records do not show ${list} as yours yet, so ${pieces.length > 1 ? 'they' : 'it'} cannot be worn. Your look was left as it was.`;
}

const grantOf = (grant: StoredGrant): RealmWardrobeGrant => ({ ...grant, recipe: JSON.parse(grant.recipe) as unknown });

/**
 * The realm's look store: one current look per person, immutable recipes by token, and server-side wardrobe grants.
 * It trusts only a person id the caller resolved from a verified session, and checks every save with `parseLook`,
 * the harmful-combination check and `checkEarned` against verified records before anything is written.
 */
export class LookStore {
  readonly origin: LookOrigin;
  private readonly listeners = new Set<LookSaved>();
  private readonly attempts = new Map<PersonId, number[]>();
  private readonly cache = new Map<string, string>();
  private readonly now: () => number;
  private readonly perMinute: number;

  constructor(private readonly options: LookStoreOptions) {
    this.origin = options.origin;
    this.now = options.now ?? Date.now;
    this.perMinute = options.savesPerMinute ?? LOOK_STORE_LIMITS.savesPerMinute;
  }

  /** The public recipe for a token or starter id. Saved recipes are served exactly as stored. */
  async recipe(token: string): Promise<LookRecipeOutcome> {
    if (!isLookToken(token)) return { status: 'malformed' };
    if (isStarterToken(token)) return { status: 'found', reply: { version: 1, token, look: starterLookRecipe(token) }, immutable: false };
    let stored = this.cache.get(token);
    if (stored === undefined) {
      const found = await this.options.repository.recipe(token);
      if (found === null) return { status: 'missing' };
      stored = found;
      this.cache.set(token, stored);
      if (this.cache.size > LOOK_STORE_LIMITS.recipeCache) this.cache.delete(this.cache.keys().next().value!);
    }
    return { status: 'found', reply: { version: 1, token, look: JSON.parse(stored) as unknown }, immutable: true };
  }

  /** What `GET /looks/me` answers for a signed-in person: their look, what the server will accept, and their grants. */
  async mine(personId: PersonId, kingdomId: KingdomId | null): Promise<RealmLookMineReply> {
    const [current, grants, entitlements] = await Promise.all([
      this.options.repository.current(personId, this.origin),
      this.options.repository.grants(personId, this.origin, LOOK_STORE_LIMITS.grantsShown),
      kingdomId ? this.entitlements(personId, kingdomId) : Promise.resolve(null),
    ]);
    const granted = grants.map(grantOf);
    if (current) return { version: 1, status: 'saved', token: current.token, look: JSON.parse(current.recipe) as unknown, savedAt: current.savedAt, entitlements, granted };
    return { version: 1, status: 'none', starter: starterCitizenLook(personId), entitlements, granted };
  }

  /** The entitlements a save in this kingdom is checked against, or null when they cannot be read right now. */
  async entitlements(personId: PersonId, kingdomId: KingdomId): Promise<CitizenEntitlements | null> {
    const result = await this.options.records.entitlements(personId, kingdomId);
    return result.kind === 'records' ? result.entitlements : null;
  }

  /** The person's current saved token, for presentation. */
  async current(personId: PersonId): Promise<{ readonly token: string; readonly savedAt: number } | null> {
    const current = await this.options.repository.current(personId, this.origin);
    return current ? { token: current.token, savedAt: current.savedAt } : null;
  }

  /** Saves a look for a person the caller resolved from a verified session. Refusals change nothing. */
  async save(personId: PersonId, body: unknown): Promise<LookSaveOutcome> {
    if (!this.admit(personId)) return refusal('busy');
    const request = RealmLookSaveRequestSchema.safeParse(body);
    if (!request.success) return refusal('malformed');
    let parsed: ReturnType<typeof canonicalLook>;
    try { parsed = canonicalLook(request.data.look); }
    catch (error) { return refusal('malformed', `Something in that look did not fit together (${(error as Error).message.replace(/\.$/, '')}), so your look was left as it was.`); }
    const { look, canonical, token } = parsed;
    if (this.options.harmful?.(look).length) return refusal('unsuitable');
    if (wornPieces(look).length) {
      const kingdomId = request.data.kingdomId;
      if (!kingdomId) return refusal('unearned', LOOK_REASONS.noKingdom);
      let records: Awaited<ReturnType<LookRecords['entitlements']>>;
      try { records = await this.options.records.entitlements(personId, kingdomId); }
      catch (error) { this.options.log?.(`look records unavailable: ${(error as Error).name}`); return refusal('unavailable'); }
      if (records.kind === 'unknown') return refusal('unearned', LOOK_REASONS.unknownKingdom);
      if (records.kind === 'closed') return refusal('unavailable', LOOK_REASONS.closed);
      const problems = checkEarned(look, records.entitlements);
      if (problems.length) return refusal('unearned', unearnedReason(problems));
    }
    let saved: Awaited<ReturnType<LookRepository['save']>>;
    try { saved = await this.options.repository.save(personId, this.origin, token, canonical); }
    catch (error) { this.options.log?.(`look save failed: ${(error as Error).name}`); return refusal('unavailable'); }
    this.cache.set(token, canonical);
    for (const listener of this.listeners) {
      try { listener({ personId, token: saved.token, savedAt: saved.savedAt }); } catch (error) { this.options.log?.(`look listener failed: ${(error as Error).name}`); }
    }
    return { status: 200, reply: { version: 1, ok: true, token: saved.token, look: JSON.parse(saved.recipe) as unknown, savedAt: saved.savedAt } };
  }

  /** Grants a piece server-side (the Forge's worn twin). Idempotent per person and piece; the first grant stands. */
  async grantWardrobePiece(input: WardrobeGrantInput): Promise<RealmWardrobeGrant> {
    const personId = PersonIdSchema.parse(input.personId);
    const recipe = canonicalJson(input.recipe);
    if (Buffer.byteLength(recipe, 'utf8') > LOOK_LIMITS.grantRecipeBytes) throw new RangeError('A granted piece recipe is larger than any piece can be.');
    const grant = RealmWardrobeGrantSchema.omit({ grantedAt: true, recipe: true }).parse({ pieceId: input.pieceId, slot: input.slot, source: input.source, title: input.title });
    return grantOf(await this.options.repository.grant(personId, this.origin, { ...grant, recipe }));
  }

  /** Called after every committed save, with the person and their new token. */
  onSaved(listener: LookSaved): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** At most `perMinute` save attempts per person in any minute; the book stays bounded. */
  private admit(personId: PersonId): boolean {
    const now = this.now(), recent = (this.attempts.get(personId) ?? []).filter(at => now - at < 60_000);
    if (recent.length >= this.perMinute) { this.attempts.set(personId, recent); return false; }
    recent.push(now);
    this.attempts.delete(personId); this.attempts.set(personId, recent);
    if (this.attempts.size > LOOK_STORE_LIMITS.rateBook) this.attempts.delete(this.attempts.keys().next().value!);
    return true;
  }
}
