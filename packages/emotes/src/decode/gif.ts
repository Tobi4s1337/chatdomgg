import { EMOTE_SOURCE_LIMITS, normalizeFrameDuration } from '../profiles';
import type { DecodedEmote } from '../types';
import { corrupt, overBudget, throwIfAborted } from './errors';

/** One image in the GIF, found by the structural scan before any pixel is decoded. */
interface GifFrame {
  left: number; top: number; width: number; height: number;
  interlaced: boolean;
  /** Offset and length of the frame's colour table in the file (local, else global). */
  table: number; colours: number;
  transparent: number;
  /** 0 or 1 keep, 2 restore to background (transparent), 3 restore previous. */
  disposal: number;
  delayMs: number | undefined;
  minCodeSize: number;
  /** Data sub-block runs as [start, end) pairs, read lazily by the LZW decoder. */
  blocks: number[];
}

const u16 = (b: Uint8Array, o: number): number => b[o]! | b[o + 1]! << 8;

/** Walks sub-blocks from `offset`; returns the offset after the terminator and pushes each run. */
function subBlocks(bytes: Uint8Array, offset: number, runs?: number[]): number {
  for (;;) {
    if (offset >= bytes.length) throw corrupt('A GIF data block is cut off.');
    const size = bytes[offset++]!;
    if (!size) return offset;
    if (offset + size > bytes.length) throw corrupt('A GIF data block runs past the end of the file.');
    runs?.push(offset, offset + size);
    offset += size;
  }
}

/**
 * Structural scan: header, colour tables, graphic controls and image descriptors, skipping every
 * compressed byte. The frame count, canvas, frame rectangles, coalesced bytes and playback time
 * are all checked here, so an over-budget animation is refused before a single frame is allocated.
 */
function scan(bytes: Uint8Array): { width: number; height: number; frames: GifFrame[] } {
  if (bytes.length < 13) throw corrupt('The file is too short to be a GIF.');
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') throw corrupt('The file is not a GIF.');
  const width = u16(bytes, 6), height = u16(bytes, 8), packed = bytes[10]!;
  if (!width || !height) throw corrupt('The GIF canvas has no size.');
  if (width > EMOTE_SOURCE_LIMITS.canvas || height > EMOTE_SOURCE_LIMITS.canvas) throw overBudget(`The GIF canvas is ${width}×${height}; emotes are at most ${EMOTE_SOURCE_LIMITS.canvas}×${EMOTE_SOURCE_LIMITS.canvas}.`);
  let offset = 13, globalTable = -1, globalColours = 0;
  if (packed & 0x80) {
    globalColours = 2 << (packed & 7);
    globalTable = offset;
    offset += globalColours * 3;
    if (offset > bytes.length) throw corrupt('The GIF colour table is cut off.');
  }
  const frames: GifFrame[] = [];
  let control: Pick<GifFrame, 'transparent' | 'disposal' | 'delayMs'> | null = null, playback = 0;
  while (offset < bytes.length) {
    const introducer = bytes[offset++]!;
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      if (offset >= bytes.length) throw corrupt('A GIF extension is cut off.');
      const label = bytes[offset++]!;
      if (label === 0xf9) {
        if (offset + 6 > bytes.length || bytes[offset] !== 4) throw corrupt('A GIF graphic control block is malformed.');
        const flags = bytes[offset + 1]!;
        control = { disposal: flags >> 2 & 7, delayMs: u16(bytes, offset + 2) * 10, transparent: flags & 1 ? bytes[offset + 4]! : -1 };
        offset = subBlocks(bytes, offset + 5);
      } else {
        offset = subBlocks(bytes, offset);
      }
      continue;
    }
    if (introducer !== 0x2c) throw corrupt(`Unexpected byte 0x${introducer.toString(16)} in the GIF stream.`);
    if (offset + 9 > bytes.length) throw corrupt('A GIF image descriptor is cut off.');
    if (frames.length >= EMOTE_SOURCE_LIMITS.frames) throw overBudget(`The animation has more than ${EMOTE_SOURCE_LIMITS.frames} frames.`);
    const left = u16(bytes, offset), top = u16(bytes, offset + 2), w = u16(bytes, offset + 4), h = u16(bytes, offset + 6), flags = bytes[offset + 8]!;
    offset += 9;
    if (!w || !h) throw corrupt('A GIF frame has no size.');
    // A frame may hang past the canvas and is clipped there, but never larger than an emote canvas.
    if (w > EMOTE_SOURCE_LIMITS.canvas || h > EMOTE_SOURCE_LIMITS.canvas) throw overBudget(`A GIF frame is ${w}×${h}.`);
    let table = globalTable, colours = globalColours;
    if (flags & 0x80) {
      colours = 2 << (flags & 7);
      table = offset;
      offset += colours * 3;
      if (offset > bytes.length) throw corrupt('A GIF frame colour table is cut off.');
    }
    if (table < 0) throw corrupt('A GIF frame has no colour table.');
    if (offset >= bytes.length) throw corrupt('A GIF frame is cut off.');
    const minCodeSize = bytes[offset++]!;
    if (minCodeSize < 2 || minCodeSize > 8) throw corrupt(`A GIF frame declares LZW code size ${minCodeSize}.`);
    const blocks: number[] = [];
    offset = subBlocks(bytes, offset, blocks);
    frames.push({ left, top, width: w, height: h, interlaced: !!(flags & 0x40), table, colours, minCodeSize, blocks,
      transparent: control?.transparent ?? -1, disposal: control?.disposal ?? 0, delayMs: control?.delayMs });
    control = null;
  }
  if (!frames.length) throw corrupt('The GIF has no image.');
  if (width * height * 4 * frames.length > EMOTE_SOURCE_LIMITS.coalescedBytes) throw overBudget('The coalesced animation is larger than 32 MiB.');
  if (frames.length > 1) {
    for (const frame of frames) playback += normalizeFrameDuration(frame.delayMs);
    if (playback > EMOTE_SOURCE_LIMITS.playbackMs) throw overBudget('The animation plays for longer than 30 seconds.');
  }
  return { width, height, frames };
}

