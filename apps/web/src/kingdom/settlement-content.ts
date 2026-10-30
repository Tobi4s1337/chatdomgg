import { createHome, createHearthHome, createTideHome, createStreetProp, createMarketWell, createMarketStall, type StreetPropForm } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { homeOrigin, terrainHeight, transformCardinalPoint, type KingdomLayout, type SettlementHome, type SettlementPlan } from '@chatdom/world';

export interface Dressing { readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly yaw: number }
type ContentPlot = Pick<SettlementHome, 'slot' | 'position' | 'rotation' | 'tier' | 'style' | 'variant' | 'ordinal'>;

/** Civic furnishings leave the main meeting of the streets open. */
export function placeMarketContent(market:SettlementPlan['market']):Dressing[] {
  return [
    {blueprint:createMarketWell(),position:[8,market.elevation,16],yaw:0},
    {blueprint:createMarketStall(0),position:[-14,market.elevation,0],yaw:0},
    {blueprint:createMarketStall(1),position:[-14,market.elevation,17],yaw:0},
  ];
}

/** Installed, reviewed Hearth families cover every tier; other styles retain
 * their authored core kit until their own content lanes are accepted. */
export function createSettlementContent(layout: KingdomLayout): { houses: WindowHouse[]; props: Dressing[] } {
  return placeSettlementContent(layout.homes, (x, z) => terrainHeight(layout, x, z));
}

/** Place a plan's homes and dressings using its own authoritative terrain sampler. */
export function placeSettlementContent(plots: readonly ContentPlot[], ground: (x: number, z: number) => number): { houses: WindowHouse[]; props: Dressing[] } {
  const houses: WindowHouse[] = [], props: Dressing[] = [];
  for (const plot of plots) {
    const blueprint = plot.style === 'hearth' ? createHearthHome(plot.tier, plot.variant as 0 | 1 | 2) : plot.style === 'tide' ? createTideHome(plot.tier, plot.variant as 0 | 1 | 2) : createHome(plot.tier, plot.style, plot.variant);
    const depth = blueprint.size[2] * .125, yaw = plot.rotation * Math.PI / 2;
    const position = homeOrigin(plot, depth);
    houses.push({ slot: plot.slot, blueprint, position, yaw });
    if (plot.style === 'grove') continue;
    // Small public front-garden edges, outside the full reserved home. The
    // central entrance band stays clear for the authored doors and name views.
    const add = (form: StreetPropForm, x: number, z: number) => {
      const b = createStreetProp(form, plot.style as 'hearth' | 'tide');
      const origin = transformCardinalPoint(position, plot.rotation, [x, 0, depth + z]);
      const centre = transformCardinalPoint(origin, plot.rotation, [b.size[0] / 16, 0, b.size[2] / 16]);
      const y = ground(centre[0], centre[2]);
      props.push({ blueprint: b, position: [origin[0], y, origin[2]], yaw });
    };
    // Keep the union of the authored door approaches clear, including the
    // off-centre Hearth and Tide entrances. Small ornaments sit at the edges.
    add('flower-pot', 0, .125);
    add(plot.ordinal % 5 === 0 ? 'leafy-shrub' : plot.ordinal % 3 ? 'flower-trough' : 'rock-cluster', 6, .125);
    // A short joined fence or wall on selected gardens; opening stays generous.
    if (plot.ordinal % 4 === 0) {
      const kind = plot.ordinal % 8 === 0 ? 'wall' : 'fence';
      add(`${kind}-straight`, 5.625, 1.75);
      add(`${kind}-end`, 7.5, 1.75);
    }
  }
  return { houses, props };
}
