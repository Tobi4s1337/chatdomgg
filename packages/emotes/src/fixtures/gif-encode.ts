/**
 * A small GIF89a writer for SIMULATED fixtures and decoder tests: it lets the module's own art go
 * through the real decoder as real bytes, with patch frames, disposal, transparency and delays.
 * Not a general encoder: colours must already fit one palette of at most 256 entries.
 */
export interface GifFrameSpec {
  /** Patch rectangle on the logical canvas. */
  left: number; top: number; width: number; height: number;
  /** Palette indices, row-major, width × height. */
  indices: Uint8Array;
  /** Delay in centiseconds (0 is legal and means "browser default"). */
  delayCs: number;
  disposal: 0 | 1 | 2 | 3;
  transparent?: number;
  interlaced?: boolean;
  /** Optional local colour table, flat RGB. */
  palette?: Uint8Array;
}

export interface GifSpec {
  width: number; height: number;
  /** Global colour table, flat RGB; padded to a power of two. */
  palette: Uint8Array;
  frames: readonly GifFrameSpec[];
  loop?: boolean;
}

class ByteWriter {
  private chunks: number[] = [];
  byte(value: number): void { this.chunks.push(value & 255); }
  u16(value: number): void { this.byte(value); this.byte(value >> 8); }
  bytes(values: ArrayLike<number>): void { for (let i = 0; i < values.length; i++) this.byte(values[i]!); }
  ascii(text: string): void { for (const c of text) this.byte(c.charCodeAt(0)); }
  done(): Uint8Array { return Uint8Array.from(this.chunks); }
}

function tableBits(colours: number): number {
  let bits = 1;
  while (2 << (bits - 1) < colours) bits++;
  return bits;
}

function paddedTable(palette: Uint8Array): { table: Uint8Array; bits: number } {
  const colours = Math.max(2, palette.length / 3), bits = tableBits(colours), table = new Uint8Array((2 << (bits - 1)) * 3);
  table.set(palette);
  return { table, bits };
}

/** GIF LZW with an early clear when the code table fills. */
function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize, end = clear + 1, out: number[] = [];
  let size = minCodeSize + 1, next = end + 1, buffer = 0, bits = 0;
  const emit = (code: number): void => {
    buffer |= code << bits; bits += size;
    while (bits >= 8) { out.push(buffer & 255); buffer >>>= 8; bits -= 8; }
  };
  let table = new Map<number, number>();
  emit(clear);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const value = indices[i]!, key = prefix * 256 + value, known = table.get(key);
    if (known !== undefined) { prefix = known; continue; }
    emit(prefix);
    if (next < 4096) {
      table.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      table = new Map(); size = minCodeSize + 1; next = end + 1;
    }
    prefix = value;
  }
  if (indices.length) emit(prefix);
  emit(end);
  if (bits > 0) out.push(buffer & 255);
  return Uint8Array.from(out);
}

function interlace(indices: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(indices.length);
  let row = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) {
    for (let y = start; y < height; y += step) out.set(indices.subarray(y * width, (y + 1) * width), (row++) * width);
  }
  return out;
}

export function encodeGif(spec: GifSpec): Uint8Array {
  const w = new ByteWriter(), global = paddedTable(spec.palette);
  w.ascii('GIF89a'); w.u16(spec.width); w.u16(spec.height);
  w.byte(0x80 | (global.bits - 1) << 4 | (global.bits - 1)); w.byte(0); w.byte(0);
  w.bytes(global.table);
  if (spec.loop ?? true) { w.byte(0x21); w.byte(0xff); w.byte(11); w.ascii('NETSCAPE2.0'); w.byte(3); w.byte(1); w.u16(0); w.byte(0); }
  for (const frame of spec.frames) {
    w.byte(0x21); w.byte(0xf9); w.byte(4);
    w.byte(frame.disposal << 2 | (frame.transparent !== undefined ? 1 : 0));
    w.u16(frame.delayCs); w.byte(frame.transparent ?? 0); w.byte(0);
    w.byte(0x2c); w.u16(frame.left); w.u16(frame.top); w.u16(frame.width); w.u16(frame.height);
    const local = frame.palette ? paddedTable(frame.palette) : null;
    w.byte((local ? 0x80 | (local.bits - 1) : 0) | (frame.interlaced ? 0x40 : 0));
    if (local) w.bytes(local.table);
    const bits = local?.bits ?? global.bits, minCodeSize = Math.max(2, bits);
    const data = lzw(frame.interlaced ? interlace(frame.indices, frame.width, frame.height) : frame.indices, minCodeSize);
    w.byte(minCodeSize);
    for (let i = 0; i < data.length; i += 255) { const block = data.subarray(i, i + 255); w.byte(block.length); w.bytes(block); }
    w.byte(0);
  }
  w.byte(0x3b);
  return w.done();
}
