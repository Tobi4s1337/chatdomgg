import type { KingdomPhrase } from '@chatdom/audio';
import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import { createAmbiencePhrase } from './phrases';
import type { AmbienceTarget } from './types';

function smooth(distance: number, near: number, far: number): number {
  const t = Math.max(0, Math.min(1, (distance - near) / (far - near)));
  return t * t * (3 - 2 * t);
}

/** Closest point on the installed ellipse, including the interior and its axis cases. */
function shorePoint(lake: SettlementPlan['lake'], x: number, z: number): readonly [number, number] {
  const dx = x - lake.x, dz = z - lake.z;
  const swap = lake.radiusZ > lake.radiusX;
  const a = swap ? lake.radiusZ : lake.radiusX, b = swap ? lake.radiusX : lake.radiusZ;
  const px = Math.abs(swap ? dz : dx), py = Math.abs(swap ? dx : dz);
  let sx: number, sy: number;
  if (a === b) {
    const length = Math.hypot(px, py);
    sx = length ? a * px / length : 0;
    sy = length ? b * py / length : b;
  } else if (py === 0) {
    sx = Math.min(a, a * a * px / (a * a - b * b));
    sy = b * Math.sqrt(Math.max(0, 1 - sx * sx / (a * a)));
  } else {
    // The closest point has one Lagrange multiplier, monotone above -b².
    let low = -b * b;
    let high = Math.hypot(px / a, py / b) > 1 ? a * Math.hypot(px, py) : 0;
    for (let i = 0; i < 32; i++) {
      const t = (low + high) / 2;
      const ex = a * px / (t + a * a), ey = b * py / (t + b * b);
      if (ex * ex + ey * ey > 1) low = t;
      else high = t;
    }
    const t = (low + high) / 2;
    sx = a * a * px / (t + a * a);
    sy = b * b * py / (t + b * b);
  }
  const localX = swap ? sy : sx, localZ = swap ? sx : sy;
  return [lake.x + (dx < 0 ? -localX : localX), lake.z + (dz < 0 ? -localZ : localZ)];
}

/** Presentation only: air outside the built bounds and lapping water at this plan's own shore. */
export function sampleKingdomAmbience(
  plan: Pick<SettlementPlan, 'lake' | 'bounds'>, listener: Vec3, right: Vec3,
): AmbienceTarget {
  const { lake, bounds } = plan;
  const [x, z] = shorePoint(lake, listener[0], listener[2]);
  const dx = x - listener[0], dy = lake.level - listener[1], dz = z - listener[2];
  const distance = Math.hypot(dx, dy, dz);
  const rightLength = Math.hypot(...right);
  const pan = distance > 1e-6 && rightLength > 1e-6
    ? (dx * right[0] + dy * right[1] + dz * right[2]) / (distance * rightLength) : 0;
  const outside = Math.hypot(
    Math.max(bounds.minX - listener[0], 0, listener[0] - bounds.maxX),
    Math.max(bounds.minZ - listener[2], 0, listener[2] - bounds.maxZ),
  );
  return {
    wind: 0.16 + 0.16 * smooth(outside, 0, 24),
    water: 1 - smooth(distance, 2, 36),
    waterPan: Math.max(-1, Math.min(1, pan)),
  };
}

/** Bounded phrases follow the current frame clock; missed time is never replayed or queued. */
export function createKingdomAmbience(play: (phrase: KingdomPhrase) => boolean): {
  update(nowMs: number, target: AmbienceTarget, audible: boolean): void;
  dispose(): void;
} {
  let disposed = false;
  let nextAt = -Infinity;
  return {
    update(nowMs, target, audible) {
      if (disposed || !audible || !Number.isFinite(nowMs) || nowMs < nextAt) return;
      // Consume a declined attempt too: a full mix must not turn this into a per-frame retry loop.
      nextAt = nowMs + 1600;
      play(createAmbiencePhrase(target));
    },
    dispose() { disposed = true; },
  };
}
