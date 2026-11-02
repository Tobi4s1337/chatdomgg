import { createKingdomAudio, type KingdomAudio } from '@chatdom/audio';
import { createPortalCurtain } from './hud/portal-curtain';
import { createPortalTransfer, type PortalCue, type PortalDescriptor, type PortalDestination, type PortalOutcome, type PortalPhase, type PortalSource, type PortalTransfer } from './portal';
import { sharedPlaySettings } from './settings';
import { registerWorldPrompt } from './slots';

export type { PortalAnchor, PortalDescriptor, PortalDestination, PortalOutcome, PortalPhase, PortalSource, PortalSurface, PortalVisit } from './portal';

/**
 * The page's one door keeper. It outlives the kingdom walk it starts from, so a journey can leave that room, stand
 * in another and come back. Destinations register at import (one line in `providers.ts`); the kingdom walk binds
 * itself as the source while it lives.
 */
let transfer: PortalTransfer | null = null;
let audio: KingdomAudio | null = null;

/** The door's own small sound: it must keep sounding while neither room's sound is up. */
function doorSound(cue: PortalCue) {
  if (typeof window === 'undefined') return;
  audio ??= createKingdomAudio();
  const volume = sharedPlaySettings().current.volume;
  audio.setSettings({ volume: volume.master * volume.interface });
  void audio.unlock();
  if (cue === 'door') audio.cue('wood', { ui: 'wood' });
  else if (cue === 'latch') audio.cue('wood', { ui: 'brass' });
  else {
    // Two steps over the threshold boards.
    audio.cue('step', { material: 'wood', pan: -0.15, distance: 1.2 });
    setTimeout(() => audio?.cue('step', { material: 'wood', pan: 0.15, distance: 1.2 }), 290);
  }
}

function shared(): PortalTransfer {
  transfer ??= createPortalTransfer({
    curtain: () => createPortalCurtain({ reducedMotion: () => sharedPlaySettings().current.reducedMotion }),
    cue: doorSound,
  });
  return transfer;
}

/** gather registers the tavern here. One destination per room type. */
export function registerPortalDestination(destination: PortalDestination): () => void { return shared().registerDestination(destination); }
/** The kingdom walk binds its room while it lives. */
export function bindPortalSource(source: PortalSource): () => void { return shared().bindSource(source); }
/** Show a door's prompt only while this is true: no dead doors. */
export function portalAvailable(portal: PortalDescriptor): boolean { return shared().available(portal); }
/** Through the door. Call it from the use key or a click on the door. */
export function enterPortal(portal: PortalDescriptor): Promise<PortalOutcome> { return shared().enter(portal); }
/** Back out of the room you are in. */
export function leavePortal(): Promise<PortalOutcome> { return shared().leave(); }
export function portalPhase(): PortalPhase { return shared().phase; }
export function onPortalPhase(listener: (phase: PortalPhase) => void): () => void { return shared().onPhase(listener); }

/** How near the door's outside anchor the prompt shows, in metres across and up. */
export const PORTAL_DOOR_REACH = { across: 2.2, up: 1.6 } as const;

/**
 * A door's prompt at its outside anchor, shown only while the door really opens ("Go into the tavern"). The use key or
 * a click goes through. Returns the unregister.
 */
export function registerPortalDoor(portal: PortalDescriptor, options: { readonly label?: string; readonly reach?: number } = {}): () => void {
  const reach = options.reach ?? PORTAL_DOOR_REACH.across;
  const [x, y, z] = portal.returnAnchor.feet;
  return registerWorldPrompt({
    id: `portal:${portal.id}`,
    prompt(pose) {
      const [px, py, pz] = pose.position;
      if (Math.hypot(px - x, pz - z) > reach || Math.abs(py - y) > PORTAL_DOOR_REACH.up) return null;
      if (!portalAvailable(portal)) return null;
      const title = shared().title(portal);
      if (!title) return null;
      return { label: options.label ?? `Go into ${title.charAt(0).toLowerCase()}${title.slice(1)}`, at: [x, y + 1.4, z] };
    },
    use() { void enterPortal(portal); },
  });
}
