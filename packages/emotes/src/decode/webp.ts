import { EMOTE_SOURCE_LIMITS, normalizeFrameDuration } from '../profiles';
import type { DecodedEmote } from '../types';
import { corrupt, overBudget, throwIfAborted } from './errors';
import { decodeVp8, readVp8Header } from './webp-vp8';
import { decodeVp8l, decodeVp8lAlphaStream, readVp8lHeader } from './webp-vp8l';

/**
 * WebP container (RIFF) for still and animated emotes: simple lossy (`VP8 `), simple lossless
 * (`VP8L`) and extended (`VP8X`) files with `ALPH`, `ANIM` and `ANMF`. Both bitstream decoders are
 * written here from their specifications (RFC 6386 and RFC 9649). Compositing follows RFC 9649
 * §2.7: the canvas starts transparent (the ANIM background colour is advisory and, as in browsers,
 * not painted), frames alpha-blend unless they ask not to, and "dispose to background" clears the
 * frame rectangle to transparent after it has been shown.
 */

interface Chunk { name: string; start: number; end: number }
interface WebpFrame {
  x: number; y: number; width: number; height: number;
  durationMs: number; blend: boolean; dispose: boolean;
  alpha: Chunk | null; image: Chunk;
}

const u24 = (b: Uint8Array, o: number): number => b[o]! | b[o + 1]! << 8 | b[o + 2]! << 16;
const u32 = (b: Uint8Array, o: number): number => (b[o]! | b[o + 1]! << 8 | b[o + 2]! << 16 | b[o + 3]! << 24) >>> 0;
const fourcc = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

function chunks(bytes: Uint8Array, start: number, end: number): Chunk[] {
  const list: Chunk[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = u32(bytes, offset + 4), begin = offset + 8;
    if (size > end - begin) throw corrupt(`The WebP ${fourcc(bytes, offset)} chunk runs past its container.`);
    list.push({ name: fourcc(bytes, offset), start: begin, end: begin + size });
    offset = begin + size + (size & 1);
    // A hostile file could be nothing but empty chunks; real emotes need a handful per frame.
    if (list.length > EMOTE_SOURCE_LIMITS.frames * 4 + 16) throw overBudget('The WebP has too many chunks.');
  }
  if (offset < end && end - offset >= 8) throw corrupt('The WebP chunk list is malformed.');
  return list;
}

function imageSize(bytes: Uint8Array, chunk: Chunk): { width: number; height: number } {
  const payload = bytes.subarray(chunk.start, chunk.end);
  const header = chunk.name === 'VP8 ' ? readVp8Header(payload) : chunk.name === 'VP8L' ? readVp8lHeader(payload) : null;
  if (!header) throw corrupt(`The WebP ${chunk.name.trim()} bitstream header is malformed.`);
  return header;
}

/** Undoes the ALPH spatial filter in place (RFC 9649 §2.6 "Filtering method"). */
function unfilterAlpha(alpha: Uint8Array, width: number, height: number, method: number): void {
  if (!method) return;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = x + y * width;
    let predictor: number;
    if (!x && !y) predictor = 0;
    else if (!y) predictor = alpha[i - 1]!;
    else if (!x) predictor = alpha[i - width]!;
    else if (method === 1) predictor = alpha[i - 1]!;
    else if (method === 2) predictor = alpha[i - width]!;
    else predictor = Math.max(0, Math.min(255, alpha[i - 1]! + alpha[i - width]! - alpha[i - width - 1]!));
    alpha[i] = alpha[i]! + predictor & 255;
  }
}

