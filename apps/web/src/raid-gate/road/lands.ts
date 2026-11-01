import { compileChannelGenesis, compileGenesisSettlement } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '@chatdom/world/genesis/observed';
import type { KingdomId, KingdomPresenceFrame, Vec3 } from '@chatdom/shared';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from '../../genesis/channels';
import { createGenesisWindowPreview } from '../../genesis/window-preview';
import type { PotentialKingdomView } from '../../kingdom/scene';

/**
 * The two ends of the rehearsed raid road: real channels with real holdings on the Atlas, whose land is grown from
 * each channel's own observed seed exactly as the Genesis previews grow it (spec 39). Potential land is scenery: no
 * room, deed, ruler or audience comes with it, and every surface that shows it as a kingdom says SIMULATED.
 */
export interface RoadLand {
  id: string;
  name: string;
  login: string;
  /** What the channel was observed playing, for the land's caption. */
  category: string;
  averageViewers: number;
  lore: string;
  character: string;
  potential: PotentialKingdomView;
}

/** The raid the road rehearses: MashaD4's mountain citadel rides to PinkKittyRose's river valley. */
export const ROAD_PAIR = { from: '154972160', to: '4363967' } as const;

export function roadLand(id: string): RoadLand {
  const channel = GENESIS_CHANNELS.find(item => item.id === id);
  const observed = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === id);
  const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(item => item.broadcasterId === id);
  if (!channel || !observed || !choice) throw new Error(`No seeded land for channel ${id}.`);
  const recipe = compileChannelGenesis({ ...observed, profileColours: [...channel.palette], evidence: {
    kind: 'observed', sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT),
  } });
  const landscape = recipe.landscapes.find(item => item.character === choice.character)!;
  const plan = compileGenesisSettlement(recipe, landscape.id);
  const centreX = (plan.bounds.minX + plan.bounds.maxX) / 2;
  const centreZ = (plan.bounds.minZ + plan.bounds.maxZ) / 2;
  const span = Math.max(plan.bounds.maxX - plan.bounds.minX, plan.bounds.maxZ - plan.bounds.minZ);
  const target: [number, number, number] = [centreX, plan.market.elevation + 6, centreZ];
  const turn = landscape.coast.oceanToward;
  const offset = (x: number, z: number): readonly [number, number] => turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
  // The Genesis hero framings, so the land reads as the founding previews show it.
  const direction = offset(-0.46, 0.72);
  let eye: Vec3 = [centreX + span * direction[0], plan.market.elevation + span * 0.43, centreZ + span * direction[1]];
  if (choice.character === 'river-valley') {
    const look = offset(20, 5), near = offset(210, 190);
    target[0] = look[0]; target[2] = look[1]; target[1] = plan.market.elevation + 5;
    eye = [near[0], target[1] + 76, near[1]];
  }
  const potential: PotentialKingdomView = {
    plan, size: recipe.size.tier, style: recipe.identity.styleFamily,
    camera: { eye, target, fov: 50 },
    windowPreview: createGenesisWindowPreview(id as KingdomId, plan.homes, recipe.evidence.asOf),
  };
  return {
    id, name: channel.name, login: channel.login, category: observed.categories[0]!.name, averageViewers: observed.audience.averageViewers!,
    lore: channel.lore, character: choice.character.replaceAll('-', ' '), potential,
  };
}

/** A presence frame with nobody in it: potential land has no audience to light, only its SIMULATED window preview. */
export function emptyPresence(id: string, asOf: number): KingdomPresenceFrame {
  return { version: 1, kingdomId: id as KingdomPresenceFrame['kingdomId'], epoch: `potential:${id}`, sequence: 0, asOf, origin: 'simulated', connection: 'offline', streamLive: false, windows: [] };
}
