import { readFileSync } from 'node:fs';
import { deflateSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeGif } from '../fixtures/gif-encode';
import { TOAD_WAVE_FRAMES, toadWaveAnimatedFixture, toadWaveGifBytes } from '../fixtures/toad-wave-animated';
import { EMOTE_SOURCE_LIMITS } from '../profiles';
import { sha256Hex } from '../sha256';
import { crc32 } from './crc32';
import { createEmoteImageDecoder, decodeEmoteBytes, decodeEmoteImage, EmoteDecodeError, sniffEmoteFormat } from './index';
import { decodeGif } from './gif';
import { decodePng } from './png';

const data = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./testdata/${name}`, import.meta.url)));
const expected = (name: string): Uint8Array => new Uint8Array(gunzipSync(data(name)));

async function failure(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (error instanceof EmoteDecodeError) return error.code; throw error; }
  throw new Error('expected the decode to fail');
}

/** A PNG writer for tests that need shapes Pillow cannot produce (Adam7, hostile headers). */
function chunk(name: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(out, 4, 8 + payload.length));
  return out;
}
function png(width: number, height: number, colour: number, depth: number, raw: Uint8Array, extra: Uint8Array[] = [], interlace = 0): Uint8Array {
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height); ihdr[8] = depth; ihdr[9] = colour; ihdr[12] = interlace;
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
/** RGBA8 rows with filter 0, optionally split into Adam7 passes. */
function rawRgba(rgba: Uint8Array, width: number, height: number, interlaced: boolean): Uint8Array {
  const rows: number[] = [];
  const passes = interlaced ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  for (const [x0, y0, dx, dy] of passes) {
    if (x0! >= width) continue;
    for (let y = y0!; y < height; y += dy!) {
      rows.push(0);
      for (let x = x0!; x < width; x += dx!) rows.push(...rgba.subarray((x + y * width) * 4, (x + y * width) * 4 + 4));
    }
  }
  return Uint8Array.from(rows);
}

describe('PNG', () => {
  for (const name of ['rgba8', 'rgb8', 'la8', 'pal4-trns', 'grey1']) {
    it(`decodes ${name} exactly as the reference decoder does`, async () => {
      const decoded = await decodePng(data(`png/${name}.png`));
      expect([decoded.width, decoded.height, decoded.frames.length]).toEqual([37, 29, 1]);
      expect(decoded.frames[0]!.durationMs).toBe(0);
      expect(Buffer.from(decoded.frames[0]!.rgba).equals(Buffer.from(expected(`png/${name}.rgba.gz`)))).toBe(true);
    });
  }

  it('keeps the high byte of 16-bit samples', async () => {
    const decoded = await decodePng(data('png/grey16.png')), raw = expected('png/grey16.raw16.gz');
    for (let i = 0; i < 37 * 29; i++) {
      const value = raw[i * 2]! | raw[i * 2 + 1]! << 8; // Pillow's I;16 is little-endian
      expect(decoded.frames[0]!.rgba[i * 4]).toBe(value >> 8);
      expect(decoded.frames[0]!.rgba[i * 4 + 3]).toBe(255);
    }
  });

  it('places Adam7 passes exactly where the plain image has them', async () => {
    const width = 13, height = 11, rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + (i >> 2) * 11) & 255;
    const plain = await decodePng(png(width, height, 6, 8, rawRgba(rgba, width, height, false)));
    const interlaced = await decodePng(png(width, height, 6, 8, rawRgba(rgba, width, height, true), [], 1));
    expect(Buffer.from(plain.frames[0]!.rgba).equals(Buffer.from(rgba))).toBe(true);
    expect(Buffer.from(interlaced.frames[0]!.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  it('refuses a huge canvas from IHDR before inflating anything', async () => {
    const bomb = png(60000, 60000, 6, 8, new Uint8Array(1));
    expect(await failure(decodePng(bomb))).toBe('over-budget');
  });

  it('stops a decompression bomb at the size the header declares', async () => {
    // 64×64 RGBA declares 16,640 inflated bytes; the stream inflates to 8 MiB of zeros.
    const bomb = png(64, 64, 6, 8, new Uint8Array(8 * 1024 * 1024));
    const decoded = await decodePng(bomb);
    expect(decoded.frames[0]!.rgba.length).toBe(64 * 64 * 4);
  });

  it('refuses APNG instead of showing its poster frame', async () => {
    const actl = chunk('acTL', Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0]));
    expect(await failure(decodePng(png(2, 2, 6, 8, new Uint8Array(18), [actl])))).toBe('unsupported');
  });

  it('treats truncation, bad checksums and short data as corrupt', async () => {
    const good = data('png/rgba8.png');
    expect(await failure(decodePng(good.subarray(0, good.length - 40)))).toBe('corrupt');
    const flipped = good.slice(); flipped[40] = flipped[40]! ^ 0xff;
    expect(await failure(decodePng(flipped))).toBe('corrupt');
    expect(await failure(decodePng(png(8, 8, 6, 8, new Uint8Array(20))))).toBe('corrupt');
  });
});

describe('GIF', () => {
  for (const name of ['pillow-disposal1', 'pillow-disposal2']) {
    it(`coalesces ${name} like the reference decoder`, async () => {
      const decoded = await decodeGif(data(`gif/${name}.gif`)), want = expected(`gif/${name}.rgba.gz`);
      expect(decoded.frames.length).toBe(6);
      const size = decoded.width * decoded.height * 4;
      decoded.frames.forEach((frame, i) => expect(Buffer.from(frame.rgba).equals(Buffer.from(want.subarray(i * size, (i + 1) * size)))).toBe(true));
    });
  }

  it('normalises zero and tiny delays once, the same way the compiler does', async () => {
    const decoded = await decodeGif(data('gif/pillow-disposal2.gif'));
    expect(decoded.frames.map(f => f.durationMs)).toEqual([50, 70, 100, 90, 100, 120]);
  });

  it('applies disposal 1, 2 and 3 to patches on a transparent canvas', async () => {
    const palette = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const fill = (n: number, v: number) => new Uint8Array(n).fill(v);
    const bytes = encodeGif({ width: 4, height: 1, palette, frames: [
      { left: 0, top: 0, width: 2, height: 1, indices: fill(2, 1), delayCs: 5, disposal: 1 },       // red stays
      { left: 2, top: 0, width: 1, height: 1, indices: fill(1, 2), delayCs: 5, disposal: 2 },       // green, then cleared
      { left: 3, top: 0, width: 1, height: 1, indices: fill(1, 3), delayCs: 5, disposal: 3 },       // blue, then restored (to empty)
      { left: 1, top: 0, width: 2, height: 1, indices: Uint8Array.from([0, 3]), transparent: 0, delayCs: 5, disposal: 0 },
    ] });
    const decoded = await decodeGif(bytes);
    const alphaAndColour = decoded.frames.map(f => [0, 1, 2, 3].map(x => f.rgba[x * 4 + 3] ? `${f.rgba[x * 4]},${f.rgba[x * 4 + 1]},${f.rgba[x * 4 + 2]}` : '-').join(' '));
    expect(alphaAndColour).toEqual([
      '255,0,0 255,0,0 - -',
      '255,0,0 255,0,0 0,255,0 -',
      '255,0,0 255,0,0 - 0,0,255',
      '255,0,0 255,0,0 0,0,255 -',
    ]);
  });

  it('clips patches that hang past the canvas', async () => {
    const bytes = encodeGif({ width: 2, height: 2, palette: Uint8Array.from([0, 0, 0, 9, 9, 9]), frames: [
      { left: 1, top: 1, width: 3, height: 3, indices: new Uint8Array(9).fill(1), delayCs: 0, disposal: 0 },
    ] });
    const decoded = await decodeGif(bytes);
    expect([...decoded.frames[0]!.rgba].filter((_, i) => i % 4 === 3)).toEqual([0, 0, 0, 255]);
  });

  it('refuses too many frames and too much playback before allocating frames', async () => {
    const one = { left: 0, top: 0, width: 1, height: 1, indices: new Uint8Array(1), delayCs: 10, disposal: 0 as const };
    const palette = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    expect(await failure(decodeGif(encodeGif({ width: 1, height: 1, palette, frames: Array(EMOTE_SOURCE_LIMITS.frames + 1).fill(one) })))).toBe('over-budget');
    expect(await failure(decodeGif(encodeGif({ width: 1, height: 1, palette, frames: Array(4).fill({ ...one, delayCs: 900 }) })))).toBe('over-budget');
    // 512×512 × 33 frames is 33 MiB of coalesced canvases: refused from the scan alone.
    const big = { ...one, width: 1, height: 1 };
    expect(await failure(decodeGif(encodeGif({ width: 512, height: 512, palette, frames: Array(33).fill(big) })))).toBe('over-budget');
    const wide = new Uint8Array(encodeGif({ width: 1, height: 1, palette, frames: [one] }));
    wide[6] = 0xff; wide[7] = 0xff;
    expect(await failure(decodeGif(wide))).toBe('over-budget');
  });

  it('treats undefined LZW codes, missing tables and stray bytes as corrupt', async () => {
    const good = encodeGif({ width: 4, height: 4, palette: Uint8Array.from([0, 0, 0, 255, 255, 255]), frames: [
      { left: 0, top: 0, width: 4, height: 4, indices: Uint8Array.from([0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0]), delayCs: 0, disposal: 0 },
    ] });
    const stray = good.slice(); stray[stray.length - 1] = 0x99;
    expect(await failure(decodeGif(stray))).toBe('corrupt');
    expect(await failure(decodeGif(good.subarray(0, 20)))).toBe('corrupt');
  });

  it('survives mutation fuzzing with only typed failures', { timeout: 30_000 }, async () => {
    const base = toadWaveGifBytes();
    let seed = 12345;
    const random = () => (seed = Math.imul(seed ^ seed >>> 15, 2246822519) + 0x9e3779b9 >>> 0) / 2 ** 32;
    for (let round = 0; round < 150; round++) {
      const mutated = base.slice();
      for (let k = 0; k < 1 + Math.floor(random() * 8); k++) mutated[Math.floor(random() * mutated.length)] = Math.floor(random() * 256);
      try { await decodeGif(mutated); } catch (error) { expect(error).toBeInstanceOf(EmoteDecodeError); }
    }
  });
});

describe('The animated SIMULATED fixture', () => {
  it('decodes into distinct coalesced frames with the authored timing', async () => {
    const { source, bytes } = toadWaveAnimatedFixture();
    expect(source.origin).toBe('simulated');
    expect(source.sourceHash).toBe(sha256Hex(bytes));
    const decoded = await decodeEmoteBytes(bytes, 'gif');
    expect(decoded.frames.length).toBe(TOAD_WAVE_FRAMES.length);
    expect(decoded.frames.map(f => f.durationMs)).toEqual([480, 90, 90, 110, 120, 90, 90, 100]);
    const hashes = decoded.frames.map(f => sha256Hex(f.rgba));
    // Poses repeat (up, mid, high), but the blink makes frame 4 differ from frame 2 and 6.
    expect(new Set(hashes).size).toBe(5);
    expect(hashes[1]).toBe(hashes[5]);
    expect(hashes[2]).toBe(hashes[6]);
    expect(hashes[3]).toBe(hashes[7]);
    expect(hashes[4]).not.toBe(hashes[2]);
  });

  it('is byte-stable, so its hash is a real content address', () => {
    expect(sha256Hex(toadWaveGifBytes())).toBe(toadWaveAnimatedFixture().source.sourceHash);
  });
});

describe('The decoder port', () => {
  it('sniffs formats by magic bytes and refuses SVG, HTML and mismatches', async () => {
    expect(sniffEmoteFormat(data('png/rgba8.png'))).toBe('png');
    expect(sniffEmoteFormat(toadWaveGifBytes())).toBe('gif');
    expect(sniffEmoteFormat(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    const svg = await decodeEmoteImage(new TextEncoder().encode('<svg onload="x()"/>'), 'png', new AbortController().signal);
    expect(svg).toMatchObject({ ok: false, code: 'unsupported' });
    const renamed = await decodeEmoteImage(toadWaveGifBytes(), 'png', new AbortController().signal);
    expect(renamed).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('refuses more than 4 MiB of compressed bytes up front', async () => {
    const huge = new Uint8Array(EMOTE_SOURCE_LIMITS.compressedBytes + 1);
    huge.set(toadWaveGifBytes().subarray(0, 6));
    expect(await decodeEmoteImage(huge, 'gif')).toMatchObject({ ok: false, code: 'over-budget' });
  });

  it('hashes exactly the decoded bytes', async () => {
    const bytes = data('png/rgb8.png'), result = await decodeEmoteImage(bytes, 'png');
    expect(result.ok && result.sourceHash).toBe(sha256Hex(bytes));
  });

  it('honours cancellation before and during a decode', async () => {
    const decoder = createEmoteImageDecoder(), early = new AbortController();
    early.abort();
    expect(await failure(decoder.decode(toadWaveGifBytes(), 'gif', early.signal))).toBe('aborted');
    const late = new AbortController(), pending = decoder.decode(toadWaveGifBytes(), 'gif', late.signal);
    late.abort();
    expect(await failure(pending)).toBe('aborted');
    const inflating = new AbortController(), png = decoder.decode(data('png/rgba8.png'), 'png', inflating.signal);
    inflating.abort();
    expect(await failure(png)).toBe('aborted');
  });
});
