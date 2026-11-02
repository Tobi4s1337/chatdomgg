import { onMount } from 'solid-js';
import '@chatdom/ui/kit.css';
import './campfire.css';

export { mountCampfireWalk, type CampfireWalk } from './walk';
export { CampfireHud } from './Hud';
export { StreamOverlay } from './StreamOverlay';
export { createCampfireSession, type CampfireSession } from './session';

/**
 * `/-/campfire`. The fire lives in the kingdom, at its clearing on the edge of the Wilds, and it is played by the
 * people who walk there (`walk.ts`, mounted in every kingdom walk through play's walk features). This address has
 * no fire of its own to show, so it says where the fire is; it never stages a circle.
 */
export default function CampfirePage() {
  onMount(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  return <div class="campfire cd-kit" data-campfire-surface="pointer">
    <div class="campfire-shade" />
    <section class="campfire-quiet cd-plate" role="status">
      <h1>The fire is in your kingdom</h1>
      <p>Walk out to the clearing at the edge of the Wilds and sit on a log. When four or more are sitting, ask the fire for a round of Dusk Court.</p>
    </section>
  </div>;
}
