import { FORGE_LIBRARY_MOTIFS, type ForgeLibraryMotif } from '@chatdom/shared';
import type { StyleKey } from '../materials';
import type { LibraryMotif } from './carve';
import { MOTIFS as LAND } from './land';
import { MOTIFS as WATER } from './water';
import { MOTIFS as SKY } from './sky';
import { MOTIFS as THINGS } from './things';
import { MOTIFS as CURIOS } from './curios';

export { LIBRARY_ENVELOPE, LIBRARY_MOUNT, CARVE_PALETTES, type LibraryMotif } from './carve';

/**
 * The Forge's library of hand-carved motifs (kit revision 3): forty subjects people ask for, each carved for every
 * kingdom in its own palette inside the kit's 24 × 16 × 18 envelope. A wish names one; the Forge never invents a
 * subject outside this list.
 */
const MAKERS: Readonly<Record<ForgeLibraryMotif, (family: StyleKey) => LibraryMotif>> = { ...LAND, ...WATER, ...SKY, ...THINGS, ...CURIOS };

for (const id of FORGE_LIBRARY_MOTIFS) if (!(id in MAKERS)) throw new Error(`The Forge library has no carving for ${id}.`);

/** A fresh copy of one carving; callers may recolour it in place. Unknown input throws. */
export function createLibraryMotif(id: ForgeLibraryMotif, family: StyleKey): LibraryMotif {
  const make = MAKERS[id];
  if (!make) throw new Error(`Unknown Forge library motif ${String(id)}.`);
  if (family !== 'hearth' && family !== 'tide' && family !== 'grove') throw new Error(`Unknown kingdom style ${String(family)}.`);
  return structuredClone(make(family));
}
