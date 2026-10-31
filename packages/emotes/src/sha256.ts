// FIPS 180-4 SHA-256 over bytes. Synchronous and dependency-free so the compiler, its tests and
// a server worker hash identically without awaiting SubtleCrypto.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Incremental hasher; `update` may be called with any number of chunks before `hex`. */
export function createSha256(): { update(bytes: Uint8Array): void; hex(): string } {
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const block = new Uint8Array(64), words = new Uint32Array(64);
  let filled = 0, length = 0, done = false;
  const compress = (): void => {
    for (let i = 0; i < 16; i++) words[i] = (block[i * 4]! << 24 | block[i * 4 + 1]! << 16 | block[i * 4 + 2]! << 8 | block[i * 4 + 3]!) >>> 0;
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15]!, b = words[i - 2]!;
      const s0 = (a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ a >>> 3;
      const s1 = (b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ b >>> 10;
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0;
    }
    let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!, e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + (e & f ^ ~e & g) + K[i]! + words[i]!) >>> 0;
      const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (a & b ^ a & c ^ b & c)) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) state[i] = state[i]! + add[i]!;
  };
  return {
    update(bytes) {
      if (done) throw new Error('SHA-256 already finished');
      length += bytes.length;
      for (let i = 0; i < bytes.length; i++) {
        block[filled++] = bytes[i]!;
        if (filled === 64) { compress(); filled = 0; }
      }
    },
    hex() {
      if (done) throw new Error('SHA-256 already finished');
      done = true;
      const bits = length * 8;
      block[filled++] = 0x80;
      if (filled > 56) { block.fill(0, filled); compress(); filled = 0; }
      block.fill(0, filled, 56);
      // Inputs here are bounded far below 2^53 bits, so the high word is exact.
      const high = Math.floor(bits / 0x100000000), low = bits >>> 0;
      block.set([high >>> 24, high >>> 16 & 255, high >>> 8 & 255, high & 255, low >>> 24, low >>> 16 & 255, low >>> 8 & 255, low & 255], 56);
      compress();
      return [...state].map(word => word.toString(16).padStart(8, '0')).join('');
    },
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  const hash = createSha256();
  hash.update(bytes);
  return hash.hex();
}

export function sha256Text(text: string): string {
  return sha256Hex(new TextEncoder().encode(text));
}
