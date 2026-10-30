import { createHome, createHearthHome, createTideHome, type StyleKey } from '@chatdom/content';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { homeOrigin, type SettlementHome } from '@chatdom/world';
import { homeFingerprint } from './assembly';

export type ForgeHostPlot = Pick<SettlementHome, 'slot' | 'position' | 'rotation' | 'tier' | 'style' | 'variant'>;
export interface NativeForgeHost {
  readonly slot: number;
  readonly family: StyleKey;
  readonly blueprint: VoxelBlueprint;
  readonly position: Vec3;
  readonly yaw: number;
}

/** One native-content resolver for both the street and server. It establishes no ownership or eligibility. */
export function createNativeForgeHost(plot: ForgeHostPlot): NativeForgeHost {
  const variant = plot.variant;
  if (variant !== 0 && variant !== 1 && variant !== 2) throw new Error('Unknown native home family variant.');
  const blueprint = plot.style === 'hearth' ? createHearthHome(plot.tier, variant)
    : plot.style === 'tide' ? createTideHome(plot.tier, variant) : createHome(plot.tier, plot.style, variant);
  return { slot: plot.slot, family: plot.style, blueprint,
    position: homeOrigin(plot, blueprint.size[2] * VOXEL_METRES.build), yaw: plot.rotation * Math.PI / 2 };
}

/** Resolve only against the server's settlement, never a prompt's house, palette or transform. */
export function resolveNativeForgeHost(layout: { readonly homes: readonly ForgeHostPlot[]; readonly revision: string }, slot: number):
  (NativeForgeHost & { readonly layoutRevision: string; readonly hostFingerprint: string }) | null {
  if (!Number.isInteger(slot) || slot < 0 || slot > 65534) return null;
  const plot = layout.homes.find(home => home.slot === slot);
  if (!plot) return null;
  const host = createNativeForgeHost(plot);
  return { ...host, layoutRevision: layout.revision, hostFingerprint: homeFingerprint(host.blueprint) };
}
