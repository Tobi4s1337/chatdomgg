/**
 * Shield geometry in shield units: the shield is 1 wide and SHIELD_ASPECT tall, top-left at (0, 0), y down.
 * Everything here is plain math so the same shapes can feed Canvas2D, Pixi hit areas or an SVG export.
 */
import { polygon, type PathCommand, type PathPiece, type Point } from './path';
import type { FieldPattern, PartitionLine, ShieldDesign } from './design';

/** Height over width of the heater shield. */
export const SHIELD_ASPECT = 1.18;

/** The fess point: the visual centre of a heater, a little above half its height. */
export const FESS_Y = 0.5;

/** Where the straight sides start to curve in towards the point. */
const SIDE_Y = 0.44;

/** The heater outline, inset by `inset` shield units (0 for the shield itself). */
export function shieldOutline(inset = 0): PathCommand[] {
  const l = inset, r = 1 - inset, t = inset;
  const side = SIDE_Y;
  const tip = SHIELD_ASPECT - inset * 1.6;
  // The flanks bow out a little below the side line before sweeping into the point.
  const cx = 1 - inset * 1.05;
  return [
    ['M', l, t], ['L', r, t], ['L', r, side],
    ['C', cx, 0.8 - inset * 0.2, 0.8 - inset * 0.6, 1.02 - inset * 0.9, 0.5, tip],
    ['C', 0.2 + inset * 0.6, 1.02 - inset * 0.9, 1 - cx, 0.8 - inset * 0.2, l, side],
    ['Z'],
  ];
}

