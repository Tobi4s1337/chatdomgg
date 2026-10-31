import type { BodyFamily } from '../avatars/body';

/**
 * Three candidate citizen shapes for Tobias to choose between (spec 49). Each is a full proportion set:
 * head box and face layout, torso slices per body family, limb columns and the joint rows a pose turns
 * about. All keep the avatar lattice (6.25 cm cells), the registered avatar palette and the wardrobe's
 * own identity (skin, hair, garb colours, cloak); only volume, proportion and edge treatment change.
 */
export const AVATAR_STYLE_IDS = ['hearthling', 'blockwright', 'storybook'] as const;
export type AvatarStyleId = (typeof AVATAR_STYLE_IDS)[number];

/** One torso row: half-width from the centre line, back and front faces (cells). */
export interface StyleSection { readonly half: number; readonly back: number; readonly front: number }

export interface StyleFamily {
  /** Torso rows from `torsoBottom` upward, one per row. */
  readonly torso: readonly StyleSection[];
  /** Left leg column: outer and inner X edges (negative), back and front faces. Mirrored for the right. */
  readonly leg: { readonly outer: number; readonly inner: number; readonly back: number; readonly front: number };
  /**
   * Right arm column (mirrored for the left): inner and outer X edges, back and front faces, its top row,
   * and `cap`, cells by which the top row reaches inward to meet a narrower or sloping shoulder.
   */
  readonly arm: { readonly inner: number; readonly outer: number; readonly back: number; readonly front: number; readonly top: number; readonly cap: number };
}

/** Head box in root-local cells (half-open) and the face rows hair must respect. */
export interface StyleHead {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z: readonly [number, number];
  /** Lowest eye row, and the first row above the eyes. */
  readonly eyeBottom: number;
  readonly eyeTop: number;
  /** Pupil columns of the left eye (half-open, mirrored), and the eye-white column beside it. */
  readonly pupil: readonly [number, number];
  readonly white: number;
  /** Whether the pupil carries a one-cell catch-light in its top outer corner. */
  readonly catchLight: boolean;
  /** Left cheek columns (half-open, mirrored) and row; mouth row (two cells, centred). */
  readonly cheek: readonly [number, number];
  readonly cheekRow: number;
  readonly mouthRow: number;
  /** Bevel radius over the crown and back of the skull, and over the face plate; zero is a sharp cube. */
  readonly crown: number;
  readonly face: number;
}

export interface AvatarStyle {
  readonly id: AvatarStyleId;
  /** Option letter and name as shown on the study bench. */
  readonly option: 'A' | 'B' | 'C';
  readonly name: string;
  readonly inspiration: string;
  /** One sentence on what the silhouette is about. */
  readonly summary: string;
  /** Standing height in cells, sole to crown. */
  readonly height: number;
  readonly head: StyleHead;
  /** Torso rows start here; breeches below `breechesTop`; the belt is painted on `beltRow`. */
  readonly torsoBottom: number;
  readonly breechesTop: number;
  readonly beltRow: number;
  /** Joint rows. The chest bone splits the torso: pelvis part below, chest part from this row up. */
  readonly chestY: number;
  readonly hipY: number;
  readonly kneeY: number;
  readonly ankleY: number;
  readonly shoulderY: number;
  readonly elbowY: number;
  readonly wristY: number;
  /** Lowest row of the hand. */
  readonly handBottom: number;
  /** A visible neck under the head: rows (half-open) and half-width. */
  readonly neck: { readonly y: readonly [number, number]; readonly half: number } | null;
  /** Cells the shoe reaches past the shin's front face. */
  readonly toe: number;
  /** Corner bevel of torso slices, limbs and shoes: 0 crisp blocks, 1 softened, 2 chunky round. */
  readonly round: 0 | 1 | 2;
  /** Hands grow this many cells forward of the sleeve and are rounded into mittens. */
  readonly mitten: number;
  /** Hair offset from the skull is multiplied by this (1 keeps the wardrobe's own thickness). */
  readonly hairDepth: number;
  /** Hair is re-cut into aligned 2-cell blocks, as a painted cube would carry it. */
  readonly blockHair: boolean;
  readonly families: Readonly<Record<BodyFamily, StyleFamily>>;
}

const rows = (half: readonly number[], back: number | readonly number[], front: number | readonly number[]): readonly StyleSection[] =>
  half.map((h, i) => ({ half: h, back: typeof back === 'number' ? back : back[i]!, front: typeof front === 'number' ? front : front[i]! }));

