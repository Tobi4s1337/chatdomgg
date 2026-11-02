import { isLookToken, lookRecipeUrl, RealmLookRecipeReplySchema } from '@chatdom/shared';
import { isStarterLook, parseLook, starterLookRecipe } from '@chatdom/content/avatar-style';
import type { StyledCitizenRecipe } from './style-adapter';

/**
 * Every surface that draws a person resolves their `look` string here: one of the six starter ids, or a saved look's
 * content token (`lk.` + 40 hex). A token never changes meaning, so a recipe, once checked, is kept for the page.
 */
export interface CitizenLookLibrary {
  /** Ready to draw now. */
  has(token: string): boolean;
  /** Fetch and parse; never throws for any string (anything that is not a look token is ignored). */
  request(token: string): void;
  onReady(listener: (token: string) => void): () => void;
  /** The parsed recipe once ready (portrait renderer, card). */
  recipe(token: string): StyledCitizenRecipe | null;
  /** For one-off surfaces: resolves with the recipe, rejects once the token is refused, retries run out or `signal` aborts. */
  load(token: string, signal?: AbortSignal): Promise<StyledCitizenRecipe>;
  /** Seed a recipe already held (your own look, straight from the save reply), so it draws without a round trip. */
  remember(token: string, recipe: unknown): void;
  /** Where a token stands: `refused` never changes for this page (unknown to the realm, or a reply that did not check out). */
  status(token: string): CitizenLookStatus;
}
export type CitizenLookStatus = 'ready' | 'loading' | 'waiting' | 'refused' | 'idle' | 'invalid';

export interface CitizenLookLibraryOptions {
  readonly fetch?: typeof fetch;
  /** Origin prefix for the realm's look route; empty means the page's own origin. */
  readonly base?: string;
  /** Saved-look recipes kept, least recently used dropped first. */
  readonly capacity?: number;
  /** Network failures retry after `firstMs`, doubling up to `maxMs`, for at most `attempts` tries per run. */
  readonly backoff?: { readonly firstMs: number; readonly maxMs: number; readonly attempts: number };
}

/** Recomputes a saved look's token: canonical JSON (sorted keys), SHA-256, first 40 hex. Null without SubtleCrypto. */
export async function lookTokenFor(recipe: unknown): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(recipe)));
  return `lk.${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 40)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Non-finite number in a look');
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'object':
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      return `{${Object.keys(value).sort().flatMap(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(item)}`];
      }).join(',')}}`;
    default: throw new TypeError(`Unsupported ${typeof value} in a look`);
  }
}

class Refused extends Error {}

interface Pending { attempts: number; timer?: ReturnType<typeof setTimeout>; inFlight: boolean }

