// The raid shots, as data. Each one stages the product's own incoming-raid moment (twitch-moments: the gate wakes
// under the raider's banner, the braziers catch and the caravan rolls in along the gift road) in a real kingdom, and
// flies the camera along that road.
//
// Places are given in road coordinates, so a shot follows the kingdom's own gate and street: `s` is metres along the
// caravan's road from the raid gate (negative is outside the gate, on the line of the first stretch), `side` is metres
// across it (positive is the side the raider's standard stands on), `up` is metres above the road.
//
// `beatAt` is the raid's own clock at shot time 0, in ms since the gate began to wake (see RAID_BEAT in
// apps/web/src/twitch-moments/raid-beat.ts: the lead wagon comes through at 3400 ms and each next one 3600 ms later).

export interface RoadSpot { readonly s: number; readonly side: number; readonly up: number }

export interface CameraKey {
  readonly t: number;
  readonly eye: RoadSpot;
  readonly look: RoadSpot;
  readonly fov: number;
  /** The look point leans toward wagon `wagon` of the column by `weight` (0..1), `up` metres over its road. */
  readonly follow?: { readonly wagon: number; readonly weight: number; readonly up: number };
}

/** Whose kingdom the raid arrives in: tobi4s_'s simulated town, or MashaD4's land grown from her own seed. */
export type Destination = 'tobi4s' | 'mashad4';

export interface RaidShot {
  readonly id: string;
  readonly duration: number;
  readonly hour: number;
  readonly destination: Destination;
  /** The raid as Twitch reports it: who leaves, and how many viewers ride along (it only sizes the caravan). */
  readonly raid: { readonly from: { readonly kingdomId: string; readonly name: string }; readonly viewers: number };
  readonly beatAt: number;
  readonly keys: readonly CameraKey[];
  /**
   * The town's windows. `lit` is the share of homes lit before the shot (people at home in chat). `wave` lights the
   * rest outward from the raid gate as the guests come in: a home at distance d (m) lights at
   * `start + d / speed` seconds of shot time, give or take `jitter`.
   */
  readonly windows: { readonly lit: number; readonly wave?: { readonly start: number; readonly speed: number; readonly jitter: number } };
}

/** The channels on screen (real, consenting): their Twitch IDs are their kingdom IDs and draw their arms. */
export const CHANNELS = {
  tobi4s: { kingdomId: '129634568', name: 'tobi4s_' },
  pinkkittyrose: { kingdomId: '4363967', name: 'PinkKittyRose' },
  mashad4: { kingdomId: '154972160', name: 'MashaD4' },
  aggman: { kingdomId: '63920635', name: 'The_AGGman' },
} as const;

export const SHOTS: Record<string, RaidShot> = {
  // S15, the caravan: PinkKittyRose raids tobi4s_ with 48 viewers (three wagons). Low beside the road a little
  // inside the gate, looking back at it under her standard: the lead wagon rolls toward us and passes close at about
  // 3.6 s, the second follows it through the brazier's light and the third comes through the gate at 3 s. The camera
  // drifts a step with the column.
  S15: {
    id: 'S15', duration: 4, hour: 20.3, destination: 'tobi4s',
    raid: { from: CHANNELS.pinkkittyrose, viewers: 48 },
    beatAt: 7600,
    keys: [
      { t: 0, eye: { s: 15.4, side: -3.3, up: 1.45 }, look: { s: 1, side: 0.2, up: 2.3 }, fov: 42, follow: { wagon: 0, weight: 0.42, up: 1.5 } },
      { t: 4, eye: { s: 17.2, side: -3.5, up: 1.5 }, look: { s: 1.5, side: 0.2, up: 2.3 }, fov: 42, follow: { wagon: 0, weight: 0.5, up: 1.5 } },
    ],
    windows: { lit: 0.78 },
  },
  // S16, the column: a raid big enough for the longest caravan (twelve wagons) under The_AGGman's arms. The camera
  // starts low behind the gate's standard and cranes up and back until the whole line of lanterns runs along the
  // street to the market, with the castle on its hill and the sky above the town. Later than the suggested 20.6 h: at
  // 21.2 h the wagons' lanterns and the windows carry the line, where at 20.6 h the street was still too bright for them.
  S16: {
    id: 'S16', duration: 3, hour: 21.2, destination: 'tobi4s',
    raid: { from: CHANNELS.aggman, viewers: 100_000 },
    beatAt: 40_000,
    keys: [
      { t: 0, eye: { s: -5, side: -4, up: 2.4 }, look: { s: 14, side: 0, up: 1.8 }, fov: 46 },
      { t: 3, eye: { s: -18, side: -11, up: 21 }, look: { s: 48, side: 2, up: 7 }, fov: 46 },
    ],
    windows: { lit: 0.8 },
  },
  // S20, the arrival: tobi4s_ rides out to MashaD4 with about thirty viewers (three wagons). At her gate, low beside
  // the road just outside it, looking in: the braziers blaze either side, tobi4s_'s standard hangs from the pole, the
  // lead wagon rolls past us through the gate and on into her town, and the town's windows light ahead of it in a wave
  // running outward from the gate. The camera eases a few steps in after the wagon.
  S20: {
    id: 'S20', duration: 3, hour: 23.2, destination: 'mashad4',
    raid: { from: CHANNELS.tobi4s, viewers: 30 },
    beatAt: 3600,
    keys: [
      { t: 0, eye: { s: -7, side: -2.6, up: 2.1 }, look: { s: 26, side: 0.4, up: 3.2 }, fov: 50 },
      { t: 3, eye: { s: -4.6, side: -2.4, up: 2.3 }, look: { s: 28, side: 0.4, up: 3.4 }, fov: 50 },
    ],
    windows: { lit: 0.12, wave: { start: 0.3, speed: 30, jitter: 0.3 } },
  },
};

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The two keys around t and the eased blend between them: the move eases in and out at its ends only. */
export function sampleKeys(keys: readonly CameraKey[], t: number): { a: CameraKey; b: CameraKey; u: number } {
  if (t <= keys[0]!.t) return { a: keys[0]!, b: keys[0]!, u: 0 };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!;
    if (t > b.t) continue;
    const raw = (t - a.t) / (b.t - a.t), first = i === 1, last = i === keys.length - 1;
    const u = first && last ? smooth(raw) : first ? 2 * smooth(raw / 2) : last ? 2 * smooth(0.5 + raw / 2) - 1 : raw;
    return { a, b, u };
  }
  const end = keys[keys.length - 1]!;
  return { a: end, b: end, u: 0 };
}
