import type { RealmFoundedScene } from '@chatdom/world';
import type { WayHome } from './host';

/** The way to your own door: the approach in front of it, from the founded plan. Pure, for tests. */
export function wayHomeFrom(founded: Pick<RealmFoundedScene, 'plan'>, plotId: string | null, feet: readonly [number, number, number],
  forward: readonly [number, number], inside: boolean): WayHome | null {
  if (!plotId) return null;
  const home = founded.plan.homes.find(candidate => candidate.id === plotId);
  if (!home) return null;
  const door = founded.plan.nodes.find(node => node.id === home.approachId)?.position ?? home.position;
  const dx = door[0] - feet[0], dz = door[2] - feet[2], metres = Math.hypot(dx, dz);
  const length = Math.hypot(forward[0], forward[1]) || 1, fx = forward[0] / length, fz = forward[1] / length;
  // Right of a view along +Z is -X: the right vector is (-fz, fx).
  const relative = metres < 1e-6 ? 0 : Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
  return { street: home.street?.trim() ? home.street : null, metres, relative, inside };
}