const MAX_CODES = 4096;

/**
 * GIF LZW. Writes colour indices for at most `width × height` pixels through `emit`, so the work is
 * bounded by the frame's own size however the code stream is built. A code past the table is
 * corrupt. A stream that ends early leaves the remaining pixels undrawn, as browsers do.
 */
function decodeLzw(bytes: Uint8Array, frame: GifFrame, prefix: Uint16Array, suffix: Uint8Array, stack: Uint8Array, emit: (pixel: number, index: number) => void): void {
  const total = frame.width * frame.height, clear = 1 << frame.minCodeSize, end = clear + 1;
  let size = frame.minCodeSize + 1, mask = (1 << size) - 1, next = end + 1, previous = -1, first = 0;
  let bits = 0, bitCount = 0, run = 0, at = frame.blocks[0] ?? 0, runEnd = frame.blocks[1] ?? 0, pixel = 0;
  for (let i = 0; i < clear; i++) { prefix[i] = 0; suffix[i] = i; }
  while (pixel < total) {
    while (bitCount < size) {
      while (at >= runEnd) {
        run += 2;
        if (run >= frame.blocks.length) return;
        at = frame.blocks[run]!; runEnd = frame.blocks[run + 1]!;
      }
      bits |= bytes[at++]! << bitCount;
      bitCount += 8;
    }
    const code = bits & mask;
    bits >>>= size; bitCount -= size;
    if (code === clear) { size = frame.minCodeSize + 1; mask = (1 << size) - 1; next = end + 1; previous = -1; continue; }
    if (code === end) return;
    if (previous < 0) {
      if (code >= clear) throw corrupt('A GIF frame starts with an undefined LZW code.');
      emit(pixel++, code);
      previous = code; first = code;
      continue;
    }
    if (code > next || (code === next && next >= MAX_CODES)) throw corrupt('A GIF frame uses an undefined LZW code.');
    let depth = 0, current = code;
    if (code === next) { stack[depth++] = first; current = previous; }
    while (current >= clear) { stack[depth++] = suffix[current]!; current = prefix[current]!; }
    first = current;
    stack[depth++] = current;
    while (depth > 0 && pixel < total) emit(pixel++, stack[--depth]!);
    if (next < MAX_CODES) {
      prefix[next] = previous; suffix[next] = first; next++;
      if (next > mask && size < 12) { size++; mask = (1 << size) - 1; }
    }
    previous = code;
  }
}

