import { corrupt, overBudget } from './errors';

/**
 * WebP lossless (VP8L) decoder, written from RFC 9649 §3. It decodes whole VP8L chunks and the
 * headerless image stream inside an ALPH chunk. Every size it allocates is derived from the declared
 * image size (checked against the caller's limit first) or from fixed format limits, every read past
 * the end of the data is a `corrupt` error, and every loop is bounded by the pixel count or by the
 * number of bits in the input.
 */

export interface Vp8lHeader {
  width: number;
  height: number;
  alphaHint: boolean;
}

const SIGNATURE = 0x2f;
const HEADER_BYTES = 5;
/** 14-bit width and height fields. */
const MAX_FORMAT_SIDE = 1 << 14;

const NUM_LITERALS = 256;
const NUM_LENGTH_CODES = 24;
const NUM_DISTANCE_CODES = 40;
const MAX_CACHE_BITS = 11;
const MAX_CODE_LENGTH = 15;
const NUM_CODE_LENGTH_CODES = 19;
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const MAX_GREEN_ALPHABET = NUM_LITERALS + NUM_LENGTH_CODES + (1 << MAX_CACHE_BITS);

const TRANSFORM_PREDICTOR = 0;
const TRANSFORM_COLOR = 1;
const TRANSFORM_SUBTRACT_GREEN = 2;
const TRANSFORM_COLOR_INDEXING = 3;

/** Lookup width of the first decoding table level; longer codes go through a second-level table. */
const ROOT_BITS = 8;
/**
 * Upper bound on decoding-table entries (4 bytes each) across all prefix codes of one image. Real
 * encoders stay far below this; a stream that declares thousands of large, distinct codes is refused
 * instead of being allowed to allocate without limit.
 */
const MAX_TABLE_ENTRIES = 1 << 22;
/** Table entries with this bit set point at a second-level table. */
const LINK = 1 << 30;

/** (xi, yi) pairs for distance codes 1..120 (RFC 9649 §3.6.2.2.1). */
const DISTANCE_MAP = new Int8Array([
  0, 1, 1, 0, 1, 1, -1, 1, 0, 2, 2, 0, 1, 2, -1, 2, 2, 1, -2, 1, 2, 2, -2, 2, 0, 3, 3, 0, 1, 3, -1, 3, 3, 1, -3, 1,
  2, 3, -2, 3, 3, 2, -3, 2, 0, 4, 4, 0, 1, 4, -1, 4, 4, 1, -4, 1, 3, 3, -3, 3, 2, 4, -2, 4, 4, 2, -4, 2, 0, 5, 3, 4,
  -3, 4, 4, 3, -4, 3, 5, 0, 1, 5, -1, 5, 5, 1, -5, 1, 2, 5, -2, 5, 5, 2, -5, 2, 4, 4, -4, 4, 3, 5, -3, 5, 5, 3, -5, 3,
  0, 6, 6, 0, 1, 6, -1, 6, 6, 1, -6, 1, 2, 6, -2, 6, 6, 2, -6, 2, 4, 5, -4, 5, 5, 4, -5, 4, 3, 6, -3, 6, 6, 3, -6, 3,
  0, 7, 7, 0, 1, 7, -1, 7, 5, 5, -5, 5, 7, 1, -7, 1, 4, 6, -4, 6, 6, 4, -6, 4, 2, 7, -2, 7, 7, 2, -7, 2, 3, 7, -3, 7,
  7, 3, -7, 3, 5, 6, -5, 6, 6, 5, -6, 5, 8, 0, 4, 7, -4, 7, 7, 4, -7, 4, 8, 1, 8, 2, 6, 6, -6, 6, 8, 3, 5, 7, -5, 7,
  7, 5, -7, 5, 8, 4, 6, 7, -6, 7, 7, 6, -7, 6, 8, 5, 7, 7, -7, 7, 8, 6, 8, 7,
]);

