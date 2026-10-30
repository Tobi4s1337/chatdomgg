import type { AvatarPartBlueprint } from '@chatdom/shared';
import { BODY_FAMILIES, bodyContour, headVolume, type BodyFamily } from './body';
import { GARB, materialName, resolveHair, type HairSwatchId } from './palette';
import { Sculpt } from './sculpt';
import type { HeadwearId } from './wearables';

/**
 * Scalp and hair treatments, in catalogue order. Every one binds rigidly to the frozen head bone and is
 * built around the one shared head, so a treatment fits every body family; only the long braid reads
 * the body, to hang clear of its back. The swatch is a separate choice, never a reward.
 */
export const HAIR_FORMS = ['bareScalp', 'closeCrop', 'roundedCurls', 'coiledHighCrown', 'sidePart', 'bob', 'longBraid', 'pairedTwists'] as const;
export type HairForm = (typeof HAIR_FORMS)[number];

/** Lane-local selection: the body, a registered hair swatch, and the headwear the hair must fit under. */
export interface HairFit {
  readonly body: BodyFamily;
  readonly hair: HairSwatchId;
  readonly headwear: HeadwearId | null;
}

/*
 * The head occupies x ∈ [−5, 5), y ∈ [16, 24), z ∈ [−4, 4); its face plate is the z = 3 row, eyes on
 * rows 19–20 and the mouth on row 17. Every treatment keeps rows 17–21 of the face plate clear.
 */

/** Where a layer around the head may grow: above the forehead, beside the face and down the back. */
interface Hairline {
  /** Lowest row over the forehead (cells in front of z = 2). */
  readonly forehead: number;
  /** Lowest row beside the face (beyond the head's sides, from z = 0 forward). */
  readonly temple: number;
  /** Lowest row behind the ears (z < 0). */
  readonly nape: number;
}

const inside = (x: number): boolean => x >= -5 && x < 5;

function withinHairline(line: Hairline): (x: number, y: number, z: number) => boolean {
  return (x, y, z) => {
    if (z >= 2 && inside(x)) return y >= line.forehead;
    if (z >= 0) return y >= (inside(x) ? line.forehead : line.temple);
    return y >= line.nape;
  };
}

/** A layer `distance` cells deep around the head, trimmed to a hairline, never touching the face plate. */
function layer(head: Sculpt, distance: number, material: number, line: Hairline): Sculpt {
  const keep = withinHairline(line);
  const out = new Sculpt().merge(head.grow(distance, material), keep);
  return out;
}

/** Clear anything that would sit over the eyes, cheeks or mouth. */
function clearFace(hair: Sculpt, below = 22): Sculpt {
  return hair.carveWhere((x, y, z) => z >= 3 && inside(x) && y < below);
}

/** Brows in the hair colour, a cell proud of the face plate above each eye: only for treatments with an open forehead. */
function brows(hair: Sculpt, material: number): void {
  hair.box([-3, 22, 4], [-1, 23, 5], material).box([1, 22, 4], [3, 23, 5], material);
}

/**
 * Bare scalp: the head's own rounded crown carries the shape, so the treatment is only a pair of brows
 * in the chosen swatch, which keeps the face as expressive as any other.
 */
function bareScalp(material: number): Sculpt {
  const hair = new Sculpt();
  brows(hair, material);
  return hair;
}

/**
 * Close crop: one cell over the skull with a crisp square hairline at the temples, short sideburns in
 * front of the ears and a nape that tapers up behind. Brows match.
 */
function closeCrop(material: number, head: Sculpt): Sculpt {
  const hair = layer(head, 1, material, { forehead: 23, temple: 19, nape: 18 });
  // Taper the back corners up toward the crown, as a fade would.
  hair.carveWhere((x, y, z) => z <= -4 && y < 19 && (x < -3 || x >= 3));
  // Sideburns stop in front of the ear line.
  hair.carveWhere((x, y, z) => !inside(x) && y < 21 && z >= -1 && z < 0);
  brows(hair, material);
  return hair;
}

