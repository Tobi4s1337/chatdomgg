import { createHash } from 'node:crypto';

/**
 * Canonical JSON for private history: sorted keys, no undefined array members, finite numbers only.
 * Anything that would not survive a JSON round trip unchanged (typed arrays, Maps, Dates) fails loudly
 * rather than being stored as a silently different value.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

export function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => {
          if (item === undefined) throw new TypeError(`Undefined array member at ${path}[${index}]`);
          return encode(item, `${path}[${index}]`);
        }).join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Unsupported ${prototype?.constructor?.name ?? 'object'} at ${path}`);
      const entries = Object.keys(value).sort().flatMap(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined ? [] : [`${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`];
      });
      return `{${entries.join(',')}}`;
    }
    default: throw new TypeError(`Unsupported ${typeof value} at ${path}`);
  }
}