/** Reads the 5-byte VP8L header (signature 0x2f, 14-bit w-1, 14-bit h-1, alpha hint, 3-bit version which must be 0). Returns null when the signature/version is wrong or data too short. */
export function readVp8lHeader(data: Uint8Array): Vp8lHeader | null {
  if (data.length < HEADER_BYTES || data[0] !== SIGNATURE) return null;
  const bits = (data[1]! | (data[2]! << 8) | (data[3]! << 16) | (data[4]! << 24)) >>> 0;
  if (bits >>> 29 !== 0) return null;
  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
    alphaHint: ((bits >>> 28) & 1) === 1,
  };
}

/** Decodes a whole VP8L chunk payload (starting at the 0x2f signature) into straight RGBA, width*height*4 bytes, row-major top-left. Throws EmoteDecodeError ('corrupt' for malformed streams, 'over-budget' if width or height > maxSide or a declared transform/color-cache would exceed bounds). */
export function decodeVp8l(data: Uint8Array, maxSide: number): { width: number; height: number; rgba: Uint8Array } {
  const header = readVp8lHeader(data);
  if (!header) {
    if (data.length < HEADER_BYTES) throw corrupt('The VP8L chunk is shorter than its header.');
    throw corrupt('The VP8L chunk has a bad signature or an unknown version.');
  }
  const { width, height } = header;
  if (width > maxSide || height > maxSide) {
    throw overBudget(`The WebP is ${width}×${height}; the limit is ${maxSide}×${maxSide}.`);
  }
  const reader = new BitReader(data, HEADER_BYTES);
  const argb = decodeImageStream(reader, width, height);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < argb.length; i++, o += 4) {
    const p = argb[i]!;
    rgba[o] = (p >>> 16) & 0xff;
    rgba[o + 1] = (p >>> 8) & 0xff;
    rgba[o + 2] = p & 0xff;
    rgba[o + 3] = p >>> 24;
  }
  return { width, height, rgba };
}

/** Decodes the headerless VP8L image stream used by the WebP ALPH chunk (compression method 1): the stream has implicit width/height and no 5-byte header; returns the GREEN channel of each decoded ARGB pixel, width*height bytes. Throws EmoteDecodeError on malformed data. */
export function decodeVp8lAlphaStream(data: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw corrupt(`The alpha plane has an invalid size ${width}×${height}.`);
  }
  if (width > MAX_FORMAT_SIDE || height > MAX_FORMAT_SIDE) {
    throw overBudget(`The alpha plane is ${width}×${height}; WebP allows at most ${MAX_FORMAT_SIDE}.`);
  }
  const argb = decodeImageStream(new BitReader(data, 0), width, height);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < argb.length; i++) alpha[i] = (argb[i]! >>> 8) & 0xff;
  return alpha;
}

/**
 * Least-significant-bit-first reader. It keeps up to 32 bits buffered and pads with zeros past the end
 * so a prefix-code lookup may peek beyond the data, but consuming a bit that is not in the data throws.
 */
class BitReader {
  private readonly data: Uint8Array;
  private readonly endBit: number;
  private next: number;
  private buffer = 0;
  private count = 0;

  constructor(data: Uint8Array, start: number) {
    this.data = data;
    this.next = start;
    this.endBit = data.length * 8;
  }

  /** Returns the next `n` (0..24) bits without consuming them. */
  peek(n: number): number {
    if (this.count < n) this.fill();
    return this.buffer & ((1 << n) - 1);
  }

  skip(n: number): void {
    this.buffer >>>= n;
    this.count -= n;
    if (this.next * 8 - this.count > this.endBit) throw corrupt('The VP8L stream ends early.');
  }

  /** Reads `n` (0..24) bits as an unsigned integer. */
  read(n: number): number {
    if (n === 0) return 0;
    const value = this.peek(n);
    this.skip(n);
    return value;
  }

  private fill(): void {
    while (this.count <= 24) {
      const byte = this.next < this.data.length ? this.data[this.next]! : 0;
      this.buffer = (this.buffer | (byte << this.count)) >>> 0;
      this.count += 8;
      this.next++;
    }
  }
}

/**
 * Flat storage for every decoding table of one image. A code is addressed by its base offset and its
 * root bit count. Root entries are `(length << 16) | symbol` or `LINK | (subBits << 16) | offset` with
 * the offset relative to the code's base; second-level entries are leaves.
 */
