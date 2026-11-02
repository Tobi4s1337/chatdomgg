import { render } from 'solid-js/web';
import { CampfireHud } from './Hud';
import type { FireHand } from './input';
import type { CampfireSession } from './session';

/** The carved HUD in the walk's feature layer. */
export function mountWalkHud(host: HTMLElement, session: CampfireSession, hand: () => FireHand | null): () => void {
  return render(() => <CampfireHud session={session} hand={hand()} variant="walk" />, host);
}
