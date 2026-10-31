import type { KingdomId, KingdomPresenceFrame } from '@chatdom/shared';

/** An evening light study, consumed only by potential-land window rendering.
 * These anonymous slots never enter the presence feed, room, citizens or history.
 */
export function createGenesisWindowPreview(
  kingdomId: KingdomId,
  homes: readonly { slot: number }[],
  asOf: number,
): KingdomPresenceFrame {
  const offset = Number(kingdomId) % 7;
  return {
    version: 1, kingdomId, epoch: `genesis-light-study:${kingdomId}`, sequence: 0,
    asOf, origin: 'simulated', connection: 'offline', streamLive: false,
    windows: homes.map(({ slot }) => ({
      slot, present: (slot + offset) % 7 !== 2, publicName: null, since: Math.max(0, asOf - 1000),
    })),
  };
}
