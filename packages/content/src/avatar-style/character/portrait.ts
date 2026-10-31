import type { Hex } from './colour';

/*
 * The bust portrait's fixed composition (spec L6): every citizen framed identically, so a wall of portraits
 * reads as a set and the hair is what differs. Engine-free numbers; the web renderer turns them into a
 * camera, lights and a background.
 */
export const PORTRAIT_SIZES = [128, 512] as const;
export type PortraitSize = typeof PORTRAIT_SIZES[number];

export const PORTRAIT = {
  /** Rendered at this multiple and filtered down, so 128 px edges stay crisp without shimmering. */
  supersample: 2,
  /** Twitch-purple, lilac at the top left to deep violet at the bottom right. */
  gradient: { from: '#cfaaff' as Hex, mid: '#b089f7' as Hex, to: '#6a39e0' as Hex },
  camera: {
    /** Turned toward the person's right, so their left cheek and the side of the hair show. */
    yawDegrees: 24,
    pitchDegrees: 10,
    fovDegrees: 24,
    /** Cells: the frame spans `halfHeight` above and below the target. */
    target: [0, 19.6, 0] as const,
    halfHeight: 10.2,
  },
  light: {
    /** Toward the key light, character space: high, nearly frontal, a little from the person's left. */
    key: { direction: [.35, .6, .85] as const, intensity: 3.1, colour: '#fff6ea' as Hex },
    /** A cool rim from behind the camera side, so dark hair keeps its silhouette against the purple. */
    rim: { direction: [-.7, .35, -.6] as const, intensity: .55, colour: '#d9c8ff' as Hex },
    sky: { colour: '#f6f0ff' as Hex, ground: '#8a5fd6' as Hex, intensity: 1.65 },
  },
  /** Bevel width as a fraction of a cell, for convex edges only. */
  bevel: .13,
} as const;

/** Camera position in cells for the portrait composition. */
export function portraitEye(): readonly [number, number, number] {
  const { yawDegrees, pitchDegrees, fovDegrees, target, halfHeight } = PORTRAIT.camera;
  const yaw = yawDegrees * Math.PI / 180, pitch = pitchDegrees * Math.PI / 180;
  const distance = halfHeight / Math.tan(fovDegrees * Math.PI / 360);
  return [target[0] - Math.sin(yaw) * Math.cos(pitch) * distance, target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(yaw) * Math.cos(pitch) * distance];
}
