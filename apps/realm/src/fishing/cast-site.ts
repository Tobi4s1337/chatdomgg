import { ROD_MAX_REACH_M, type FishingPierSite, type Vec3 } from '@chatdom/shared';
import type { RealmChannelPose } from '../room-channels';

export type FishingWaterSample = { readonly waterY: number | null; readonly groundY: number };
export type FishingWaterSampler = (x: number, z: number) => FishingWaterSample;
export type FishingCastAim = { readonly ok: true; readonly anchor: Vec3; readonly float: Vec3; readonly depthM: number }
  | { readonly ok: false; readonly message: string };

/** The pier's own metre frame: `right` across the deck, `out` from the bank over the water. */
export function pierFrame(site: FishingPierSite) {
  const right: Vec3 = site.turn === 0 ? [1, 0, 0] : site.turn === 1 ? [0, 0, -1] : site.turn === 2 ? [-1, 0, 0] : [0, 0, 1];
  const out: Vec3 = site.turn === 0 ? [0, 0, 1] : site.turn === 1 ? [1, 0, 0] : site.turn === 2 ? [0, 0, -1] : [-1, 0, 0];
  return { right, out };
}

/** The current adopted installation is supplied by the realm. A site inferred by a browser is never accepted. */
export function onFishingLip(site: FishingPierSite, pose: RealmChannelPose, revision: number): boolean {
  if (!site || site.version !== 1 || site.id !== 'pier:lake' || !pose
    || !Number.isSafeInteger(revision) || revision < 0 || pose.collisionRevision !== revision || !pose.grounded
    || !Number.isInteger(pose.yaw) || pose.yaw < 0 || pose.yaw > 255 || !Array.isArray(pose.position)
    || pose.position.length !== 3 || !pose.position.every(Number.isFinite)
    || !Array.isArray(site.root) || site.root.length !== 3 || !site.root.every(Number.isFinite) || !Number.isFinite(site.deckY) || !Number.isFinite(site.waterY)
    || !Number.isFinite(site.walk) || site.walk <= 0 || ![0, 1, 2, 3].includes(site.turn)) return false;
  const { right, out } = pierFrame(site), dx = pose.position[0] - site.root[0], dz = pose.position[2] - site.root[2];
  const x = dx * right[0] + dz * right[2], z = dx * out[0] + dz * out[2];
  return Math.abs(pose.position[1] - site.deckY) <= .3 && Math.abs(x) <= 3.55
    && z >= site.walk + 2.9 && z <= site.walk + 3.85;
}

/** Server byte yaw (0 = +Z, 64 = +X), not camera radians. Samples the whole open-water cast corridor. */
/** `reachM` is the rod's earned reach (PI12, `fishingRodHistory`): a little further at full draw, never luckier. */
export function aimFishingCast(site: FishingPierSite, pose: RealmChannelPose, revision: number,
  chargeMs: number, sample: FishingWaterSampler, reachM = 0): FishingCastAim {
  const refuse = (message: string): FishingCastAim => ({ ok: false, message });
  if (!onFishingLip(site, pose, revision)) return refuse('Stand at the end of the pier to cast.');
  if (!Number.isFinite(chargeMs) || chargeMs < 200 || chargeMs > 5000) return refuse('Draw the rod back a little before casting.');
  const { out } = pierFrame(site), yaw = pose.yaw * Math.PI * 2 / 256, dx = Math.sin(yaw), dz = Math.cos(yaw);
  const forward = dx * out[0] + dz * out[2];
  if (forward < Math.cos(35 * Math.PI / 180)) return refuse('Face the open water to cast.');
  const fromRootX = pose.position[0] - site.root[0], fromRootZ = pose.position[2] - site.root[2];
  const localZ = fromRootX * out[0] + fromRootZ * out[2];
  const toEdge = (site.walk + 4 - localZ) / forward;
  const reach = Number.isFinite(reachM) ? Math.min(ROD_MAX_REACH_M, Math.max(0, reachM)) : 0;
  const range = 2 + (5 + reach) * Math.min(1, (chargeMs - 200) / 1400), distance = toEdge + range;
  const steps = Math.ceil(range / .25);
  let depthM = 0;
  for (let step = 0; step <= steps; step++) {
    const at = toEdge + range * step / steps;
    const water = sample(pose.position[0] + dx * at, pose.position[2] + dz * at);
    if (water.waterY === null || !Number.isFinite(water.waterY) || !Number.isFinite(water.groundY)
      || Math.abs(water.waterY - site.waterY) > .001 || water.waterY - water.groundY < 1) return refuse('There is no deep, open water along that cast.');
    depthM = water.waterY - water.groundY;
  }
  return { ok: true, anchor: [...pose.position], float: [pose.position[0] + dx * distance, site.waterY, pose.position[2] + dz * distance], depthM };
}
