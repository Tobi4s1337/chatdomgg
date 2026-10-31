import type { AvatarAttachmentId, AvatarPartBlueprint } from '@chatdom/shared';
import { AVATAR_PALETTE, MAT } from '../materials';
import { bodyContour, createBodyParts, headVolume, type BodyFamily, type Contour } from './body';
import { restPosition } from './rig';
import { Sculpt } from './sculpt';

/**
 * Garments are fitted to the actual body volume, not to a hand-copied table: every family's parts are
 * read back into root-local rest cells, and clothes are grown from them as offset shells. A new family
 * or a reshaped one is dressed without touching a garment.
 */
export interface BodyForm {
  readonly family: BodyFamily;
  readonly contour: Contour;
  /** One bone's body volume in root-local rest cells. */
  bone(id: AvatarAttachmentId): Sculpt;
  /** Pelvis and chest together. */
  readonly trunk: Sculpt;
  /** The skull plus ears, exactly as the head part is carved. */
  readonly head: Sculpt;
  /** Every body cell. */
  readonly all: Sculpt;
}

/** A garment's cells, grouped by the bone or socket each group rides. Root-local rest cells. */
export type Pieces = Partial<Record<AvatarAttachmentId, Sculpt>>;

/** Root-local rest cells of a compiled part: `(cell - pivot)` re-based onto the attachment's rest position. */
export function partCells(part: AvatarPartBlueprint): Sculpt {
  const out = new Sculpt();
  const rest = restPosition(part.attachment);
  for (const box of part.boxes) for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++) {
    out.set(x - part.pivot[0] + rest[0], y - part.pivot[1] + rest[1], z - part.pivot[2] + rest[2], box.material);
  }
  return out;
}

const forms = new Map<BodyFamily, BodyForm>();

export function bodyForm(family: BodyFamily): BodyForm {
  const known = forms.get(family);
  if (known) return known;
  const contour = bodyContour(family);
  const bones = new Map<AvatarAttachmentId, Sculpt>();
  for (const part of createBodyParts(family, AVATAR_PALETTE.skin[0])) bones.set(part.attachment, partCells(part));
  const union = (ids: readonly AvatarAttachmentId[]): Sculpt => {
    const out = new Sculpt();
    for (const id of ids) { const s = bones.get(id); if (s) out.merge(s); }
    return out;
  };
  const form: BodyForm = {
    family, contour,
    bone(id) { const s = bones.get(id); if (!s) throw new Error(`The ${family} body has no ${id} part.`); return s; },
    trunk: union(['pelvis', 'chest']),
    head: headVolume(MAT.skin1),
    all: union([...bones.keys()]),
  };
  forms.set(family, form);
  return form;
}

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

/** Cells of `source` passing a test, as a new workpiece. */
export function pick(source: Sculpt, test: (x: number, y: number, z: number, material: number) => boolean): Sculpt {
  const out = new Sculpt();
  source.forEachCell((x, y, z, m) => { if (test(x, y, z, m)) out.set(x, y, z, m); });
  return out;
}

/** Every cell of `source` recoloured. */
export function recolour(source: Sculpt, material: number): Sculpt {
  const out = new Sculpt();
  source.forEachCell((x, y, z) => { out.set(x, y, z, material); });
  return out;
}

/** An axis-aligned rectangle of cells in the XZ plane, half-open. */
export interface Footprint { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number }

/** Euclidean distance from a cell's centre to a footprint (zero inside). */
export function reach(rect: Footprint, x: number, z: number): number {
  const dx = Math.max(rect.x0 - (x + .5), x + .5 - rect.x1, 0), dz = Math.max(rect.z0 - (z + .5), z + .5 - rect.z1, 0);
  return Math.hypot(dx, dz);
}

type Limit = number | ((x: number, z: number) => number);

/**
 * Cells at Euclidean distance (inner, outer] from a footprint, on one row. Rounder than a Manhattan
 * shell, so hems and brims read as cloth rather than as a stepped diamond.
 */
export function ring(rect: Footprint, y: number, inner: Limit, outer: Limit, material: number, into = new Sculpt()): Sculpt {
  const at = (limit: Limit, x: number, z: number): number => typeof limit === 'number' ? limit : limit(x, z);
  for (let z = rect.z0 - 9; z < rect.z1 + 9; z++) for (let x = rect.x0 - 9; x < rect.x1 + 9; x++) {
    const d = reach(rect, x, z);
    if (d > at(inner, x, z) && d <= at(outer, x, z)) into.set(x, y, z, material);
  }
  return into;
}

/**
 * Removes garment cells that share a cell with the body and would show a face beside the body's own
 * face on the same plane. Such cells are kept only where they are buried (under a hanging arm, say),
 * so a raised arm still finds cloth beneath it but nothing ever flickers at rest.
 */
export function settle(garment: Sculpt, body: Sculpt): Sculpt {
  const doomed: [number, number, number][] = [];
  garment.forEachCell((x, y, z) => {
    if (!body.get(x, y, z)) return;
    if (NEIGHBOURS.some(([dx, dy, dz]) => !body.get(x + dx, y + dy, z + dz) && !garment.get(x + dx, y + dy, z + dz))) doomed.push([x, y, z]);
  });
  for (const [x, y, z] of doomed) garment.set(x, y, z, 0);
  return garment;
}

/** Where a group of garment cells rides: one bone or socket, or a rule per cell. */
export type BoneRule = AvatarAttachmentId | ((x: number, y: number, z: number) => AvatarAttachmentId);

/**
 * Turns groups of garment cells into pieces: the groups are united in order (a later group's colour wins
 * a shared cell), settled against the body, then split between bones by each group's rule.
 */
export function dress(form: BodyForm, groups: readonly (readonly [Sculpt, BoneRule])[]): Pieces {
  const union = new Sculpt();
  for (const [cells] of groups) union.merge(cells);
  settle(union, form.all);
  const pieces: Pieces = {};
  const seen = new Sculpt();
  for (const [cells, rule] of [...groups].reverse()) cells.forEachCell((x, y, z) => {
    const m = union.get(x, y, z);
    if (!m || seen.get(x, y, z)) return;
    seen.set(x, y, z, 1);
    (pieces[typeof rule === 'string' ? rule : rule(x, y, z)] ??= new Sculpt()).set(x, y, z, m);
  });
  return pieces;
}

/** Splits cells between bones by a rule; empty groups are dropped. */
export function assign(source: Sculpt, bone: (x: number, y: number, z: number) => AvatarAttachmentId, into: Pieces = {}): Pieces {
  source.forEachCell((x, y, z, m) => {
    const id = bone(x, y, z);
    (into[id] ??= new Sculpt()).set(x, y, z, m);
  });
  return into;
}

/** All cells of a set of pieces in one workpiece. */
export function flatten(pieces: Pieces): Sculpt {
  const out = new Sculpt();
  for (const s of Object.values(pieces)) if (s) out.merge(s);
  return out;
}

/** The z just past the frontmost occupied cell of column (x, y), or null. */
export function frontOf(s: Sculpt, x: number, y: number): number | null {
  for (let z = 16; z > -16; z--) if (s.get(x, y, z - 1)) return z;
  return null;
}

/** The lowest occupied z of column (x, y), or null. */
export function backOf(s: Sculpt, x: number, y: number): number | null {
  for (let z = -16; z < 16; z++) if (s.get(x, y, z)) return z;
  return null;
}

/** Left/right by the centre line: cells with x < 0 belong to the left side. */
export const side = (x: number): 'Left' | 'Right' => x < 0 ? 'Left' : 'Right';
