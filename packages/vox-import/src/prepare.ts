import { MAX_ASSET_PADDED_CELLS, VoxelBlueprintSchema, type StyleId, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { VOX_IMPORT_LIMITS, VoxFailure, voxFail, type VoxImportError } from './limits';
import { oklab, paletteHex } from './palette';
import type { VoxFile, VoxMaterialEffect } from './parse';

export const VOX_SCALES = [0.25, 0.5, 1, 2, 4] as const;
export type VoxScale = typeof VOX_SCALES[number];
/** The shared blueprint box cap; detail beyond it needs a smaller scale or a simpler model. */
const MAX_BOXES = 20_000;

/** An allowed, non-air kingdom material from the current draft policy. */
export interface VoxImportMaterial { readonly id: number; readonly name: string; readonly colour: string }

export interface VoxImportOptions {
  readonly file: VoxFile;
  /** Stored model index the builder chose. */
  readonly model: number;
  /** The draft policy's allowed materials, resolved through the registry. Never avatar colours. */
  readonly materials: readonly VoxImportMaterial[];
  readonly styleId: StyleId;
  readonly scale: VoxScale;
  /** Build-cell origin of the blueprint's minimum corner. */
  readonly origin: Vec3;
  /** The plot's whole lattice and block allowance. The draft core re-checks both at insertion. */
  readonly destination: { readonly size: Vec3; readonly maxVoxels: number };
}

export interface VoxMaterialUse {
  readonly id: number; readonly name: string; readonly colour: string;
  /** Resulting build cells in this material. */
  readonly cells: number;
  /** Source colours that snapped here, most used first. */
  readonly sources: readonly string[];
}

export interface VoxImportSummary {
  readonly model: number;
  /** As stored, MagicaVoxel x · y · z (z up). */
  readonly sourceSize: Vec3;
  /** Occupied bounds stood upright at scale 1: build x · y (up) · z. */
  readonly uprightSize: Vec3;
  /** The blueprint's size in build cells at the chosen scale. */
  readonly size: Vec3;
  readonly scale: VoxScale;
  readonly cells: number;
  readonly boxes: number;
  /** Shrinking merged several source blocks into one. */
  readonly reduced: boolean;
  readonly materials: readonly VoxMaterialUse[];
  /** Source physical material effects among this object's colours, all replaced by kingdom materials. */
  readonly effects: readonly VoxMaterialEffect[];
}

export type VoxPrepareResult =
  | { readonly ok: true; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly summary: VoxImportSummary }
  | { readonly ok: false; readonly error: VoxImportError };

/** One parsed object to one exact build-lattice blueprint. Pure: the parsed source is never mutated. */
export function prepareVoxImport(options: VoxImportOptions): VoxPrepareResult {
  try { return prepare(options); }
  catch (error) { if (error instanceof VoxFailure) return { ok: false, error: error.error }; throw error; }
}

/** Nearest allowed material for each used colour: squared OKLab distance, lowest material ID on ties. */
export function snapColours(palette: Uint8Array, used: readonly number[], materials: readonly VoxImportMaterial[]): Map<number, VoxImportMaterial> {
  const choices = materials.filter(m => Number.isInteger(m.id) && m.id > 0 && /^#[0-9a-f]{6}$/i.test(m.colour))
    .map(m => ({ material: m, lab: oklab(...([1, 3, 5].map(i => parseInt(m.colour.slice(i, i + 2), 16)) as [number, number, number])) }))
    .sort((a, b) => a.material.id - b.material.id);
  if (!choices.length) voxFail('materials', 'This plot has no building materials to match colours against.', 'Leave and reopen your plot; your draft is unchanged.');
  const out = new Map<number, VoxImportMaterial>();
  for (const index of used) {
    const [l, a, b] = oklab(palette[index * 4]!, palette[index * 4 + 1]!, palette[index * 4 + 2]!);
    let best = choices[0]!, bestDistance = Infinity;
    for (const choice of choices) {
      const d = (choice.lab[0] - l) ** 2 + (choice.lab[1] - a) ** 2 + (choice.lab[2] - b) ** 2;
      if (d < bestDistance) { best = choice; bestDistance = d; }
    }
    out.set(index, best.material);
  }
  return out;
}

function prepare(options: VoxImportOptions): VoxPrepareResult {
  const { file, scale, destination } = options, model = file.models[options.model];
  if (!model) voxFail('model', 'Choose one of the objects in this file.', 'Pick an object from the list.');
  if (!model.count) voxFail('empty', `Object ${model.index + 1} has no blocks.`, 'Choose another object, or add blocks to it in MagicaVoxel.');
  if (!VOX_SCALES.includes(scale)) voxFail('destination', 'Choose a size from ¼ to 4×.', 'Pick one of the size buttons.');
  if (!options.origin.every(Number.isInteger)) voxFail('destination', 'Place the object on whole blocks.', 'Use the position controls.');

  const records = model.records, count = model.count, [, sy] = model.size;
  // Snap the colours this object actually uses. Raw RGB and palette ordinals never become material IDs.
  const usage = new Uint32Array(256);
  for (let i = 0; i < count; i++) { const c = records[i * 4 + 3]!; usage[c] = usage[c]! + 1; }
  const used = [...usage.keys()].filter(i => usage[i]);
  const snapped = snapColours(file.palette, used, options.materials);

  // Stand the object up: MagicaVoxel (x, y, z-up) to build (x, z, sizeY - 1 - y), keeping its handedness.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const p = [records[i * 4]!, records[i * 4 + 2]!, sy - 1 - records[i * 4 + 1]!];
    for (let d = 0; d < 3; d++) { if (p[d]! < min[d]!) min[d] = p[d]!; if (p[d]! > max[d]!) max[d] = p[d]!; }
  }
  const upright = [0, 1, 2].map(d => max[d]! - min[d]! + 1) as unknown as Vec3;
  const divisor = scale < 1 ? 1 / scale : 1, factor = scale > 1 ? scale : 1;
  const grid = upright.map(n => Math.floor((n - 1) / divisor) + 1) as unknown as Vec3;
  const size = grid.map(n => n * factor) as [number, number, number];

  // Destination limits before any expansion or grid allocation.
  const limit = destination.size.map(n => Math.min(n, VOX_IMPORT_LIMITS.dimension));
  if (size.some((n, d) => n > limit[d]!)) {
    const fits = VOX_SCALES.filter(s => s < scale && upright.every((n, d) => (s < 1 ? Math.floor((n - 1) * s) + 1 : n * s) <= limit[d]!));
    voxFail('destination', `At ${scaleName(scale)} this object would measure ${size.join(' × ')} blocks; your plot holds ${limit.join(' × ')}.`,
      fits.length ? `Try ${scaleName(fits[fits.length - 1]!)}.` : 'Crop the object in MagicaVoxel and save again.');
  }
  if (size.reduce((n, axis) => n * (axis + 2), 1) > MAX_ASSET_PADDED_CELLS) voxFail('destination', 'This object is too large to place at this size.', 'Choose a smaller size.');
  if (factor > 1 && count * factor ** 3 > destination.maxVoxels) voxFail('destination', `At ${scaleName(scale)} this object needs ${(count * factor ** 3).toLocaleString('en')} blocks; your home allows ${destination.maxVoxels.toLocaleString('en')}.`, 'Choose a smaller size.');

  // Fill the coalescing grid: one cell per resulting block, or per enlarged block of `factor³`.
  const [gx, gy] = grid, cells = new Uint16Array(grid[0] * grid[1] * grid[2]);
  const at = (i: number) => {
    const x = records[i * 4]! - min[0]!, y = records[i * 4 + 2]! - min[1]!, z = sy - 1 - records[i * 4 + 1]! - min[2]!;
    return Math.floor(x / divisor) + gx * (Math.floor(y / divisor) + gy * Math.floor(z / divisor));
  };
  const material = (i: number) => snapped.get(records[i * 4 + 3]!)!.id;
  if (divisor === 1) {
    for (let i = 0; i < count; i++) cells[at(i)] = material(i);
  } else {
    // Most frequent snapped material among the occupied contributors; lowest material ID breaks ties.
    const ids = [...new Set(snapped.values())].map(m => m.id).sort((a, b) => a - b), slot = new Map(ids.map((id, s) => [id, s]));
    const keys = new Uint32Array(count);
    for (let i = 0; i < count; i++) keys[i] = at(i) * 256 + slot.get(material(i))!;
    keys.sort();
    for (let i = 0; i < count;) {
      const cell = Math.floor(keys[i]! / 256);
      let bestSlot = -1, bestCount = 0;
      while (i < count && Math.floor(keys[i]! / 256) === cell) {
        const s = keys[i]! % 256; let n = 0;
        while (i < count && keys[i] === cell * 256 + s) { n++; i++; }
        if (n > bestCount) { bestCount = n; bestSlot = s; }
      }
      cells[cell] = ids[bestSlot]!;
    }
  }

  const boxes = coalesce(cells, grid, factor);
  if (boxes.length > MAX_BOXES) voxFail('too-detailed', `At ${scaleName(scale)} this object needs ${boxes.length.toLocaleString('en')} building pieces; a home holds ${MAX_BOXES.toLocaleString('en')}.`, 'Try a smaller size, or use fewer colours in MagicaVoxel.');

  const perMaterial = new Map<number, number>();
  for (const id of cells) if (id) perMaterial.set(id, (perMaterial.get(id) ?? 0) + factor ** 3);
  const total = [...perMaterial.values()].reduce((a, b) => a + b, 0);
  if (total > destination.maxVoxels) voxFail('destination', `This object needs ${total.toLocaleString('en')} blocks; your home allows ${destination.maxVoxels.toLocaleString('en')}.`, 'Choose a smaller size.');
  const materials = [...perMaterial].map(([id, n]) => {
    const m = options.materials.find(m => m.id === id)!;
    const sources = used.filter(i => snapped.get(i)!.id === id).sort((a, b) => usage[b]! - usage[a]! || a - b).map(i => paletteHex(file.palette, i));
    return { id, name: m.name, colour: m.colour, cells: n, sources };
  }).sort((a, b) => b.cells - a.cells || a.id - b.id);
  const effects = [...new Set(used.map(i => file.effects.get(i)).filter((e): e is VoxMaterialEffect => !!e))].sort();

  const blueprint: VoxelBlueprint = { version: 1, id: `vox-import:${model.index}:${scale * 4}`, styleId: options.styleId, kind: 'prop', lattice: 'build', size, boxes, windows: [] };
  if (!VoxelBlueprintSchema.safeParse(blueprint).success) voxFail('destination', 'This object could not become a building plan at this size.', 'Choose another size.');
  return { ok: true, blueprint, origin: [...options.origin] as unknown as Vec3, summary: {
    model: model.index, sourceSize: model.size, uprightSize: upright, size, scale, cells: total, boxes: boxes.length,
    reduced: divisor > 1 && total < count, materials, effects,
  } };
}

export function scaleName(scale: VoxScale): string { return scale === 0.25 ? '¼ size' : scale === 0.5 ? '½ size' : `${scale}×`; }

/** Deterministic greedy boxes in z, y, x order; coordinates multiplied by `factor` for enlargement. */
function coalesce(cells: Uint16Array, [sx, sy, sz]: Vec3, factor: number): VoxelBlueprint['boxes'] {
  const done = new Uint8Array(cells.length), boxes: VoxelBlueprint['boxes'] = [];
  const open = (i: number, m: number) => cells[i] === m && !done[i];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const start = x + sx * (y + sy * z), m = cells[start]!;
    if (!m || done[start]) continue;
    let x1 = x + 1;
    while (x1 < sx && open(start + x1 - x, m)) x1++;
    const row = (yy: number, zz: number) => { for (let xx = x; xx < x1; xx++) if (!open(xx + sx * (yy + sy * zz), m)) return false; return true; };
    let y1 = y + 1;
    while (y1 < sy && row(y1, z)) y1++;
    let z1 = z + 1;
    while (z1 < sz && (() => { for (let yy = y; yy < y1; yy++) if (!row(yy, z1)) return false; return true; })()) z1++;
    for (let zz = z; zz < z1; zz++) for (let yy = y; yy < y1; yy++) done.fill(1, x + sx * (yy + sy * zz), x1 + sx * (yy + sy * zz));
    boxes.push({ from: [x * factor, y * factor, z * factor], to: [x1 * factor, y1 * factor, z1 * factor], material: m });
  }
  return boxes;
}