class TablePool {
  table = new Int32Array(4096);
  size = 0;

  alloc(entries: number): number {
    const offset = this.size;
    const end = offset + entries;
    if (end > MAX_TABLE_ENTRIES) throw overBudget('The WebP declares more prefix-code tables than the decoder allows.');
    if (end > this.table.length) {
      let length = this.table.length;
      while (length < end) length *= 2;
      const grown = new Int32Array(Math.min(length, MAX_TABLE_ENTRIES));
      grown.set(this.table.subarray(0, this.size));
      this.table = grown;
    }
    this.table.fill(0, offset, end);
    this.size = end;
    return offset;
  }
}

/** Scratch buffers shared by every prefix code read during one decode. */
interface CodeScratch {
  lengths: Uint8Array;
  codeLengthLengths: Uint8Array;
  sorted: Uint16Array;
  count: Int32Array;
  offsets: Int32Array;
}

function createScratch(): CodeScratch {
  return {
    lengths: new Uint8Array(MAX_GREEN_ALPHABET),
    codeLengthLengths: new Uint8Array(NUM_CODE_LENGTH_CODES),
    sorted: new Uint16Array(MAX_GREEN_ALPHABET),
    count: new Int32Array(MAX_CODE_LENGTH + 1),
    offsets: new Int32Array(MAX_CODE_LENGTH + 2),
  };
}

/**
 * Checks a code-length histogram (`count[1..15]`) and returns the longest code length, or 0 for a code
 * with a single used symbol, which decodes that symbol without consuming bits. Any other code must be
 * complete: an empty, over-subscribed or incomplete code is corrupt.
 */
function checkLengths(count: Int32Array): number {
  let used = 0;
  for (let len = 1; len <= MAX_CODE_LENGTH; len++) used += count[len]!;
  if (used === 0) throw corrupt('A VP8L prefix code has no symbols.');
  if (used === 1) return 0;
  let left = 1;
  let maxLength = 0;
  for (let len = 1; len <= MAX_CODE_LENGTH; len++) {
    left = left * 2 - count[len]!;
    if (left < 0) throw corrupt('A VP8L prefix code is over-subscribed.');
    if (count[len]! > 0) maxLength = len;
  }
  if (left !== 0) throw corrupt('A VP8L prefix code is incomplete.');
  return maxLength;
}

/**
 * Builds the two-level decoding table for lengths already accepted by `checkLengths` (whose histogram is
 * still in `scratch.count`, and is consumed). Returns the handle `base * 16 + rootBits`.
 */
function buildTable(lengths: Uint8Array, alphabetSize: number, maxLength: number, scratch: CodeScratch, pool: TablePool): number {
  const { count, offsets, sorted } = scratch;
  if (maxLength === 0) {
    let symbol = 0;
    while (lengths[symbol] === 0) symbol++;
    const base = pool.alloc(1);
    pool.table[base] = symbol;
    return base * 16;
  }

  offsets[1] = 0;
  for (let len = 1; len <= MAX_CODE_LENGTH; len++) offsets[len + 1] = offsets[len]! + count[len]!;
  for (let s = 0; s < alphabetSize; s++) {
    const len = lengths[s]!;
    if (len !== 0) sorted[offsets[len]!++] = s;
  }

  const rootBits = Math.min(maxLength, ROOT_BITS);
  const rootSize = 1 << rootBits;
  const base = pool.alloc(rootSize);
  let table = pool.table;
  let code = 0;
  let index = 0;
  let currentLow = -1;
  let subBits = 0;
  let subOffset = 0;
  for (let len = 1; len <= maxLength; len++) {
    for (let n = count[len]!; n > 0; n--) {
      const symbol = sorted[index++]!;
      const reversed = reverseBits(code, len);
      const entry = (len << 16) | symbol;
      if (len <= rootBits) {
        for (let i = reversed; i < rootSize; i += 1 << len) table[base + i] = entry;
      } else {
        const low = reversed & (rootSize - 1);
        if (low !== currentLow) {
          // Size the second-level table so it holds exactly the codes that share this root prefix.
          subBits = len - rootBits;
          let room = 1 << subBits;
          while (subBits + rootBits < maxLength) {
            room -= count[subBits + rootBits]!;
            if (room <= 0) break;
            subBits++;
            room <<= 1;
          }
          subOffset = pool.alloc(1 << subBits) - base;
          table = pool.table;
          table[base + low] = LINK | (subBits << 16) | subOffset;
          currentLow = low;
        }
        const subSize = 1 << subBits;
        for (let i = reversed >>> rootBits; i < subSize; i += 1 << (len - rootBits)) table[base + subOffset + i] = entry;
      }
      code++;
      count[len]!--;
    }
    code <<= 1;
  }
  return base * 16 + rootBits;
}

