/**
 * Browser-safe byte identity for founded scenes. No Node imports: the entry adapter decodes with this same module.
 *
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, -0 written as 0, finite numbers only.
 * Undefined object members are dropped (never present in a validated scene); undefined array members, non-plain
 * objects and non-finite numbers fail loudly instead of becoming different bytes.
 */
export function canonicalSceneJson(value: unknown): string {
  return encode(value, '$');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);

/** SHA-256 of a blueprint's exact canonical bytes: the asset identity. Never the semantic blueprint ID. */
export function assetHashOf(blueprint: unknown): Promise<string> {
  return sha256Hex(utf8(canonicalSceneJson(blueprint)));
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
      if (Array.isArray(value)) return `[${value.map((item, i) => {
        if (item === undefined) throw new TypeError(`Undefined array member at ${path}[${i}]`);
        return encode(item, `${path}[${i}]`);
      }).join(',')}]`;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Unsupported object at ${path}`);
      const entries: string[] = [];
      for (const key of Object.keys(value).sort()) {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) entries.push(`${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`);
      }
      return `{${entries.join(',')}}`;
    }
    default: throw new TypeError(`Unsupported ${typeof value} at ${path}`);
  }
}
