import {
  BuildDraftSnapshotSchema, BuildOperationSchema, VoxelBlueprintSchema, cellIndex,
  type BuildDraftPolicy, type BuildDraftSnapshot, type BuildOperation, type Vec3,
  type ContentWindow, type VoxelAsset, type VoxelBlueprint,
} from '@chatdom/shared';
import { blueprintFromCells, shapeBuildCells } from './shaping';

export type BuildErrorCode = 'bounds' | 'palette' | 'budget' | 'snapshot' | 'operation' | 'complexity' | 'support' | 'review';
export class BuildError extends Error {
  constructor(readonly code: BuildErrorCode, message: string) { super(message); this.name = 'BuildError'; }
}
export interface BuildChange { revision: number; changed: number; voxelCount: number }
interface Patch { indices: Uint32Array; before: Uint16Array; after: Uint16Array }
const MAX_HISTORY_CELLS = 1_048_576;
const MAX_HISTORY_STEPS = 64;

/** Private authored cells. Generated details never become edits, undo entries or saved source. */
export class BuildDraft {
  readonly policy: BuildDraftPolicy;
  private readonly cells: Uint16Array;
  private readonly palette: Set<number>;
  private undos: Patch[] = [];
  private redos: Patch[] = [];
  private version = 0;
  private occupied = 0;
  private gestureStart: number | null = null;

  constructor(policy: BuildDraftPolicy, saved?: unknown) {
    const { size, editableFrom: from, editableTo: to } = policy;
    if (size.some(n => !Number.isInteger(n) || n < 1 || n > 256)
      || size.reduce((n, axis) => n * axis, 1) > 1_310_720
      || from.some((n, i) => !Number.isInteger(n) || n < 0 || n >= to[i]!)
      || to.some((n, i) => !Number.isInteger(n) || n > size[i]!)
      || !Number.isInteger(policy.maxVoxels) || policy.maxVoxels < 1 || policy.maxVoxels > 196608) {
      throw new BuildError('bounds', 'This plot has invalid building limits.');
    }
    this.palette = new Set(policy.palette);
    const shapeMaterials = [...policy.shaping.wall, ...policy.shaping.roof, policy.shaping.trim, policy.shaping.stone, policy.shaping.glass];
    if (policy.palette.some(n => !Number.isInteger(n) || n < 1 || n > 65535)
      || shapeMaterials.some(n => !this.palette.has(n))) throw new BuildError('palette', 'This kingdom’s building palette is incomplete.');
    this.policy = Object.freeze({ ...policy, size: Object.freeze([...size]) as Vec3,
      editableFrom: Object.freeze([...from]) as Vec3, editableTo: Object.freeze([...to]) as Vec3,
      palette: Object.freeze([...policy.palette]), shaping: Object.freeze({ ...policy.shaping,
        wall: Object.freeze([...policy.shaping.wall]), roof: Object.freeze([...policy.shaping.roof]) }) });
    this.cells = new Uint16Array(size[0] * size[1] * size[2]);
    if (saved !== undefined) this.restore(saved);
  }

  get revision(): number { return this.version; }
  get voxelCount(): number { return this.occupied; }
  get canUndo(): boolean { return this.undos.length > 0; }
  get canRedo(): boolean { return this.redos.length > 0; }
  get(at: Vec3): number { this.checkPoint(at); return this.cells[this.index(at)]!; }
  cloneVoxels(): Uint16Array { return this.cells.slice(); }

  /** Optional browser stroke grouping. Cells and saves still advance on every accepted sample. */
  beginGesture(): void { this.endGesture(); this.gestureStart = this.undos.length; }
  endGesture(): void {
    const start = this.gestureStart; this.gestureStart = null;
    if (start === null || this.undos.length <= start + 1) return;
    const changes = new Map<number, { before: number; after: number }>();
    for (const patch of this.undos.splice(start)) for (let i = 0; i < patch.indices.length; i++) {
      const index = patch.indices[i]!, prior = changes.get(index);
      changes.set(index, { before: prior?.before ?? patch.before[i]!, after: patch.after[i]! });
    }
    const entries = [...changes].filter(([, value]) => value.before !== value.after);
    if (entries.length) this.undos.push({ indices: Uint32Array.from(entries.map(([i]) => i)),
      before: Uint16Array.from(entries.map(([, v]) => v.before)), after: Uint16Array.from(entries.map(([, v]) => v.after)) });
    this.trimHistory();
  }