/**
 * A. Hearthling: a chunky toy in the Cube World / Trove family. The head is nearly half the figure and wider
 * than the shoulders, the body a short soft barrel, stubby legs on rounded shoes and thick arms ending in
 * mitten fists. Every edge is bevelled, so the figure reads as one rounded lump of character.
 */
const HEARTHLING: AvatarStyle = {
  id: 'hearthling', option: 'A', name: 'Hearthling', inspiration: 'chunky, Cube World and Trove inspired',
  summary: 'A big round head on a short barrel body: toy-like, soft-edged and readable from far away.',
  height: 24,
  head: {
    x: [-6, 6], y: [13, 24], z: [-5, 5], eyeBottom: 16, eyeTop: 19, pupil: [-4, -2], white: -5, catchLight: true,
    cheek: [-5, -3], cheekRow: 15, mouthRow: 14, crown: 3, face: 1,
  },
  torsoBottom: 6, breechesTop: 8, beltRow: 8, chestY: 9,
  hipY: 6, kneeY: 3, ankleY: 2, shoulderY: 11, elbowY: 9, wristY: 7, handBottom: 4,
  neck: null, toe: 1, round: 2, mitten: 1, hairDepth: 1, blockHair: false,
  families: {
    balanced: {
      torso: rows([4, 5, 5, 5, 5, 5, 4], -3, [3, 3, 4, 4, 4, 4, 3]),
      leg: { outer: -4, inner: -1, back: -2, front: 2 },
      arm: { inner: 5, outer: 8, back: -1, front: 2, top: 12, cap: 1 },
    },
    slender: {
      torso: rows([3, 4, 4, 4, 4, 4, 3], -2, [2, 2, 3, 3, 3, 3, 2]),
      leg: { outer: -3, inner: -1, back: -1, front: 1 },
      arm: { inner: 4, outer: 6, back: -1, front: 1, top: 12, cap: 1 },
    },
    broad: {
      torso: rows([5, 5, 5, 6, 6, 7, 6], [-3, -3, -3, -4, -4, -4, -4], [3, 3, 3, 4, 4, 4, 4]),
      leg: { outer: -4, inner: -1, back: -2, front: 2 },
      arm: { inner: 7, outer: 10, back: -2, front: 2, top: 12, cap: 1 },
    },
    round: {
      torso: rows([6, 6, 6, 6, 5, 5, 4], -3, [4, 5, 5, 5, 4, 4, 3]),
      leg: { outer: -5, inner: -1, back: -2, front: 2 },
      arm: { inner: 6, outer: 9, back: -1, front: 2, top: 11, cap: 1 },
    },
  },
};

/**
 * B. Blockwright: blockier, in the Minecraft family. A sharp cube head a quarter-and-a-bit of the height,
 * a flat slab torso, and arms and legs as straight square columns of one thickness, legs touching. Faces
 * are flat paint on the cube; hair is re-cut into two-cell blocks so it sits on the head like a cap.
 */
const BLOCKWRIGHT: AvatarStyle = {
  id: 'blockwright', option: 'B', name: 'Blockwright', inspiration: 'blockier, Minecraft inspired',
  summary: 'Crisp cubes and square columns: a cube head on a slab body, painted faces, no bevels.',
  height: 28,
  head: {
    x: [-4, 4], y: [20, 28], z: [-4, 4], eyeBottom: 23, eyeTop: 25, pupil: [-2, -1], white: -3, catchLight: false,
    cheek: [-3, -2], cheekRow: 22, mouthRow: 21, crown: 0, face: 0,
  },
  torsoBottom: 10, breechesTop: 12, beltRow: 12, chestY: 14,
  hipY: 10, kneeY: 5, ankleY: 2, shoulderY: 18, elbowY: 15, wristY: 12, handBottom: 10,
  neck: null, toe: 0, round: 0, mitten: 0, hairDepth: 1, blockHair: true,
  families: {
    balanced: {
      torso: rows(Array(10).fill(4), -2, 2),
      leg: { outer: -4, inner: 0, back: -2, front: 2 },
      arm: { inner: 4, outer: 8, back: -2, front: 2, top: 19, cap: 0 },
    },
    slender: {
      torso: rows(Array(10).fill(3), -2, 2),
      leg: { outer: -3, inner: 0, back: -2, front: 2 },
      arm: { inner: 3, outer: 6, back: -2, front: 2, top: 19, cap: 0 },
    },
    broad: {
      torso: rows([4, 4, 4, 4, 5, 5, 5, 5, 5, 5], [-2, -2, -2, -2, -3, -3, -3, -3, -3, -3], [2, 2, 2, 2, 3, 3, 3, 3, 3, 3]),
      leg: { outer: -4, inner: 0, back: -2, front: 2 },
      arm: { inner: 5, outer: 9, back: -2, front: 2, top: 19, cap: 0 },
    },
    round: {
      torso: rows([5, 5, 5, 5, 5, 5, 5, 5, 4, 4], -2, [3, 3, 4, 4, 4, 4, 4, 3, 2, 2]),
      leg: { outer: -4, inner: 0, back: -2, front: 2 },
      arm: { inner: 5, outer: 8, back: -2, front: 2, top: 18, cap: 1 },
    },
  },
};

