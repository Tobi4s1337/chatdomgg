/**
 * The gate bench's cast for the rehearsed raid road (`ROAD_PAIR`): real channels with holdings on the Atlas, so the
 * map can draw the road between them. People, rooms and gifts on it are private simulated fixtures.
 */
import { AtlasChannelSchema } from '@chatdom/shared';
import type { KingdomId, PersonId } from '../../../../api/src/raid-gate/contracts';
import type { BenchCast } from '../bench';
import type { RoadLand } from './lands';

const SIMULATED_HOST = '53000001' as PersonId;

export function castFor(from: RoadLand, to: RoadLand, land: 'founded' | 'waiting'): BenchCast {
  const founded = land === 'founded';
  const channel = AtlasChannelSchema.parse({ kingdomId: to.id, login: to.login, displayName: to.name, language: 'en', founded,
    kingdomName: founded ? to.name : null, contentClassification: 'general' });
  return {
    source: { kingdomId: from.id as KingdomId, name: from.name, login: from.login },
    destinations: [{ channel, land, live: true, group: 'road' }],
    rooms: founded ? [from.id as KingdomId, to.id as KingdomId] : [from.id as KingdomId],
    welcome: { kingdomId: to.id as KingdomId, name: to.name, host: SIMULATED_HOST, things: { hostGift: 'Lantern of the rose-lit river', monarchGift: 'River-reed welcome loaf' } },
    names: { [to.id]: to.name, [SIMULATED_HOST]: 'Ash of the Mill', [from.id]: from.name, '52000001': 'Wren', '52000002': 'Tamsin',
      '52000003': 'Oswin', '52000004': 'Brannoc', '52000005': 'Ysolde', '52000006': 'Corwen' },
    carried: { crafted: 'A pawn carved from mountain pine', forged: 'Citadel-glass lantern' },
  };
}
