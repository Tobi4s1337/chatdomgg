import type { CardOffice, CardTenure, CitizenCardDocument } from '../../../api/src/citizen-card/contracts';

/** Fixed English month names: device locales and ICU versions disagree ("Sep" or "Sept"). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "14 Feb 2022", always in UTC, so a date never shifts by a day with the reader's timezone. */
export function formatDay(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) throw new Error('Not a date.');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The ISO day for a `<time datetime>` attribute, in UTC like the visible date. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const OFFICE_TITLES: Readonly<Record<CardOffice, string>> = {
  monarch: 'King',
  moderator: 'Knight of the Watch',
  vip: 'Noble',
};

/** Office is a supplied fact; without one a person with a home here is a citizen, and without a home a guest. */
export function standing(document: Pick<CitizenCardDocument, 'identity' | 'address' | 'citizenNumber'>): string {
  if (document.identity.office) return OFFICE_TITLES[document.identity.office];
  return document.address || document.citizenNumber !== null ? 'Citizen' : 'Guest';
}

export interface Fact {
  readonly label: string;
  /** Null when the fact has not been witnessed: shown as “Not known yet”, never as zero or “no”. */
  readonly value: string | null;
  readonly datetime?: string;
  readonly note?: string;
}

export function followFact(tenure: CardTenure): Fact {
  return tenure.followedAt === null
    ? { label: 'Following since', value: null }
    : { label: 'Following since', value: formatDay(tenure.followedAt), datetime: isoDay(tenure.followedAt) };
}

const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;

/**
 * Cumulative months and the active tier are separate facts. A lapsed sub keeps the months they earned and asserts
 * no tier; an active tier without witnessed months says so rather than counting from zero.
 */
export function subscriptionFact(tenure: CardTenure): Fact {
  const { subscribedMonths: total, activeTier: tier } = tenure;
  if (total === null && tier === null) return { label: 'Subscribed', value: null };
  if (total === null) return { label: 'Subscribed', value: `Tier ${tier} now`, note: 'Months not known yet' };
  if (total === 0) return tier === null ? { label: 'Subscribed', value: 'Not yet' } : { label: 'Subscribed', value: `Tier ${tier} now` };
  return { label: 'Subscribed', value: tier === null ? months(total) : `${months(total)}, Tier ${tier}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Chat colours

/** The plaque's parchment and its ink backing, as the name actually sits on them. */
export const PARCHMENT = '#efe1bf';
export const INK_PLATE = '#2a1f17';
const READABLE = 3.4;

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Their name is written in their own chat colour. A colour that would vanish on parchment sits on a small ink
 * plate instead; one that reads on neither is written in ink with a swatch of their colour beside it.
 */
export function nameStyle(colour: string | null): { readonly surface: 'parchment' | 'plate' | 'ink'; readonly colour: string | null } {
  if (!colour) return { surface: 'ink', colour: null };
  if (contrast(colour, PARCHMENT) >= READABLE) return { surface: 'parchment', colour };
  if (contrast(colour, INK_PLATE) >= READABLE) return { surface: 'plate', colour };
  return { surface: 'ink', colour };
}

/** Show the login beside a display name only when it reads differently, as Twitch does. */
export function showLogin(identity: { readonly login: string; readonly name: string }): boolean {
  return identity.name.toLowerCase() !== identity.login;
}
