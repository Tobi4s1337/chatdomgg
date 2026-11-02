import { z } from 'zod';
import { KingdomIdSchema, PIER_ALMANAC_ROUTE, type PierAlmanac } from '@chatdom/shared';

/** Why the Almanac could not be opened, in words a reader can act on. */
export class AlmanacLoadError extends Error {
  constructor(readonly reason: 'address' | 'missing' | 'offline' | 'resting' | 'torn', message: string) {
    super(message);
    this.name = 'AlmanacLoadError';
  }
}

const WORDS = {
  address: 'This link does not name a kingdom. Check the address and try again.',
  missing: 'No kingdom keeps an Almanac at this address.',
  offline: 'The Almanac could not be reached. Check your connection and try again.',
  resting: 'The realm is resting just now. Try again in a little while.',
  torn: 'The Almanac came back torn. Try again in a little while.',
  other: 'This Almanac belongs to another kingdom.',
} as const;

const time = z.number().int().nonnegative().max(8.64e15);
const name = z.string().max(64).nullable();
const fact = z.object({ name, at: time, via: z.enum(['pier', 'chat']) });
const entry = z.object({
  speciesId: z.string().min(1).max(80),
  status: z.enum(['caught', 'waiting', 'elsewhere']),
  count: z.number().int().nonnegative(),
  first: fact.nullable(),
  biggest: fact.extend({ weightG: z.number().nonnegative(), lengthMm: z.number().nonnegative() }).nullable(),
  mounts: z.number().int().nonnegative(),
});
const almanacSchema = z.object({
  version: z.literal(1),
  kingdomId: KingdomIdSchema,
  kingdom: z.string().max(80),
  asOf: time,
  water: z.enum(['lake', 'river', 'sea']).nullable(),
  entries: z.array(entry).max(512),
  caught: z.number().int().nonnegative(),
  catches: z.number().int().nonnegative(),
});
const realmError = z.object({ version: z.literal(1), status: z.string(), message: z.string().min(1).max(240) });

/** The realm's reply, checked field by field; anything else is a torn page, never half a book. */
export function parseAlmanac(raw: unknown, kingdomId: string): PierAlmanac {
  const parsed = almanacSchema.safeParse(raw);
  if (!parsed.success) throw new AlmanacLoadError('torn', WORDS.torn);
  if (parsed.data.kingdomId !== kingdomId) throw new AlmanacLoadError('torn', WORDS.other);
  return parsed.data as PierAlmanac;
}

/** The kingdom's public Almanac: approved names only, as the realm writes it. */
export async function loadAlmanac(kingdomId: string, options: { readonly signal?: AbortSignal; readonly fetcher?: typeof fetch } = {}): Promise<PierAlmanac> {
  if (!KingdomIdSchema.safeParse(kingdomId).success) throw new AlmanacLoadError('address', WORDS.address);
  const url = PIER_ALMANAC_ROUTE.replace(':kingdomId', encodeURIComponent(kingdomId));
  const fetcher = options.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: 'application/json' }, ...(options.signal ? { signal: options.signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AlmanacLoadError('offline', WORDS.offline);
  }
  const type = response.headers.get('content-type') ?? '';
  let body: unknown = null;
  if (/\bjson\b/i.test(type)) { try { body = await response.json(); } catch { body = null; } }
  if (!response.ok) {
    // The realm's own refusal is written for people; a proxy's page never is.
    const said = realmError.safeParse(body);
    if (response.status === 404) throw new AlmanacLoadError('missing', said.success ? said.data.message : WORDS.missing);
    if (response.status === 400) throw new AlmanacLoadError('address', said.success ? said.data.message : WORDS.address);
    throw new AlmanacLoadError('resting', said.success && response.status < 500 ? said.data.message : WORDS.resting);
  }
  if (body === null) throw new AlmanacLoadError('torn', WORDS.torn);
  return parseAlmanac(body, kingdomId);
}

/** Plain words for any failure while opening the book. */
export function almanacFailure(error: unknown): string {
  return error instanceof AlmanacLoadError ? error.message : WORDS.offline;
}
