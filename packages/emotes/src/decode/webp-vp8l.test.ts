import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EmoteDecodeError } from './errors';
import { decodeVp8l, decodeVp8lAlphaStream, readVp8lHeader } from './webp-vp8l';

/**
 * Vectors in testdata/vp8l are original synthetic images encoded by libwebp 1.6 (through Pillow) with
 * lossless=True, exact=True and a spread of method/quality settings, so they exercise the predictor,
 * color, subtract-green and color-indexing transforms, pixel bundling, color caches, meta prefix codes
 * and LZ77. manifest.json holds each image's size and the SHA-256 of its exact RGBA (checked against
 * libwebp's own decode when generated). The alpha-*.webp files are lossy frames with a lossless ALPH
 * chunk; *.alpha.gz holds the exact alpha plane.
 */

interface ManifestEntry {
  file: string;
  width: number;
  height: number;
  rgbaSha256: string;
}

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./testdata/vp8l/${name}`, import.meta.url)));
const manifest = JSON.parse(new TextDecoder().decode(fixture('manifest.json'))) as ManifestEntry[];

/** Walks the RIFF container and returns the payload of every chunk, in order. */
function riffChunks(file: Uint8Array): { fourcc: string; payload: Uint8Array }[] {
  const ascii = (offset: number): string => String.fromCharCode(...file.subarray(offset, offset + 4));
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WEBP') throw new Error('not a WebP file');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const chunks: { fourcc: string; payload: Uint8Array }[] = [];
  let offset = 12;
  while (offset + 8 <= file.length) {
    const size = view.getUint32(offset + 4, true);
    chunks.push({ fourcc: ascii(offset), payload: file.subarray(offset + 8, offset + 8 + size) });
    offset += 8 + size + (size & 1);
  }
  return chunks;
}

function chunk(file: Uint8Array, fourcc: string): Uint8Array {
  const found = riffChunks(file).find((c) => c.fourcc === fourcc);
  if (!found) throw new Error(`no ${fourcc} chunk`);
  return found.payload;
}

const vp8lOf = (name: string): Uint8Array => chunk(fixture(name), 'VP8L');
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Least-significant-bit-first writer for hand-built streams. */
class BitWriter {
  private readonly bytes: number[] = [];
  private bitCount = 0;

  write(value: number, n: number): this {
    for (let i = 0; i < n; i++) {
      const byte = this.bitCount >> 3;
      if (byte === this.bytes.length) this.bytes.push(0);
      if ((value >>> i) & 1) this.bytes[byte]! |= 1 << (this.bitCount & 7);
      this.bitCount++;
    }
    return this;
  }

  /** Signature plus 14-bit width-1, 14-bit height-1, alpha hint 0 and version 0. */
  header(width: number, height: number): this {
    return this.write(0x2f, 8).write(width - 1, 14).write(height - 1, 14).write(0, 1).write(0, 3);
  }

  /** A simple prefix code with one 8-bit symbol, which decodes without consuming bits. */
  single(symbol: number): this {
    return this.write(1, 1).write(0, 1).write(1, 1).write(symbol, 8);
  }

  bytesOut(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

function expectDecodeError(run: () => unknown, code: EmoteDecodeError['code']): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EmoteDecodeError);
    expect((error as EmoteDecodeError).code).toBe(code);
    return;
  }
  throw new Error(`expected an EmoteDecodeError '${code}'`);
}

/** Undoes the ALPH chunk's spatial filter (RFC 9649 §2.7.1.2) so any filter method can be compared. */
function unfilterAlpha(filtered: Uint8Array, width: number, height: number, method: number): Uint8Array {
  const out = new Uint8Array(filtered.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let predictor = 0;
      if (method !== 0 && (x > 0 || y > 0)) {
        if (y === 0) predictor = out[i - 1]!;
        else if (x === 0) predictor = out[i - width]!;
        else if (method === 1) predictor = out[i - 1]!;
        else if (method === 2) predictor = out[i - width]!;
        else predictor = Math.min(255, Math.max(0, out[i - 1]! + out[i - width]! - out[i - width - 1]!));
      }
      out[i] = (filtered[i]! + predictor) & 0xff;
    }
  }
  return out;
}

describe('readVp8lHeader', () => {
  it('reads size and alpha hint and rejects other signatures and versions', () => {
    expect(readVp8lHeader(new BitWriter().header(37, 19).bytesOut())).toEqual({ width: 37, height: 19, alphaHint: false });
    expect(readVp8lHeader(vp8lOf('shapes-alpha-96x64-m6.webp'))).toEqual({ width: 96, height: 64, alphaHint: true });
    const versioned = new BitWriter().write(0x2f, 8).write(0, 28).write(0, 1).write(1, 3).bytesOut();
    expect(readVp8lHeader(versioned)).toBeNull();
    expect(readVp8lHeader(new Uint8Array([0x2e, 0, 0, 0, 0]))).toBeNull();
    expect(readVp8lHeader(new Uint8Array([0x2f, 0, 0, 0]))).toBeNull();
  });
});

describe('decodeVp8l on libwebp vectors', () => {
  it('covers the vector set', () => {
    expect(manifest.length).toBeGreaterThanOrEqual(20);
  });

  for (const entry of manifest) {
    it(`decodes ${entry.file} exactly`, () => {
      const decoded = decodeVp8l(vp8lOf(entry.file), 512);
      expect(decoded.width).toBe(entry.width);
      expect(decoded.height).toBe(entry.height);
      expect(decoded.rgba.length).toBe(entry.width * entry.height * 4);
      expect(sha256(decoded.rgba)).toBe(entry.rgbaSha256);
    });
  }

  it('keeps the colour of fully transparent pixels', () => {
    const { rgba } = decodeVp8l(vp8lOf('transparent-40x30.webp'), 512);
    let transparentWithColour = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] === 0 && (rgba[i]! | rgba[i + 1]! | rgba[i + 2]!) !== 0) transparentWithColour++;
    expect(transparentWithColour).toBeGreaterThan(500);
  });
});

describe('decodeVp8lAlphaStream', () => {
  for (const name of ['alpha-shapes-96x64', 'alpha-scene-61x47', 'alpha-palette-33x21']) {
    it(`decodes the ALPH plane of ${name}`, () => {
      const file = fixture(`${name}.webp`);
      const vp8x = chunk(file, 'VP8X');
      const width = (vp8x[4]! | (vp8x[5]! << 8) | (vp8x[6]! << 16)) + 1;
      const height = (vp8x[7]! | (vp8x[8]! << 8) | (vp8x[9]! << 16)) + 1;
      const alph = chunk(file, 'ALPH');
      const flags = alph[0]!;
      expect(flags & 3).toBe(1);
      expect((flags >> 4) & 3).toBe(0);
      const filtered = decodeVp8lAlphaStream(alph.subarray(1), width, height);
      expect(filtered.length).toBe(width * height);
      const expected = new Uint8Array(gunzipSync(fixture(`${name}.alpha.gz`)));
      expect(Buffer.from(unfilterAlpha(filtered, width, height, (flags >> 2) & 3)).equals(Buffer.from(expected))).toBe(true);
    });
  }

  it('rejects a truncated alpha stream and a bad size', () => {
    const alph = chunk(fixture('alpha-shapes-96x64.webp'), 'ALPH');
    expectDecodeError(() => decodeVp8lAlphaStream(alph.subarray(1, alph.length >> 1), 96, 64), 'corrupt');
    expectDecodeError(() => decodeVp8lAlphaStream(alph.subarray(1), 0, 64), 'corrupt');
  });
});

describe('decodeVp8l on hand-built streams', () => {
  it('decodes literals through single-symbol codes', () => {
    const stream = new BitWriter()
      .header(2, 2)
      .write(0, 1) // no transform
      .write(0, 1) // no color cache
      .write(0, 1) // no meta prefix codes
      .single(0x40) // green
      .single(0x10) // red
      .single(0x20) // blue
      .single(0x80) // alpha
      .single(0) // distance
      .bytesOut();
    const { rgba } = decodeVp8l(stream, 512);
    expect(Array.from(rgba)).toEqual([0x10, 0x40, 0x20, 0x80, 0x10, 0x40, 0x20, 0x80, 0x10, 0x40, 0x20, 0x80, 0x10, 0x40, 0x20, 0x80]);
  });

  it('applies subtract-green and a two-symbol code', () => {
    const stream = new BitWriter()
      .header(3, 1)
      .write(1, 1)
      .write(2, 2) // subtract green
      .write(0, 1) // end of transforms
      .write(0, 1)
      .write(0, 1)
      // green: symbols 5 and 200, one bit each
      .write(1, 1).write(1, 1).write(1, 1).write(5, 8).write(200, 8)
      .single(1) // red residual
      .single(2) // blue residual
      .single(255) // alpha
      .single(0)
      .write(0, 1).write(1, 1).write(1, 1) // green codes: 5, 200, 200
      .bytesOut();
    const { rgba } = decodeVp8l(stream, 512);
    expect(Array.from(rgba)).toEqual([6, 5, 7, 255, 201, 200, 202, 255, 201, 200, 202, 255]);
  });

  it('reads but does not build the prefix codes of meta groups no block uses', () => {
    // One block whose meta prefix code is 0xffff, so the stream carries 65536 groups.
    const stream = (unusedDistance: number): Uint8Array => {
      const w = new BitWriter().header(1, 1).write(0, 1).write(0, 1);
      w.write(1, 1).write(0, 3); // meta prefix codes, prefix_bits 2
      w.write(0, 1).single(0xff).single(0xff).single(0).single(0).single(0); // the 1×1 entropy image
      for (let group = 0; group < 0xffff; group++) w.single(0).single(0).single(0).single(0).single(unusedDistance);
      w.single(7).single(8).single(9).single(10).single(0);
      return w.write(0, 32).bytesOut();
    };
    const started = performance.now();
    expect(Array.from(decodeVp8l(stream(0), 512).rgba)).toEqual([8, 7, 9, 10]);
    expect(performance.now() - started).toBeLessThan(2000);
    // A distance code whose only symbol is outside the 40-symbol alphabet is empty, even in an unused group.
    expectDecodeError(() => decodeVp8l(stream(200), 512), 'corrupt');
  });

  it('caps the memory of prefix-code tables', () => {
    const order = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8];
    // A normal code where every symbol has length 8; the code-length code is the single symbol 8.
    const allEight = (w: BitWriter, maxSymbol?: number): void => {
      w.write(0, 1).write(order.length - 4, 4);
      for (const symbol of order) w.write(symbol === 8 ? 1 : 0, 3);
      if (maxSymbol === undefined) w.write(0, 1);
      else w.write(1, 1).write(3, 3).write(maxSymbol - 2, 8);
    };
    const msbFirst = (w: BitWriter, value: number): void => {
      for (let bit = 7; bit >= 0; bit--) w.write((value >> bit) & 1, 1);
    };
    const w = new BitWriter().header(512, 512).write(0, 1).write(0, 1);
    w.write(1, 1).write(0, 3); // a 128×128 entropy image naming 16384 distinct groups
    w.write(0, 1);
    allEight(w, 256);
    allEight(w);
    w.single(0).single(0).single(0);
    for (let group = 0; group < 128 * 128; group++) {
      msbFirst(w, group & 0xff);
      msbFirst(w, group >> 8);
    }
    for (let group = 0; group < 128 * 128; group++) {
      allEight(w, 256);
      allEight(w);
      allEight(w);
      allEight(w);
      w.single(0);
    }
    expectDecodeError(() => decodeVp8l(w.bytesOut(), 512), 'over-budget');
  });

  it('rejects color cache sizes outside 1..11', () => {
    for (const bits of [0, 12, 15]) {
      const stream = new BitWriter().header(1, 1).write(0, 1).write(1, 1).write(bits, 4).write(0, 64).bytesOut();
      expectDecodeError(() => decodeVp8l(stream, 512), 'corrupt');
    }
  });

  it('rejects a transform that appears twice', () => {
    const stream = new BitWriter().header(1, 1).write(1, 1).write(2, 2).write(1, 1).write(2, 2).write(0, 64).bytesOut();
    expectDecodeError(() => decodeVp8l(stream, 512), 'corrupt');
  });

  it('rejects incomplete and over-subscribed prefix codes', () => {
    const lengthsCode = (lengths: number[]): BitWriter => {
      const w = new BitWriter().header(1, 1).write(0, 1).write(0, 1).write(0, 1);
      // Normal code: 19 code-length code lengths. Only symbols 1, 2 and 3 (positions 3, 4, 5) are used.
      w.write(0, 1).write(15, 4);
      const order = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      for (const symbol of order) w.write(lengths[symbol] ?? 0, 3);
      return w.write(0, 64);
    };
    // Code lengths 1, 1, 1 over-subscribe; 1 and 2 alone leave the code incomplete.
    expectDecodeError(() => decodeVp8l(lengthsCode([0, 1, 1, 1]).bytesOut(), 512), 'corrupt');
    expectDecodeError(() => decodeVp8l(lengthsCode([0, 1, 2]).bytesOut(), 512), 'corrupt');
  });

  it('bounds back-references by the first and the last pixel', () => {
    // Green uses a normal code in which literal 0 and length symbol 256 + lengthSymbol have one bit each.
    // The code-length code holds lengths 0 and 1 at one bit each (4 entries in order 17, 18, 0, 1).
    const stream = (height: number, lengthSymbol: number, pixelBits: number[]): Uint8Array => {
      const w = new BitWriter().header(1, height).write(0, 1).write(0, 1).write(0, 1);
      w.write(0, 1).write(0, 4).write(0, 3).write(0, 3).write(1, 3).write(1, 3);
      w.write(0, 1); // no max_symbol: one token for each of the 280 green symbols
      for (let symbol = 0; symbol < 280; symbol++) w.write(symbol === 0 || symbol === 256 + lengthSymbol ? 1 : 0, 1);
      w.single(9).single(9).single(255).single(0); // red, blue, alpha; distance symbol 0 is distance code 1
      for (const bit of pixelBits) w.write(bit, 1);
      return w.write(0, 32).bytesOut();
    };
    // Distance code 1 is one row up, which in a one-pixel-wide image is a distance of 1.
    expect(() => decodeVp8l(stream(3, 1, [1]), 512)).toThrow(/before the first pixel/);
    expect(() => decodeVp8l(stream(3, 3, [0, 1]), 512)).toThrow(/past the last pixel/);
    expectDecodeError(() => decodeVp8l(stream(3, 3, [0, 1]), 512), 'corrupt');
    const { rgba } = decodeVp8l(stream(3, 1, [0, 1]), 512);
    expect(Array.from(rgba)).toEqual([9, 0, 9, 255, 9, 0, 9, 255, 9, 0, 9, 255]);
  });

  it('refuses an oversized header before allocating', () => {
    const stream = new BitWriter().header(16384, 16384).write(0, 64).bytesOut();
    expect(readVp8lHeader(stream)).toEqual({ width: 16384, height: 16384, alphaHint: false });
    const started = performance.now();
    expectDecodeError(() => decodeVp8l(stream, 512), 'over-budget');
    expectDecodeError(() => decodeVp8l(new BitWriter().header(513, 1).bytesOut(), 512), 'over-budget');
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('rejects a bad signature and an empty chunk as corrupt', () => {
    expectDecodeError(() => decodeVp8l(new Uint8Array(0), 512), 'corrupt');
    expectDecodeError(() => decodeVp8l(new Uint8Array([0x2e, 0, 0, 0, 0, 0]), 512), 'corrupt');
  });
});

describe('decodeVp8l on hostile input', () => {
  it('rejects every truncation of a real stream as corrupt', () => {
    const full = vp8lOf('scene-300x200-m6.webp');
    for (let i = 1; i <= 16; i++) {
      const cut = Math.floor((full.length * i) / 17);
      expectDecodeError(() => decodeVp8l(full.subarray(0, cut), 512), 'corrupt');
    }
    const small = vp8lOf('palette16-67x45.webp');
    for (let cut = 0; cut < small.length - 1; cut += 7) expectDecodeError(() => decodeVp8l(small.subarray(0, cut), 512), 'corrupt');
  });

  it('only ever throws EmoteDecodeError on mutated streams, and finishes quickly', () => {
    let seed = 0x5eed1234;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const sources = ['noise-37x19-m6.webp', 'palette16-67x45.webp', 'tiled-128x96-m6.webp', 'shapes-alpha-96x64-m2.webp', 'gradient-64x48-m4.webp', 'palette2-50x30.webp'].map(vp8lOf);
    const outcomes = { decoded: 0, corrupt: 0, overBudget: 0 };
    const started = performance.now();
    for (let n = 0; n < 300; n++) {
      const source = sources[n % sources.length]!;
      const mutated = source.slice();
      const flips = 1 + Math.floor(random() * 6);
      for (let f = 0; f < flips; f++) {
        // Mostly the stream body; occasionally the header, so oversized and odd sizes are hit too.
        const at = random() < 0.1 ? Math.floor(random() * 5) : 5 + Math.floor(random() * (mutated.length - 5));
        mutated[at] = random() < 0.5 ? mutated[at]! ^ (1 << Math.floor(random() * 8)) : Math.floor(random() * 256);
      }
      const input = random() < 0.2 ? mutated.subarray(0, Math.floor(random() * mutated.length)) : mutated;
      try {
        const { width, height, rgba } = decodeVp8l(input, 512);
        expect(rgba.length).toBe(width * height * 4);
        outcomes.decoded++;
      } catch (error) {
        if (!(error instanceof EmoteDecodeError)) throw error;
        if (error.code === 'over-budget') outcomes.overBudget++;
        else {
          expect(error.code).toBe('corrupt');
          outcomes.corrupt++;
        }
      }
    }
    expect(outcomes.corrupt).toBeGreaterThan(100);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('only ever throws EmoteDecodeError on random bytes', () => {
    let state = 99;
    const next = (): number => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 24;
    for (let n = 0; n < 200; n++) {
      const bytes = new Uint8Array(5 + (n % 97));
      for (let i = 0; i < bytes.length; i++) bytes[i] = next();
      bytes[0] = 0x2f;
      bytes[4]! &= 0x1f;
      try {
        decodeVp8l(bytes, 512);
      } catch (error) {
        expect(error).toBeInstanceOf(EmoteDecodeError);
      }
    }
  });
});
