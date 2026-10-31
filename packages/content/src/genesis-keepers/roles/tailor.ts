import type { AvatarAttachmentId, AvatarPartBlueprint, Vec3 } from '@chatdom/shared';
import { MAT } from '../../materials';
import { bodyContour, createBodyParts, restPosition, type BodyFamily, type Contour } from '../../avatars/index';
import { Sculpt } from '../../avatars/sculpt';
import type { KeeperTool } from '../types';

/**
 * Shared tailoring for keeper costumes. Everything is authored in root-local rest cells (+Y up, +Z forward, left −X),
 * the frame `Sculpt.toPart` re-bases to each attachment. Garments are layers outside the body: built from offsets of the
 * body's own cells, minus every body cell, so layers meet face to face and never share a coplanar face.
 */
export interface BodyCells {
  readonly family: BodyFamily;
  readonly contour: Contour;
  /** Each body part's cells by its attachment. */
  readonly bones: ReadonlyMap<AvatarAttachmentId, Sculpt>;
  /** Every body cell, for subtracting from layers. */
  readonly all: Sculpt;
}

/** A part's cells back in root-local rest cells, the frame every costume is authored in. */
export function partToSculpt(part: AvatarPartBlueprint): Sculpt {
  const rest = restPosition(part.attachment);
  const offset = [rest[0] - part.pivot[0], rest[1] - part.pivot[1], rest[2] - part.pivot[2]] as const;
  const out = new Sculpt();
  for (const box of part.boxes) {
    for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++) {
      out.set(x + offset[0], y + offset[1], z + offset[2], box.material);
    }
  }
  return out;
}

const cache = new Map<BodyFamily, BodyCells>();

export function bodyCells(family: BodyFamily): BodyCells {
  const known = cache.get(family);
  if (known) return known;
  const bones = new Map<AvatarAttachmentId, Sculpt>();
  const all = new Sculpt();
  for (const part of createBodyParts(family, MAT.skin1)) {
    const cells = partToSculpt(part);
    bones.set(part.attachment, cells);
    all.merge(cells);
  }
  const made = { family, contour: bodyContour(family), bones, all };
  cache.set(family, made);
  return made;
}

/**
 * A layer `distance` cells out from the named bones' surface (Manhattan offset), minus every body cell, kept only where
 * `where` passes. The result is unpainted cells in `material`.
 */
export function layer(body: BodyCells, bones: readonly AvatarAttachmentId[], distance: number, material: number, where: (x: number, y: number, z: number) => boolean): Sculpt {
  const base = new Sculpt();
  for (const bone of bones) {
    const cells = body.bones.get(bone);
    if (!cells) throw new Error(`The ${body.family} body has no ${bone}.`);
    base.merge(cells);
  }
  const out = new Sculpt();
  base.shell(distance, material).forEachCell((x, y, z, m) => { if (!body.all.get(x, y, z) && where(x, y, z)) out.set(x, y, z, m); });
  return out;
}

/** The body's frontmost occupied z (exclusive face) on row y over |x| ≤ span; −Infinity when the row is empty. */
export function frontAt(body: BodyCells, y: number, xFrom: number, xTo: number): number {
  let front = -Infinity;
  body.all.forEachCell((x, cy, z) => { if (cy === y && x >= xFrom && x < xTo) front = Math.max(front, z + 1); });
  return front;
}

/** The body's backmost occupied z (inclusive) on row y over [xFrom, xTo). */
export function backAt(body: BodyCells, y: number, xFrom: number, xTo: number): number {
  let back = Infinity;
  body.all.forEachCell((x, cy, z) => { if (cy === y && x >= xFrom && x < xTo) back = Math.min(back, z); });
  return back;
}

/** The right hand's cells' centre (x, y, z) in rest cells; the left is its mirror (−1 − x). */
export function handCentre(body: BodyCells, side: 'Left' | 'Right'): Vec3 {
  const hand = body.bones.get(`hand${side}`)!;
  const { min, max } = hand.bounds();
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/**
 * A tool from sculpts per grip, with named points in root-local rest cells. `id` is the short name acts use; `partId`
 * prefixes the parts, and must carry everything the geometry depends on (role, kit, body) so equal ids mean equal bytes.
 */
export function tool(id: string, partId: string, held: readonly { readonly sculpt: Sculpt; readonly grip: AvatarAttachmentId }[], points: KeeperTool['points']): KeeperTool {
  const parts: AvatarPartBlueprint[] = held.map((h, i) => h.sculpt.toPart(`${partId}.${i}`, h.grip, 'accessory'));
  return { id, parts, points };
}

/** A copy reflected across x = 0 (cell x maps to −1 − x). */
export function mirror(source: Sculpt): Sculpt {
  const out = new Sculpt();
  source.forEachCell((x, y, z, m) => { out.set(-1 - x, y, z, m); });
  return out;
}
