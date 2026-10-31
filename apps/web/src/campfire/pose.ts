import { VOXEL_METRES, type AvatarBoneId, type AvatarPartBlueprint, type Vec3 } from '@chatdom/shared';
import { createBodyParts, partMatrix, transformPoint, type AvatarPose } from '@chatdom/content/avatars';
import { AVATAR_PALETTE } from '@chatdom/content/materials';

/*
 * Seated poses on the common avatar rig. The shared citizen renderer only walks, so this is the
 * campfire's own adapter over the same rig maths and compiled parts. Legs are fixed per posture
 * and solved once: soles on the ground, the seat surface exactly under the thighs. Only the upper
 * body moves afterwards, so feet and hips never slide off their contact.
 */

export const SEATED_POSTURES = ['knees', 'lean', 'warm', 'upright'] as const;
export type SeatedPosture = (typeof SEATED_POSTURES)[number];

type Rotations = Partial<Record<AvatarBoneId, Vec3>>;
interface Posture { readonly legs: Rotations; readonly upper: Rotations }

// Degrees, XYZ order. Thighs rest just below horizontal; shins tip forward so feet plant ahead of the knee.
// Every posture shares the legs, so one log height grounds every sitter's soles and hips together.
const LEGS = (thigh: number, shin: number, splay: number): Rotations => ({
  thighLeft: [thigh, 0, -splay], thighRight: [thigh, 0, splay],
  shinLeft: [shin, 0, splay * .6], shinRight: [shin, 0, -splay * .6],
  footLeft: [-(thigh + shin), 0, splay * .4], footRight: [-(thigh + shin), 0, -splay * .4],
});
const SEATED_LEGS = LEGS(-84, 70, 5);
const POSTURES: Record<SeatedPosture, Posture> = {
  // Hands resting on the knees, settled and listening.
  knees: { legs: SEATED_LEGS, upper: { chest: [6, 0, 0], upperArmLeft: [-30, 0, -4], upperArmRight: [-30, 0, 4], forearmLeft: [-44, 0, 0], forearmRight: [-44, 0, 0] } },
  // Elbows to knees, leaning into the conversation.
  lean: { legs: SEATED_LEGS, upper: { chest: [15, 0, 0], head: [-9, 0, 0], upperArmLeft: [-52, 0, -6], upperArmRight: [-52, 0, 6], forearmLeft: [-38, 0, 8], forearmRight: [-38, 0, -8] } },
  // Palms out toward the flame.
  warm: { legs: SEATED_LEGS, upper: { chest: [4, 0, 0], upperArmLeft: [-66, 0, -8], upperArmRight: [-66, 0, 8], forearmLeft: [-22, 0, 10], forearmRight: [-22, 0, -10] } },
  // The Magistrate: upright, hands on thighs.
  upright: { legs: SEATED_LEGS, upper: { chest: [1, 0, 0], upperArmLeft: [-16, 0, -6], upperArmRight: [-16, 0, 6], forearmLeft: [-58, 0, 0], forearmRight: [-58, 0, 0] } },
};

const CELL = VOXEL_METRES.avatar;
let referenceBody: readonly AvatarPartBlueprint[] | undefined;
const body = (): readonly AvatarPartBlueprint[] => referenceBody ??= createBodyParts('balanced', AVATAR_PALETTE.skin[0]);

function corners(part: AvatarPartBlueprint, pose: AvatarPose): Vec3[] {
  const matrix = partMatrix(part, pose);
  const out: Vec3[] = [];
  for (const box of part.boxes) if (box.material !== 0) {
    for (const x of [box.from[0], box.to[0]]) for (const y of [box.from[1], box.to[1]]) for (const z of [box.from[2], box.to[2]]) out.push(transformPoint(matrix, [x * CELL, y * CELL, z * CELL]));
  }
  return out;
}

export interface SeatSolution {
  readonly posture: SeatedPosture;
  /** Root lift in avatar cells that puts the lowest sole exactly on the ground. */
  readonly lift: number;
  /** Height of the seat surface under the thighs, metres above the ground. */
  readonly seatTop: number;
  /** Distance from the root (under the pelvis) forward to the middle of the soles, metres. */
  readonly soleForward: number;
  /** Lowest point of the whole seated body, metres; never below the ground. */
  readonly lowest: number;
  /** Root-local head centre when seated, metres. */
  readonly head: Vec3;
}

const solved = new Map<SeatedPosture, SeatSolution>();