  /** A whole pointer gesture, import or template is one atomic, undoable operation batch. */
  apply(input: BuildOperation | readonly BuildOperation[]): BuildChange {
    const operations = Array.isArray(input) ? input : [input];
    const pending = new Map<number, number>();
    const read = (i: number) => pending.get(i) ?? this.cells[i]!;
    const write = (x: number, y: number, z: number, material: number) => {
      this.checkPoint([x, y, z]);
      const index = cellIndex(x, y, z, this.policy.size[0], this.policy.size[1]);
      if (this.cells[index] === material) pending.delete(index); else pending.set(index, material);
    };
    for (const candidate of operations) {
      const parsed = BuildOperationSchema.safeParse(candidate);
      if (!parsed.success) throw new BuildError('operation', 'Choose whole blocks and a building tool.');
      const op = parsed.data;
      const material = op.kind === 'erase' ? 0 : op.material;
      if (material !== 0 && !this.palette.has(material)) throw new BuildError('palette', 'That material does not belong to this kingdom.');
      const transforms = this.mirrors(op.mirror);
      if (op.kind === 'fill') {
        this.checkPoint(op.at);
        // Each mirrored seed fills its own original component, including components touched by a previous seed.
        for (const transform of transforms) {
          const seed = transform(op.at), seedIndex = this.index(seed), target = read(seedIndex);
          this.checkPoint(seed);
          if (!target || target === material) continue;
          const queue = [seedIndex], visited = new Set<number>(queue);
          for (let q = 0; q < queue.length; q++) {
            const index = queue[q]!, [x, y, z] = this.coordinate(index);
            write(x, y, z, material);
            for (const next of [[x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1]] as Vec3[]) {
              if (!this.inside(next)) continue;
              const ni = this.index(next);
              if (!visited.has(ni) && read(ni) === target) { visited.add(ni); queue.push(ni); }
            }
          }
        }
      } else {
        this.checkBox(op.from, op.to);
        for (let z = op.from[2]; z < op.to[2]; z++) for (let y = op.from[1]; y < op.to[1]; y++) for (let x = op.from[0]; x < op.to[0]; x++) {
          for (const transform of transforms) {
            const [tx, ty, tz] = transform([x, y, z]);
            this.checkPoint([tx, ty, tz]);
            if (op.kind !== 'paint' || read(cellIndex(tx, ty, tz, this.policy.size[0], this.policy.size[1]))) write(tx, ty, tz, material);
          }
        }
      }
    }
    // Validate final changes before touching the source. A failed mirror/fill/import leaves everything intact.
    const indices: number[] = [], before: number[] = [], after: number[] = [];
    let count = this.occupied;
    for (const [index, material] of pending) {
      const prior = this.cells[index]!;
      if (prior === material) continue;
      if (!this.editable(this.coordinate(index))) throw new BuildError('bounds', 'Keep this build inside your unlocked plot.');
      count += Number(material !== 0) - Number(prior !== 0);
      indices.push(index); before.push(prior); after.push(material);
    }
    if (count > this.policy.maxVoxels) throw new BuildError('budget', 'Your home has reached its block allowance.');
    if (!indices.length) return this.change(0);
    const patch = { indices: Uint32Array.from(indices), before: Uint16Array.from(before), after: Uint16Array.from(after) };
    this.commit(patch, false);
    this.undos.push(patch); this.redos = [];
    if (this.gestureStart === null) this.trimHistory();
    return this.change(indices.length);
  }

  undo(): BuildChange {
    this.endGesture();
    const patch = this.undos.pop();
    if (!patch) return this.change(0);
    this.commit(patch, true); this.redos.push(patch); return this.change(patch.indices.length);
  }
  redo(): BuildChange {
    this.endGesture();
    const patch = this.redos.pop();
    if (!patch) return this.change(0);
    this.commit(patch, false); this.undos.push(patch); return this.change(patch.indices.length);
  }

  /** Replace this bounded region, including air. No automatic decoration is imported into the source. */
  insertBlueprint(input: VoxelBlueprint, origin: Vec3): BuildChange {
    const parsed = VoxelBlueprintSchema.safeParse(input);
    if (!parsed.success) throw new BuildError('operation', 'This house plan cannot be read.');
    const blueprint = parsed.data;
    if (blueprint.styleId !== this.policy.styleId) throw new BuildError('palette', 'Choose a plan from this kingdom’s style.');
    const offset = (point: Vec3): [number, number, number] => [point[0] + origin[0], point[1] + origin[1], point[2] + origin[2]];
    return this.apply([
      { kind: 'erase', from: [...origin], to: offset(blueprint.size) },
      ...blueprint.boxes.map(box => box.material === 0
        ? { kind: 'erase' as const, from: offset(box.from), to: offset(box.to) }
        : { kind: 'place' as const, from: offset(box.from), to: offset(box.to), material: box.material }),
    ]);
  }

  serialize(): BuildDraftSnapshot {
    const runs: BuildDraftSnapshot['runs'] = [];
    for (let i = 0; i < this.cells.length;) {
      const material = this.cells[i]!;
      if (!material) { i++; continue; }
      const start = i++;
      while (i < this.cells.length && this.cells[i] === material) i++;
      runs.push([start, i - start, material]);
    }
    return { version: 1, plotId: this.policy.plotId, ownerId: this.policy.ownerId, styleId: this.policy.styleId,
      size: [...this.policy.size], revision: this.version, runs };
  }

