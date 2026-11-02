import type { BakedMetadata, BakedRegionRef } from '../../../../../packages/world/src/grand/baked/types';
import { balanceLevels } from '../../grand/lod';

export const STARTUP_BUDGET_BYTES = 4 * 1024 * 1024;
export interface StartupCoverage {
  readonly levels: readonly number[];
  readonly required: readonly boolean[];
  readonly refs: readonly (BakedRegionRef | null)[];
  readonly meshBytes: number;
  readonly plannedBytes: number;
  readonly budgetBytes: number;
  readonly budgetExceeded: boolean;
}

/** Coarsest complete coverage, balanced against EVERY region, including offscreen physical L0 pins.
 * Visibility only chooses which of these fixed levels to fetch. A budget overrun never removes coverage. */
export function planStartupCoverage(metadata: BakedMetadata, visible: readonly boolean[], bootstrapBytes: number): StartupCoverage {
  if (visible.length !== metadata.regions.length || visible.some(value => typeof value !== 'boolean')
    || !Number.isSafeInteger(bootstrapBytes) || bootstrapBytes < 0) throw new RangeError('Invalid initial land coverage inputs');
  const byKey = new Map(metadata.regions.map((region, index) => [`${region.rx}:${region.rz}`, index]));
  const neighbours = metadata.regions.map(region => {
    const adjacent: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const index = byKey.get(`${region.rx + dx}:${region.rz + dz}`);
      if (index !== undefined) adjacent.push(index);
    }
    return adjacent;
  });
  const states = metadata.regions.map(region => ({ shown: null, ideal: region.exact ? 0 : 3, desired: 3, coarsenSince: 0 }));
  balanceLevels(states, neighbours, 4);
  const levels = Object.freeze(states.map(state => state.desired));
  const required = Object.freeze(metadata.regions.map((region, index) => region.exact || visible[index]!));
  const refs = Object.freeze(metadata.regions.map((region, index) => {
    if (!required[index]) return null;
    const ref = region.meshes.find(ref => ref.level === levels[index]);
    if (!ref) throw new Error('Baked terrain is missing its balanced initial resolution');
    return ref;
  }));
  const meshBytes = refs.reduce((bytes, ref) => bytes + (ref?.gzipBytes ?? 0), 0), plannedBytes = bootstrapBytes + meshBytes;
  return Object.freeze({ levels, required, refs, meshBytes, plannedBytes, budgetBytes: STARTUP_BUDGET_BYTES,
    budgetExceeded: plannedBytes > STARTUP_BUDGET_BYTES });
}

/** Both endpoints are balanced. Pointwise one-level movement between them remains balanced as well.
 * Synchronizing complete waves avoids a newly installed L0 next to a still-displayed L2 neighbour. */
export function stepBalancedLevels(current: readonly number[], desired: readonly number[]): number[] {
  if (current.length !== desired.length) throw new RangeError('Land LOD states disagree');
  return current.map((level, index) => level + Math.sign(desired[index]! - level));
}
