import { createHash } from 'node:crypto';
import { parseLook, starterLookRecipe, type CitizenLook } from '@chatdom/content/avatar-style';
import { CITIZEN_STARTER_LOOKS, LOOK_TOKEN } from '@chatdom/shared';
import { canonicalJson } from '../persistence/codec';

/** A look is small: the recipe as stored, and the largest save body the routes read. */
export const LOOK_LIMITS = { recipeBytes: 8_192, bodyBytes: 16_384, grantRecipeBytes: 65_536 } as const;

export interface CanonicalLook {
  readonly look: CitizenLook;
  /** `parseLook` output with sorted keys at every level: equal looks give equal bytes. */
  readonly canonical: string;
  readonly token: string;
}

/** `lk.` + the first 40 hex characters of the SHA-256 of the canonical recipe. */
export function lookTokenOf(canonical: string): string {
  return `lk.${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 40)}`;
}

/** Validates any input as a look and gives its canonical bytes and token. Throws parseLook's plain message. */
export function canonicalLook(input: unknown): CanonicalLook {
  const look = parseLook(input), canonical = canonicalJson(look);
  if (Buffer.byteLength(canonical, 'utf8') > LOOK_LIMITS.recipeBytes) throw new Error('This look is larger than any look can be.');
  return { look, canonical, token: lookTokenOf(canonical) };
}

/** A stored recipe, re-read through `parseLook` so every surface receives the same field order the builder writes. */
export function storedLook(canonical: string): CitizenLook {
  return parseLook(JSON.parse(canonical));
}

export const isSavedLookToken = (value: string): boolean => LOOK_TOKEN.test(value);
export const isStarterToken = (value: string): boolean => (CITIZEN_STARTER_LOOKS as readonly string[]).includes(value);
export { starterLookRecipe };
