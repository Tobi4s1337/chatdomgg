import { inspect } from 'node:util';

const REDACTED = '[redacted]';

/**
 * A credential that refuses to print itself. String conversion, JSON and `util.inspect` all yield `[redacted]`;
 * only an explicit `reveal()` at the point of use reads the value.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    if (value.length === 0) throw new TypeError('A secret cannot be empty');
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  same(other: Secret | null): boolean {
    return other !== null && other.#value === this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return `Secret(${REDACTED})`;
  }
}