/** Row of the n-th decoded line of an interlaced frame (passes start 0, 4, 2, 1; step 8, 8, 4, 2). */
function interlacedRow(line: number, height: number): number {
  const pass1 = Math.ceil(height / 8), pass2 = Math.ceil(Math.max(0, height - 4) / 8), pass3 = Math.ceil(Math.max(0, height - 2) / 4);
  if (line < pass1) return line * 8;
  line -= pass1;
  if (line < pass2) return 4 + line * 8;
  line -= pass2;
  if (line < pass3) return 2 + line * 4;
  return 1 + (line - pass3) * 2;
}

/**
 * Decodes a GIF into full coalesced canvases, one per image. Frame patches are drawn onto the
 * logical canvas, which starts transparent; disposal 2 clears the patch back to transparent (as
 * browsers do, ignoring the background colour) and disposal 3 restores what was under it.
 * Durations follow `normalizeFrameDuration`; a single image is static with duration 0.
 */
export async function decodeGif(bytes: Uint8Array, signal?: AbortSignal): Promise<DecodedEmote> {
  throwIfAborted(signal);
  const { width, height, frames } = scan(bytes);
  const canvas = new Uint8Array(width * height * 4), out: DecodedEmote['frames'][number][] = [];
  const prefix = new Uint16Array(MAX_CODES), suffix = new Uint8Array(MAX_CODES), stack = new Uint8Array(MAX_CODES + 1);
  for (const [index, frame] of frames.entries()) {
    // Yield between frames so a cancellation from the owning worker is seen promptly.
    if (index) await Promise.resolve();
    throwIfAborted(signal);
    const x0 = Math.min(frame.left, width), y0 = Math.min(frame.top, height);
    const x1 = Math.min(width, frame.left + frame.width), y1 = Math.min(height, frame.top + frame.height);
    let saved: Uint8Array | null = null;
    if (frame.disposal === 3 && x1 > x0 && y1 > y0) {
      saved = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
      for (let y = y0; y < y1; y++) saved.set(canvas.subarray((x0 + y * width) * 4, (x1 + y * width) * 4), (y - y0) * (x1 - x0) * 4);
    }
    decodeLzw(bytes, frame, prefix, suffix, stack, (pixel, colour) => {
      if (colour === frame.transparent) return;
      const fx = pixel % frame.width, line = (pixel - fx) / frame.width;
      const x = frame.left + fx, y = frame.top + (frame.interlaced ? interlacedRow(line, frame.height) : line);
      if (x >= width || y >= height) return;
      const o = (x + y * width) * 4;
      if (colour >= frame.colours) { canvas[o] = 0; canvas[o + 1] = 0; canvas[o + 2] = 0; canvas[o + 3] = 0; return; }
      const t = frame.table + colour * 3;
      canvas[o] = bytes[t]!; canvas[o + 1] = bytes[t + 1]!; canvas[o + 2] = bytes[t + 2]!; canvas[o + 3] = 255;
    });
    out.push({ rgba: canvas.slice(), durationMs: frames.length > 1 ? normalizeFrameDuration(frame.delayMs) : 0 });
    if (frame.disposal === 2) for (let y = y0; y < y1; y++) canvas.fill(0, (x0 + y * width) * 4, (x1 + y * width) * 4);
    else if (saved) for (let y = y0; y < y1; y++) canvas.set(saved.subarray((y - y0) * (x1 - x0) * 4, (y - y0 + 1) * (x1 - x0) * 4), (x0 + y * width) * 4);
  }
  return { width, height, frames: out };
}