function reverseBits(value: number, length: number): number {
  let out = 0;
  for (let i = 0; i < length; i++) {
    out = (out << 1) | (value & 1);
    value >>>= 1;
  }
  return out;
}

function readSymbol(reader: BitReader, table: Int32Array, code: number): number {
  const base = code >>> 4;
  const rootBits = code & 15;
  const bits = reader.peek(MAX_CODE_LENGTH);
  let entry = table[base + (bits & ((1 << rootBits) - 1))]!;
  if ((entry & LINK) !== 0) {
    const subBits = (entry >>> 16) & 0xff;
    entry = table[base + (entry & 0xffff) + ((bits >>> rootBits) & ((1 << subBits) - 1))]!;
  }
  reader.skip(entry >>> 16);
  return entry & 0xffff;
}

/**
 * Reads one prefix code (simple or normal) and returns its table handle. With `build` false the code is
 * only validated and -1 is returned; that path does work proportional to the bits read, not to the
 * alphabet, so streams full of unused meta groups stay cheap.
 */
function readPrefixCode(reader: BitReader, alphabetSize: number, scratch: CodeScratch, pool: TablePool, build: boolean): number {
  const { lengths, count } = scratch;
  if (reader.read(1) === 1) {
    const symbols = reader.read(1) + 1;
    let first = reader.read(reader.read(1) === 1 ? 8 : 1);
    let second = symbols === 2 ? reader.read(8) : -1;
    // A symbol outside the alphabet carries no code, and a repeated symbol counts once.
    if (first >= alphabetSize) first = -1;
    if (second >= alphabetSize || second === first) second = -1;
    if (first < 0 && second < 0) throw corrupt('A VP8L prefix code has no symbols.');
    if (!build) return -1;
    if (first < 0 || second < 0) {
      const base = pool.alloc(1);
      pool.table[base] = Math.max(first, second);
      return base * 16;
    }
    const base = pool.alloc(2);
    pool.table[base] = (1 << 16) | Math.min(first, second);
    pool.table[base + 1] = (1 << 16) | Math.max(first, second);
    return base * 16 + 1;
  }

  const codeLengthLengths = scratch.codeLengthLengths;
  codeLengthLengths.fill(0);
  const declared = reader.read(4) + 4;
  for (let i = 0; i < declared; i++) codeLengthLengths[CODE_LENGTH_ORDER[i]!] = reader.read(3);
  count.fill(0);
  for (let i = 0; i < NUM_CODE_LENGTH_CODES; i++) count[codeLengthLengths[i]!]!++;
  count[0] = 0;
  // The code-length code lives in the pool only while this code's lengths are read.
  const mark = pool.size;
  const codeLengthCode = buildTable(codeLengthLengths, NUM_CODE_LENGTH_CODES, checkLengths(count), scratch, pool);

  let maxTokens = alphabetSize;
  if (reader.read(1) === 1) {
    const lengthBits = 2 + 2 * reader.read(3);
    maxTokens = 2 + reader.read(lengthBits);
    if (maxTokens > alphabetSize) throw corrupt('A VP8L prefix code declares more symbols than its alphabet.');
  }

  if (build) lengths.fill(0, 0, alphabetSize);
  count.fill(0);
  let symbol = 0;
  let previous = 8;
  const onlyToken = (codeLengthCode & 15) === 0 ? pool.table[codeLengthCode >>> 4]! & 0xffff : -1;
  if (onlyToken >= 0 && onlyToken < 16) {
    // Every token is the same literal length and consumes no bits.
    const n = Math.min(maxTokens, alphabetSize);
    if (build) lengths.fill(onlyToken, 0, n);
    count[onlyToken]! += n;
  } else {
    while (symbol < alphabetSize && maxTokens > 0) {
      maxTokens--;
      const token = readSymbol(reader, pool.table, codeLengthCode);
      if (token < 16) {
        if (build) lengths[symbol] = token;
        count[token]!++;
        symbol++;
        if (token !== 0) previous = token;
        continue;
      }
      const repeat = token === 16 ? 3 + reader.read(2) : token === 17 ? 3 + reader.read(3) : 11 + reader.read(7);
      if (symbol + repeat > alphabetSize) throw corrupt('A VP8L code-length run passes the end of its alphabet.');
      const value = token === 16 ? previous : 0;
      if (build) lengths.fill(value, symbol, symbol + repeat);
      count[value]! += repeat;
      symbol += repeat;
    }
  }
  pool.size = mark;
  count[0] = 0;
  const maxLength = checkLengths(count);
  return build ? buildTable(lengths, alphabetSize, maxLength, scratch, pool) : -1;
}

