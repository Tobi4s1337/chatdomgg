import { MAX_ASSET_PADDED_CELLS, VoxelBlueprintSchema, type StyleId, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { VOX_IMPORT_LIMITS, VoxFailure, voxFail, type VoxImportError } from './limits';
import { oklab, paletteHex } from './palette';
import type { VoxFile, VoxMaterialEffect, VoxModel } from './parse';

export const VOX_SCALES = [0.25, 0.5, 1, 2, 4] as const;
export type VoxScale = typeof VOX_SCALES[number];
/** The shared blueprint box cap; detail beyond it needs a smaller scale or a simpler model. */
const MAX_BOXES = 20_000;

/** An allowed, non-air kingdom material from the current draft policy. */
export interface VoxImportMaterial { readonly id: number; readonly name: string; readonly colour: string }

/** The draft policy's lattice, half-open editable box and block allowance. The draft core re-checks all of it at insertion. */
export interface VoxDestination {
  readonly size: Vec3;
  readonly editableFrom: Vec3;
  readonly editableTo: Vec3;
  readonly maxVoxels: number;
}

/** How far the replacement box reaches past each editable face, in build cells: [low, high] per axis. */
export interface VoxPlacement {
  readonly inside: boolean;
  readonly over: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
}

export interface VoxImportOptions {
  readonly file: VoxFile;
  /** Stored model index the builder chose. */
  readonly model: number;
  /** The draft policy's allowed materials, resolved through the registry. Never avatar colours. */
  readonly materials: readonly VoxImportMaterial[];
  readonly styleId: StyleId;
  readonly scale: VoxScale;
  /** Build-cell origin of the blueprint's minimum corner, inside the plot lattice. It may leave the editable box; `placement` says so. */
  readonly origin: Vec3;
  readonly destination: VoxDestination;
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
  /** Where the whole replacement box, air included, sits against the editable plot. */
  readonly placement: VoxPlacement;
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

  const { min, size: upright } = uprightBounds(model);
  const divisor = scale < 1 ? 1 / scale : 1, factor = scale > 1 ? scale : 1;
  const grid = voxScaledSize(upright, Math.min(scale, 1) as VoxScale), size = voxScaledSize(upright, scale) as [number, number, number];

  // Destination limits before any expansion or grid allocation: the editable box, not just the reserved lot.
  const limit = voxEditableSpan(destination);
  if (size.some((n, d) => n > limit[d]!)) {
    const fits = VOX_SCALES.filter(s => s < scale && voxScaledSize(upright, s).every((n, d) => n <= limit[d]!));
    voxFail('destination', `At ${scaleName(scale)} this object would measure ${size.join(' × ')} blocks; your plot builds up to ${limit.join(' × ')}.`,
      fits.length ? `Try ${scaleName(fits[fits.length - 1]!)}.` : 'Crop the object in MagicaVoxel and save again.');
  }
  const range = voxOriginRange(size, destination);
  if (!options.origin.every((n, d) => n >= range.min[d]! && n <= range.max[d]!)) voxFail('destination', 'Keep the object on your plot.', 'Use the position controls.');
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
    reduced: divisor > 1 && total < count, materials, effects, placement: placeVox(size, options.origin, destination),
  } };
}

/** Occupied source bounds stood upright: MagicaVoxel (x, y, z-up) to build (x, z, sizeY - 1 - y). */
function uprightBounds(model: VoxModel): { min: Vec3; size: Vec3 } {
  const { records, count } = model, sy = model.size[1];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const p = [records[i * 4]!, records[i * 4 + 2]!, sy - 1 - records[i * 4 + 1]!];
    for (let d = 0; d < 3; d++) { if (p[d]! < min[d]!) min[d] = p[d]!; if (p[d]! > max[d]!) max[d] = p[d]!; }
  }
  return { min: min as unknown as Vec3, size: [0, 1, 2].map(d => max[d]! - min[d]! + 1) as unknown as Vec3 };
}

/** The object's occupied size standing upright at 1×, before any scale. */
export function voxUprightSize(model: VoxModel): Vec3 { return model.count ? uprightBounds(model).size : [0, 0, 0]; }

