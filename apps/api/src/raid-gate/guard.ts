/**
 * Strict readers for the Raid Gate boundary. Every reader rebuilds a fresh value from the keys it knows, so an
 * unknown key, a role setter or a repository extra can never ride along. A reader returns `undefined` for a value
 * it refuses; callers turn that into one `invalid` denial and never guess what was meant.
 */
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema, type KingdomId, type PersonId } from '../../../../packages/shared/src/identity';

export type Fields = Readonly<Record<string, unknown>>;

/** A plain object whose keys are exactly `required` plus any of `optional`. */
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Fields | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Object.keys(value);
  if (keys.length > required.length + optional.length) return undefined;
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  for (const key of keys) if (!required.includes(key) && !optional.includes(key)) return undefined;
  return value as Fields;
}

export const token = (value: unknown): string | undefined => TokenSchema.safeParse(value).success ? value as string : undefined;
export const kingdom = (value: unknown): KingdomId | undefined => {
  const parsed = KingdomIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
export const person = (value: unknown): PersonId | undefined => {
  const parsed = PersonIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
export const epoch = (value: unknown): number | undefined => EpochMsSchema.safeParse(value).success ? value as number : undefined;
export const uint = (value: unknown): number | undefined => UIntSchema.safeParse(value).success ? value as number : undefined;
export const positive = (value: unknown): number | undefined => {
  const parsed = uint(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};
export const bool = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
export function oneOf<const T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : undefined;
}

/** True when every value in the record was accepted. */
export function complete<T extends Record<string, unknown>>(record: T): record is { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.values(record).every(value => value !== undefined);
}
