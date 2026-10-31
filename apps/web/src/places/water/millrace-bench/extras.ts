import { createFingerpost, type FingerpostDestination } from '../../../../../../packages/content/src/places/water/fingerpost/index';
import { createMill } from '../../../../../../packages/content/src/places/water/mill/index';
import type { FixtureExtras } from './fixture';

/**
 * SIMULATED destinations for the bridge-foot fingerpost: the fixture's castle court lies up the hill to the
 * north-east, the market back over the bridge to the east and the road out runs south. Bearings are directions
 * in world x/z; the host derives the real ones from the land's anchors.
 */
const DESTINATIONS: readonly (readonly [FingerpostDestination, number, number])[] = [
  ['castle', 0.55, -1], ['market', 1, 0.12], ['road', -0.2, 1],
];

/** Yaw that turns an arm's local +X onto a world x/z direction. */
const yawTowards = (dx: number, dz: number) => Math.atan2(-dz, dx);

/** The mill and fingerpost composed into the review. */
export function reviewExtras(): FixtureExtras {
  const { post, arms } = createFingerpost('hearth', DESTINATIONS.map(([destination]) => destination));
  return {
    mill: createMill('grove'),
    fingerpost: {
      post,
      arms: arms.map((arm, i) => ({ mount: arm.mount, piece: arm.piece, yaw: yawTowards(DESTINATIONS[i]![1], DESTINATIONS[i]![2]) })),
    },
  };
}
