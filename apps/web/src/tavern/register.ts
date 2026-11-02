import { createKingdomAudio } from '@chatdom/audio';
import { followPlayVolume, joinPlayDoors, type PlayDoorKeeper, type PlayWalkFeatures } from './play-door';
import { createTavernDestination } from './play-slot';

/**
 * The one line in play's `providers.ts`: `import '../tavern/register';`. Where play's door keeper is part of the build
 * (B1b `play/portals.ts`, B1c walk features), the tavern registers its destination and its kingdom door; where it is
 * not, nothing happens and no door is offered. The tavern keeps one mixer for the page, unlocked by the first gesture
 * inside, at play's world volume, so its sound survives every trip through the door.
 */
type PlaySettings = { sharedPlaySettings(): Parameters<typeof followPlayVolume>[1] };

const portals = import.meta.glob<PlayDoorKeeper>('../play/portals.ts', { eager: true })['../play/portals.ts'];
const slots = import.meta.glob<Partial<PlayWalkFeatures>>('../play/slots.ts', { eager: true })['../play/slots.ts'];
const settings = import.meta.glob<Partial<PlaySettings>>('../play/settings.ts', { eager: true })['../play/settings.ts'];

if (typeof window !== 'undefined' && portals?.registerPortalDestination && slots?.registerWalkFeature) {
  const audio = createKingdomAudio();
  if (settings?.sharedPlaySettings) followPlayVolume(audio, settings.sharedPlaySettings());
  joinPlayDoors(portals, { registerWalkFeature: slots.registerWalkFeature }, { destination: createTavernDestination({ audio }) });
}

export {};
