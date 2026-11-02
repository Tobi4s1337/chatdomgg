// The kingdom set piece's shots: tobi4s_'s town (seed willowmere, town tier) as the stream shows it, staged in
// the product's own scene. Every number here is a function of shot time t; `index.ts` turns it into poses, presence
// frames, goals and acts.
//
// Points are keyed to the real layout: an anchor resolved from the generated plan at load, plus a world-space offset
// in metres. Anchors:
//   gate          the castle gate node (Crown Road's top end)
//   market        the market node
//   door:<slot>   the doorstep a citizen walks home to (the end of their arrival route)
//   start:<slot>  where that citizen's walk home begins
//   crown:<m>     the point on Crown Road this many metres down from the gate (measured along the road)
//   world         the origin
//
// Two ways of driving the town:
//   presence  our own presence feed (origin simulated): we choose which windows are lit and when one lights. The
//             scene's clock follows Date.now, which this page holds to the shot clock.
//   native    the scene's own simulated evening, seeked to a fixed kingdom second every frame. Needed where the
//             product only offers its staging on that feed (the castle gate's dock sites, and the Forge's fixture
//             home, which is the simulation's first arrival).

export type Point = readonly [anchor: string, dx: number, dy: number, dz: number];
export interface CameraKey { readonly eye: Point; readonly target: Point; readonly fov: number }
export type Ease = 'inout' | 'gentle' | 'drift';

/** A home whose window lights at `at` seconds of the take. A look of 'none' lights the window with nobody walking. */
export interface Arrival { readonly slot: number; readonly at: number; readonly look?: string }
/** A present citizen sent along the streets to a public node, arriving there at `arrive` seconds of the take. */
export interface Errand { readonly slot?: number; readonly to: string; readonly arrive: number }

interface ShotBase {
  readonly id: string;
  /** Seconds. The take is [0, duration). */
  readonly duration: number;
  /** Hour of the evening (the scene's sky grade). */
  readonly hour: number;
  readonly what: string;
  /** Camera keys, spread evenly along one eased move (by distance travelled, so speed never jumps at a key). */
  readonly camera: readonly CameraKey[];
  readonly ease: Ease;
  /** Citizens on their way somewhere during the take. */
  readonly errands?: readonly Errand[];
}

export interface PresenceShot extends ShotBase {
  readonly mode: 'presence';
  /** Share of homes already lit (and their people home) before the take, chosen by a fixed hash of the slot. */
  readonly lit: number;
  /** Homes that are always lit, or never lit, before the take, whatever the hash says. */
  readonly alsoLit?: readonly number[];
  readonly dark?: readonly number[];
  readonly arrivals?: readonly Arrival[];
}

export interface NativeShot extends ShotBase {
  readonly mode: 'native';
  /** The simulated evening's second at t = 0 (everyone has long since arrived home). */
  readonly at: number;
  /** Seconds of a longer take this shot continues: S18 is S17 from t = 4, so both share one gate ceremony. */
  readonly offset?: number;
  /** The gate's dock act (gate-open), on the shared take clock. */
  readonly gateOpensAt?: number;
  /** Forge fixture: the ritual's second at t = 0 (the dragon chimney's flight ends at 19 s). */
  readonly forgeAt?: number;
}

export type Shot = PresenceShot | NativeShot;

/** nachteule_42, the lurker: a follower since 2022 with a hearth cottage in the old quarter (Hearthward). */
export const LURKER = { slot: 8, look: 'dusk' } as const;
/** A small hearth hut on a side lane in Copperleaf (2024), for the window that lights with nobody in the street. */
export const QUIET_HOME = 2061;

// Shared by S17 and S18: one gate ceremony on one clock.
const GATE_ERRANDS: readonly Errand[] = [
  { to: 'castle:gate', arrive: 8.5 }, { to: 'castle:gate', arrive: 11 }, { to: 'castle:gate', arrive: 13 },
  { to: 'castle:gate', arrive: 15.5 }, { to: 'castle:gate', arrive: 18 }, { to: 'castle:gate', arrive: 20 },
  { to: 'castle:gate', arrive: 23 }, { to: 'castle:gate', arrive: 26 }, { to: 'castle:gate', arrive: 29 },
  { to: 'castle:gate', arrive: 32 },
];