  toAsset(shaped = true): VoxelAsset {
    return { id: `build:${this.policy.plotId}`, revision: this.version, lattice: 'build', size: this.policy.size,
      voxels: shaped ? shapeBuildCells(this.cells, this.policy).cells : this.cloneVoxels() };
  }
  compile(): { asset: VoxelAsset; windows: ContentWindow[] } {
    const shaped = shapeBuildCells(this.cells, this.policy);
    return { asset: { id: `build:${this.policy.plotId}`, revision: this.version, lattice: 'build', size: this.policy.size, voxels: shaped.cells }, windows: shaped.windows };
  }
  toRawBlueprint(): VoxelBlueprint { return blueprintFromCells(this.cells, this.policy); }
  toBlueprint(): VoxelBlueprint {
    const shaped = shapeBuildCells(this.cells, this.policy);
    return blueprintFromCells(shaped.cells, this.policy, shaped.windows);
  }

  private restore(saved: unknown): void {
    const result = BuildDraftSnapshotSchema.safeParse(saved);
    if (!result.success) throw new BuildError('snapshot', 'Your saved house could not be read. Keep the original save.');
    const data = result.data, policy = this.policy;
    if (data.plotId !== policy.plotId || data.ownerId !== policy.ownerId || data.styleId !== policy.styleId
      || data.size.some((n, i) => n !== policy.size[i])) throw new BuildError('snapshot', 'That saved house belongs to another plot.');
    let previousEnd = 0, count = 0;
    for (const [start, length, material] of data.runs) {
      if (start < previousEnd || start + length > this.cells.length || !this.palette.has(material)) throw new BuildError('snapshot', 'Your saved house has invalid blocks. Keep the original save.');
      for (let i = start; i < start + length; i++) if (!this.editable(this.coordinate(i))) throw new BuildError('bounds', 'This saved house reaches outside the unlocked plot.');
      count += length;
      if (count > policy.maxVoxels) throw new BuildError('budget', 'This saved house exceeds your block allowance.');
      this.cells.fill(material, start, start + length); previousEnd = start + length;
    }
    this.occupied = count; this.version = data.revision;
  }
  private commit(patch: Patch, backwards: boolean): void {
    const values = backwards ? patch.before : patch.after;
    for (let i = 0; i < patch.indices.length; i++) {
      const at = patch.indices[i]!, next = values[i]!;
      this.occupied += Number(next !== 0) - Number(this.cells[at] !== 0); this.cells[at] = next;
    }
    this.version++;
  }
  private change(changed: number): BuildChange { return { revision: this.version, changed, voxelCount: this.occupied }; }
  private trimHistory(): void {
    let cells = this.undos.reduce((n, patch) => n + patch.indices.length, 0);
    while (this.undos.length > MAX_HISTORY_STEPS || (cells > MAX_HISTORY_CELLS && this.undos.length > 1)) cells -= this.undos.shift()!.indices.length;
  }
  private inside(at: Vec3): boolean { return at.every((n, i) => Number.isInteger(n) && n >= 0 && n < this.policy.size[i]!); }
  private editable(at: Vec3): boolean { return at.every((n, i) => n >= this.policy.editableFrom[i]! && n < this.policy.editableTo[i]!); }
  private checkPoint(at: Vec3): void { if (!this.inside(at)) throw new BuildError('bounds', 'Choose a block inside your plot.'); }
  private checkBox(from: Vec3, to: Vec3): void {
    this.checkPoint(from);
    if (to.some((n, i) => !Number.isInteger(n) || n <= from[i]! || n > this.policy.size[i]!)) throw new BuildError('bounds', 'Keep the brush inside your plot.');
  }
  private index(at: Vec3): number { return cellIndex(at[0], at[1], at[2], this.policy.size[0], this.policy.size[1]); }
  private coordinate(i: number): Vec3 {
    const [sx, sy] = this.policy.size;
    return [i % sx, Math.floor(i / sx) % sy, Math.floor(i / (sx * sy))];
  }
  private mirrors(mirror: BuildOperation['mirror']): ((at: Vec3) => Vec3)[] {
    const xSum = this.policy.editableFrom[0] + this.policy.editableTo[0] - 1;
    const zSum = this.policy.editableFrom[2] + this.policy.editableTo[2] - 1;
    const list: ((at: Vec3) => Vec3)[] = [at => at];
    if (mirror === 'x' || mirror === 'xz') list.push(([x, y, z]) => [xSum - x, y, z]);
    if (mirror === 'z' || mirror === 'xz') list.push(([x, y, z]) => [x, y, zSum - z]);
    if (mirror === 'xz') list.push(([x, y, z]) => [xSum - x, y, zSum - z]);
    return list;
  }
}