/**
 * Lobes of a textured mass: rounded clumps about three cells across, spread evenly over a surface. Centres
 * are picked greedily in a fixed order on the left half, at least `spacing` apart, then mirrored, so the
 * mass is balanced and deterministic and every clump is big enough to survive the street camera.
 */
function lobes(surface: Sculpt, material: number, radius: number, spacing: number, where: (x: number, y: number, z: number) => boolean): Sculpt {
  const centres: [number, number, number][] = [];
  const candidates: [number, number, number][] = [];
  surface.forEachCell((x, y, z) => { if (x < 0 && where(x, y, z)) candidates.push([x + 1, y + .5, z + .5]); });
  // Top down, centre outward: the crown's outline is settled first, with a clump on the centre line.
  candidates.sort((a, b) => b[1] - a[1] || b[0] - a[0] || a[2] - b[2]);
  for (const c of candidates) if (centres.every(d => (c[0] - d[0]) ** 2 + (c[1] - d[1]) ** 2 + (c[2] - d[2]) ** 2 >= spacing * spacing)) centres.push(c);
  const out = new Sculpt();
  for (const [x, y, z] of centres) out.ellipsoid([x - .5, y, z], [radius, radius, radius], material);
  return out.carveWhere(x => x >= 0).mirrorX();
}

/** Cells between two distances from the head: the surface a textured mass's clumps sit on. */
function band(head: Sculpt, from: number, to: number, material: number): Sculpt {
  return new Sculpt().merge(head.grow(to, material)).subtract(head.grow(from, material)).subtract(head);
}

/**
 * Rounded curls: a full, round mass two and a half cells off the skull, over the ears and down to the
 * nape, its surface built from clumps four cells across so the outline is soft and bumpy at street distance rather than flecked.
 */
function roundedCurls(material: number, head: Sculpt): Sculpt {
  const line: Hairline = { forehead: 22, temple: 18, nape: 17 };
  const keep = withinHairline(line);
  // A deep body under the clumps, so the seams between them are shallow creases rather than pinholes.
  const hair = layer(head, 2.5, material, line);
  hair.merge(lobes(band(head, 2, 3, material), material, 2.1, 3.6, keep), (x, y, z) => keep(x, y, z) && y >= line.nape);
  clearFace(hair, 22);
  return hair.subtract(head).tidy(2);
}

/**
 * Coiled high crown: close sides and nape, and a tall rounded crown of coils above the head, its outline
 * broken into clumps so it reads as coiled hair rather than a hat.
 */
function coiledHighCrown(material: number, head: Sculpt): Sculpt {
  const hair = layer(head, 1, material, { forehead: 23, temple: 19, nape: 18 });
  const crown = new Sculpt().ellipsoid([0, 25.5, -1], [5.5, 3.4, 5], material);
  crown.carveWhere((_x, y) => y < 24);
  hair.merge(crown);
  hair.merge(lobes(crown.shell(1, material).subtract(head), material, 1.6, 3.2, (_x, y) => y >= 25));
  clearFace(hair, 23);
  return hair.subtract(head).tidy(2);
}

/**
 * Side part. Built from offset layers of the skull, so it follows the head exactly: one cell close on
 * the parted (left) side, two cells of lift over the crown and the full right side, a rounded
 * occipital mass and a tidy nape. The fringe is one sheet whose lower edge steps down diagonally
 * from the parting to the right temple, where a short lock falls past the ear.
 */
