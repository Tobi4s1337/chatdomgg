import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EMOTE_SOURCE_LIMITS } from '../profiles';
import { EmoteDecodeError } from './errors';
import { decodeEmoteImage } from './index';
import { decodeWebp } from './webp';

const data = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./testdata/webp/${name}`, import.meta.url)));
const expected = (name: string): Uint8Array => new Uint8Array(gunzipSync(data(name)));

/** Largest channel difference, ignoring colour under fully transparent pixels (it is never shown). */
function maxDifference(a: Uint8Array, b: Uint8Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(a[i + c]! - b[i + c]!));
  }
  return worst;
}

describe('WebP container', () => {
  for (const name of ['anim-lossless', 'anim-lossy', 'anim-mixed']) {
    it(`coalesces ${name} like libwebp's animation decoder`, async () => {
      const decoded = await decodeWebp(data(`${name}.webp`)), want = expected(`${name}.rgba.gz`);
      expect([decoded.width, decoded.height, decoded.frames.length]).toEqual([48, 40, 5]);
      expect(decoded.frames.map(f => f.durationMs)).toEqual([120, 100, 60, 90, 200]);
      const size = 48 * 40 * 4;
      // Non-premultiplied blending rounds once per pixel; libwebp's integer path may differ by one.
      decoded.frames.forEach((frame, i) => expect(maxDifference(frame.rgba, want.subarray(i * size, (i + 1) * size)), `frame ${i}`).toBeLessThanOrEqual(1));
    });
  }

  it('decodes a still lossy image with a separate alpha plane, and a simple lossy file', async () => {
    for (const name of ['still-lossy-alpha', 'still-simple-lossy']) {
      const decoded = await decodeWebp(data(`${name}.webp`));
      expect(decoded.frames.length).toBe(1);
      expect(decoded.frames[0]!.durationMs).toBe(0);
      expect(maxDifference(decoded.frames[0]!.rgba, expected(`${name}.rgba.gz`)), name).toBe(0);
    }
  });

  it('refuses an oversized canvas and too many frames from the headers alone', async () => {
    const big = data('anim-lossless.webp').slice();
    const vp8x = 12 + 8; // first chunk payload: flags(4) width-1(3) height-1(3)
    big[vp8x + 4] = 0xff; big[vp8x + 5] = 0xff; big[vp8x + 6] = 0x00;
    expect(await decodeEmoteImage(big, 'webp')).toMatchObject({ ok: false, code: 'over-budget' });

    // Repeat one ANMF chunk past the frame limit.
    const source = data('anim-lossless.webp'), view = new DataView(source.buffer, source.byteOffset);
    let at = 12, anmf: Uint8Array | null = null, header = 0;
    while (at + 8 <= source.length) {
      const name = String.fromCharCode(...source.subarray(at, at + 4)), size = view.getUint32(at + 4, true);
      if (name === 'ANMF' && !anmf) anmf = source.slice(at, at + 8 + size + (size & 1));
      if (name === 'ANMF' && !header) header = at;
      at += 8 + size + (size & 1);
    }
    const parts = [source.subarray(0, header), ...Array(EMOTE_SOURCE_LIMITS.frames + 1).fill(anmf!)];
    const total = parts.reduce((n, p) => n + p.length, 0), many = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { many.set(part, offset); offset += part.length; }
    new DataView(many.buffer).setUint32(4, total - 8, true);
    expect(await decodeEmoteImage(many, 'webp')).toMatchObject({ ok: false, code: 'over-budget' });
  });

  it('survives mutation fuzzing with only typed failures', { timeout: 30_000 }, async () => {
    const base = data('anim-mixed.webp');
    let seed = 99;
    const random = () => (seed = Math.imul(seed ^ seed >>> 15, 2246822519) + 0x9e3779b9 >>> 0) / 2 ** 32;
    for (let round = 0; round < 200; round++) {
      const mutated = base.slice();
      for (let k = 0; k < 1 + Math.floor(random() * 6); k++) mutated[Math.floor(random() * mutated.length)] = Math.floor(random() * 256);
      try { await decodeWebp(mutated); } catch (error) { expect(error).toBeInstanceOf(EmoteDecodeError); }
    }
  });
});
