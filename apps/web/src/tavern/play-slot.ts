import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { KingdomAudio } from '@chatdom/audio';
import type { GameInputLease } from '../games/input';
import { requestBenchGameInput } from './bench-input';
import { connectTavern } from './client';
import { TavernRoomSurface } from './Surface';
import { TAVERN_TITLE, tavernVisit, type TavernPortalDestination } from './portal';

export { TAVERN_TITLE, tavernPortalDescriptor, tavernPortalFor, tavernVisit, watchTavernDoor, yawRadians } from './portal';
export type { TavernPortalAnchor, TavernPortalDescriptor, TavernPortalDestination, TavernPortalSurface, TavernPortalVisit, TavernVisitHooks } from './portal';

export interface TavernDestinationOptions {
  /** The caller's existing common mixer. The tavern never opens a second audio context. */
  readonly audio: KingdomAudio;
  /** Play's seated-input lease on the tavern's own transparent table canvas; defaults to the pointer-lock lease. */
  readonly requestInput?: (surface: HTMLCanvasElement, reason: string) => GameInputLease;
  /** Where the tavern keeps its reconnect token for this tab; session storage by default. */
  readonly storage?: Storage;
}

/** `registerPortalDestination(createTavernDestination({ audio }))` in play's providers. */
export function createTavernDestination(options: TavernDestinationOptions): TavernPortalDestination {
  const requestInput = options.requestInput ?? ((surface, reason) => requestBenchGameInput(surface, reason));
  return {
    room: 'tavern', title: TAVERN_TITLE,
    mount(host, visit) {
      const storage = options.storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
      return tavernVisit(visit, () => connectTavern(visit.endpoint, visit.entry, storage), hooks => render(() => createComponent(TavernRoomSurface, {
        open: hooks.open, leave: hooks.leave, onReady: hooks.onReady, onTerminal: hooks.onTerminal,
        audio: options.audio, requestInput,
      }), host));
    },
  };
}
