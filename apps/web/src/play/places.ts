import type { InteractionPlaces } from '../interactions/ports';
import { placeOpener } from './slots';

/** The tavern and the campfire open through the places other lanes register; everything else as the page gave it. */
export function withRegisteredPlaces(base: InteractionPlaces | undefined): InteractionPlaces {
  return {
    open(accepted, closed) {
      const kind = accepted.action === 'tavern' ? 'tavern' : accepted.action === 'sit' && accepted.record.target.kind === 'campfire-seat' ? 'campfire' : null;
      const opener = kind ? placeOpener(kind) : undefined;
      return opener ? opener(accepted.record, closed) : base?.open(accepted, closed) ?? null;
    },
    ...(base?.home ? { home: base.home.bind(base) } : {}),
  };
}
