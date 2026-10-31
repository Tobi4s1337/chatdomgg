import { EMOTE_SOURCE_LIMITS } from '../profiles';
import type { DecodedEmote } from '../types';
import { crc32 } from './crc32';
import { corrupt, overBudget, throwIfAborted, unsupported } from './errors';
import { inflateExact } from './inflate';

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Bit depths each colour type allows (PNG 3rd edition §11.2.1). */
const DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7 passes: x start, y start, x step, y step. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

interface Header { width: number; height: number; depth: number; colour: number; interlace: boolean }

const u32 = (b: Uint8Array, o: number): number => (b[o]! << 24 | b[o + 1]! << 16 | b[o + 2]! << 8 | b[o + 3]!) >>> 0;
const type = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

function rowBytes(header: Header, width: number): number {
  return Math.ceil(width * CHANNELS[header.colour]! * header.depth / 8);
}

/** Every pass's sub-image size: the exact inflated length the header promises, known before inflating. */
function passes(header: Header): { x: number; y: number; dx: number; dy: number; width: number; height: number }[] {
  if (!header.interlace) return [{ x: 0, y: 0, dx: 1, dy: 1, width: header.width, height: header.height }];
  return ADAM7.map(([x, y, dx, dy]) => ({ x, y, dx, dy, width: Math.ceil(Math.max(0, header.width - x) / dx), height: Math.ceil(Math.max(0, header.height - y) / dy) }));
}

function unfilter(data: Uint8Array, offset: number, height: number, stride: number, bpp: number): void {
  let previous = -1;
  for (let y = 0; y < height; y++) {
    const filter = data[offset]!, row = offset + 1;
    if (filter > 4) throw corrupt(`Row ${y} uses unknown PNG filter ${filter}.`);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? data[row + i - bpp]! : 0;
      const b = previous >= 0 ? data[previous + i]! : 0;
      const c = previous >= 0 && i >= bpp ? data[previous + i - bpp]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[row + i] = data[row + i]! + predictor & 255;
    }
    previous = row;
    offset = row + stride;
  }
}

/**
 * Decodes a PNG into one straight-RGBA frame. Supports every standard colour type and bit depth,
 * palettes with tRNS, colour-key transparency and Adam7 interlacing. The canvas is checked against
 * the 512×512 limit from IHDR before anything is inflated, and the inflated size is fixed by the
 * header. APNG (acTL) is refused as unsupported rather than silently shown as its poster frame.
 */
export async function decodePng(bytes: Uint8Array, signal?: AbortSignal): Promise<DecodedEmote> {
  throwIfAborted(signal);
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) throw corrupt('The file is not a PNG.');
  let offset = 8, header: Header | undefined, palette: Uint8Array | undefined, transparency: Uint8Array | undefined, ended = false;
  const data: Uint8Array[] = [];
  let seenData = false, afterData = false;
  while (offset < bytes.length && !ended) {
    if (offset + 12 > bytes.length) throw corrupt('A PNG chunk is cut off.');
    const length = u32(bytes, offset), name = type(bytes, offset + 4);
    if (length > 0x7fffffff || offset + 12 + length > bytes.length) throw corrupt(`The ${name} chunk runs past the end of the file.`);
    const start = offset + 8, end = start + length;
    if (crc32(bytes, offset + 4, end) !== u32(bytes, end)) throw corrupt(`The ${name} chunk fails its checksum.`);
    if (!header && name !== 'IHDR') throw corrupt('A PNG must start with its IHDR header.');
    if (seenData && name !== 'IDAT') afterData = true;
    switch (name) {
      case 'IHDR': {
        if (header || length !== 13) throw corrupt('The PNG header is malformed.');
        const width = u32(bytes, start), height = u32(bytes, start + 4), depth = bytes[start + 8]!, colour = bytes[start + 9]!;
        if (!width || !height) throw corrupt('The PNG has no size.');
        if (width > EMOTE_SOURCE_LIMITS.canvas || height > EMOTE_SOURCE_LIMITS.canvas) throw overBudget(`The PNG is ${width}×${height}; emotes are at most ${EMOTE_SOURCE_LIMITS.canvas}×${EMOTE_SOURCE_LIMITS.canvas}.`);
        if (!DEPTHS[colour]?.includes(depth)) throw corrupt(`PNG colour type ${colour} cannot have bit depth ${depth}.`);
        if (bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12]! > 1) throw corrupt('The PNG uses an unknown compression, filter or interlace method.');
        header = { width, height, depth, colour, interlace: bytes[start + 12] === 1 };
        break;
      }
      case 'PLTE':
        if (length % 3 || length === 0 || length > 768 || palette || seenData) throw corrupt('The PNG palette is malformed.');
        palette = bytes.slice(start, end);
        break;
      case 'tRNS':
        if (seenData) throw corrupt('The PNG transparency chunk comes after the image data.');
        transparency = bytes.slice(start, end);
        break;
      case 'IDAT':
        if (afterData) throw corrupt('The PNG image data is split by another chunk.');
        seenData = true;
        data.push(bytes.subarray(start, end));
        break;
      case 'acTL': case 'fcTL': case 'fdAT':
        throw unsupported('Animated PNG is not supported; use the provider’s GIF or WebP rendition.');
      case 'IEND':
        ended = true;
        break;
      default:
        // Ancillary chunks (lowercase first letter) are safe to skip; an unknown critical chunk is not.
        if (!(bytes[offset + 4]! & 0x20)) throw unsupported(`The PNG needs the unknown critical chunk ${name}.`);
    }
    offset = end + 4;
  }
  if (!header) throw corrupt('The PNG has no header.');
  if (!data.length) throw corrupt('The PNG has no image data.');
  if (header.colour === 3 && !palette) throw corrupt('The paletted PNG has no palette.');
  const layout = passes(header);
  let expected = 0;
  for (const pass of layout) if (pass.width && pass.height) expected += pass.height * (1 + rowBytes(header, pass.width));
  const raw = await inflateExact(data, expected, signal);
  throwIfAborted(signal);
  return { width: header.width, height: header.height, frames: [{ rgba: toRgba(raw, header, layout, palette, transparency), durationMs: 0 }] };
}