interface Transform {
  type: number;
  /** Image width when the transform was read (the width it operates on). */
  width: number;
  bits: number;
  data: Uint32Array;
}

const divRoundUp = (value: number, shift: number): number => (value + (1 << shift) - 1) >>> shift;

/** Reads transforms and the main image of a VP8L stream and returns the final ARGB pixels. */
function decodeImageStream(reader: BitReader, width: number, height: number): Uint32Array {
  const scratch = createScratch();
  const transforms: Transform[] = [];
  let seen = 0;
  let codedWidth = width;
  while (reader.read(1) === 1) {
    const type = reader.read(2);
    if ((seen & (1 << type)) !== 0) throw corrupt('A VP8L transform appears twice.');
    seen |= 1 << type;
    if (type === TRANSFORM_PREDICTOR || type === TRANSFORM_COLOR) {
      const bits = reader.read(3) + 2;
      const data = decodeImageData(reader, divRoundUp(codedWidth, bits), divRoundUp(height, bits), false, scratch);
      transforms.push({ type, width: codedWidth, bits, data });
    } else if (type === TRANSFORM_SUBTRACT_GREEN) {
      transforms.push({ type, width: codedWidth, bits: 0, data: new Uint32Array(0) });
    } else {
      const size = reader.read(8) + 1;
      const entries = decodeImageData(reader, size, 1, false, scratch);
      // Indices past the table decode as transparent black, so the table is padded with zeros.
      const palette = new Uint32Array(256);
      palette[0] = entries[0]!;
      for (let i = 1; i < size; i++) palette[i] = addPixels(entries[i]!, palette[i - 1]!);
      const bits = size <= 2 ? 3 : size <= 4 ? 2 : size <= 16 ? 1 : 0;
      transforms.push({ type, width: codedWidth, bits, data: palette });
      codedWidth = divRoundUp(codedWidth, bits);
    }
  }

  let pixels = decodeImageData(reader, codedWidth, height, true, scratch);
  for (let t = transforms.length - 1; t >= 0; t--) {
    const transform = transforms[t]!;
    switch (transform.type) {
      case TRANSFORM_PREDICTOR:
        inversePredictor(pixels, transform.width, height, transform.bits, transform.data);
        break;
      case TRANSFORM_COLOR:
        inverseColorTransform(pixels, transform.width, height, transform.bits, transform.data);
        break;
      case TRANSFORM_SUBTRACT_GREEN:
        addGreen(pixels);
        break;
      case TRANSFORM_COLOR_INDEXING:
        pixels = expandColorIndexing(pixels, transform.width, height, transform.bits, transform.data);
    }
  }
  return pixels;
}

/**
 * Decodes one entropy-coded image: the main ARGB image (`isMain`, which may carry meta prefix codes)
 * or a transform/entropy sub-image.
 */
