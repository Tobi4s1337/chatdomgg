import type { WindowHouse } from '@chatdom/render';
import { REALM_CASTLE_SLOT } from '@chatdom/shared/realm';
import { MAT } from '@chatdom/content';

/** A presence-only view of the installed keep; the physical placement remains untouched. */
export function royalWindow(forgeHosts: readonly WindowHouse[]): WindowHouse | undefined {
  const keep = forgeHosts.find(host => host.slot === REALM_CASTLE_SLOT);
  if (!keep) return undefined;
  // The central keep already has these authored upper lancets, below the separate beacon chamber.
  // The crown of this lancet clears the keep's pitched roof. Designate that existing surface as the monarch's light without changing any host/collision bytes.
  const lancet = keep.blueprint.boxes.find(box => box.material === MAT.darkStone
    && box.from[0] === 115 && box.from[1] === 128 && box.from[2] === 134
    && box.to[0] === 120 && box.to[1] === 159 && box.to[2] === 139);
  const last = [...keep.blueprint.boxes].reverse().find(box => box.from[0] <= 117 && box.to[0] > 117
    && box.from[1] <= 145 && box.to[1] > 145 && box.from[2] <= 138 && box.to[2] > 138);
  if (/^castle-(hearth|tide|grove)$/.test(keep.blueprint.id) && lancet && last?.material === MAT.darkStone) {
    return { ...keep, blueprint: { ...keep.blueprint, windows: [
      { id: 'monarch-upper-lancet', centre: [117.5, 160, 139.04], width: 3, height: 6, facing: 'south' },
    ] } };
  }
  const angles = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 } as const;
  const pane = keep.blueprint.windows
    .filter(window => Math.cos(angles[window.facing] + keep.yaw) > 0.5)
    .reduce<(typeof keep.blueprint.windows)[number] | undefined>((lowest, window) =>
      !lowest || window.centre[1] < lowest.centre[1] ? window : lowest, undefined);
  if (!pane) return undefined;
  return { ...keep, blueprint: { ...keep.blueprint, windows: [pane] } };
}
