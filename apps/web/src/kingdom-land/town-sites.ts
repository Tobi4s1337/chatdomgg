import { createMarketStall, createMarketWell } from '@chatdom/content';
import type { LandSite } from '@chatdom/world';
import type { Dressing } from '../kingdom/settlement-content';

export interface SiteContent {
  /** Ready to mount at the site's origin; yaw from its cardinal turn (local +Z faces the square's heart). */
  placed: Dressing[];
  /**
   * Sites held for their own makers: the Forge yard for the hero anvil, the statue pads for emote statues, the
   * benches for the civic bench model. Their footprints stay open on the square; nothing stands in for them.
   */
  pending: LandSite[];
}

/** The square's sites as mountable content: the well and the stalls exist today. */
export function placeSiteContent(sites: readonly LandSite[]): SiteContent {
  const placed: Dressing[] = [], pending: LandSite[] = [];
  let stalls = 0;
  for (const site of sites) {
    const yaw = site.turn * Math.PI / 2, position = [...site.position] as Dressing['position'];
    if (site.kind === 'well') placed.push({ blueprint: createMarketWell(), position, yaw });
    else if (site.kind === 'stall') placed.push({ blueprint: createMarketStall((stalls++ % 2) as 0 | 1), position, yaw });
    else pending.push(site);
  }
  return { placed, pending };
}
