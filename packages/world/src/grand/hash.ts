/**
 * The grand land's string and integer hashes (FNV-1a and a 32-bit finaliser). Their own module so that choosing a
 * channel's world traits (`world.ts`) needs no noise or generator code; `noise.ts` re-exports them unchanged.
 */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mix32(value: number): number {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