function sidePart(material: number, head: Sculpt): Sculpt {
  const near = head.shell(1, material), far = head.grow(2, material);
  const hair = new Sculpt();
  hair.merge(near, (_x, y) => y >= 18);
  hair.merge(far, (x, y, z) => (y >= 23 && x >= -2) || (x >= 3 && y >= 19 && z < 3) || (z <= -4 && y >= 19 && y < 25));
  // Fringe line: high at the parting, falling two cells at a time toward the right temple.
  const fringe = (x: number): number => x < -4 ? 21 : x < -2 ? 23 : x < 0 ? 22 : x < 4 ? 21 : 19;
  hair.carveWhere((x, y, z) => {
    if (z >= 3 && x >= -6 && x < 4 && y < fringe(x)) return true;
    // The parted side lies close above the ear and tapers to the nape.
    if (x < -5 && z >= 1 && y < 21) return true;
    if (x < -5 && y < 19) return true;
    if (x >= 5 && z >= -2 && z < 1 && y < 20) return true;
    if (z <= -5 && y < 19 && (x < -3 || x >= 3)) return true;
    return false;
  });
  // The right temple lock: a short fall of hair in front of the ear.
  hair.box([4, 18, 2], [6, 21, 4], material);
  hair.set(4, 18, 3, 0);
  // Parting: a notch where the close side meets the lift.
  for (let z = -1; z < 4; z++) hair.set(-2, 24, z, 0);
  return hair.subtract(head).tidy(2);
}

/**
 * Bob: a rounded bell of hair two cells deep that falls to the jaw at the sides and the nape behind,
 * its lower edge turned under, with a straight fringe that stops a row above the eyes.
 */
function bob(material: number, head: Sculpt): Sculpt {
  const hair = layer(head, 2, material, { forehead: 21, temple: 17, nape: 16 });
  // The bell frames the face: nothing in front of the cheeks, and the fringe only across the brow.
  hair.carveWhere((x, y, z) => z >= 4 && y < 21);
  hair.carveWhere((x, y, z) => z >= 4 && !inside(x) && y < 23);
  // Turn the lowest row under: it keeps only the cells close to the head.
  const close = head.grow(1.5, material);
  hair.carveWhere((x, y, z) => y === (z < 0 ? 16 : 17) && !close.get(x, y, z));
  clearFace(hair, 21);
  return hair.subtract(head).tidy(2);
}

/**
 * Long braid: hair drawn back close over the crown into a knot at the nape, then a three-strand plait
 * that hangs down the spine to the waist, tied off in leather with a short tuft. The plait keeps a cell
 * of air behind the deepest point of the wearer's back, so it never sinks into the shoulders.
 */
function longBraid(material: number, head: Sculpt, body: BodyFamily): Sculpt {
  const c = bodyContour(body);
  const hair = layer(head, 1, material, { forehead: 22, temple: 19, nape: 17 });
  hair.merge(head.grow(1.6, material), (_x, y, z) => y >= 23 && z < 3);
  const back = Math.min(-4, c.chest.back - 1, c.waist.back - 1);
  const z0 = back - 2;
  // The knot where the hair gathers, bridging the skull to the plait.
  hair.ellipsoid([0, 18.5, -5], [2.2, 2, 1.8], material);
  hair.box([-1, 16, z0], [1, 18, back], material);
  // Plait: two-row crossings that alternate sides, so the strands read as woven at a distance.
  for (let i = 0; i < 3; i++) {
    const top = 16 - 2 * i;
    hair.box([-1, top - 2, z0], [1, top, back], material);
    const side = i % 2 === 0 ? -2 : 1;
    hair.box([side, top - 1, z0], [side + 1, top, back], material);
  }
  // Leather tie at the waist, then the tuft that flares below it, ending above the seat.
  hair.box([-1, 9, z0], [1, 10, back], GARB.leather);
  hair.box([-1, 7, z0], [1, 9, back], material).box([-2, 7, z0], [2, 8, back], material);
  clearFace(hair, 22);
  return hair.subtract(head);
}

/**
 * A two-strand twist hanging from a root: a two-by-two rope that stays in its column, every other
 * two-row turn standing a cell further out (`out` is the unit step away from the head), so the rope
 * reads as twisted in profile while the grooves between neighbours stay clean. Neighbours start on
 * opposite turns (`phase`), so the bulges interleave instead of lining up in bands. The tip is rounded.
 */
