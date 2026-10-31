import type { AvatarPartBlueprint } from '@chatdom/shared';
import { compileAvatarPart } from '../avatars/compile';
import { restPosition } from '../avatars/rig';
import { Sculpt } from '../avatars/sculpt';
import type { AvatarStyle } from './styles';

/**
 * Hair is carried over, not redrawn. The wardrobe's own hair part is re-fitted onto a style's head by a
 * landmark map: inside the skull's box each axis is stretched piecewise between matching landmarks (jaw,
 * eye bottom, eye top and crown; the sides; back and face), and outside it the distance from the skull is
 * kept, scaled only by the style's `hairDepth`. A curl stays a curl of the same size, a fringe still stops
 * above the eyes, and nothing swells with the head, so every treatment keeps its identity without bloating.
 */

/** The wardrobe head's landmarks, root-local cells (see `avatars/hair.ts`). */
const WARDROBE_HEAD = { x: [-5, 5], y: [16, 19, 21, 24], z: [-4, 4] } as const;

type Axis = readonly number[];

function landmarks(style: AvatarStyle): { x: Axis; y: Axis; z: Axis } {
  const h = style.head;
  return { x: [h.x[0], h.x[1]], y: [h.y[0], h.eyeBottom, h.eyeTop, h.y[1]], z: [h.z[0], h.z[1]] };
}

/** Source coordinate for a target coordinate: piecewise linear inside, offset-preserving outside. */
function inverse(v: number, src: Axis, dst: Axis, depth: number): number {
  const n = dst.length - 1;
  if (v <= dst[0]!) return src[0]! - (dst[0]! - v) / depth;
  if (v >= dst[n]!) return src[n]! + (v - dst[n]!) / depth;
  let i = 0;
  while (v > dst[i + 1]!) i++;
  return src[i]! + (v - dst[i]!) * (src[i + 1]! - src[i]!) / (dst[i + 1]! - dst[i]!);
}

function forward(v: number, src: Axis, dst: Axis, depth: number): number {
  return inverse(v, dst, src, 1 / depth);
}

/** A part's cells in root-local rest cells under today's rig. */
export function partCells(part: AvatarPartBlueprint): Sculpt {
  const asset = compileAvatarPart(part, 0);
  const rest = restPosition(part.attachment);
  const [sx, sy] = asset.size;
  const out = new Sculpt();
  asset.voxels.forEach((m, i) => {
    if (!m) return;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    out.set(x - part.pivot[0] + rest[0], y - part.pivot[1] + rest[1], z - part.pivot[2] + rest[2], m);
  });
  return out;
}

/** Re-fit wardrobe hair cells (root-local, today's head) onto a style's head. */
export function retargetHair(source: Sculpt, style: AvatarStyle): Sculpt {
  const map = landmarks(style), depth = style.hairDepth;
  const axes = [[WARDROBE_HEAD.x, map.x], [WARDROBE_HEAD.y, map.y], [WARDROBE_HEAD.z, map.z]] as const;
  const { min, max } = source.bounds();
  const lo = axes.map(([s, d], i) => Math.floor(forward(min[i]!, s, d, depth)) - 1);
  const hi = axes.map(([s, d], i) => Math.ceil(forward(max[i]!, s, d, depth)) + 1);
  const out = new Sculpt();
  for (let z = lo[2]!; z < hi[2]!; z++) for (let y = lo[1]!; y < hi[1]!; y++) for (let x = lo[0]!; x < hi[0]!; x++) {
    const p = [x, y, z].map((v, i) => Math.floor(inverse(v + .5, axes[i]![0], axes[i]![1], depth)));
    const m = source.get(p[0]!, p[1]!, p[2]!);
    if (m) out.set(x, y, z, m);
  }
  return out;
}

/**
 * Re-cut hair into two-cell blocks aligned with a cube head, as a painted cube carries it: a block is
 * filled when at least half of it was hair, in the block's most common hair material.
 */
