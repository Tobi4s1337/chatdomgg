import type { Vec3 } from '@chatdom/shared';
import { naturalLandHeight } from '../../kingdom-land/surface';
import type { KingdomLandform } from '../../kingdom-land/types';
import type { XZ } from '../../settlement/types';
import { bearingOf, CELL, cellToWorld, directionToWorld, rectangleToWorld, type CardinalFrame } from './frame';

/**
 * Structural mirror of the honest local metadata the content pieces publish (content's `WaterPiece`), in build
 * cells from the blueprint's (0,0,0) corner. World never imports content: the host passes the pieces it built and
 * TypeScript checks the shapes agree. Nothing here carries a person or a name.
 */
export type PieceFacing = 'north' | 'south' | 'east' | 'west';
export interface PieceCellBox { readonly from: Vec3; readonly to: Vec3 }
export interface PieceMeta {
  readonly blueprint: { readonly size: Vec3 };
  readonly footings: readonly { readonly id: string; readonly box: PieceCellBox }[];
  readonly walks: readonly {
    readonly id: string; readonly axis: 'x' | 'z'; readonly along: readonly [number, number];
    readonly across: readonly [number, number]; readonly tops: readonly number[];
  }[];
  readonly seats: readonly { readonly id: string; readonly box: PieceCellBox; readonly facing: PieceFacing }[];
  /** `reach` is in cells, like every other piece coordinate. */
  readonly emitters: readonly { readonly id: string; readonly position: Vec3; readonly reach: number }[];
  readonly sounds: readonly { readonly id: string; readonly kind: string; readonly position: Vec3 }[];
  readonly texts: readonly { readonly id: string; readonly centre: Vec3; readonly facing: PieceFacing; readonly width: number; readonly height: number }[];
  readonly mounts: readonly { readonly id: string; readonly position: Vec3; readonly axis: Vec3 }[];
}

/** A walking surface in world metres: its centreline over every cell column, and its clear width. */
export interface PlacedWalk { readonly id: string; readonly points: readonly Vec3[]; readonly ends: readonly [Vec3, Vec3]; readonly width: number }
/** A seat's top face (world AABB, y = seat height) and the bearing a sitter faces (legs hang that way). */
export interface PlacedSeat { readonly id: string; readonly min: Vec3; readonly max: Vec3; readonly facing: number }
/** A lamp's glass for the shared people-light result and the field's emitter list; never a light of its own. */
export interface PlacedEmitter { readonly id: string; readonly position: Vec3; readonly reach: number }
export interface PlacedSound { readonly id: string; readonly kind: string; readonly position: Vec3 }
/** A face reserved for caller text: centre on the face, outward normal, size in metres. */
export interface PlacedText { readonly id: string; readonly centre: Vec3; readonly normal: Vec3; readonly width: number; readonly height: number }
export interface PlacedMount { readonly id: string; readonly pivot: Vec3; readonly axis: Vec3 }
/** Where a piece bears on its foundation: plan outline and the bearing height, world metres. */
export interface PlacedFooting { readonly id: string; readonly outline: readonly XZ[]; readonly base: number }

export interface PlacedAnchors {
  readonly walks: readonly PlacedWalk[];
  readonly seats: readonly PlacedSeat[];
  readonly emitters: readonly PlacedEmitter[];
  readonly sounds: readonly PlacedSound[];
  readonly texts: readonly PlacedText[];
  readonly mounts: readonly PlacedMount[];
  readonly footings: readonly PlacedFooting[];
}

const FACING: Readonly<Record<PieceFacing, Vec3>> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };

/** Every local anchor of a piece, carried into the world by its static frame. */
export function placePieceAnchors(frame: CardinalFrame, piece: PieceMeta): PlacedAnchors {
  const at = (cell: Vec3) => cellToWorld(frame, cell);
  const walks = piece.walks.map(walk => {
    const mid = (walk.across[0] + walk.across[1]) / 2;
    const local = (along: number, top: number): Vec3 => walk.axis === 'x' ? [along, top, mid] : [mid, top, along];
    const points = walk.tops.map((top, i) => at(local(walk.along[0] + i + .5, top)));
    return { id: walk.id, points, ends: [at(local(walk.along[0], walk.tops[0]!)), at(local(walk.along[1], walk.tops.at(-1)!))] as const,
      width: (walk.across[1] - walk.across[0]) * CELL };
  });
  const seats = piece.seats.map(seat => {
    const a = at([seat.box.from[0], seat.box.to[1], seat.box.from[2]]), b = at([seat.box.to[0], seat.box.to[1], seat.box.to[2]]);
    return { id: seat.id, min: [Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2])] as Vec3, max: [Math.max(a[0], b[0]), a[1], Math.max(a[2], b[2])] as Vec3,
      facing: bearingOf(directionToWorld(frame.turn, FACING[seat.facing])) };
  });
  const footings = piece.footings.map(footing => ({ id: footing.id, base: frame.origin[1] + footing.box.from[1] * CELL,
    outline: rectangleToWorld(frame, [footing.box.from[0] * CELL, footing.box.from[2] * CELL], [footing.box.to[0] * CELL, footing.box.to[2] * CELL]) }));
  return {
    walks, seats, footings,
    emitters: piece.emitters.map(e => ({ id: e.id, position: at(e.position), reach: e.reach * CELL })),
    sounds: piece.sounds.map(s => ({ id: s.id, kind: s.kind, position: at(s.position) })),
    texts: piece.texts.map(t => ({ id: t.id, centre: at(t.centre), normal: directionToWorld(frame.turn, FACING[t.facing]), width: t.width * CELL, height: t.height * CELL })),
    mounts: piece.mounts.map(m => ({ id: m.id, pivot: at(m.position), axis: directionToWorld(frame.turn, m.axis) })),
  };
}

/** A footing whose bearing stands more than this above the sampled ground is floating. */
export const FOOTING_FLOAT = CELL;

/**
 * Footings that do not reach the land's real surface (bed under water, ground on land), sampled at the outline's
 * corners and centre. Returns how far each floating footing stands above its lowest sample.
 */
export function floatingFootings(landform: KingdomLandform, anchors: PlacedAnchors): { id: string; gap: number }[] {
  const out: { id: string; gap: number }[] = [];
  for (const footing of anchors.footings) {
    const xs = footing.outline.map(p => p[0]), zs = footing.outline.map(p => p[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cz = zs.reduce((a, b) => a + b, 0) / zs.length;
    // Corners pulled a little inside, so a footing on a bank is not judged by the water beside it.
    const samples = footing.outline.map(([x, z]) => naturalLandHeight(landform, x + (cx - x) * .1, z + (cz - z) * .1));
    samples.push(naturalLandHeight(landform, cx, cz));
    const gap = footing.base - Math.min(...samples);
    if (gap > FOOTING_FLOAT) out.push({ id: footing.id, gap });
  }
  return out;
}