function twist(hair: Sculpt, material: number, root: readonly [number, number, number], length: number, out: readonly [number, number, number], phase = 0): void {
  const [x, y, z] = root;
  const bottom = y - length;
  for (let i = 0; i * 2 < length; i++) {
    const step = (i + phase) % 2;
    const top = y - 2 * i, low = Math.max(bottom, top - 2);
    const [dx, dy, dz] = [out[0] * step, out[1] * step, out[2] * step];
    hair.box([x + dx, low + dy, z + dz], [x + dx + 2, top + dy, z + dz + 2], material);
  }
  // Round the tip: the outer half of the last row tucks in.
  const last = (Math.ceil(length / 2) - 1 + phase) % 2;
  const [lx, lz] = [x + out[0] * last, z + out[2] * last];
  if (out[0]) { const cx = out[0] < 0 ? lx : lx + 1; hair.box([cx, bottom, lz], [cx + 1, bottom + 1, lz + 2], 0); }
  if (out[2]) { const cz = out[2] < 0 ? lz : lz + 1; hair.box([lx, bottom, cz], [lx + 2, bottom + 1, cz + 1], 0); }
}

/**
 * Paired twists: a rounded crown of two-strand twists that hang to the jaw around the sides and back,
 * with short ones framing the forehead. Each twist is a two-by-two rope in its own column with a groove
 * beside it, the same chunk size everywhere, so the head reads as many ropes rather than noise.
 */
function pairedTwists(material: number, head: Sculpt): Sculpt {
  const line: Hairline = { forehead: 22, temple: 19, nape: 17 };
  const hair = layer(head, 1, material, line);
  const keep = withinHairline(line);
  const dome = new Sculpt().merge(head.grow(2.4, material), (x, y, z) => y >= 23 && keep(x, y, z));
  hair.merge(dome);
  // Rope ends over the crown: rounded tips that break the dome's outline.
  hair.merge(lobes(band(head, 2, 3, material), material, 1.3, 3, (_x, y) => y >= 25));
  // Five ropes down the back to the nape, a groove between each, mirrored about the centre line.
  [-7, -4, -1, 2, 5].forEach((x, i) => twist(hair, material, [x, 24, -7], 9, [0, 0, -1], i % 2));
  [-4, -1].forEach((z, i) => {
    twist(hair, material, [-8, 24, z], 7, [-1, 0, 0], 1 - i);
    twist(hair, material, [6, 24, z], 7, [1, 0, 0], 1 - i);
  });
  // Short twists framing the face, stopping above the cheek; three over the brow.
  twist(hair, material, [-8, 24, 2], 5, [-1, 0, 0]);
  twist(hair, material, [6, 24, 2], 5, [1, 0, 0]);
  for (const x of [-4, -1, 2]) twist(hair, material, [x, 26, 4], 3, [0, 0, 1]);
  clearFace(hair, 22);
  hair.carveWhere((x, y, z) => z >= 2 && !inside(x) && y < 19);
  return hair.subtract(head).tidy(2);
}

const FORMS: Record<HairForm, (material: number, head: Sculpt, body: BodyFamily) => Sculpt> = {
  bareScalp: material => bareScalp(material),
  closeCrop,
  roundedCurls,
  coiledHighCrown,
  sidePart,
  bob,
  longBraid,
  pairedTwists,
};

export function createHairParts(form: HairForm, fit: HairFit): readonly AvatarPartBlueprint[] {
  const build = Object.hasOwn(FORMS, form) ? FORMS[form] : undefined;
  if (!build) throw new Error(`Unknown hair form ${String(form)}.`);
  if (!BODY_FAMILIES.includes(fit.body)) throw new Error(`Unknown body family ${String(fit.body)}.`);
  if (fit.headwear !== null) throw new Error(`${form} has no authored fit under ${String(fit.headwear)}.`);
  const swatch = resolveHair(fit.hair);
  const hair = build(swatch, headVolume(swatch), fit.body);
  // Only the braid depends on the body; the others share one ID across families.
  const tag = form === 'longBraid' ? `${materialName(swatch)}.${fit.body}` : materialName(swatch);
  return [hair.toPart(`hair.${form}.${tag}`, 'head', 'hair')];
}