function toRgba(raw: Uint8Array, header: Header, layout: ReturnType<typeof passes>, palette: Uint8Array | undefined, trns: Uint8Array | undefined): Uint8Array {
  const { width, depth, colour } = header, channels = CHANNELS[colour]!;
  const rgba = new Uint8Array(width * header.height * 4);
  const bpp = Math.max(1, channels * depth / 8);
  const max = (1 << depth) - 1;
  // Colour-key transparency compares full-precision samples, as the PNG specification requires.
  const key16 = (i: number): number => trns && trns.length >= i * 2 + 2 ? trns[i * 2]! << 8 | trns[i * 2 + 1]! : -1;
  const greyKey = colour === 0 ? key16(0) : -1;
  const rgbKey = colour === 2 ? [key16(0), key16(1), key16(2)] : null;
  let offset = 0;
  for (const pass of layout) {
    if (!pass.width || !pass.height) continue;
    const stride = rowBytes(header, pass.width);
    unfilter(raw, offset, pass.height, stride, bpp);
    for (let py = 0; py < pass.height; py++) {
      const row = offset + py * (stride + 1) + 1, y = pass.y + py * pass.dy;
      for (let px = 0; px < pass.width; px++) {
        const x = pass.x + px * pass.dx, out = (x + y * width) * 4;
        const sample = (channel: number): number => {
          if (depth === 16) { const at = row + (px * channels + channel) * 2; return raw[at]! << 8 | raw[at + 1]!; }
          if (depth === 8) return raw[row + px * channels + channel]!;
          const bit = px * depth, byte = raw[row + (bit >> 3)]!;
          return byte >> (8 - depth - (bit & 7)) & max;
        };
        // Down to 8 bits: the high byte of 16-bit samples; low depths scale to the full range.
        const eight = (value: number): number => depth === 16 ? value >> 8 : depth === 8 ? value : Math.round(value * 255 / max);
        if (colour === 3) {
          const index = sample(0);
          if (index * 3 + 2 >= palette!.length) { rgba[out + 3] = 0; continue; }
          rgba[out] = palette![index * 3]!; rgba[out + 1] = palette![index * 3 + 1]!; rgba[out + 2] = palette![index * 3 + 2]!;
          rgba[out + 3] = trns && index < trns.length ? trns[index]! : 255;
        } else if (colour === 0 || colour === 4) {
          const raw0 = sample(0), grey = eight(raw0);
          rgba[out] = grey; rgba[out + 1] = grey; rgba[out + 2] = grey;
          rgba[out + 3] = colour === 4 ? eight(sample(1)) : raw0 === greyKey ? 0 : 255;
        } else {
          const r = sample(0), g = sample(1), b = sample(2);
          rgba[out] = eight(r); rgba[out + 1] = eight(g); rgba[out + 2] = eight(b);
          rgba[out + 3] = colour === 6 ? eight(sample(3)) : rgbKey && r === rgbKey[0] && g === rgbKey[1] && b === rgbKey[2] ? 0 : 255;
        }
      }
    }
    offset += pass.height * (stride + 1);
  }
  return rgba;
}
