import { ForgeWishQueueError, type ForgeWishJson } from './types';

/** Copy only bounded, finite, plain JSON. No getters, custom serializers or silently dropped values. */
export function copyWishJson(value: unknown): ForgeWishJson {
  let nodes = 0;
  function copy(input: unknown, depth: number): ForgeWishJson {
    if (++nodes > 8_192 || depth > 24) throw new ForgeWishQueueError('invalid');
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null) throw new ForgeWishQueueError('invalid');
    if (Object.getOwnPropertySymbols(input).length) throw new ForgeWishQueueError('invalid');
    if (Array.isArray(input)) {
      if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 8_192
        || Object.keys(input).length !== input.length) throw new ForgeWishQueueError('invalid');
      const output: ForgeWishJson[] = [];
      for (let index = 0; index < input.length; index++) {
        const field = Object.getOwnPropertyDescriptor(input, String(index));
        if (!field || !('value' in field)) throw new ForgeWishQueueError('invalid');
        output.push(copy(field.value, depth + 1));
      }
      return output;
    }
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
      throw new ForgeWishQueueError('invalid');
    const output: Record<string, ForgeWishJson> = Object.create(null) as Record<string, ForgeWishJson>;
    for (const key of Object.keys(input).sort()) {
      const field = Object.getOwnPropertyDescriptor(input, key)!;
      if (!('value' in field) || key.length > 128) throw new ForgeWishQueueError('invalid');
      output[key] = copy(field.value, depth + 1);
    }
    return output;
  }
  const result = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > 65_536) throw new ForgeWishQueueError('invalid');
  return result;
}