export const SHOTS: Record<string, Shot> = {
  S05: {
    id: 'S05', mode: 'presence', duration: 4, hour: 18.2, ease: 'gentle', lit: .35, dark: [LURKER.slot],
    what: 'Low tracking shot up the last straight of Crown Road towards the castle gate; townsfolk with lanterns walk ahead.',
    errands: [
      { to: 'castle:gate', arrive: 9 }, { to: 'castle:gate', arrive: 14 }, { to: 'castle:gate', arrive: 19 },
      { to: 'castle:gate', arrive: 24 }, { to: 'castle:gate', arrive: 28.5 }, { to: 'castle:gate', arrive: 33 },
      { to: 'castle:gate', arrive: 37 },
    ],
    camera: [
      { eye: ['crown:31', 0, 1.9, 4.2], target: ['gate', -3, 6.5, 1.5], fov: 46 },
      { eye: ['crown:24', 0, 1.8, 3.8], target: ['gate', -3, 6.5, 1.5], fov: 45 },
    ],
  },
  S06: {
    id: 'S06', mode: 'presence', duration: 4, hour: 18.6, ease: 'inout', lit: .4, dark: [LURKER.slot],
    what: 'From the gate the camera lifts over the gatehouse and flies down over the town into the old quarter, ending on the lurker\'s dark cottage.',
    camera: [
      { eye: ['gate', 6, 9, 14], target: ['gate', -2, 11, -2], fov: 50 },
      { eye: ['gate', -6, 30, 6], target: ['market', -40, 0, 30], fov: 52 },
      { eye: [`door:${LURKER.slot}`, 34, 22, -26], target: [`door:${LURKER.slot}`, -2, 2, 2], fov: 48 },
      // Lands on S07's first frame, so the two cut as one move.
      { eye: [`door:${LURKER.slot}`, 12, 4.2, -11], target: [`door:${LURKER.slot}`, -1, 2.4, 6.5], fov: 44 },
    ],
  },
  S07: {
    id: 'S07', mode: 'presence', duration: 4, hour: 19.0, ease: 'drift', lit: .45, dark: [LURKER.slot],
    what: 'The lurker\'s cottage in the old quarter; at 2.5 s their window lights and they appear up the lane, lantern in hand, heading home.',
    arrivals: [{ slot: LURKER.slot, at: 2.5, look: LURKER.look }],
    camera: [
      { eye: [`door:${LURKER.slot}`, 12, 4.2, -11], target: [`door:${LURKER.slot}`, -1, 2.4, 6.5], fov: 44 },
      { eye: [`door:${LURKER.slot}`, 11.2, 4.0, -10.2], target: [`door:${LURKER.slot}`, -1, 2.4, 6.5], fov: 43 },
    ],
  },
  S09: {
    id: 'S09', mode: 'presence', duration: 3, hour: 20.2, ease: 'drift', lit: .6, dark: [QUIET_HOME],
    what: 'A small hut on a side lane in Copperleaf; its window lights at 1.0 s with nobody in the street. Slow push-in.',
    arrivals: [{ slot: QUIET_HOME, at: 1, look: 'none' }],
    camera: [
      { eye: [`door:${QUIET_HOME}`, -15, 3.1, -6.2], target: [`door:${QUIET_HOME}`, 1.2, 2.7, -1.4], fov: 40 },
      { eye: [`door:${QUIET_HOME}`, -13, 2.9, -5.4], target: [`door:${QUIET_HOME}`, 1.2, 2.7, -1.4], fov: 39 },
    ],
  },
  S12: {
    id: 'S12', mode: 'native', duration: 4, hour: 19.8, ease: 'drift', at: 480, forgeAt: 17.4,
    what: 'The forged sleeping-dragon chimney flies in over the rooftops, lands on its house and settles; smoke curls from it. Neighbours\' windows are lit.',
    camera: [
      { eye: ['door:43', 10.5, 8.6, 12], target: ['door:43', -8.5, 10.6, 0], fov: 32 },
      { eye: ['door:43', 9.7, 8.3, 11.1], target: ['door:43', -8.5, 10.4, 0], fov: 31 },
    ],
  },
  S17: {
    id: 'S17', mode: 'native', duration: 4, hour: 23.0, ease: 'drift', at: 480, gateOpensAt: .6, errands: GATE_ERRANDS,
    what: 'The gate wakes: low in front of the gate, looking up at the gatehouse, the braziers catch and sparks rise while townsfolk with lanterns walk up to it.',
    camera: [
      { eye: ['gate', 18, 2.6, 18], target: ['gate', -2, 7.5, -2], fov: 44 },
      { eye: ['gate', 16.5, 2.5, 16.5], target: ['gate', -2, 7.6, -2], fov: 43 },
    ],
  },
  S18: {
    id: 'S18', mode: 'native', duration: 3, hour: 23.0, ease: 'inout', at: 480, offset: 4, gateOpensAt: .6, errands: GATE_ERRANDS,
    what: 'Ride out: from below the gate the camera rises past the gatehouse and turns out over the lit town towards the land beyond, ending high, looking out and down.',
    camera: [
      { eye: ['gate', 16.5, 2.5, 16.5], target: ['gate', -2, 7.6, -2], fov: 43 },
      { eye: ['gate', 18, 28, 12], target: ['gate', -55, 2, 40], fov: 46 },
      { eye: ['gate', 20, 70, 10], target: ['gate', -90, -15, 150], fov: 50 },
    ],
  },
  S22: {
    id: 'S22', mode: 'presence', duration: 7, hour: 21.8, ease: 'drift', lit: .85, alsoLit: [LURKER.slot],
    what: 'Slow drift from the green across the old quarter\'s lane towards the lurker\'s lit window, the lit row beyond it, low hills and a calm night sky in the upper third for a title.',
    camera: [
      { eye: [`door:${LURKER.slot}`, 17, 8.5, -15], target: [`door:${LURKER.slot}`, -1.2, 5.5, 0.5], fov: 40 },
      { eye: [`door:${LURKER.slot}`, 13, 6.8, -10.5], target: [`door:${LURKER.slot}`, -1.2, 5.2, 0.5], fov: 39 },
    ],
  },
};

/** For the edit: every shot's length in seconds. */
export const DURATIONS: Record<string, number> = Object.fromEntries(Object.values(SHOTS).map(shot => [shot.id, shot.duration]));
