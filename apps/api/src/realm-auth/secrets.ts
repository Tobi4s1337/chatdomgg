import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random value, URL-safe. Used for session handles, tickets, state, nonce and sign-in bindings. */
export function secret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
export function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
/**
 * The CSRF token is derived from the session handle under its own label, so it needs no storage, changes with
 * every session and cannot be computed from the stored handle hash. It authorises same-session requests only.
 */
export function csrfFor(handle: string): string {
  return createHash('sha256').update('chatdom.realm.csrf.v1\0').update(handle, 'utf8').digest('base64url');
}
export function sameText(a: string, b: string): boolean {
  return sameHash(sha256(a), sha256(b));
}
