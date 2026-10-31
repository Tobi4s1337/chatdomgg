import { sha256Hex } from '../sha256';

/**
 * Content-addressed storage for fetched source bytes and compiled buffers. Hashes are verified on
 * write and again on read, so a damaged or substituted blob is never served under a trusted
 * address. Main binds the durable implementation; `createMemoryEmoteBlobStore` is for tests and
 * the bench and is never durable production storage.
 */
export interface EmoteBlobStore {
  put(hash: string, bytes: Uint8Array): Promise<void>;
  /** The verified bytes, or null when absent or when the stored bytes no longer match the hash. */
  get(hash: string): Promise<Uint8Array | null>;
}

export class EmoteBlobError extends Error {
  constructor(message: string) { super(message); this.name = 'EmoteBlobError'; }
}

/** Bounded by bytes and by entries; the oldest entries leave first. Copies in and out. */
export function createMemoryEmoteBlobStore(limits: { maxBytes: number; maxEntries: number } = { maxBytes: 64 * 1024 * 1024, maxEntries: 2048 }): EmoteBlobStore & { readonly bytes: number; readonly size: number } {
  const blobs = new Map<string, Uint8Array>();
  let bytes = 0;
  const evict = (): void => {
    for (const [hash, blob] of blobs) {
      if (bytes <= limits.maxBytes && blobs.size <= limits.maxEntries) return;
      blobs.delete(hash); bytes -= blob.length;
    }
  };
  return {
    get bytes() { return bytes; },
    get size() { return blobs.size; },
    async put(hash, data) {
      if (!/^[a-f0-9]{64}$/.test(hash) || sha256Hex(data) !== hash) throw new EmoteBlobError('The blob does not match its content address.');
      if (data.length > limits.maxBytes) throw new EmoteBlobError('The blob is larger than the store.');
      const existing = blobs.get(hash);
      if (existing) { blobs.delete(hash); blobs.set(hash, existing); return; }
      blobs.set(hash, data.slice()); bytes += data.length;
      evict();
    },
    async get(hash) {
      const blob = blobs.get(hash);
      if (!blob) return null;
      if (sha256Hex(blob) !== hash) { blobs.delete(hash); bytes -= blob.length; return null; }
      return blob.slice();
    },
  };
}

/**
 * Wraps a bound blob store so the catalogue service checks every content address itself: a write
 * whose bytes do not hash to the address is refused, and a read that comes back different is
 * treated as absent. The service never relies on the bound implementation to have verified.
 */
export function verifyEmoteBlobStore(store: EmoteBlobStore): EmoteBlobStore {
  return {
    async put(hash, bytes) {
      if (!/^[a-f0-9]{64}$/.test(hash) || !(bytes instanceof Uint8Array) || sha256Hex(bytes) !== hash) throw new EmoteBlobError('The blob does not match its content address.');
      await store.put(hash, bytes);
    },
    async get(hash) {
      if (!/^[a-f0-9]{64}$/.test(hash)) return null;
      const bytes = await store.get(hash);
      return bytes instanceof Uint8Array && sha256Hex(bytes) === hash ? bytes : null;
    },
  };
}
