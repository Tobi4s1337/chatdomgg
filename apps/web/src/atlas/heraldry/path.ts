/**
 * Path data shared by every heraldry renderer (Canvas2D here; Pixi or SVG can replay the same commands).
 * Coordinates are in shield units unless a function says otherwise.
 */

export type PathCommand =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['Q', number, number, number, number]
  | readonly ['C', number, number, number, number, number, number]
  /** Canvas-style arc: centre, radius, start and end angle (radians, y down), anticlockwise. */
  | readonly ['A', number, number, number, number, number, boolean]
  | readonly ['Z'];

/** One filled piece of a shape. Pieces of the same shape are filled one after another, so they union. */
export interface PathPiece {
  readonly d: readonly PathCommand[];
  /** Holes (a door in a tower, the eye of a fish) are drawn as extra sub-paths under the even-odd rule. */
  readonly evenOdd?: true;
}

export type Point = readonly [number, number];

/** The subset of CanvasPath used to replay commands, so Path2D, both 2D contexts and look-alikes all work. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  closePath(): void;
}

/** Replays commands into a sink, mapping each point through `x0 + x * scale`, `y0 + y * scale`. */
export function tracePath(sink: PathSink, d: readonly PathCommand[], x0 = 0, y0 = 0, scale = 1): void {
  for (const c of d) {
    switch (c[0]) {
      case 'M': sink.moveTo(x0 + c[1] * scale, y0 + c[2] * scale); break;
      case 'L': sink.lineTo(x0 + c[1] * scale, y0 + c[2] * scale); break;
      case 'Q': sink.quadraticCurveTo(x0 + c[1] * scale, y0 + c[2] * scale, x0 + c[3] * scale, y0 + c[4] * scale); break;
      case 'C':
        sink.bezierCurveTo(x0 + c[1] * scale, y0 + c[2] * scale, x0 + c[3] * scale, y0 + c[4] * scale,
          x0 + c[5] * scale, y0 + c[6] * scale);
        break;
      case 'A': sink.arc(x0 + c[1] * scale, y0 + c[2] * scale, c[3] * scale, c[4], c[5], c[6]); break;
      case 'Z': sink.closePath(); break;
    }
  }
}

export function polygon(points: readonly Point[]): PathCommand[] {
  const d: PathCommand[] = [];
  points.forEach(([x, y], i) => d.push(i === 0 ? ['M', x, y] : ['L', x, y]));
  d.push(['Z']);
  return d;
}

export function circle(cx: number, cy: number, r: number, anticlockwise = false): PathCommand[] {
  const turn = Math.PI * 2;
  return [['M', cx + r, cy], anticlockwise ? ['A', cx, cy, r, turn, 0, true] : ['A', cx, cy, r, 0, turn, false], ['Z']];
}
