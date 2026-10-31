import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EmoteDecodeError } from './errors';
import { decodeVp8, readVp8Header } from './webp-vp8';

/**
 * Vectors in testdata/vp8 are original synthetic images (gradients, noise, flat cartoon shapes with
 * sharp edges) encoded by libwebp with a spread of quality, method, filter type and strength,
 * sharpness, segment and token-partition settings. manifest.json holds each image's size, settings
 * and the SHA-256 of the RGB that Pillow (libwebp, default fancy upsampling) decodes; the smaller
 * vectors also ship that RGB as *.rgb.gz so a mismatch reports how far off it is.
 */

interface ManifestEntry {
  name: string;
  width: number;
  height: number;
  quality: number;
  method: number;
  options: Record<string, number>;
  rgbSha256: string;
  rgbFile: string | null;
}

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./testdata/vp8/${name}`, import.meta.url)));
const manifest = JSON.parse(new TextDecoder().decode(fixture('manifest.json'))) as ManifestEntry[];

/** Returns the payload of the first chunk with the given fourcc, walking the RIFF container. */
function riffChunk(file: Uint8Array, fourcc: string): Uint8Array {
  const ascii = (offset: number): string => String.fromCharCode(...file.subarray(offset, offset + 4));
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WEBP') throw new Error('not a WebP file');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 12;
  while (at + 8 <= file.length) {
    const size = view.getUint32(at + 4, true);
    if (ascii(at) === fourcc) return file.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  throw new Error(`no ${fourcc} chunk`);
}

const vp8Payload = (name: string): Uint8Array => riffChunk(fixture(`${name}.webp`), 'VP8 ');

function rgbOf(rgba: Uint8Array): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  return rgb;
}

function decodeError(run: () => unknown): EmoteDecodeError {
  try {
    run();
  } catch (error) {
    if (error instanceof EmoteDecodeError) return error;
    throw error;
  }
  throw new Error('expected the decode to fail');
}

/** Small deterministic PRNG (mulberry32) so fuzz cases are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('readVp8Header', () => {
  it('reads the key-frame size of every vector', () => {
    for (const entry of manifest) {
      expect(readVp8Header(vp8Payload(entry.name))).toEqual({ width: entry.width, height: entry.height });
    }
  });

  it('rejects short data, inter frames and bad start codes', () => {
    const payload = vp8Payload('cartoon-64-q5');
    expect(readVp8Header(payload.subarray(0, 9))).toBeNull();
    const inter = payload.slice();
    inter[0] = inter[0]! | 1;
    expect(readVp8Header(inter)).toBeNull();
    const badStart = payload.slice();
    badStart[4] = 0x02;
    expect(readVp8Header(badStart)).toBeNull();
  });
});

describe('decodeVp8 against libwebp', () => {
  for (const entry of manifest) {
    it(`${entry.name} (${entry.width}x${entry.height}, q${entry.quality} m${entry.method} ${JSON.stringify(entry.options)})`, () => {
      const decoded = decodeVp8(vp8Payload(entry.name), 512);
      expect(decoded.width).toBe(entry.width);
      expect(decoded.height).toBe(entry.height);
      expect(decoded.rgba.length).toBe(entry.width * entry.height * 4);
      for (let i = 3; i < decoded.rgba.length; i += 4) if (decoded.rgba[i] !== 255) throw new Error(`alpha at ${i}`);
      const rgb = rgbOf(decoded.rgba);
      if (entry.rgbFile !== null) {
        const expected = new Uint8Array(gunzipSync(fixture(entry.rgbFile)));
        expect(expected.length).toBe(rgb.length);
        let maxDiff = 0;
        let differing = 0;
        for (let i = 0; i < rgb.length; i++) {
          const diff = Math.abs(rgb[i]! - expected[i]!);
          if (diff > 0) differing++;
          if (diff > maxDiff) maxDiff = diff;
        }
        expect({ maxDiff, differing }).toEqual({ maxDiff: 0, differing: 0 });
      }
      expect(createHash('sha256').update(rgb).digest('hex')).toBe(entry.rgbSha256);
    });
  }
});

describe('decodeVp8 on hostile input', () => {
  const valid = vp8Payload('cartoon-112-q90');

  it('refuses a size over the limit before allocating', () => {
    const huge = valid.slice(0, 64);
    huge[6] = 0xff;
    huge[7] = 0x3f;
    huge[8] = 0xff;
    huge[9] = 0x3f;
    expect(readVp8Header(huge)).toEqual({ width: 16383, height: 16383 });
    const started = performance.now();
    const error = decodeError(() => decodeVp8(huge, 512));
    expect(error.code).toBe('over-budget');
    expect(performance.now() - started).toBeLessThan(50);
    expect(decodeError(() => decodeVp8(valid, 111)).code).toBe('over-budget');
  });

  it('reports an inter frame as unsupported', () => {
    const inter = valid.slice();
    inter[0] = inter[0]! | 1;
    expect(decodeError(() => decodeVp8(inter, 512)).code).toBe('unsupported');
    expect(decodeError(() => decodeVp8(Uint8Array.of(0x01, 0x00, 0x00), 512)).code).toBe('unsupported');
  });

  it('reports truncated data and broken headers as corrupt', () => {
    for (const length of [0, 2, 3, 9, 10, 20, 60]) {
      expect(decodeError(() => decodeVp8(valid.subarray(0, length), 512)).code).toBe('corrupt');
    }
    const firstPartitionSize = (valid[0]! | (valid[1]! << 8) | (valid[2]! << 16)) >>> 5;
    // Cut inside the first partition, and exactly where the token partition would start.
    expect(decodeError(() => decodeVp8(valid.subarray(0, 10 + firstPartitionSize - 1), 512)).code).toBe('corrupt');
    expect(decodeError(() => decodeVp8(valid.subarray(0, 10 + firstPartitionSize), 512)).code).toBe('corrupt');
    const badStart = valid.slice();
    badStart[3] = 0x00;
    expect(decodeError(() => decodeVp8(badStart, 512)).code).toBe('corrupt');
    const empty = valid.slice();
    empty[6] = 0;
    empty[7] = 0;
    expect(decodeError(() => decodeVp8(empty, 512)).code).toBe('corrupt');
    const badVersion = valid.slice();
    badVersion[0] = (badVersion[0]! & ~0x0e) | (5 << 1);
    expect(decodeError(() => decodeVp8(badVersion, 512)).code).toBe('corrupt');
  });

  it('reports token partition sizes beyond the data as corrupt', () => {
    const payload = vp8Payload('cartoon-32x128-q60-parts8');
    const firstPartitionSize = (payload[0]! | (payload[1]! << 8) | (payload[2]! << 16)) >>> 5;
    const sizes = 10 + firstPartitionSize;
    const tooBig = payload.slice();
    tooBig[sizes + 2] = 0x7f;
    expect(decodeError(() => decodeVp8(tooBig, 512)).code).toBe('corrupt');
    // Dropping the tail leaves the declared middle partitions intact but the last one empty or short.
    expect(decodeError(() => decodeVp8(payload.subarray(0, sizes + 3 * 7), 512)).code).toBe('corrupt');
  });

  it('survives seeded mutations with either a picture or an EmoteDecodeError', () => {
    const random = prng(0x5eed);
    const sources = [valid, vp8Payload('cartoon-32x128-q60-parts8'), vp8Payload('grad-45x29-q40-simple-sharp3')];
    const started = performance.now();
    let decoded = 0;
    for (let n = 0; n < 200; n++) {
      const source = sources[n % sources.length]!;
      let input = source.slice();
      const kind = Math.floor(random() * 4);
      if (kind === 0) {
        input = input.subarray(0, Math.floor(random() * input.length));
      } else {
        const flips = 1 + Math.floor(random() * (kind === 3 ? 64 : 8));
        // Mostly after the size fields so most cases get deep into the bitstream.
        for (let i = 0; i < flips; i++) {
          const at = kind === 1 ? Math.floor(random() * input.length) : 10 + Math.floor(random() * (input.length - 10));
          input[at] = Math.floor(random() * 256);
        }
      }
      try {
        const out = decodeVp8(input, 512);
        expect(out.rgba.length).toBe(out.width * out.height * 4);
        decoded++;
      } catch (error) {
        if (!(error instanceof EmoteDecodeError)) throw error;
      }
    }
    expect(decoded).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
