import { validateCard, type CardReply, type SearchResult } from './directory';

/**
 * The signed-in streamer's own place on the Atlas (decision 39: every channel, with a self-serve hide). The page's
 * session authority answers for the session's own Twitch user only (`/api/atlas/me`), so the Atlas never learns or
 * chooses whose channel it is: a signed-in person is the broadcaster of exactly one channel, their own.
 *
 * Read once the map is drawn, in explore mode only (never in hero or gate, never before the first frame). Every
 * failure reads as "nobody is signed in": the cards simply offer no button.
 */
export type OwnerState =
  | { status: 'anonymous' }
  | {
    status: 'broadcaster';
    channelId: string;
    /** The broadcaster hid their channel. */
    hidden: boolean;
    /** The public map shows the channel now (false while hidden, and while the operator's list holds it). */
    onMap: boolean;
    /** While hidden: the card as the map would draw it without the hide, for the broadcaster's eyes only. */
    card: CardReply | null;
    csrfToken: string;
  };

export const OWNER_BASE = '/api/atlas/me';
const CHANNEL_ID = /^[1-9][0-9]{0,31}$/;
const ANONYMOUS: OwnerState = { status: 'anonymous' };

/** Strictly read what the session authority says; anything unexpected is anonymous. */
export function validateOwner(value: unknown, preview: string): OwnerState {
  const v = value as { version?: unknown; status?: unknown; channelId?: unknown; hidden?: unknown; onMap?: unknown; card?: unknown; csrfToken?: unknown } | null;
  if (!v || typeof v !== 'object' || v.version !== 1 || v.status !== 'broadcaster') return ANONYMOUS;
  if (typeof v.channelId !== 'string' || !CHANNEL_ID.test(v.channelId) || typeof v.hidden !== 'boolean' || typeof v.onMap !== 'boolean') return ANONYMOUS;
  if (typeof v.csrfToken !== 'string' || v.csrfToken.length < 16 || v.csrfToken.length > 256) return ANONYMOUS;
  let card: CardReply | null = null;
  if (v.card !== null && v.card !== undefined) {
    try {
      card = validateCard(v.card, preview);
      if (card.channel.id !== v.channelId) card = null;
    } catch {
      card = null;
    }
  }
  return { status: 'broadcaster', channelId: v.channelId, hidden: v.hidden, onMap: v.onMap, card: v.hidden ? card : null, csrfToken: v.csrfToken };
}

async function json(response: Response): Promise<unknown> {
  if (!/^application\/json/.test(response.headers.get('content-type') ?? '')) return null;
  return response.json() as Promise<unknown>;
}

/** Who is signed in, and their own channel's visibility on this map. Never throws; failures are anonymous. */
export async function readOwner(preview: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<OwnerState> {
  try {
    const response = await fetcher(`${OWNER_BASE}?preview=${encodeURIComponent(preview)}`, { credentials: 'same-origin', cache: 'no-store', signal: signal ?? null });
    if (!response.ok) return ANONYMOUS;
    return validateOwner(await json(response), preview);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return ANONYMOUS;
  }
}

export class OwnerActError extends Error {
  constructor(readonly reason: 'signed-out' | 'unavailable') {
    super(reason === 'signed-out' ? 'The session ended.' : 'The Atlas could not be reached.');
    this.name = 'OwnerActError';
  }
}

/**
 * Hide or show the signed-in broadcaster's own channel. Resolves with the new state once the Atlas has recorded it
 * durably; rejects (nothing changed) otherwise. The card a hidden channel keeps comes from the next `readOwner`.
 */
export async function ownerAct(act: 'hide' | 'show', owner: Extract<OwnerState, { status: 'broadcaster' }>, preview: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Extract<OwnerState, { status: 'broadcaster' }>> {
  let response: Response;
  try {
    response = await fetcher(`${OWNER_BASE}/${act}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: signal ?? null,
      headers: { 'content-type': 'application/json', 'x-csrf-token': owner.csrfToken },
      body: '{"version":1}',
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new OwnerActError('unavailable');
  }
  if (response.status === 401) throw new OwnerActError('signed-out');
  if (!response.ok) throw new OwnerActError('unavailable');
  const state = validateOwner(await json(response).catch(() => null), preview);
  if (state.status !== 'broadcaster' || state.channelId !== owner.channelId || state.hidden !== (act === 'hide')) throw new OwnerActError('unavailable');
  return state;
}

/** The broadcaster's own hidden channel as a search row, when the query names it; null otherwise. */
export function ownSearchRow(owner: OwnerState | null, query: string): SearchResult | null {
  if (owner?.status !== 'broadcaster' || !owner.hidden || !owner.card) return null;
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return null;
  const { channel } = owner.card;
  const names = [channel.login, channel.name?.toLowerCase()].filter((n): n is string => !!n);
  if (!names.some(name => name.startsWith(q))) return null;
  return { channel, portrait: owner.card.portrait ?? null, ...(owner.card.position ? { position: owner.card.position } : {}), average: owner.card.average, language: owner.card.language };
}