/** Grounds a posture against the actual authored body geometry. Every body family shares the frozen leg joints. */
export function solveSeat(posture: SeatedPosture): SeatSolution {
  const known = solved.get(posture);
  if (known) return known;
  const { legs, upper } = POSTURES[posture];
  const unlifted: AvatarPose = { id: `campfire.${posture}`, label: posture, rotations: { ...legs, ...upper } };
  const parts = body();
  const feet = parts.filter(p => p.attachment === 'footLeft' || p.attachment === 'footRight').flatMap(p => corners(p, unlifted));
  const sole = Math.min(...feet.map(p => p[1]));
  const lift = -sole / CELL;
  const pose: AvatarPose = { ...unlifted, root: [0, lift, 0] };
  // The seat meets the back of the thighs and the seat of the breeches, not the knees.
  const hips = parts.filter(p => p.attachment === 'pelvis' || p.attachment === 'thighLeft' || p.attachment === 'thighRight')
    .flatMap(p => corners(p, pose)).filter(p => p[2] <= .14);
  const seatTop = Math.min(...hips.map(p => p[1]));
  const soles = parts.filter(p => p.attachment === 'footLeft' || p.attachment === 'footRight').flatMap(p => corners(p, pose));
  const soleForward = soles.reduce((n, p) => n + p[2], 0) / soles.length;
  const lowest = Math.min(...parts.flatMap(p => corners(p, pose)).map(p => p[1]));
  const head = corners(parts.find(p => p.attachment === 'head')!, pose);
  const centre = [0, 1, 2].map(axis => head.reduce((n, p) => n + p[axis]!, 0) / head.length) as unknown as Vec3;
  const solution = { posture, lift, seatTop, soleForward, lowest, head: centre };
  solved.set(posture, solution);
  return solution;
}

/** Every posture shares one seat height so a log is right for whoever sits on it. */
export function sharedSeatTop(): number {
  const tops = SEATED_POSTURES.map(p => solveSeat(p).seatTop);
  if (Math.max(...tops) - Math.min(...tops) > 1e-9) throw new Error('Seated postures disagree about the seat height.');
  return tops[0]!;
}

export interface SeatedMotion {
  readonly posture: SeatedPosture;
  /** Seconds on the public clock; every sample is a pure function of it. */
  readonly time: number;
  /** Per-person phase so a circle never breathes in unison. */
  readonly phase: number;
  /** Head yaw toward whoever this person attends to, radians relative to the body (+ turns left). */
  readonly attend: number;
  /** 0 resting, 1 attentive: a slight lift of the chin and stillness. */
  readonly attention?: number;
}

const deg = (radians: number): number => radians * 180 / Math.PI;

/**
 * A seated pose at a time. The legs never move; breathing, a slow drift of the gaze and an
 * occasional settle live in the chest, head and arms, so the solved lift keeps soles and hips in contact.
 */
export function seatedPose(motion: SeatedMotion): AvatarPose {
  const { legs, upper } = POSTURES[motion.posture];
  const solution = solveSeat(motion.posture);
  const t = motion.time + motion.phase * 7.31;
  const breath = Math.sin(t * 2 * Math.PI / (3.6 + motion.phase * .9));
  const attention = Math.max(0, Math.min(1, motion.attention ?? 0));
  // Gaze drifts a little around its subject on long, unrelated periods: alive, never twitchy.
  const drift = Math.sin(t * .23) * .09 + Math.sin(t * .071 + 1.7) * .06;
  const yaw = deg(motion.attend * .85 + drift * (1 - attention * .6));
  const chestYaw = deg(motion.attend * .15);
  const add = (base: Vec3 | undefined, delta: Vec3): Vec3 => [(base?.[0] ?? 0) + delta[0], (base?.[1] ?? 0) + delta[1], (base?.[2] ?? 0) + delta[2]];
  const rotations: Rotations = {
    ...legs, ...upper,
    chest: add(upper.chest, [breath * .7 - attention * 2, chestYaw, 0]),
    head: add(upper.head, [-breath * .4 - attention * 4 + Math.sin(t * .37) * 1.2, yaw, Math.sin(t * .19 + .4) * 1.5]),
    upperArmLeft: add(upper.upperArmLeft, [breath * .5, 0, 0]),
    upperArmRight: add(upper.upperArmRight, [breath * .5, 0, 0]),
  };
  return { id: `campfire.${motion.posture}`, label: motion.posture, rotations, root: [0, solution.lift, 0] };
}
