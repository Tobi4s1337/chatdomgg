import type { Vec3 } from '@chatdom/shared';
import { RESAVE, VOX_IMPORT_LIMITS, VoxFailure, voxFail, type VoxImportError } from './limits';
import { defaultPalette } from './palette';

/** One stored SIZE/XYZI object. Coordinates are MagicaVoxel's own: Z is up. */
export interface VoxModel {
  /** Position in stored model order; scene shapes refer to this. */
  readonly index: number;
  /** Stored x, y, z extents. */
  readonly size: Vec3;
  readonly count: number;
  /** Owned `count * 4` bytes of (x, y, z, colourIndex); every record checked, colour index 1..255. */
  readonly records: Uint8Array;
}

export type VoxMaterialEffect = 'metal' | 'glass' | 'emit' | 'blend' | 'media' | 'cloud' | 'translucent';

/** What the file carries beyond local object geometry. None of it is imported; the tool says so. */
export interface VoxSceneInfo {
  /** Transform, group and shape nodes. */
  readonly nodes: number;
  /** Shape references to stored models; more than models means instances. */
  readonly placements: number;
  readonly instanced: boolean;
  /** Multi-frame transforms or shapes, or a legacy PACK animation container. */
  readonly animated: boolean;
  readonly pack: boolean;
}

export interface VoxFile {
  readonly version: 150 | 200;
  readonly models: readonly VoxModel[];
  /** 256 RGBA records; record i is colour index i and record 0 is unused. One palette serves every model. */
  readonly palette: Uint8Array;
  readonly paletteSource: 'file' | 'default';
  readonly scene: VoxSceneInfo | null;
  /** Source physical material per colour index, when not plain diffuse. */
  readonly effects: ReadonlyMap<number, VoxMaterialEffect>;
  /** Chunk ids skipped within bounds (render settings, cameras, notes, unknown extensions). */
  readonly skipped: readonly string[];
}

export type VoxParseResult = { readonly ok: true; readonly file: VoxFile } | { readonly ok: false; readonly error: VoxImportError };

interface Chunk { readonly id: string; readonly at: number; readonly content: number; readonly contentEnd: number; readonly end: number }

const KNOWN_SKIPPED = new Set(['LAYR', 'rOBJ', 'rCAM', 'NOTE']);
const EFFECTS: Record<string, VoxMaterialEffect> = { _metal: 'metal', _glass: 'glass', _emit: 'emit', _blend: 'blend', _media: 'media', _cloud: 'cloud' };

/** A printable label for a chunk id; file bytes never reach the UI unescaped or unbounded. */
const label = (id: string) => /^[\x20-\x7e]{4}$/.test(id) ? id.trim() || 'blank' : 'unnamed';

/** Bounded little-endian reads: no read or view leaves [start, end). */
class Reader {
  constructor(private readonly view: DataView, public at: number, private readonly end: number, private readonly what: string) {}
  get remaining(): number { return this.end - this.at; }
  private need(bytes: number): void {
    if (bytes > this.remaining) voxFail('truncated', `The ${this.what} section ends before its data.`, RESAVE, this.at);
  }
  u32(): number { this.need(4); const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.at, true); this.at += 4; return v; }
  /** Count of records each at least `minBytes` long; rejects counts the remaining bytes cannot hold. */
  count(minBytes: number): number {
    const n = this.i32();
    if (n < 0 || n * minBytes > this.remaining) voxFail('structure', `The ${this.what} section declares more entries than it holds.`, RESAVE, this.at - 4);
    return n;
  }
  text(): string {
    const n = this.count(1);
    let out = '';
    for (let i = 0; i < Math.min(n, 64); i++) out += String.fromCharCode(this.view.getUint8(this.at + i));
    this.at += n; return out;
  }
  dict(): Map<string, string> {
    const pairs = this.count(8), out = new Map<string, string>();
    for (let i = 0; i < pairs; i++) { const key = this.text(); out.set(key, this.text()); }
    return out;
  }
}

/** Parse MagicaVoxel bytes into bounded model records and the file-wide palette. Never throws for bad input. */
export function parseVox(bytes: Uint8Array): VoxParseResult {
  try { return { ok: true, file: parse(bytes) }; }
  catch (error) { if (error instanceof VoxFailure) return { ok: false, error: error.error }; throw error; }
}

