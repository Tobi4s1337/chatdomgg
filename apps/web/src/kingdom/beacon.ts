import type { KingdomPresenceFrame } from '@chatdom/shared';

type BeaconFrame = Pick<KingdomPresenceFrame, 'streamLive' | 'connection' | 'windows'>;

/** The live kingdom keeps a quiet pilot light; its people raise the crown into a spectacle. */
export function beaconStrength(frame: BeaconFrame | undefined, capacity: number): number {
  if (!frame?.streamLive || frame.connection !== 'fresh' || capacity <= 0) return 0;
  const fraction = Math.min(1, frame.windows.filter(window => window.present).length / capacity);
  return .18 + .82 * Math.pow(fraction, 2.4);
}