function decodeAlpha(bytes: Uint8Array, chunk: Chunk, width: number, height: number): Uint8Array {
  if (chunk.end - chunk.start < 1) throw corrupt('The WebP alpha chunk is empty.');
  const flags = bytes[chunk.start]!, method = flags & 3, filter = flags >> 2 & 3;
  if (flags >> 6) throw corrupt('The WebP alpha chunk sets reserved bits.');
  const payload = bytes.subarray(chunk.start + 1, chunk.end);
  let alpha: Uint8Array;
  if (method === 0) {
    if (payload.length < width * height) throw corrupt('The WebP alpha plane is cut off.');
    alpha = payload.slice(0, width * height);
  } else if (method === 1) {
    alpha = decodeVp8lAlphaStream(payload, width, height);
  } else {
    throw corrupt(`The WebP alpha chunk uses unknown compression ${method}.`);
  }
  // Pre-processing (level reduction) is a hint for the encoder only; decoding ignores it.
  unfilterAlpha(alpha, width, height, filter);
  return alpha;
}

/** Decodes one frame's bitstream to straight RGBA at its own size. */
function decodeImage(bytes: Uint8Array, frame: Pick<WebpFrame, 'width' | 'height' | 'alpha' | 'image'>): Uint8Array {
  const payload = bytes.subarray(frame.image.start, frame.image.end);
  const decoded = frame.image.name === 'VP8L' ? decodeVp8l(payload, EMOTE_SOURCE_LIMITS.canvas) : decodeVp8(payload, EMOTE_SOURCE_LIMITS.canvas);
  if (decoded.width !== frame.width || decoded.height !== frame.height) throw corrupt('A WebP bitstream does not match its frame size.');
  if (frame.image.name === 'VP8 ' && frame.alpha) {
    const alpha = decodeAlpha(bytes, frame.alpha, frame.width, frame.height);
    for (let i = 0; i < alpha.length; i++) decoded.rgba[i * 4 + 3] = alpha[i]!;
  }
  return decoded.rgba;
}

/** Non-premultiplied "source over" (RFC 9649 §2.7.1.4), in integers so every engine agrees. */
function blendOver(canvas: Uint8Array, at: number, r: number, g: number, b: number, a: number): void {
  if (a === 255) { canvas[at] = r; canvas[at + 1] = g; canvas[at + 2] = b; canvas[at + 3] = 255; return; }
  if (a === 0) return;
  const dstA = canvas[at + 3]!, dstWeight = dstA * (255 - a);
  const outA255 = a * 255 + dstWeight; // alpha × 255
  if (!outA255) { canvas.fill(0, at, at + 4); return; }
  const half = outA255 >> 1;
  canvas[at] = Math.floor((r * a * 255 + canvas[at]! * dstWeight + half) / outA255);
  canvas[at + 1] = Math.floor((g * a * 255 + canvas[at + 1]! * dstWeight + half) / outA255);
  canvas[at + 2] = Math.floor((b * a * 255 + canvas[at + 2]! * dstWeight + half) / outA255);
  canvas[at + 3] = Math.floor((outA255 + 127) / 255);
}

