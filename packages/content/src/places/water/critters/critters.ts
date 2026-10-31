import { createFloater } from './floater';
import type { Critter, CritterKind, CritterVariant } from './rig';
import { createDragonfly, createKingfisher, createTrout } from './small';
import { createDrake, createHeron, createHen } from './waterfowl';

/** Every wild creature and float the water places show. Fixed handmade factories, never authored by chat. */
export const CRITTER_KINDS: readonly CritterKind[] = ['drake', 'hen', 'heron', 'trout', 'kingfisher', 'dragonfly', 'floater'];

const FACTORIES: Readonly<Record<CritterKind, (variant: CritterVariant) => Critter>> = {
  drake: createDrake, hen: createHen, heron: createHeron, trout: createTrout,
  kingfisher: createKingfisher, dragonfly: createDragonfly, floater: createFloater,
};

/** Deterministic. The variant changes small colour accents only; the rig, pivots and sizes stay the same. */
export function createCritter(kind: CritterKind, variant: CritterVariant = 0): Critter {
  const make = FACTORIES[kind];
  if (!make || ![0, 1, 2].includes(variant)) throw new Error(`Unknown critter ${String(kind)} variant ${String(variant)}.`);
  return make(variant);
}