function parse(bytes: Uint8Array): VoxFile {
  const limits = VOX_IMPORT_LIMITS;
  if (bytes.byteLength > limits.fileBytes) voxFail('too-large', `This file is over ${limits.fileBytes / 1048576} MiB.`, 'Export just the object you want to bring in, or a smaller version of it.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.byteLength < 8 || fourcc(0) !== 'VOX ') voxFail('not-vox', 'This is not a MagicaVoxel .vox file.', 'In MagicaVoxel, save or export the model as .vox, then choose that file.');
  const version = view.getUint32(4, true);
  if (version !== 150 && version !== 200) voxFail('version', `This .vox uses format version ${version}, which this tool cannot read yet.`, 'Open it in MagicaVoxel 0.99 or later and save it again.', 4);

  let chunks = 0;
  const readChunk = (at: number, end: number, what: string): Chunk => {
    if (end - at < 12) voxFail('truncated', `The file ends inside the ${what} header.`, RESAVE, at);
    if (++chunks > limits.chunks) voxFail('limit', `This file has more than ${limits.chunks.toLocaleString('en')} sections.`, 'Export just the object you want to bring in.', at);
    const id = fourcc(at), content = at + 12, contentEnd = content + view.getUint32(at + 4, true), chunkEnd = contentEnd + view.getUint32(at + 8, true);
    if (chunkEnd > end) voxFail('truncated', `The ${label(id)} section claims more bytes than its container holds.`, RESAVE, at);
    return { id, at, content, contentEnd, end: chunkEnd };
  };
  /** Children of chunks we do not read still have to be well framed, to a bounded depth. */
  const checkChildren = (chunk: Chunk, depth: number) => {
    if (chunk.contentEnd === chunk.end) return;
    if (depth > limits.depth) voxFail('limit', `Sections are nested more than ${limits.depth} levels deep.`, RESAVE, chunk.at);
    for (let at = chunk.contentEnd; at < chunk.end;) { const child = readChunk(at, chunk.end, label(chunk.id)); checkChildren(child, depth + 1); at = child.end; }
  };

  const main = readChunk(8, bytes.byteLength, 'MAIN');
  if (main.id !== 'MAIN') voxFail('structure', 'The file has no MAIN section where its models should be.', RESAVE, 8);
  if (main.end !== bytes.byteLength) voxFail('structure', 'There are extra bytes after the model data.', RESAVE, main.end);

  const models: VoxModel[] = [], effects = new Map<number, VoxMaterialEffect>(), skipped = new Set<string>();
  let pack: number | null = null, pending: { size: Vec3; at: number } | null = null, palette: Uint8Array | null = null, totalVoxels = 0;
  let nodes = 0, placements = 0, animated = false;
  const placed = new Set<number>();

  for (let at = main.contentEnd; at < main.end;) {
    const chunk = readChunk(at, main.end, 'MAIN'); at = chunk.end;
    checkChildren(chunk, 2);
    const length = chunk.contentEnd - chunk.content, reader = new Reader(view, chunk.content, chunk.contentEnd, label(chunk.id));
    if (pending && chunk.id !== 'XYZI') voxFail('structure', `Model ${models.length + 1} has a size but no blocks after it.`, RESAVE, chunk.at);
    switch (chunk.id) {
      case 'PACK': {
        if (pack !== null) voxFail('structure', 'The file declares its model count twice.', RESAVE, chunk.at);
        if (models.length || pending) voxFail('structure', 'The model count appears after the models.', RESAVE, chunk.at);
        if (length !== 4) voxFail('structure', 'The model count section has the wrong length.', RESAVE, chunk.at);
        pack = reader.u32();
        if (pack < 1 || pack > limits.models) voxFail('limit', `The file declares ${pack.toLocaleString('en')} models; this tool reads 1 to ${limits.models}.`, 'Export just the object you want to bring in.', chunk.at);
        break;
      }
      case 'SIZE': {
        if (models.length >= limits.models) voxFail('limit', `This file holds more than ${limits.models} models.`, 'Export just the object you want to bring in.', chunk.at);
        if (length !== 12) voxFail('structure', `Model ${models.length + 1}'s size section has the wrong length.`, RESAVE, chunk.at);
        const size: Vec3 = [reader.i32(), reader.i32(), reader.i32()];
        if (size.some(n => n < 1 || n > limits.dimension)) voxFail('dimensions', `Model ${models.length + 1} measures ${size.join(' × ')}; each side must be 1 to ${limits.dimension}.`, 'Crop the model in MagicaVoxel and save again.', chunk.at);
        pending = { size, at: chunk.at };
        break;
      }
      case 'XYZI': {
        if (!pending) voxFail('structure', `Blocks for model ${models.length + 1} appear without its size.`, RESAVE, chunk.at);
        const count = reader.u32();
        if (count > limits.voxels - totalVoxels) voxFail('limit', `This file holds more than ${limits.voxels.toLocaleString('en')} blocks.`, 'Export just the object you want to bring in, or a smaller version of it.', chunk.at);
        if (4 + count * 4 !== length) voxFail('structure', `Model ${models.length + 1} declares ${count.toLocaleString('en')} blocks but stores a different amount.`, RESAVE, chunk.at);
        const [sx, sy, sz] = pending.size, start = chunk.content + 4;
        const seen = new Uint8Array(Math.ceil(sx * sy * sz / 8));
        for (let i = 0; i < count; i++) {
          const o = start + i * 4, x = bytes[o]!, y = bytes[o + 1]!, z = bytes[o + 2]!, c = bytes[o + 3]!;
          if (x >= sx || y >= sy || z >= sz) voxFail('voxel', `Model ${models.length + 1} has a block at ${x}, ${y}, ${z}, outside its ${sx} × ${sy} × ${sz} size.`, RESAVE, o);
          if (c === 0) voxFail('voxel', `Model ${models.length + 1} has a block with no colour (palette index 0).`, RESAVE, o);
          const key = x + sx * (y + sy * z), bit = 1 << (key & 7);
          if (seen[key >> 3]! & bit) voxFail('duplicate', `Model ${models.length + 1} stores two blocks at ${x}, ${y}, ${z}.`, RESAVE, o);
          seen[key >> 3] = seen[key >> 3]! | bit;
        }
        totalVoxels += count;
        models.push({ index: models.length, size: pending.size, count, records: bytes.slice(start, start + count * 4) });
        pending = null;
        break;
      }
      case 'RGBA': {
        if (palette) voxFail('structure', 'The file stores two palettes.', RESAVE, chunk.at);
        if (length !== 1024) voxFail('structure', 'The palette section has the wrong length.', RESAVE, chunk.at);
        // Record r serves colour index r + 1. The 256th record has no index and is never mapped onto air.
        palette = new Uint8Array(1024);
        palette.set(bytes.subarray(chunk.content, chunk.content + 1020), 4);
        break;
      }
      case 'IMAP':
        voxFail('palette-remap', 'This file reorders its palette (IMAP), which this tool does not apply.', 'In MagicaVoxel, export with the standard palette order, then choose the new file.', chunk.at);
        break;
      case 'MATL': {
        const id = reader.i32(), props = reader.dict(), effect = EFFECTS[props.get('_type') ?? ''];
        if (effect && id >= 1 && id <= 255) effects.set(id, effect);
        break;
      }
      case 'MATT': {
        const id = reader.i32(), type = reader.i32();
        const effect = ([undefined, 'metal', 'glass', 'emit'] as const)[type];
        if (effect && id >= 1 && id <= 255) effects.set(id, effect);
        break;
      }
      case 'nTRN': {
        nodes++; reader.i32(); reader.dict(); reader.i32(); reader.i32(); reader.i32();
        const frames = reader.count(4);
        if (frames < 1) voxFail('structure', 'A scene transform has no frames.', RESAVE, chunk.at);
        if (frames > 1) animated = true;
        for (let i = 0; i < frames; i++) reader.dict();
        break;
      }
      case 'nGRP': {
        nodes++; reader.i32(); reader.dict();
        const children = reader.count(4);
        for (let i = 0; i < children; i++) reader.i32();
        break;
      }
      case 'nSHP': {
        nodes++; reader.i32(); reader.dict();
        const refs = reader.count(8);
        if (refs < 1) voxFail('structure', 'A scene shape refers to no model.', RESAVE, chunk.at);
        if (refs > 1) animated = true;
        for (let i = 0; i < refs; i++) { placed.add(reader.i32()); reader.dict(); placements++; }
        break;
      }
      default:
        skipped.add(KNOWN_SKIPPED.has(chunk.id) ? chunk.id : label(chunk.id));
    }
  }
  if (pending) voxFail('structure', `Model ${models.length + 1} has a size but no blocks after it.`, RESAVE, pending.at);
  if (!models.length) voxFail('empty', 'This .vox holds no objects.', 'Check that the model has blocks in MagicaVoxel and save again.');
  if (pack !== null && pack !== models.length) voxFail('structure', `The file says it holds ${pack} models but stores ${models.length}.`, RESAVE);
  if (models.every(model => !model.count)) voxFail('empty', 'Every object in this .vox is empty.', 'Check that the model has blocks in MagicaVoxel and save again.');

  const rgba = palette ?? defaultPalette();
  for (let index = 1; index < 256; index++) if (rgba[index * 4 + 3]! < 255 && !effects.has(index)) effects.set(index, 'translucent');
  const scene = nodes || pack !== null ? { nodes, placements, instanced: placements > placed.size, animated: animated || pack !== null, pack: pack !== null } : null;
  return { version: version as 150 | 200, models, palette: rgba, paletteSource: palette ? 'file' : 'default', scene, effects, skipped: [...skipped] };
}
