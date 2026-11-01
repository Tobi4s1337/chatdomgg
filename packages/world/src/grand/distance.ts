/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled
 * Functions", 2012): two separable passes of the 1D lower envelope of parabolas. Returns distances in
 * cells from every cell to the nearest cell where `inside` is set.
 */
export function distanceTransform(inside: Uint8Array, size: number, cap = 1e9): Float32Array {
  const INF = 1e20;
  const grid = new Float64Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = inside[i] ? 0 : INF;
  const f = new Float64Array(size), d = new Float64Array(size), v = new Int32Array(size), zz = new Float64Array(size + 1);
  const pass = (step: number, lines: number, lineStride: number) => {
    for (let line = 0; line < lines; line++) {
      const base = line * lineStride;
      for (let q = 0; q < size; q++) f[q] = grid[base + q * step]!;
      let k = 0;
      v[0] = 0; zz[0] = -INF; zz[1] = INF;
      for (let q = 1; q < size; q++) {
        let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
        while (s <= zz[k]!) { k--; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
        k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < size; q++) {
        while (zz[k + 1]! < q) k++;
        const dq = q - v[k]!;
        d[q] = dq * dq + f[v[k]!]!;
      }
      for (let q = 0; q < size; q++) grid[base + q * step] = d[q]!;
    }
  };
  pass(1, size, size);    // rows
  pass(size, size, 1);    // columns
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(cap, Math.sqrt(grid[i]!));
  return out;
}

/** Separable box blur, repeated for a near-Gaussian; returns a new field. */
export function blur(source: Float32Array, size: number, radius: number, passes = 2): Float32Array {
  const a = Float32Array.from(source), b = new Float32Array(source.length);
  const window = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z < size; z++) {
      let sum = 0;
      const row = z * size;
      for (let x = -radius; x <= radius; x++) sum += a[row + Math.min(size - 1, Math.max(0, x))]!;
      for (let x = 0; x < size; x++) {
        b[row + x] = sum / window;
        sum += a[row + Math.min(size - 1, x + radius + 1)]! - a[row + Math.max(0, x - radius)]!;
      }
    }
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let z = -radius; z <= radius; z++) sum += b[Math.min(size - 1, Math.max(0, z)) * size + x]!;
      for (let z = 0; z < size; z++) {
        a[z * size + x] = sum / window;
        sum += b[Math.min(size - 1, z + radius + 1) * size + x]! - b[Math.max(0, z - radius) * size + x]!;
      }
    }
  }
  return a;
}
