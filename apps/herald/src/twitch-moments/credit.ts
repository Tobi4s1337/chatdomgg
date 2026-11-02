import { sha256Text } from '../../../../packages/emotes/src/sha256';
import { TokenSchema, type KingdomId, type PersonId } from '@chatdom/shared';
import { CreditSchema, type Credit } from '../../../web/src/twitch-moments/contracts';
import type { CitizenDirectory } from './ports';

/** A public credit, or anonymous when the name or slot would not pass the public boundary. Never throws. */
export function publicCredit(displayName: string, slot: number | null): Credit {
  const parsed = CreditSchema.safeParse({ displayName, slot });
  return parsed.success ? parsed.data : null;
}

/**
 * Credit for a known person, by person ID only. A named citizen is credited with their home slot (or the gate,
 * when homeless); a quiet citizen is anonymous; someone who is not a citizen keeps the name Twitch itself showed
 * publicly for this act, with no slot. Without such a provider name they stay anonymous.
 */
export async function resolveCredit(directory: CitizenDirectory, kingdomId: KingdomId, personId: PersonId, providerName: string | null): Promise<Credit> {
  const citizen = await directory.resolve(kingdomId, personId);
  if (citizen) return citizen.disclosure === 'named' ? publicCredit(citizen.displayName, citizen.homeSlot) : null;
  return providerName === null ? null : publicCredit(providerName, null);
}

/**
 * Twitch's public stand-in accounts for anonymous acts: AnAnonymousCheerer (407665396) and AnAnonymousGifter
 * (274598607). Some payloads carry a null user for an anonymous act and some carry one of these accounts, so both
 * the account ID and its fixed login are checked. A stand-in is never resolved, credited or kept.
 */
const ANONYMOUS_ACCOUNTS: ReadonlySet<string> = new Set(['407665396', '274598607']);
const ANONYMOUS_LOGINS: ReadonlySet<string> = new Set(['ananonymouscheerer', 'ananonymousgifter']);
export function isAnonymousAccount(userId: string | null, login: string | null): boolean {
  return userId === null || ANONYMOUS_ACCOUNTS.has(userId) || (login !== null && ANONYMOUS_LOGINS.has(login.toLowerCase()));
}

/** Two independent FNV-1a passes: a stable short digest for an over-long provider ID. Not a security hash. */
function digest(text: string): string {
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Longest provider-derived token, so `gifts.<groupKey>` and record keys stay inside their bounds. */
export const PROVIDER_TOKEN_MAX = 100;

/**
 * A provider-issued ID (a message, delivery or community gift ID, never a person ID) as a public token, with an
 * optional family prefix. Characters outside the token alphabet become `-`; an over-long ID is digested.
 */
export function providerToken(prefix: string | null, id: string): string {
  // Raids share one identity with the gate/road/passport authority; the public raid key omits the provider ID.
  if (prefix === 'raid') return `raid.${sha256Text(id)}`;
  const clean = id.replace(/[^A-Za-z0-9_.:-]/gu, '-');
  const head = prefix === null ? '' : `${prefix}.`;
  const body = head.length + clean.length <= PROVIDER_TOKEN_MAX && /^[A-Za-z0-9]/u.test(head || clean) ? clean : `h${digest(id)}`;
  return TokenSchema.parse(`${head}${body}`);
}
