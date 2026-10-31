import type { DurableWorldAdoption } from '../persistence/kingdom';
import { prepareFoundedWalkerPositions } from './anchors';
import type { FoundedPreparedWorld } from './provider';

/** Prospective scene only; the existing durable writer owns when this candidate becomes public. */
export function foundedWorldAdoption(prepared: FoundedPreparedWorld, adopted: () => void): DurableWorldAdoption {
  return {
    world: prepared.world,
    layoutRevision: prepared.scene.layoutRevision,
    spawn: prepared.options.spawn,
    matches: checkpoint => prepared.manifestFor({ ...checkpoint, collisionRevision: prepared.world.revision }) !== null,
    positions: walkers => prepareFoundedWalkerPositions(prepared.scene.plan, prepared.world, walkers),
    adopted,
  };
}