/** The outline as a flat polygon [x0, y0, x1, y1, ...] in pixels, e.g. for a Pixi hit area. */
export function shieldPolygon(x: number, y: number, width: number, stepsPerCurve = 8): number[] {
  const out: number[] = [];
  const push = (px: number, py: number): void => { out.push(x + px * width, y + py * width); };
  let cur: Point = [0, 0];
  for (const c of shieldOutline()) {
    if (c[0] === 'M' || c[0] === 'L') { push(c[1], c[2]); cur = [c[1], c[2]]; }
    else if (c[0] === 'C') {
      for (let i = 1; i <= stepsPerCurve; i++) {
        const t = i / stepsPerCurve, u = 1 - t;
        const bx = u * u * u * cur[0] + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5];
        const by = u * u * u * cur[1] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6];
        push(bx, by);
      }
      cur = [c[5], c[6]];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Lines of partition.

interface LineStyle { readonly period: number; readonly depth: number }
const LINE_STYLES: Record<Exclude<PartitionLine, 'straight'>, LineStyle> = {
  wavy: { period: 0.25, depth: 0.075 },
  indented: { period: 0.14, depth: 0.1 },
  embattled: { period: 0.25, depth: 0.08 },
  engrailed: { period: 0.2, depth: 0.06 },
};

/**
 * Points along a partition line from p0 to p1. Offsets go along the left-hand normal of the direction (in y-down
 * coordinates, (-dy, dx)) times `sign`. The pattern's phase is anchored at `anchor`, a point on the line, so
 * patterns sit symmetrically on the shield. Engrailed scallops bow towards the positive side.
 */
export function partitionLine(p0: Point, p1: Point, line: PartitionLine, anchor: Point, sign = 1): Point[] {
  if (line === 'straight') return [p0, p1];
  const { period, depth } = LINE_STYLES[line];
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy * sign, ny = ux * sign;
  const s0 = (anchor[0] - p0[0]) * ux + (anchor[1] - p0[1]) * uy; // anchor's distance along the line
  const at = (s: number, off: number): Point => [p0[0] + ux * s + nx * off, p0[1] + uy * s + ny * off];
  const pts: Point[] = [];
  const first = Math.floor((0 - s0) / period) - 1;
  const last = Math.ceil((len - s0) / period) + 1;
  const pushS = (s: number, off: number): void => {
    if (s < 0 || s > len) return;
    pts.push(at(s, off));
  };
  pts.push(at(0, offsetAt(line, (0 - s0) / period, depth)));
  for (let k = first; k <= last; k++) {
    const base = s0 + k * period;
    switch (line) {
      case 'embattled': {
        // Merlon centred on the anchor: up from -1/4 to +1/4 of a period, down for the rest.
        const a = base - period / 4, b = base + period / 4;
        pushS(a, -depth / 2); pushS(a, depth / 2); pushS(b, depth / 2); pushS(b, -depth / 2);
        break;
      }
      case 'indented':
        pushS(base, depth / 2); pushS(base + period / 2, -depth / 2);
        break;
      default:
        for (let i = 0; i < 12; i++) {
          const s = base + (i / 12) * period;
          pushS(s, offsetAt(line, (s - s0) / period, depth));
        }
    }
  }
  pts.push(at(len, offsetAt(line, (len - s0) / period, depth)));
  return pts;
}

function offsetAt(line: PartitionLine, u: number, depth: number): number {
  const f = u - Math.floor(u);
  switch (line) {
    case 'wavy': return (depth / 2) * Math.cos(f * Math.PI * 2);
    case 'indented': return depth / 2 - depth * (f < 0.5 ? f * 2 : 2 - f * 2);
    case 'embattled': return f < 0.25 || f >= 0.75 ? depth / 2 : -depth / 2;
    case 'engrailed': {
      // Scallops with cusps at the anchor and every period, bowing towards +normal in between.
      const x = f * 2 - 1;
      return depth * Math.sqrt(Math.max(0, 1 - x * x)) - depth / 2;
    }
    default: return 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The second tincture's region for each pattern.

const L = -0.4, R = 1.4, T = -0.4, B = SHIELD_ASPECT + 0.4;
const C: Point = [0.5, FESS_Y];

function mirror(points: readonly Point[]): Point[] {
  return points.map(([x, y]) => [1 - x, y]);
}

function reversed(points: readonly Point[]): Point[] {
  return [...points].reverse();
}

/** A band of half-width `w` around the line through `c` with direction (ux, uy), with patterned edges. */
function band(c: Point, ux: number, uy: number, w: number, reach: number, line: PartitionLine, engrailedInward: boolean): Point[] {
  const nx = -uy, ny = ux; // left-hand normal
  const a0: Point = [c[0] - ux * reach - nx * w, c[1] - uy * reach - ny * w];
  const a1: Point = [c[0] + ux * reach - nx * w, c[1] + uy * reach - ny * w];
  const b0: Point = [c[0] - ux * reach + nx * w, c[1] - uy * reach + ny * w];
  const b1: Point = [c[0] + ux * reach + nx * w, c[1] + uy * reach + ny * w];
  const anchorA: Point = [c[0] - nx * w, c[1] - ny * w];
  const anchorB: Point = [c[0] + nx * w, c[1] + ny * w];
  // Edge A lies on the -normal side, so +normal points into the band. Edge B is the opposite.
  const inward = engrailedInward ? 1 : -1;
  const edgeA = partitionLine(a0, a1, line, anchorA, line === 'engrailed' ? inward : 1);
  const edgeBLine: PartitionLine = line === 'embattled' ? 'straight' : line;
  const edgeB = partitionLine(b0, b1, edgeBLine, anchorB, line === 'engrailed' ? -inward : 1);
  return [...edgeA, ...reversed(edgeB)];
}

function chevronEdge(apex: Point, line: PartitionLine, sign: number): Point[] {
  const reach = 1.6;
  const left: Point = [apex[0] - reach, apex[1] + reach];
  const right: Point = [apex[0] + reach, apex[1] + reach];
  // Both arms run away from the apex so the pattern meets itself symmetrically there.
  const leftArm = partitionLine(apex, left, line, apex, -sign);
  const rightArm = partitionLine(apex, right, line, apex, sign);
  return [...reversed(leftArm), ...rightArm.slice(1)];
}

function plus(c: Point, w: number, k: number, angle: number): Point[] {
  const local: Point[] = [[-w, -k], [w, -k], [w, -w], [k, -w], [k, w], [w, w], [w, k], [-w, k], [-w, w], [-k, w], [-k, -w], [-w, -w]];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return local.map(([x, y]) => [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos]);
}

const CHIEF_Y = 0.32;
const FESS_HALF = 0.16;
const PALE_HALF = 0.16;
const BEND_HALF = 0.15;
const CROSS_HALF = 0.12;
const CHEVRON_APEX = 0.28;
const CHEVRON_THICK = 0.2;
export const BORDURE_WIDTH = 0.11;

/**
 * The region painted in the second tincture, before clipping to the shield. Sub-paths never overlap, so the
 * region also works under the even-odd rule.
 */
export function secondRegion(pattern: FieldPattern, line: PartitionLine): PathPiece | null {
  const S = 1 / Math.SQRT2;
  switch (pattern) {
    case 'plain': return null;
    case 'perPale':
      return { d: polygon([...partitionLine([0.5, T], [0.5, B], line, C), [R, B], [R, T]]) };
    case 'perFess':
      return { d: polygon([...partitionLine([L, FESS_Y], [R, FESS_Y], line, C), [R, B], [L, B]]) };
    case 'perBend':
    case 'perBendSinister': {
      const pts: Point[] = [...partitionLine([C[0] - 1.3, C[1] - 1.3], [C[0] + 1.3, C[1] + 1.3], line, C), [C[0] - 1.3, C[1] + 1.3]];
      return { d: polygon(pattern === 'perBend' ? pts : mirror(pts)) };
    }
    case 'quarterly':
      return { d: [...polygon([[0.5, T], [R, T], [R, FESS_Y], [0.5, FESS_Y]]), ...polygon([[L, FESS_Y], [0.5, FESS_Y], [0.5, B], [L, B]])] };
    case 'perChevron': {
      const edge = chevronEdge([0.5, 0.4], line, 1);
      return { d: polygon([...edge, [edge[edge.length - 1]![0], B + 2], [edge[0]![0], B + 2]]) };
    }
    case 'perSaltire':
      return {
        d: [...polygon([C, [C[0] - 1.2, C[1] - 1.2], [C[0] - 1.2, C[1] + 1.2]]), ...polygon([C, [C[0] + 1.2, C[1] - 1.2], [C[0] + 1.2, C[1] + 1.2]])],
      };
    case 'gyronny': {
      const d: PathCommand[] = [];
      for (let k = 0; k < 8; k += 2) {
        const a0 = -Math.PI / 2 + (k * Math.PI) / 4, a1 = a0 + Math.PI / 4;
        d.push(...polygon([C, [C[0] + Math.cos(a0) * 2, C[1] + Math.sin(a0) * 2], [C[0] + Math.cos(a1) * 2, C[1] + Math.sin(a1) * 2]]));
      }
      return { d };
    }
    case 'chief': {
      const edge = partitionLine([L, CHIEF_Y], [R, CHIEF_Y], line, [0.5, CHIEF_Y], line === 'engrailed' ? -1 : 1);
      return { d: polygon([[L, T], [R, T], ...reversed(edge)]) };
    }
    case 'fess': return { d: polygon(band(C, 1, 0, FESS_HALF, 1.4, line, true)) };
    case 'pale': return { d: polygon(band(C, 0, 1, PALE_HALF, 1.4, line, true)) };
    case 'bend': return { d: polygon(band(C, S, S, BEND_HALF, 1.6, line, true)) };
    case 'bendSinister': return { d: polygon(mirror(band(C, S, S, BEND_HALF, 1.6, line, true))) };
    case 'chevron': {
      // Engrailed arcs bow into the chevron from both edges; other lines run parallel.
      const upper = chevronEdge([0.5, CHEVRON_APEX], line, 1);
      const lowerLine: PartitionLine = line === 'embattled' ? 'straight' : line;
      const lower = chevronEdge([0.5, CHEVRON_APEX + CHEVRON_THICK * Math.SQRT2], lowerLine, line === 'engrailed' ? -1 : 1);
      return { d: polygon([...upper, ...reversed(lower)]) };
    }
    case 'cross': return { d: polygon(plus(C, CROSS_HALF, 1.6, 0)) };
    case 'saltire': return { d: polygon(plus(C, CROSS_HALF, 1.8, Math.PI / 4)) };
    case 'bordure':
      return { d: [...polygon([[L, T], [R, T], [R, B], [L, B]]), ...shieldOutline(BORDURE_WIDTH)], evenOdd: true };
    case 'pile': return { d: polygon([[0.2, T], [0.8, T], [0.8, 0], [0.5, 0.98], [0.2, 0]]) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Where charges go.

export interface ChargeSpot {
  readonly x: number;
  readonly y: number;
  /** Diameter of the charge's box, in shield units. */
  readonly size: number;
}

const spot = (x: number, y: number, size: number): ChargeSpot => ({ x, y, size });
const TWO_AND_ONE = [spot(0.28, 0.31, 0.3), spot(0.72, 0.31, 0.3), spot(0.5, 0.76, 0.3)];

export function chargeSpots(design: ShieldDesign): ChargeSpot[] {
  const charge = design.charge;
  if (!charge) return [];
  const { count, placement } = charge;
  const p = design.pattern;
  if (placement === 'onOrdinary') {
    switch (p) {
      case 'chief': return count === 1 ? [spot(0.5, 0.165, 0.25)] : [0.2, 0.5, 0.8].map((x) => spot(x, 0.165, 0.22));
      case 'fess': return count === 1 ? [spot(0.5, FESS_Y, 0.27)] : [0.2, 0.5, 0.8].map((x) => spot(x, FESS_Y, 0.23));
      case 'pale': return count === 1 ? [spot(0.5, FESS_Y, 0.27)] : [0.19, 0.5, 0.81].map((y) => spot(0.5, y, 0.23));
      case 'bend': return [-0.26, 0, 0.26].map((t) => spot(0.5 + t, FESS_Y + t, 0.2));
      case 'bendSinister': return [-0.26, 0, 0.26].map((t) => spot(0.5 - t, FESS_Y + t, 0.2));
      default: return [spot(0.5, FESS_Y, 0.25)];
    }
  }
  if (count === 1) {
    switch (p) {
      case 'chief': return [spot(0.5, 0.69, 0.44)];
      case 'bordure': return [spot(0.5, 0.53, 0.5)];
      case 'perBend':
      case 'perBendSinister': return [spot(0.5, FESS_Y, 0.52)];
      default: return [spot(0.5, FESS_Y + 0.02, 0.6)];
    }
  }
  switch (p) {
    case 'perChevron': return [spot(0.25, 0.27, 0.28), spot(0.75, 0.27, 0.28), spot(0.5, 0.84, 0.3)];
    case 'fess': return [spot(0.27, 0.18, 0.25), spot(0.73, 0.18, 0.25), spot(0.5, 0.86, 0.26)];
    case 'chevron': return [spot(0.21, 0.22, 0.25), spot(0.79, 0.22, 0.25), spot(0.5, 0.92, 0.24)];
    case 'bordure': return [spot(0.31, 0.34, 0.25), spot(0.69, 0.34, 0.25), spot(0.5, 0.77, 0.27)];
    default: return TWO_AND_ONE;
  }
}