export async function decodeWebp(bytes: Uint8Array, signal?: AbortSignal): Promise<DecodedEmote> {
  throwIfAborted(signal);
  if (bytes.length < 20 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') throw corrupt('The file is not a WebP.');
  const riffEnd = 8 + u32(bytes, 4);
  if (riffEnd > bytes.length || riffEnd < 12) throw corrupt('The WebP is cut off.');
  const list = chunks(bytes, 12, riffEnd), head = list[0];
  if (!head) throw corrupt('The WebP has no image.');
  const limit = EMOTE_SOURCE_LIMITS.canvas;
  const checkCanvas = (width: number, height: number): void => {
    if (width > limit || height > limit) throw overBudget(`The WebP is ${width}×${height}; emotes are at most ${limit}×${limit}.`);
  };

  if (head.name === 'VP8 ' || head.name === 'VP8L') {
    const { width, height } = imageSize(bytes, head);
    checkCanvas(width, height);
    return { width, height, frames: [{ rgba: decodeImage(bytes, { width, height, alpha: null, image: head }), durationMs: 0 }] };
  }
  if (head.name !== 'VP8X' || head.end - head.start < 10) throw corrupt('The WebP header is malformed.');
  const flags = bytes[head.start]!, width = u24(bytes, head.start + 4) + 1, height = u24(bytes, head.start + 7) + 1;
  checkCanvas(width, height);

  if (!(flags & 0x02)) {
    const alpha = list.find(c => c.name === 'ALPH') ?? null, image = list.find(c => c.name === 'VP8 ' || c.name === 'VP8L');
    if (!image) throw corrupt('The WebP has no image bitstream.');
    if (list.some(c => c.name === 'ANMF')) throw corrupt('The WebP has animation frames but no animation flag.');
    const size = imageSize(bytes, image);
    if (size.width !== width || size.height !== height) throw corrupt('The WebP image does not match its canvas.');
    return { width, height, frames: [{ rgba: decodeImage(bytes, { width, height, alpha, image }), durationMs: 0 }] };
  }

  // Animated: scan every frame header first, so budgets are enforced before any pixel allocation.
  if (!list.some(c => c.name === 'ANIM')) throw corrupt('The animated WebP has no ANIM chunk.');
  const frames: WebpFrame[] = [];
  for (const chunk of list) {
    if (chunk.name !== 'ANMF') continue;
    if (frames.length >= EMOTE_SOURCE_LIMITS.frames) throw overBudget(`The animation has more than ${EMOTE_SOURCE_LIMITS.frames} frames.`);
    if (chunk.end - chunk.start < 16) throw corrupt('A WebP animation frame header is cut off.');
    const s = chunk.start, frameFlags = bytes[s + 15]!;
    const inner = chunks(bytes, s + 16, chunk.end);
    const alpha = inner.find(c => c.name === 'ALPH') ?? null, image = inner.find(c => c.name === 'VP8 ' || c.name === 'VP8L');
    if (!image) throw corrupt('A WebP animation frame has no image.');
    const frame: WebpFrame = {
      x: u24(bytes, s) * 2, y: u24(bytes, s + 3) * 2, width: u24(bytes, s + 6) + 1, height: u24(bytes, s + 9) + 1,
      durationMs: u24(bytes, s + 12), blend: !(frameFlags & 2), dispose: !!(frameFlags & 1), alpha, image,
    };
    if (frame.x + frame.width > width || frame.y + frame.height > height) throw corrupt('A WebP animation frame lies outside the canvas.');
    const size = imageSize(bytes, image);
    if (size.width !== frame.width || size.height !== frame.height) throw corrupt('A WebP animation frame does not match its bitstream.');
    frames.push(frame);
  }
  if (!frames.length) throw corrupt('The animated WebP has no frames.');
  if (width * height * 4 * frames.length > EMOTE_SOURCE_LIMITS.coalescedBytes) throw overBudget('The coalesced animation is larger than 32 MiB.');
  if (frames.length > 1 && frames.reduce((sum, f) => sum + normalizeFrameDuration(f.durationMs), 0) > EMOTE_SOURCE_LIMITS.playbackMs) {
    throw overBudget('The animation plays for longer than 30 seconds.');
  }

  const canvas = new Uint8Array(width * height * 4), out: DecodedEmote['frames'][number][] = [];
  for (const [index, frame] of frames.entries()) {
    if (index) await Promise.resolve();
    throwIfAborted(signal);
    const rgba = decodeImage(bytes, frame);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const src = (x + y * frame.width) * 4, dst = (frame.x + x + (frame.y + y) * width) * 4;
      if (frame.blend) blendOver(canvas, dst, rgba[src]!, rgba[src + 1]!, rgba[src + 2]!, rgba[src + 3]!);
      else canvas.set(rgba.subarray(src, src + 4), dst);
    }
    out.push({ rgba: canvas.slice(), durationMs: frames.length > 1 ? normalizeFrameDuration(frame.durationMs) : 0 });
    if (frame.dispose) for (let y = 0; y < frame.height; y++) canvas.fill(0, (frame.x + (frame.y + y) * width) * 4, (frame.x + frame.width + (frame.y + y) * width) * 4);
  }
  return { width, height, frames: out };
}
