import { mountCampfireWalk, type CampfireWalk } from './walk';
import { mountWalkHud } from './walk-hud';

/**
 * The one line in play's `providers.ts`: `import '../campfire/register';`. Where play's walk feature slot is part of
 * the build (`play/slots.ts`, B1c), the fire joins every kingdom walk; where it is not, nothing happens. Play's
 * `WalkFeatureContext` is the structural `CampfireWalk`, so this builds on either side of the merge.
 */
export const CAMPFIRE_FEATURE = 'campfire';

interface PlaySlots { registerWalkFeature(provider: { readonly id: string; mount(walk: CampfireWalk): () => void }): () => void }

const slots = import.meta.glob<Partial<PlaySlots>>('../play/slots.ts', { eager: true })['../play/slots.ts'];

/** Registers the fire with a walk feature registry; returns the unregister. */
export function joinPlayWalks(registry: PlaySlots): () => void {
  return registry.registerWalkFeature({ id: CAMPFIRE_FEATURE, mount: walk => mountCampfireWalk(walk, { mountHud: mountWalkHud }) });
}

if (typeof window !== 'undefined' && slots?.registerWalkFeature) joinPlayWalks({ registerWalkFeature: slots.registerWalkFeature });
