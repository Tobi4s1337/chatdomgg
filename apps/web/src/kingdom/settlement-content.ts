import { createHome, createHearthHome, createStreetProp, type StreetPropForm } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { terrainHeight, type KingdomLayout } from '@chatdom/world';

export interface Dressing { readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly yaw: number }

/** Installed, reviewed Hearth families cover every tier; other styles retain
 * their authored core kit until their own content lanes are accepted. */
export function createSettlementContent(layout: KingdomLayout): { houses: WindowHouse[]; props: Dressing[] } {
  const houses: WindowHouse[] = [], props: Dressing[] = [];
  for (const plot of layout.homes) {
    const authored = plot.style === 'hearth';
    const blueprint = authored ? createHearthHome(plot.tier, plot.variant as 0 | 1 | 2) : createHome(plot.tier, plot.style, plot.variant);
    const streetZ = plot.rotation === 0 ? plot.lot.maxZ + 4 : plot.lot.minZ - 4;
    const depth = blueprint.size[2] * .125, yaw = plot.rotation * Math.PI / 2;
    const position: Vec3 = plot.rotation === 0
      ? [plot.position[0] - 4, plot.position[1], streetZ - 4 - depth]
      : [plot.position[0] + 4, plot.position[1], streetZ + 4 + depth];
    houses.push({ slot: plot.slot, blueprint, position, yaw });
    if (plot.style === 'grove') continue;
    // Small public front-garden edges, outside the full reserved home. The
    // central entrance band stays clear for the authored doors and name views.
    const turn = plot.rotation === 0 ? 1 : -1;
    const add = (form: StreetPropForm, x: number, z: number) => {
      const b = createStreetProp(form, plot.style as 'hearth' | 'tide');
      const wx = position[0] + turn * x, wz = position[2] + turn * (depth + z);
      const y = terrainHeight(layout, wx + turn * b.size[0] / 16, wz + turn * b.size[2] / 16);
      props.push({ blueprint: b, position: [wx, y, wz], yaw });
    };
    add(plot.ordinal % 2 ? 'flower-pot' : 'leafy-shrub', .125, .125);
    add(plot.ordinal % 3 ? 'flower-trough' : 'rock-cluster', 6, .125);
    // A short joined fence or wall on selected gardens; opening stays generous.
    if (plot.ordinal % 4 === 0) {
      const kind = plot.ordinal % 8 === 0 ? 'wall' : 'fence';
      add(`${kind}-straight`, 5.5, 1.75);
      add(`${kind}-end`, 7.5, 1.75);
    }
  }
  return { houses, props };
}
