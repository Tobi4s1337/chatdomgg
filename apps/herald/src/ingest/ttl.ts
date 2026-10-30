/**
 * A bounded map whose entries expire after a fixed time. Insertion order is expiry order, so expiry and
 * eviction only ever look at the oldest entries. At capacity the oldest entry goes first; the eviction is
 * counted so a cap hit is never silent.
 */
export class TtlMap<K, V> {
  readonly #ttlMs: number;
  readonly #capacity: number;
  readonly #entries = new Map<K, { readonly value: V; readonly expiresAt: number }>();
  evicted = 0;

  constructor(ttlMs: number, capacity: number) {
    this.#ttlMs = ttlMs;
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K, now: number): V | undefined {
    this.#expire(now);
    return this.#entries.get(key)?.value;
  }

  has(key: K, now: number): boolean {
    return this.get(key, now) !== undefined;
  }

  /** Sets a value; a re-set entry moves to the back with a fresh expiry. */
  set(key: K, value: V, now: number): void {
    this.#expire(now);
    this.#entries.delete(key);
    while (this.#entries.size >= this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
      this.evicted++;
    }
    this.#entries.set(key, { value, expiresAt: now + this.#ttlMs });
  }

  delete(key: K): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  #expire(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt > now) return;
      this.#entries.delete(key);
    }
  }
}