function decodeImageData(reader: BitReader, width: number, height: number, isMain: boolean, scratch: CodeScratch): Uint32Array {
  let cacheBits = 0;
  if (reader.read(1) === 1) {
    cacheBits = reader.read(4);
    if (cacheBits < 1 || cacheBits > MAX_CACHE_BITS) throw corrupt(`The VP8L color cache size ${cacheBits} is invalid.`);
  }

  let groupBits = 0;
  let groupWidth = 0;
  let groupImage: Uint32Array | null = null;
  // Maps a meta prefix code to the slot of its decoded group; -1 for codes no block uses.
  let slotOf: Int32Array;
  let numGroups = 1;
  let usedGroups = 1;
  if (isMain && reader.read(1) === 1) {
    groupBits = reader.read(3) + 2;
    groupWidth = divRoundUp(width, groupBits);
    groupImage = decodeImageData(reader, groupWidth, divRoundUp(height, groupBits), false, scratch);
    let maxCode = 0;
    for (let i = 0; i < groupImage.length; i++) {
      const meta = (groupImage[i]! >>> 8) & 0xffff;
      groupImage[i] = meta;
      if (meta > maxCode) maxCode = meta;
    }
    numGroups = maxCode + 1;
    slotOf = new Int32Array(numGroups).fill(-1);
    usedGroups = 0;
    for (let i = 0; i < groupImage.length; i++) {
      const meta = groupImage[i]!;
      if (slotOf[meta] === -1) slotOf[meta] = usedGroups++;
    }
    for (let i = 0; i < groupImage.length; i++) groupImage[i] = slotOf[groupImage[i]!]!;
  } else {
    slotOf = new Int32Array(1);
  }

  // Every group's five codes are in the stream, including groups no block refers to. Those are read
  // and validated but get no tables.
  const cacheSize = cacheBits > 0 ? 1 << cacheBits : 0;
  const greenAlphabet = NUM_LITERALS + NUM_LENGTH_CODES + cacheSize;
  const pool = new TablePool();
  const codes = new Int32Array(usedGroups * 5);
  for (let g = 0; g < numGroups; g++) {
    const slot = slotOf[g]!;
    const build = slot >= 0;
    for (let k = 0; k < 5; k++) {
      const alphabet = k === 0 ? greenAlphabet : k === 4 ? NUM_DISTANCE_CODES : NUM_LITERALS;
      const handle = readPrefixCode(reader, alphabet, scratch, pool, build);
      if (build) codes[slot * 5 + k] = handle;
    }
  }
  const table = pool.table;

  const total = width * height;
  const pixels = new Uint32Array(total);
  const cache = cacheBits > 0 ? new Uint32Array(cacheSize) : null;
  const cacheShift = 32 - cacheBits;
  const blockMask = groupImage ? (1 << groupBits) - 1 : 0;
  let pos = 0;
  let x = 0;
  let y = 0;
  let group = 0;
  let cached = 0;
  while (pos < total) {
    if (groupImage && (x & blockMask) === 0) group = groupImage[(y >>> groupBits) * groupWidth + (x >>> groupBits)]! * 5;
    const green = readSymbol(reader, table, codes[group]!);
    if (green < NUM_LITERALS) {
      const red = readSymbol(reader, table, codes[group + 1]!);
      const blue = readSymbol(reader, table, codes[group + 2]!);
      const alpha = readSymbol(reader, table, codes[group + 3]!);
      pixels[pos++] = ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
      if (++x === width) {
        x = 0;
        y++;
      }
    } else if (green < NUM_LITERALS + NUM_LENGTH_CODES) {
      const length = readPrefixedValue(reader, green - NUM_LITERALS);
      const distanceCode = readPrefixedValue(reader, readSymbol(reader, table, codes[group + 4]!));
      const distance = planeDistance(distanceCode, width);
      if (distance > pos) throw corrupt('A VP8L back-reference points before the first pixel.');
      if (length > total - pos) throw corrupt('A VP8L back-reference runs past the last pixel.');
      for (let i = 0; i < length; i++, pos++) pixels[pos] = pixels[pos - distance]!;
      x += length;
      if (x >= width) {
        y += Math.floor(x / width);
        x %= width;
      }
      // The block may change mid-run, so the group is looked up again for the next symbol.
      if (groupImage && pos < total) group = groupImage[(y >>> groupBits) * groupWidth + (x >>> groupBits)]! * 5;
    } else {
      // Only reachable with a color cache: the green alphabet has no symbols past the length codes otherwise.
      pixels[pos++] = cache![green - NUM_LITERALS - NUM_LENGTH_CODES]!;
      if (++x === width) {
        x = 0;
        y++;
      }
    }
    if (cache) {
      for (; cached < pos; cached++) {
        const color = pixels[cached]!;
        cache[Math.imul(color, 0x1e35a7bd) >>> cacheShift] = color;
      }
    }
  }
  return pixels;
}

