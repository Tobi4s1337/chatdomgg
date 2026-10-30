export interface NeighbourPoint { readonly slot: number; readonly x: number; readonly z: number }
/** `a < b`; each pair appears once. */
export interface NeighbourPair { readonly a: number; readonly b: number; readonly distance: number }

const cellKey = (x: number, z: number): number => (x + 32_768) * 65_536 + (z + 32_768);

/**
 * Pairs within `range` metres, built once per policy step from a uniform grid whose cell is at
 * least `range`, so a 3×3 query is exhaustive. Each citizen keeps its `maxPerCitizen` closest
 * people (distance, then slot); a pair survives when either side keeps it. Work is proportional
 * to supplied people and local density, never all pairs. Output is sorted by `(a, b)`.
 */
export function neighbourPairs(points: readonly NeighbourPoint[], range: number, cell: number, maxPerCitizen: number): NeighbourPair[] {
  if (!(cell >= range) || !(range > 0)) throw new Error('Neighbour cells must cover the query range');
  const cells = new Map<number, NeighbourPoint[]>();
  for (const point of points) {
    const key = cellKey(Math.floor(point.x / cell), Math.floor(point.z / cell)), list = cells.get(key);
    if (list) list.push(point); else cells.set(key, [point]);
  }
  const pairs = new Map<number, NeighbourPair>(), near: { point: NeighbourPoint; distance: number }[] = [];
  for (const point of points) {
    near.length = 0;
    const cx = Math.floor(point.x / cell), cz = Math.floor(point.z / cell);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const other of cells.get(cellKey(cx + dx, cz + dz)) ?? []) {
        if (other.slot === point.slot) continue;
        const distance = Math.hypot(other.x - point.x, other.z - point.z);
        if (distance <= range) near.push({ point: other, distance });
      }
    }
    near.sort((p, q) => p.distance - q.distance || p.point.slot - q.point.slot);
    for (const { point: other, distance } of near.slice(0, maxPerCitizen)) {
      const a = Math.min(point.slot, other.slot), b = Math.max(point.slot, other.slot);
      pairs.set(a * 65_536 + b, { a, b, distance });
    }
  }
  return [...pairs.values()].sort((p, q) => p.a - q.a || p.b - q.b);
}