export function blockify(hair: Sculpt, style: AvatarStyle): Sculpt {
  const [ox, oy, oz] = [style.head.x[0], style.head.y[0], style.head.z[0]];
  const blocks = new Map<string, Map<number, number>>();
  hair.forEachCell((x, y, z, m) => {
    const k = [Math.floor((x - ox) / 2), Math.floor((y - oy) / 2), Math.floor((z - oz) / 2)].join(',');
    const tally = blocks.get(k) ?? new Map<number, number>();
    tally.set(m, (tally.get(m) ?? 0) + 1);
    blocks.set(k, tally);
  });
  const out = new Sculpt();
  for (const [k, tally] of blocks) {
    const count = [...tally.values()].reduce((a, b) => a + b, 0);
    if (count < 4) continue;
    const material = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    const [bx, by, bz] = k.split(',').map(Number) as [number, number, number];
    out.box([ox + bx * 2, oy + by * 2, oz + bz * 2], [ox + bx * 2 + 2, oy + by * 2 + 2, oz + bz * 2 + 2], material);
  }
  return out;
}

/** Never cover the eyes: clear hair in front of the face plate across the eye rows. */
function clearEyes(hair: Sculpt, style: AvatarStyle): Sculpt {
  const h = style.head;
  const left = Math.min(h.white, h.pupil[0]), right = -1 - left;
  return hair.carveWhere((x, y, z) => z >= h.z[1] - 1 && x >= left && x <= right && y >= h.eyeBottom && y < h.eyeTop);
}

/**
 * Hair for a style head: retargeted, block-cut where the style asks for it, kept off the skull and the
 * eyes, and tidied so no single-voxel confetti survives. `fitted` is the retargeted hair before any block
 * cut, which is what the scalp is painted from.
 */
export function styleHair(source: Sculpt, style: AvatarStyle, head: Sculpt): { hair: Sculpt; fitted: Sculpt } {
  const fitted = retargetHair(source, style);
  const hair = style.blockHair ? blockify(fitted, style) : new Sculpt().merge(fitted);
  hair.subtract(head);
  clearEyes(hair, style);
  return { hair: hair.tidy(2), fitted };
}

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const AROUND: readonly (readonly [number, number, number])[] = [-1, 0, 1].flatMap(x => [-1, 0, 1].flatMap(y => [-1, 0, 1].map(z => [x, y, z] as const))).filter(([x, y, z]) => x || y || z);

/**
 * Seal the seam between hair and skull. A bevelled head repaints a skull surface cell in the hair's colour
 * where two or more hair cells hold it, so a re-fitted shell never shows skin through a corner; cells at a
 * hairline (one hair neighbour) keep their skin. A block head is painted like a cube character's: every
 * skull cell the fitted hair touches (before its block cut) takes the hair colour, and the blocks stand
 * proud of that paint. The face plate below the brow is never repainted.
 */
export function sealScalp(head: Sculpt, hair: Sculpt, fitted: Sculpt, style: AvatarStyle, skin: number): void {
  const h = style.head;
  const repaint: [number, number, number, number][] = [];
  head.forEachCell((x, y, z, m) => {
    if (m !== skin) return;
    if (z >= h.z[1] - 1 && y < h.eyeTop) return;
    const touching = new Map<number, number>();
    const [source, around, need] = style.blockHair ? [fitted, AROUND, 1] : [hair, FACES, 2];
    for (const [dx, dy, dz] of around) {
      const n = source.get(x + dx, y + dy, z + dz);
      if (n && !head.get(x + dx, y + dy, z + dz)) touching.set(n, (touching.get(n) ?? 0) + 1);
    }
    const total = [...touching.values()].reduce((a, b) => a + b, 0);
    if (total >= need) repaint.push([x, y, z, [...touching].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]]);
  });
  for (const [x, y, z, m] of repaint) head.set(x, y, z, m);
}