/** Resulting build cells per axis: enlargement replicates, reduction groups by floor-divided coordinates. */
export function voxScaledSize(upright: Vec3, scale: VoxScale): Vec3 {
  return upright.map(n => scale < 1 ? Math.floor((n - 1) * scale) + 1 : n * scale) as unknown as Vec3;
}

/** The half-open editable box's extent, never beyond the source dimension cap. */
export function voxEditableSpan(destination: VoxDestination): Vec3 {
  return [0, 1, 2].map(d => Math.min(destination.editableTo[d]! - destination.editableFrom[d]!, VOX_IMPORT_LIMITS.dimension)) as unknown as Vec3;
}

/** Origins that keep the whole box inside the plot lattice. Leaving the editable box stays possible, and visible. */
export function voxOriginRange(size: Vec3, destination: VoxDestination): { min: Vec3; max: Vec3 } {
  return { min: [0, 0, 0], max: [0, 1, 2].map(d => Math.max(0, destination.size[d]! - size[d]!)) as unknown as Vec3 };
}

export function clampVoxOrigin(origin: Vec3, size: Vec3, destination: VoxDestination): Vec3 {
  const { min, max } = voxOriginRange(size, destination);
  return [0, 1, 2].map(d => Math.min(max[d]!, Math.max(min[d]!, Math.round(origin[d]!)))) as unknown as Vec3;
}

/** Centred across the plot, standing on its ground, at its street front (+Z). */
export function defaultVoxOrigin(size: Vec3, destination: VoxDestination): Vec3 {
  const { editableFrom: from, editableTo: to } = destination;
  return clampVoxOrigin([Math.floor((from[0] + to[0] - size[0]) / 2), from[1], Math.max(from[2], to[2] - size[2])], size, destination);
}

/** Keep the footprint centre and the base when the size changes, so resizing never throws the object across the plot. */
export function rescaleVoxOrigin(origin: Vec3, from: Vec3, to: Vec3, destination: VoxDestination): Vec3 {
  return clampVoxOrigin([origin[0] + Math.floor((from[0] - to[0]) / 2), origin[1], origin[2] + Math.floor((from[2] - to[2]) / 2)], to, destination);
}

export function placeVox(size: Vec3, origin: Vec3, destination: VoxDestination): VoxPlacement {
  const { editableFrom: from, editableTo: to } = destination;
  const over = [0, 1, 2].map(d => [Math.max(0, from[d]! - origin[d]!), Math.max(0, origin[d]! + size[d]! - to[d]!)] as const) as unknown as VoxPlacement['over'];
  return { inside: over.every(([low, high]) => !low && !high), over };
}

/** What a placement outside the editable plot means, and the control that fixes it. Null when it fits. */
export function voxPlacementError(placement: VoxPlacement, destination: VoxDestination): VoxImportError | null {
  if (placement.inside) return null;
  const [[left, right], [below, above], [back, front]] = placement.over, parts: string[] = [], fixes: string[] = [];
  const blocks = (n: number) => `${n.toLocaleString('en')} block${n === 1 ? '' : 's'}`;
  if (above) { parts.push(`${blocks(above)} above your ${destination.editableTo[1] - destination.editableFrom[1]}-block height`); fixes.push('lower it (Y)'); }
  if (below) { parts.push(`${blocks(below)} below the ground`); fixes.push('set it on the ground'); }
  if (back) { parts.push(`${blocks(back)} behind the back of your plot`); fixes.push('move it toward the street (Z)'); }
  if (front) { parts.push(`${blocks(front)} past the street front`); fixes.push('move it back (Z)'); }
  if (left || right) { parts.push(`${blocks(left || right)} past the side of your plot`); fixes.push('slide it across (X)'); }
  const listed = (words: string[]) => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  const fix = listed(fixes);
  return { code: 'placement', message: `It reaches ${listed(parts)}.`, remedy: `${fix[0]!.toUpperCase()}${fix.slice(1)}, or choose a smaller size.` };
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
