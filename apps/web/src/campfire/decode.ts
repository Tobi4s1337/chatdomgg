/**
 * Strict allowlist decoders for the campfire's local ports. Every object decoder rejects keys it does
 * not name, so a server field that was never meant for this audience fails loudly instead of riding
 * along into props, DOM or a recorder.
 */
export class CampfireDecodeError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'CampfireDecodeError';
  }
}

export type Decoder<T> = (value: unknown, path: string) => T;

const fail = (path: string, reason: string): never => { throw new CampfireDecodeError(path, reason); };

export const literal = <const T extends string | number | boolean>(expected: T): Decoder<T> => (value, path) =>
  value === expected ? expected : fail(path, `expected ${JSON.stringify(expected)}`);

export const oneOf = <const T extends readonly string[]>(options: T): Decoder<T[number]> => (value, path) =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T[number] : fail(path, `expected one of ${options.join(', ')}`);

export const int = (min: number, max: number): Decoder<number> => (value, path) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(path, `expected an integer in ${min}..${max}`);

export const bool: Decoder<boolean> = (value, path) => typeof value === 'boolean' ? value : fail(path, 'expected a boolean');

export const text = (maxLength: number, pattern?: RegExp): Decoder<string> => (value, path) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) return fail(path, `expected text of 1..${maxLength} characters`);
  // Control characters never belong in a label or a witnessed line.
  for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); if (code < 32 || code === 127) return fail(path, 'contains control characters'); }
  if (pattern && !pattern.test(value)) return fail(path, 'has an unexpected form');
  return value;
};

export const nullable = <T>(decoder: Decoder<T>): Decoder<T | null> => (value, path) => value === null ? null : decoder(value, path);

export const array = <T>(item: Decoder<T>, max: number): Decoder<readonly T[]> => (value, path) => {
  if (!Array.isArray(value)) return fail(path, 'expected a list');
  if (value.length > max) return fail(path, `expected at most ${max} entries`);
  return Object.freeze(value.map((entry, index) => item(entry, `${path}[${index}]`)));
};

type Shape = Record<string, Decoder<unknown>>;
type Decoded<S extends Shape> = { readonly [K in keyof S]: S[K] extends Decoder<infer T> ? T : never };

/** A plain object with exactly the named keys: missing, extra or inherited keys all fail. */
export const object = <S extends Shape>(shape: S): Decoder<Decoded<S>> => (value, path) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'expected an object');
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return fail(path, 'expected a plain object');
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) if (!Object.hasOwn(shape, key)) fail(`${path}.${key}`, 'is not part of this view');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (!Object.hasOwn(source, key)) fail(`${path}.${key}`, 'is missing');
    out[key] = shape[key]!(source[key], `${path}.${key}`);
  }
  return Object.freeze(out) as Decoded<S>;
};

/** Tagged unions: the tag picks exactly one strict object decoder. */
export const tagged = <K extends string, M extends Record<string, Decoder<unknown>>>(key: K, cases: M): Decoder<M[keyof M] extends Decoder<infer T> ? T : never> => (value, path) => {
  if (typeof value !== 'object' || value === null) return fail(path, 'expected an object');
  const tag = (value as Record<string, unknown>)[key];
  if (typeof tag !== 'string' || !Object.hasOwn(cases, tag)) return fail(`${path}.${key}`, `expected one of ${Object.keys(cases).join(', ')}`);
  return cases[tag]!(value, path) as M[keyof M] extends Decoder<infer T> ? T : never;
};

export const check = (condition: boolean, path: string, reason: string): void => { if (!condition) fail(path, reason); };
