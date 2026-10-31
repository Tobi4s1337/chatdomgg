import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

/**
 * Water-place pieces: one strict `VoxelBlueprint` plus the honest local metadata a host needs to mount it.
 * Every coordinate is in local build cells (0.125 m) measured from the blueprint's (0,0,0) corner, which is the
 * land site's placement origin; static pieces turn only by whole quarter turns about that corner. Nothing here
 * carries a name, a position in the world or a person: the caller supplies those.
 */
export type CellBox = { readonly from: Vec3; readonly to: Vec3 };
export type Facing = 'north' | 'south' | 'east' | 'west';

/**
 * A continuous walking surface. `across` is the half-open lateral extent of the clear strip on the other
 * horizontal axis; `tops[i]` is the walking height (top of the occupied cell, in cells) over cell
 * `along[0] + i`. Adjacent tops never differ by more than one cell and the strip has head clearance above.
 */
export interface WalkStrip {
  readonly id: string;
  readonly axis: 'x' | 'z';
  readonly along: readonly [number, number];
  readonly across: readonly [number, number];
  readonly tops: readonly number[];
}

/** A sitting edge: the top face of `box` is the seat, and a sitter's legs hang towards `facing`. */
export interface SeatEdge { readonly id: string; readonly box: CellBox; readonly facing: Facing }

/** Where a physical lamp's glass sits. The host feeds it to the shared people-light result; it is never lit here. */
export interface EmitterAnchor { readonly id: string; readonly position: Vec3; readonly reach: number }

export type WaterSoundKind = 'wheel' | 'weir' | 'trough' | 'arch' | 'creak' | 'reeds';
/** A point for the host's audio mix. Content supplies the hook only; it never plays sound. */
export interface SoundAnchor { readonly id: string; readonly kind: WaterSoundKind; readonly position: Vec3 }

/**
 * A flat face reserved for caller text (a destination or place name) drawn through the host's approved text
 * treatment. `centre` lies on the face; `facing` is its outward normal; width/height are in cells.
 */
export interface TextPlane {
  readonly id: string;
  readonly centre: Vec3;
  readonly facing: Facing;
  readonly width: number;
  readonly height: number;
}

/**
 * A pivot for a moving or attached part. `position` is the exact pivot point in cells (it may sit on a cell
 * corner); `axis` is the unit rotation axis in local space.
 */
export interface MountPoint { readonly id: string; readonly position: Vec3; readonly axis: Vec3 }

export type ClearRole = 'arch-opening' | 'wheel-pit' | 'tailrace' | 'spillway' | 'headroom';
/** A volume that must stay air in the piece itself (the stream under an arch, the wheel's swing). */
export interface ClearVolume { readonly id: string; readonly role: ClearRole; readonly box: CellBox }

/** A footprint where the piece bears on its foundation at y = 0 (bed, bank or yard, per the land site). */
export interface Footing { readonly id: string; readonly box: CellBox }

export interface WaterPiece {
  readonly blueprint: VoxelBlueprint;
  readonly footings: readonly Footing[];
  readonly walks: readonly WalkStrip[];
  readonly seats: readonly SeatEdge[];
  readonly emitters: readonly EmitterAnchor[];
  readonly sounds: readonly SoundAnchor[];
  readonly texts: readonly TextPlane[];
  readonly mounts: readonly MountPoint[];
  readonly clear: readonly ClearVolume[];
}

export const NO_METADATA = {
  footings: [], walks: [], seats: [], emitters: [], sounds: [], texts: [], mounts: [], clear: [],
} as const satisfies Omit<WaterPiece, 'blueprint'>;

type Box = VoxelBlueprint['boxes'][number];

/** One part of a representative assembly: its boxes are shifted by `offset` cells after a quarter-turn yaw. */
export interface AssemblyPart { readonly blueprint: VoxelBlueprint; readonly offset: Vec3; readonly turn?: 0 | 1 | 2 | 3 }

/**
 * Rotates a half-open box by `turn` quarter turns about +Y inside a part of the given size, keeping it in the
 * part's positive octant. Turn 1 maps local +Z (front) to +X, matching `transformCardinalPoint`.
 */
export function turnBox(box: Box, size: Vec3, turn: 0 | 1 | 2 | 3): Box {
  const corners = [[box.from[0], box.from[2]], [box.to[0], box.to[2]]].map(([x, z]) => {
    let [u, v] = [x!, z!];
    let [w, d] = [size[0], size[2]];
    for (let i = 0; i < turn; i++) { [u, v] = [v, w - u]; [w, d] = [d, w]; }
    return [u, v] as const;
  });
  const [a, b] = corners as [readonly [number, number], readonly [number, number]];
  return {
    from: [Math.min(a[0], b[0]), box.from[1], Math.min(a[1], b[1])],
    to: [Math.max(a[0], b[0]), box.to[1], Math.max(a[1], b[1])],
    material: box.material,
  };
}

/** Size of a part after `turn` quarter turns. */
export const turnedSize = (size: Vec3, turn: 0 | 1 | 2 | 3): Vec3 => (turn % 2 ? [size[2], size[1], size[0]] : size);

/**
 * Joins real parts into one static review assembly. Parts are laid in order, so a later part's air boxes only
 * carve what that part itself declared; a part must not overlap another part's solids (tests check this).
 */
export function assemble(id: string, styleId: VoxelBlueprint['styleId'], kind: VoxelBlueprint['kind'], size: Vec3,
  parts: readonly AssemblyPart[]): VoxelBlueprint {
  const boxes: Box[] = [];
  for (const part of parts) {
    const turn = part.turn ?? 0;
    const turned = turnedSize(part.blueprint.size, turn);
    turned.forEach((extent, axis) => {
      if (part.offset[axis]! < 0 || part.offset[axis]! + extent > size[axis]!) {
        throw new Error(`${id}: part ${part.blueprint.id} leaves the ${size.join('×')} assembly on axis ${axis}.`);
      }
    });
    for (const box of part.blueprint.boxes) {
      const t = turnBox(box, part.blueprint.size, turn);
      boxes.push({ from: [...add(t.from, part.offset)], to: [...add(t.to, part.offset)], material: t.material });
    }
  }
  return { version: 1, id, styleId, kind, lattice: 'build', size: [...size], boxes, windows: [] };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
