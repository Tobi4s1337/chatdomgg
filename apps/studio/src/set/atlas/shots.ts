// The Atlas shots as data: lengths, the beats of the raid road, and the camera's ease. Every pose and road state is a
// pure function of shot time t (index.ts), so a still at `from=t` is the same frame a recording reaches at t.
import type { Consenting } from './data';

export interface RoadPlan {
  from: Consenting;
  to: Consenting;
  /** Seconds: the ink starts leaving `from` … reaches `to`. */
  ink: readonly [number, number];
  /** Seconds over which the road's pencil line comes up on the paper (0…1 opacity); null when it is there at once. */
  appear: readonly [number, number] | null;
  /** The raid's travellers, for the column's size (see `caravanCount`); null for a road with no column on it. */
  viewers: number | null;
}

export interface AtlasShot {
  id: 'S19' | 'S21';
  duration: number;
  roads: readonly RoadPlan[];
  camera: 'rise' | 'pullback';
}

/** The raid itself: tobi4s_'s column rides to MashaD4. The ink reaches MashaD4 at 3.9 s. */
const RAID: RoadPlan = { from: 'tobi4s_', to: 'MashaD4', ink: [0.6, 3.9], appear: null, viewers: 38 };

export const SHOTS: Record<AtlasShot['id'], AtlasShot> = {
  // Every raid leaves a road: risen out of tobi4s_'s kingdom, the camera pulls back while the column inks the road to
  // MashaD4, and settles with both holdings and the road composed.
  S19: { id: 'S19', duration: 5, camera: 'rise', roads: [RAID] },
  // The Atlas of Twitch: from that road out to the whole map. The other roads are raids between the consenting
  // channels only, inked in as the map opens.
  S21: {
    id: 'S21', duration: 4, camera: 'pullback',
    roads: [
      { ...RAID, ink: [-1, -1], viewers: null },
      { from: 'PinkKittyRose', to: 'tobi4s_', ink: [0.35, 2.5], appear: [0.2, 0.7], viewers: null },
      { from: 'The_AGGman', to: 'PinkKittyRose', ink: [0.9, 3.0], appear: [0.7, 1.2], viewers: null },
    ],
  },
};

/** S19's column: when it leaves the gate, and how long the rest of it takes to file in at MashaD4. */
export const COLUMN = { out: 0.45, file: [3.9, 4.7] as const };

/** S19's camera: the rise starts this many times closer than the near road shot (the product's own rise). */
export const RISE_START = 2.4;
/** S19's camera eases out over the whole shot; S21's pull-back is done by this second and holds the whole map. */
export const PULLBACK_END = 3.7;