/** LZ77 length and distance values: a prefix symbol plus raw extra bits (RFC 9649 §3.6.2.2). */
function readPrefixedValue(reader: BitReader, symbol: number): number {
  if (symbol < 4) return symbol + 1;
  const extraBits = (symbol - 2) >>> 1;
  const offset = (2 + (symbol & 1)) << extraBits;
  return offset + reader.read(extraBits) + 1;
}

function planeDistance(code: number, width: number): number {
  if (code > 120) return code - 120;
  const xi = DISTANCE_MAP[(code - 1) * 2]!;
  const yi = DISTANCE_MAP[(code - 1) * 2 + 1]!;
  const distance = xi + yi * width;
  return distance < 1 ? 1 : distance;
}

/** Adds two ARGB pixels channel by channel, each channel modulo 256. */
function addPixels(a: number, b: number): number {
  const alphaGreen = ((a & 0xff00ff00) + (b & 0xff00ff00)) & 0xff00ff00;
  const redBlue = ((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff;
  return (alphaGreen | redBlue) >>> 0;
}

/** Per-channel floor((a + b) / 2). */
function average2(a: number, b: number): number {
  return ((((a ^ b) & 0xfefefefe) >>> 1) + ((a & b) >>> 0)) >>> 0;
}

function select(left: number, top: number, topLeft: number): number {
  // Distance of the gradient estimate to L is sum |T - TL|, to T is sum |L - TL|.
  const toLeft =
    Math.abs(((top >>> 24) & 0xff) - ((topLeft >>> 24) & 0xff)) +
    Math.abs(((top >>> 16) & 0xff) - ((topLeft >>> 16) & 0xff)) +
    Math.abs(((top >>> 8) & 0xff) - ((topLeft >>> 8) & 0xff)) +
    Math.abs((top & 0xff) - (topLeft & 0xff));
  const toTop =
    Math.abs(((left >>> 24) & 0xff) - ((topLeft >>> 24) & 0xff)) +
    Math.abs(((left >>> 16) & 0xff) - ((topLeft >>> 16) & 0xff)) +
    Math.abs(((left >>> 8) & 0xff) - ((topLeft >>> 8) & 0xff)) +
    Math.abs((left & 0xff) - (topLeft & 0xff));
  return toLeft < toTop ? left : top;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

function clampAddSubtractFull(a: number, b: number, c: number): number {
  let out = 0;
  for (let shift = 0; shift < 32; shift += 8) {
    out |= clamp255(((a >>> shift) & 0xff) + ((b >>> shift) & 0xff) - ((c >>> shift) & 0xff)) << shift;
  }
  return out >>> 0;
}

function clampAddSubtractHalf(a: number, b: number): number {
  let out = 0;
  for (let shift = 0; shift < 32; shift += 8) {
    const ca = (a >>> shift) & 0xff;
    const cb = (b >>> shift) & 0xff;
    // C division truncates toward zero.
    out |= clamp255(ca + Math.trunc((ca - cb) / 2)) << shift;
  }
  return out >>> 0;
}

function predict(mode: number, left: number, top: number, topRight: number, topLeft: number): number {
  switch (mode) {
    case 1:
      return left;
    case 2:
      return top;
    case 3:
      return topRight;
    case 4:
      return topLeft;
    case 5:
      return average2(average2(left, topRight), top);
    case 6:
      return average2(left, topLeft);
    case 7:
      return average2(left, top);
    case 8:
      return average2(topLeft, top);
    case 9:
      return average2(top, topRight);
    case 10:
      return average2(average2(left, topLeft), average2(top, topRight));
    case 11:
      return select(left, top, topLeft);
    case 12:
      return clampAddSubtractFull(left, top, topLeft);
    case 13:
      return clampAddSubtractHalf(average2(left, top), topLeft);
    default:
      // Mode 0, and the unassigned modes 14 and 15, which decoders treat as mode 0.
      return 0xff000000;
  }
}

function inversePredictor(pixels: Uint32Array, width: number, height: number, bits: number, modes: Uint32Array): void {
  pixels[0] = addPixels(pixels[0]!, 0xff000000);
  for (let x = 1; x < width; x++) pixels[x] = addPixels(pixels[x]!, pixels[x - 1]!);
  const blocksPerRow = divRoundUp(width, bits);
  for (let y = 1; y < height; y++) {
    const row = y * width;
    pixels[row] = addPixels(pixels[row]!, pixels[row - width]!);
    const modeRow = (y >>> bits) * blocksPerRow;
    for (let x = 1; x < width; x++) {
      const mode = (modes[modeRow + (x >>> bits)]! >>> 8) & 0xf;
      const pos = row + x;
      // For the rightmost column, pos - width + 1 is the first pixel of the current row, as specified.
      const predicted = predict(mode, pixels[pos - 1]!, pixels[pos - width]!, pixels[pos - width + 1]!, pixels[pos - width - 1]!);
      pixels[pos] = addPixels(pixels[pos]!, predicted);
    }
  }
}

const toInt8 = (v: number): number => (v << 24) >> 24;

function inverseColorTransform(pixels: Uint32Array, width: number, height: number, bits: number, elements: Uint32Array): void {
  const blocksPerRow = divRoundUp(width, bits);
  for (let y = 0; y < height; y++) {
    const elementRow = (y >>> bits) * blocksPerRow;
    for (let x = 0, pos = y * width; x < width; x++, pos++) {
      const element = elements[elementRow + (x >>> bits)]!;
      const greenToRed = toInt8(element & 0xff);
      const greenToBlue = toInt8((element >>> 8) & 0xff);
      const redToBlue = toInt8((element >>> 16) & 0xff);
      const p = pixels[pos]!;
      const green = toInt8((p >>> 8) & 0xff);
      const red = (((p >>> 16) & 0xff) + ((greenToRed * green) >> 5)) & 0xff;
      const blue = ((p & 0xff) + ((greenToBlue * green) >> 5) + ((redToBlue * toInt8(red)) >> 5)) & 0xff;
      pixels[pos] = ((p & 0xff00ff00) | (red << 16) | blue) >>> 0;
    }
  }
}

function addGreen(pixels: Uint32Array): void {
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i]!;
    const green = (p >>> 8) & 0xff;
    const redBlue = ((p & 0x00ff00ff) + ((green << 16) | green)) & 0x00ff00ff;
    pixels[i] = ((p & 0xff00ff00) | redBlue) >>> 0;
  }
}

function expandColorIndexing(packed: Uint32Array, width: number, height: number, bits: number, palette: Uint32Array): Uint32Array {
  const out = new Uint32Array(width * height);
  if (bits === 0) {
    for (let i = 0; i < out.length; i++) out[i] = palette[(packed[i]! >>> 8) & 0xff]!;
    return out;
  }
  const packedWidth = divRoundUp(width, bits);
  const bitsPerPixel = 8 >>> bits;
  const mask = (1 << bitsPerPixel) - 1;
  const lane = (1 << bits) - 1;
  for (let y = 0; y < height; y++) {
    const source = y * packedWidth;
    for (let x = 0, pos = y * width; x < width; x++, pos++) {
      const index = (((packed[source + (x >>> bits)]! >>> 8) & 0xff) >>> ((x & lane) * bitsPerPixel)) & mask;
      out[pos] = palette[index]!;
    }
  }
  return out;
}
