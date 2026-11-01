/** 0 is enclosed, 3 is fully open. Occupancy is sampled outside a visible face. */
export function cornerOcclusion(sideU: boolean, sideV: boolean, corner: boolean): number {
  return sideU && sideV ? 0 : 3 - Number(sideU) - Number(sideV) - Number(corner);
}

/** Four 2-bit AO values in the same winding as the face's vertices. */
export function packOcclusion(a: number, b: number, c: number, d: number): number {
  return a | b << 2 | c << 4 | d << 6;
}

/** Select the diagonal which avoids an asymmetric interpolation across a saddle. */
export function flipDiagonal(ao: number): boolean {
  return (ao & 3) + ((ao >> 4) & 3) > ((ao >> 2) & 3) + ((ao >> 6) & 3);
}
