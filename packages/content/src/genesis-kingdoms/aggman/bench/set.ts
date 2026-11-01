import type { AggmanPiece } from '../piece';

/** A row of pieces for the lane bench. `at` is the piece origin in build cells on the bench ground. */
export interface BenchSet {
  readonly name: string;
  readonly pieces: readonly { readonly piece: AggmanPiece; readonly at: readonly [number, number]; readonly turn?: 0 | 1 | 2 | 3 }[];
}
