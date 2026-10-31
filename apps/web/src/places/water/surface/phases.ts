/**
 * Every moving term of the water is a pure function of caller time, computed here in double precision and handed
 * to the shader as already-wrapped phases. Seeking forward or back gives the same frame; nothing accumulates and
 * no phase loses precision after hours of stream.
 */

/** Gentle wind ripples on still water: direction (x, z), wavenumber (rad/m) and angular speed (rad/s). */
export const WIND_WAVES: readonly (readonly [number, number, number, number])[] = [
  [0.91, 0.42, 0.26, 0.22],
  [-0.36, 0.93, 0.37, -0.17],
  [0.62, -0.78, 0.83, 0.41],
];

/** Seconds per flow-map cycle; each of the two layers restarts half a cycle apart, faded out at its reset. */
export const FLOW_PERIOD = 2.2;

const TAU = Math.PI * 2;
const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** Deterministic pattern offset for a layer's `cycle`: each restart reads a fresh patch, hidden at zero weight. */
export function cycleOffset(cycle: number, layer: number): [number, number] {
  // A small integer hash, so offsets stay stable for any finite cycle count.
  let h = (Math.imul(cycle | 0, 0x27d4eb2d) ^ Math.imul(layer + 1, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return [((h & 0xffff) / 0xffff) * 37.0, ((h >>> 16) / 0xffff) * 37.0];
}

export interface WaterPhases {
  /** Wind wave phases in radians, wrapped to [0, 2π). */
  readonly wind: readonly [number, number, number];
  /** Flow layers' progress through their cycle, [0, 1), half a cycle apart. */
  readonly flow: readonly [number, number];
  /** Each flow layer's current pattern offset (metres). */
  readonly offsets: readonly [readonly [number, number], readonly [number, number]];
}

export function waterPhases(time: number): WaterPhases {
  if (!Number.isFinite(time)) throw new RangeError('Water time must be finite seconds');
  const wind = WIND_WAVES.map(([, , , omega]) => wrap(time * omega, TAU)) as unknown as [number, number, number];
  const cycles = [time / FLOW_PERIOD, time / FLOW_PERIOD + 0.5];
  const flow = cycles.map(c => c - Math.floor(c)) as unknown as [number, number];
  const offsets = cycles.map((c, layer) => cycleOffset(Math.floor(c), layer)) as unknown as [[number, number], [number, number]];
  return { wind, flow, offsets };
}
