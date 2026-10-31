import type { WindowHouse } from '@chatdom/render';
import { REALM_CASTLE_SLOT } from '@chatdom/shared/realm';

/** A presence-only view of the installed keep; the physical placement remains untouched. */
export function royalWindow(forgeHosts: readonly WindowHouse[]): WindowHouse | undefined {
  const keep = forgeHosts.find(host => host.slot === REALM_CASTLE_SLOT);
  if (!keep) return undefined;
  const angles = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 } as const;
  const pane = keep.blueprint.windows
    .filter(window => Math.cos(angles[window.facing] + keep.yaw) > 0.5)
    .reduce<(typeof keep.blueprint.windows)[number] | undefined>((lowest, window) =>
      !lowest || window.centre[1] < lowest.centre[1] ? window : lowest, undefined);
  if (!pane) return undefined;
  return { ...keep, blueprint: { ...keep.blueprint, windows: [pane] } };
}
