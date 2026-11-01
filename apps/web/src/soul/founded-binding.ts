import { seedHash, type KingdomLandInterface } from '@chatdom/world';
import type { SoulBiome, SoulTopology } from '../../../../packages/world/src/soul';
import type { SoulSceneBinding } from './host';

/**
 * Bind only sites attested by the installed public scene and its physical land interface.
 * A forge's supported interaction approach is a stationary open-workplace anchor, not a
 * claim that a road from it is navigable. Other roles require their own authored sites.
 */
export function foundedSoulBinding(land: KingdomLandInterface, biome: SoulBiome, utcOffsetMinutes = 0): SoulSceneBinding {
  const { scene } = land;
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const hasForge = scene.placements.some(placement => {
    const asset = assets.get(placement.assetHash);
    return placement.id === 'forge:hearth:v1' && asset?.kind === 'civic'
      && /^civic-forge-hearth-(hearth|tide|grove)$/.test(asset.id);
  });
  const topology: SoulTopology = {
    routes: hasForge && land.forge.approach ? { smith: [land.forge.approach] } : {},
    lamps: [],
  };
  return { config: { seed: seedHash(scene.plan.config.seed), biome, utcOffsetMinutes, topology } };
}

