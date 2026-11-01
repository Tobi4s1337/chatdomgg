import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import { giftRouteOf } from '../../kingdom/moments/anchors';

/**
 * Where the leaving kingdom's camera stands while its party gathers: just outside the gate the town is entered by
 * (the same gate a raid's caravan rolls in through), raised a little, looking in along the road over the dressed near
 * streets to the town and its castle in the evening haze. Never the land's edge or a field of roofs from above.
 */
export interface GateShot { eye: Vec3; target: Vec3; fov: number }

/** A point `distance` metres along a polyline (clamped to its ends). */
export function along(points: readonly Vec3[], distance: number): Vec3 {
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const step = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (step > 0 && left <= step) {
      const k = left / step;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
    left -= step;
  }
  return points[points.length - 1]!;
}

export function gateShotOf(inbound: readonly Vec3[], portrait: boolean): GateShot | null {
  if (inbound.length < 2) return null;
  const gate = inbound[0]!;
  // The road's heading into town, read over its first stretch so a kink at the gate does not swing the shot.
  const ahead = along(inbound, 18);
  const dx = ahead[0] - gate[0], dz = ahead[2] - gate[2];
  const length = Math.hypot(dx, dz);
  if (length < 1) return null;
  const fx = dx / length, fz = dz / length;
  // A little to one side of the road, so it leads in on a diagonal instead of splitting the frame.
  const ax = -fz, az = fx;
  const back = portrait ? 20 : 15, aside = portrait ? 3 : 5.5, rise = portrait ? 15 : 11;
  const look = along(inbound, portrait ? 34 : 40);
  return {
    eye: [gate[0] - fx * back + ax * aside, gate[1] + rise, gate[2] - fz * back + az * aside],
    target: [look[0], look[1] + 2.5, look[2]],
    fov: portrait ? 60 : 44,
  };
}

export function sourceGateShot(layout: SettlementPlan, portrait: boolean): GateShot | null {
  const route = giftRouteOf(layout);
  return route ? gateShotOf(route.inbound, portrait) : null;
}
