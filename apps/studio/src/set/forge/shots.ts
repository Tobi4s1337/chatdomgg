// The Forge set's shots, as data. Camera keys are in metres relative to the top centre of the anvil's work
// surface (+x toward the horn, +z toward the engraved cheek, the side the audience stands on), keyed by shot
// second. Shot time is ritual time: t = 0 is the first instant of the words.
export interface CameraKey {
  /** Shot second. */
  at: number;
  /** Eye and look-at point, metres from the anvil's top centre. */
  eye: readonly [number, number, number];
  look: readonly [number, number, number];
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface ForgeShot {
  id: string;
  /** Take length in seconds of shot time. */
  duration: number;
  /** Ritual second at shot second 0. */
  ritual: number;
  /** Camera keys, in time order; the path passes through every one with continuous velocity. */
  keys: readonly CameraKey[];
  /** The moments the edit cuts from the take, as suggested `from=` values. */
  moments?: Readonly<Record<string, number>>;
}

// S11: the whole ritual up to the strike, one continuous move. Low and close on the anvil while the runes rise;
// up and back as the blueprint glows over it; out to the side for the pour so its light falls across the yard and
// the workshop; then in tight and low for the hammer and its sparks.
const S11: ForgeShot = {
  id: 'S11', duration: 13, ritual: 0,
  moments: { runes: 1.5, blueprint: 4, pour: 8, strike: 12.4 },
  keys: [
    // Words: low beside the engraved cheek as the runes lift off it, easing back as their ring opens overhead.
    { at: 0, eye: [-1.6, -.42, 3.8], look: [0, .3, 0], fov: 40 },
    { at: 1.5, eye: [-1.2, -.38, 5.2], look: [0, 1.05, 0], fov: 40 },
    { at: 3, eye: [-.5, -.15, 6.2], look: [0, 1.3, 0], fov: 40 },
    // Blueprint: up and back so the whole drawing glows over the anvil against the dusk.
    { at: 4, eye: [.35, .25, 7.4], look: [0, 1.4, 0], fov: 40 },
    { at: 5.2, eye: [1.4, .7, 8.2], look: [.1, 1.8, 0], fov: 40 },
    // Pour: out to the side, crucible to anvil in frame, the metal's light across the yard and the workshop.
    { at: 8, eye: [3.0, 1.3, 9.6], look: [.2, 2.0, 0], fov: 41 },
    { at: 10.6, eye: [3.6, 1.7, 8.4], look: [0, 2.6, 0], fov: 39 },
    // Seal and strike: in tight, a little below the hammer's face, the swing seen side on.
    { at: 12.2, eye: [1.8, 2.5, 6.0], look: [-.6, 3.4, 0], fov: 36 },
    { at: 13, eye: [1.55, 2.55, 5.6], look: [-.6, 3.3, 0], fov: 35 },
  ],
};

export const SHOTS: Readonly<Record<string, ForgeShot>> = { S11 };