export function createCitizenLookLibrary(options: CitizenLookLibraryOptions = {}): CitizenLookLibrary {
  const capacity = options.capacity ?? 512;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Look library capacity must be a positive integer.');
  const backoff = options.backoff ?? { firstMs: 1000, maxMs: 30_000, attempts: 8 };
  const base = options.base ?? '';
  const starters = new Map<string, StyledCitizenRecipe>();
  const recipes = new Map<string, StyledCitizenRecipe>();
  const pending = new Map<string, Pending>();
  const refused = new Set<string>();
  const listeners = new Set<(token: string) => void>();
  const waiters = new Map<string, Set<{ resolve(recipe: StyledCitizenRecipe): void; reject(error: Error): void }>>();

  const starter = (token: string) => {
    let recipe = starters.get(token);
    if (!recipe) { recipe = parseLook(starterLookRecipe(token)); starters.set(token, recipe); }
    return recipe;
  };
  const touch = (token: string) => {
    const recipe = recipes.get(token);
    if (recipe) { recipes.delete(token); recipes.set(token, recipe); }
    return recipe;
  };
  const settle = (token: string, outcome: StyledCitizenRecipe | Error) => {
    const waiting = waiters.get(token);
    waiters.delete(token);
    for (const waiter of waiting ?? []) {
      if (outcome instanceof Error) waiter.reject(outcome);
      else waiter.resolve(outcome);
    }
  };
  const ready = (token: string, recipe: StyledCitizenRecipe) => {
    const run = pending.get(token);
    if (run?.timer) clearTimeout(run.timer);
    pending.delete(token);
    recipes.delete(token); recipes.set(token, recipe);
    while (recipes.size > capacity) recipes.delete(recipes.keys().next().value!);
    settle(token, recipe);
    for (const listener of [...listeners]) {
      try { listener(token); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  };
  const refuse = (token: string, reason: string) => {
    pending.delete(token);
    refused.add(token);
    settle(token, new Error(reason));
  };

  async function fetchRecipe(token: string): Promise<StyledCitizenRecipe> {
    const get = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await get(`${base}${lookRecipeUrl(token)}`, { credentials: 'omit', headers: { accept: 'application/json' } });
    // The realm answers 400/404 for a token it does not hold; asking again cannot change that answer.
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      throw new Refused(`The realm has no look ${token} (${response.status}).`);
    }
    if (!response.ok) throw new Error(`The realm could not send look ${token} (${response.status}).`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new Refused(`Look ${token} arrived unreadable.`); }
    const reply = RealmLookRecipeReplySchema.safeParse(body);
    if (!reply.success || reply.data.token !== token) throw new Refused(`Look ${token} arrived as something else.`);
    let recipe: StyledCitizenRecipe;
    try { recipe = parseLook(reply.data.look); } catch { throw new Refused(`Look ${token} is not a look.`); }
    const [asSent, asParsed] = await Promise.all([lookTokenFor(reply.data.look).catch(() => null), lookTokenFor(recipe)]);
    if (asParsed !== null && asSent !== token && asParsed !== token) throw new Refused(`Look ${token} does not match its recipe.`);
    return recipe;
  }

  function attempt(token: string, run: Pending) {
    delete run.timer;
    run.inFlight = true;
    run.attempts++;
    fetchRecipe(token).then(recipe => {
      if (pending.get(token) === run) ready(token, recipe);
    }, (error: unknown) => {
      if (pending.get(token) !== run) return;
      run.inFlight = false;
      if (error instanceof Refused) { refuse(token, error.message); return; }
      if (run.attempts >= backoff.attempts) {
        // Out of tries for this run: the next request() or load() starts a fresh one.
        pending.delete(token);
        settle(token, error instanceof Error ? error : new Error(`Look ${token} could not be fetched.`));
        return;
      }
      run.timer = setTimeout(() => attempt(token, run), Math.min(backoff.maxMs, backoff.firstMs * 2 ** (run.attempts - 1)));
    });
  }

  const library: CitizenLookLibrary = {
    has(token) {
      if (isStarterLook(token)) return true;
      return touch(token) !== undefined;
    },
    request(token) {
      if (!isLookToken(token) || isStarterLook(token) || refused.has(token) || pending.has(token) || touch(token)) return;
      const run: Pending = { attempts: 0, inFlight: false };
      pending.set(token, run);
      attempt(token, run);
    },
    onReady(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    recipe(token) {
      if (isStarterLook(token)) return starter(token);
      return touch(token) ?? null;
    },
    load(token, signal) {
      if (!isLookToken(token)) return Promise.reject(new Error('Not a look token.'));
      const known = library.recipe(token);
      if (known) return Promise.resolve(known);
      if (refused.has(token)) return Promise.reject(new Error(`Look ${token} was refused.`));
      if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted.'));
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve(recipe: StyledCitizenRecipe) { signal?.removeEventListener('abort', abort); resolve(recipe); },
          reject(error: Error) { signal?.removeEventListener('abort', abort); reject(error); },
        };
        const abort = () => { waiters.get(token)?.delete(waiter); reject(signal!.reason instanceof Error ? signal!.reason : new Error('Aborted.')); };
        signal?.addEventListener('abort', abort, { once: true });
        let set = waiters.get(token);
        if (!set) waiters.set(token, set = new Set());
        set.add(waiter);
        library.request(token);
      });
    },
    remember(token, recipe) {
      if (!isLookToken(token) || isStarterLook(token)) return;
      let parsed: StyledCitizenRecipe;
      try { parsed = parseLook(recipe); } catch { return; }
      refused.delete(token);
      ready(token, parsed);
    },
    status(token) {
      if (!isLookToken(token)) return 'invalid';
      if (isStarterLook(token) || recipes.has(token)) return 'ready';
      if (refused.has(token)) return 'refused';
      const run = pending.get(token);
      return run ? run.inFlight ? 'loading' : 'waiting' : 'idle';
    },
  };
  return library;
}

let shared: CitizenLookLibrary | undefined;
/** The page's one library: the street, the stream view, the card and the portraits share its fetches and cache. */
export function sharedCitizenLooks(): CitizenLookLibrary {
  return shared ??= createCitizenLookLibrary();
}