/**
 * C. Storybook: slim storybook voxel. A taller figure with a neck, a smaller oval head, a tapered waist,
 * long two-cell limbs with small hands, and slim shoes with a toe. It keeps the bevelled crown and the
 * kingdom's warmth but trades the chibi head for an elegant, illustrated line.
 */
const STORYBOOK: AvatarStyle = {
  id: 'storybook', option: 'C', name: 'Storybook', inspiration: 'slim storybook voxel',
  summary: 'Taller and slender: a small oval head on a neck, a tapered waist and long limbs.',
  height: 30,
  head: {
    x: [-4, 4], y: [22, 30], z: [-4, 4], eyeBottom: 25, eyeTop: 27, pupil: [-2, -1], white: -3, catchLight: false,
    cheek: [-3, -2], cheekRow: 24, mouthRow: 23, crown: 2, face: 1,
  },
  torsoBottom: 12, breechesTop: 14, beltRow: 14, chestY: 16,
  hipY: 13, kneeY: 7, ankleY: 2, shoulderY: 19, elbowY: 15, wristY: 11, handBottom: 9,
  neck: { y: [21, 22], half: 1 }, toe: 1, round: 1, mitten: 0, hairDepth: .85, blockHair: false,
  families: {
    balanced: {
      torso: rows([4, 4, 3, 3, 4, 4, 4, 4, 3], -2, [2, 2, 2, 2, 3, 3, 3, 2, 2]),
      leg: { outer: -4, inner: -1, back: -1, front: 1 },
      arm: { inner: 4, outer: 6, back: -1, front: 1, top: 20, cap: 1 },
    },
    slender: {
      torso: rows([3, 3, 3, 3, 3, 3, 3, 3, 2], -2, [2, 2, 2, 2, 2, 3, 3, 2, 2]),
      leg: { outer: -3, inner: -1, back: -1, front: 1 },
      arm: { inner: 3, outer: 5, back: -1, front: 1, top: 20, cap: 1 },
    },
    broad: {
      torso: rows([4, 4, 4, 4, 5, 5, 6, 6, 5], [-2, -2, -2, -3, -3, -3, -3, -3, -3], [2, 2, 2, 3, 3, 3, 3, 3, 2]),
      leg: { outer: -4, inner: -1, back: -2, front: 1 },
      arm: { inner: 6, outer: 9, back: -2, front: 1, top: 20, cap: 1 },
    },
    round: {
      torso: rows([5, 5, 5, 5, 5, 4, 4, 4, 3], -2, [3, 4, 4, 4, 4, 3, 3, 2, 2]),
      leg: { outer: -4, inner: -1, back: -2, front: 1 },
      arm: { inner: 5, outer: 7, back: -1, front: 1, top: 19, cap: 1 },
    },
  },
};

export const AVATAR_STYLES: Readonly<Record<AvatarStyleId, AvatarStyle>> = { hearthling: HEARTHLING, blockwright: BLOCKWRIGHT, storybook: STORYBOOK };

export function avatarStyle(id: AvatarStyleId): AvatarStyle {
  const style = Object.hasOwn(AVATAR_STYLES, id) ? AVATAR_STYLES[id] : undefined;
  if (!style) throw new Error(`Unknown avatar style ${String(id)}.`);
  return style;
}

/** The torso row at `y` for a family, or throws when `y` is outside the torso. */
export function styleRow(style: AvatarStyle, family: BodyFamily, y: number): StyleSection {
  const row = style.families[family].torso[y - style.torsoBottom];
  if (!row) throw new Error(`${style.id}: row ${y} is not a torso row.`);
  return row;
}

/** The torso's top row (inclusive). */
export const torsoTop = (style: AvatarStyle, family: BodyFamily): number => style.torsoBottom + style.families[family].torso.length - 1;
