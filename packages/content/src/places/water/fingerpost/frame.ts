import type { Vec3 } from '@chatdom/shared';

/** The only places a fingerpost may point at. The host supplies which of them exist and their bearings. */
export const FINGERPOST_DESTINATIONS = ['castle', 'market', 'lake', 'road'] as const;
export type FingerpostDestination = (typeof FINGERPOST_DESTINATIONS)[number];

/**
 * The fingerpost's frame, frozen so the post's collars and every arm's root agree. Arms point at arbitrary world
 * bearings, which a cardinal blueprint cannot, so each arm is its own piece pointing along local +X from its
 * root; the host sets that root on a post collar and yaws it about +Y. Each arm owns a band of height of its own,
 * so two arms at any pair of bearings may cross in plan but never meet.
 */
export const FINGERPOST = {
  /** The post blueprint's square plan, and its vertical axis on the cell corner (6, 6). */
  plan: 12,
  axis: [6, 6] as const,
  /** Half-open span of the 4 × 4 timber on both horizontal axes: half a metre of post. */
  timber: [4, 8] as const,
  /** The dressed plinth's span, and the iron collar bands' span (they stand one cell proud of the timber). */
  plinth: [2, 10] as const,
  band: [3, 9] as const,
  /** Underside of the lowest arm: 2 m, the headroom every water-place walk keeps. */
  clearance: 16,
  /** One arm's band of height, which is also its board's height. */
  pitch: 5,
  maxArms: 4,
  /** Above the top arm: an iron band, a cap plate, a neck, a two-cell ball and its tip. */
  crown: 6,
  arm: {
    /** 3.1 m out from the post's axis, 0.625 m tall, 0.5 m through the proud emblem. */
    size: [25, 5, 4] as const satisfies Vec3,
    /** The root on the post's axis at the board's mid-height; the host's yaw turns about it. */
    root: [0, 2.5, 2] as const satisfies Vec3,
    /** The board's half-open Z span: two cells thick, centred on the root. */
    board: [1, 3] as const,
    /** Half-open X spans along the board: the iron shoe against the post, the name face and the emblem plaque. */
    shoe: [2, 4] as const,
    name: [4, 14] as const,
    plaque: [14, 21] as const,
    /**
     * Where each row of the board ends, bottom to top: a cell of wood frames the plaque, then the finger steps
     * two cells and one to a point, a chevron that still reads as pointing from ten metres.
     */
    point: [22, 24, 25, 24, 22] as const,
  },
} as const;

export interface FingerpostFrame {
  /** Height of the post blueprint: the tip of its finial, in cells. */
  readonly height: number;
  /** The iron bands under the lowest arm and over the highest. */
  readonly bands: readonly [number, number];
  /** One collar per arm, top first: the arm's band starts at `floor`, its root sits at `position`. */
  readonly collars: readonly { readonly id: string; readonly floor: number; readonly position: Vec3 }[];
}

/** The post's heights for `count` arms: arm 0 sits right under the crown, the rest stacked downward. */
export function fingerpostFrame(count: number): FingerpostFrame {
  if (!Number.isInteger(count) || count < 1 || count > FINGERPOST.maxArms) {
    throw new RangeError(`fingerpost: a post carries 1..${FINGERPOST.maxArms} arms, not ${count}.`);
  }
  const { clearance, pitch, crown, axis, arm } = FINGERPOST, top = clearance + count * pitch;
  return {
    height: top + crown,
    bands: [clearance - 1, top],
    collars: Array.from({ length: count }, (_, i) => {
      const floor = top - (i + 1) * pitch;
      return { id: `arm-${i}`, floor, position: [axis[0], floor + arm.root[1], axis[1]] as Vec3 };
    }),
  };
}

export function checkDestination(form: string, destination: FingerpostDestination): void {
  if (!(FINGERPOST_DESTINATIONS as readonly string[]).includes(destination)) {
    throw new RangeError(`${form}: unknown destination ${String(destination)}.`);
  }
}

/** A supplied list is one to four known, distinct destinations; nothing is made up to fill a post. */
export function checkDestinations(form: string, destinations: readonly FingerpostDestination[]): void {
  if (!Array.isArray(destinations) || destinations.length === 0) throw new RangeError(`${form}: no destinations supplied.`);
  if (destinations.length > FINGERPOST.maxArms) {
    throw new RangeError(`${form}: ${destinations.length} destinations, at most ${FINGERPOST.maxArms}.`);
  }
  for (const d of destinations) checkDestination(form, d);
  if (new Set(destinations).size !== destinations.length) throw new RangeError(`${form}: a destination is repeated.`);
}
