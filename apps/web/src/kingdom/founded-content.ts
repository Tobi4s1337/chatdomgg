import type { WindowHouse } from '@chatdom/render';
import type { RealmFoundedScene } from '@chatdom/world';
import type { Dressing } from './settlement-content';

/** Install the producer's exact geometry. Semantic blueprint IDs are not content identities. */
export function foundedContent(scene: RealmFoundedScene) {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  if (assets.size !== scene.assets.length) throw new Error('The founded scene repeats an asset hash');
  const plots = new Map(scene.plan.homes.map(home => [home.id, home]));
  const homes = new Set<string>(), ids = new Set<string>();
  const houses: WindowHouse[] = [], props: Dressing[] = [];
  const content = scene.placements.map(placement => {
    const blueprint = assets.get(placement.assetHash);
    if (!blueprint || ids.has(placement.id)) throw new Error('The founded scene has an unresolved placement');
    ids.add(placement.id);
    const placed = { blueprint, position: placement.position, yaw: placement.rotation * Math.PI / 2, assetHash: placement.assetHash };
    const plot = placement.plotId ? plots.get(placement.plotId) : undefined;
    if (placement.plotId && !plot) throw new Error('The founded scene references an unknown plot');
    // Attachments may share a plot with its home; only the home supplies the presence windows.
    if (plot && blueprint.kind === 'home') {
      if (homes.has(plot.id)) throw new Error('The founded scene repeats a home');
      homes.add(plot.id); houses.push({ ...placed, slot: plot.slot });
    } else props.push(placed);
    return placed;
  });
  if (homes.size !== scene.plan.homes.length) throw new Error('The founded scene is missing a street home');
  return { houses, props, content };
}
