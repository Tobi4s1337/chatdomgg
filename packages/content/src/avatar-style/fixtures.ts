import type { AvatarBoneId } from '@chatdom/shared';
import type { BodyFamily } from '../avatars/body';
import type { HairForm } from '../avatars/hair';

/**
 * The five wardrobe looks the study shows in every option. They are the SIMULATED everyday citizens of
 * `apps/web/src/citizens/default-look.ts` (`createDefaultCitizenLooks()`), read from their actual compiled
 * parts at render time; `expect` records what each look is so a drifted fixture fails loudly instead of
 * quietly showing someone else. Order, pose, scale, camera and light are the same in every option.
 */
export interface StyleStudyFixture {
  /** The `CitizenLook.id` in `createDefaultCitizenLooks()`. */
  readonly look: string;
  /** Bench label; every fixture is a SIMULATED review person, never an account. */
  readonly label: string;
  readonly expect: { readonly family: BodyFamily; readonly hair: HairForm; readonly cloak: boolean };
  /** A still, lived-in pose (radians, XYZ about each joint), identical across options. */
  readonly pose: Partial<Record<AvatarBoneId, readonly [number, number, number]>>;
}

export const STYLE_STUDY_FIXTURES: readonly StyleStudyFixture[] = [
  {
    look: 'hearth', label: 'Hearth', expect: { family: 'balanced', hair: 'sidePart', cloak: true },
    // Weight on the left hip, a hand half-raised as if mid-sentence.
    pose: { pelvis: [0, 0, .03], chest: [0, .06, -.04], head: [0, .14, .05], upperArmLeft: [0, 0, -.1], upperArmRight: [-.18, 0, .12], forearmRight: [-.55, 0, 0], thighRight: [0, 0, .06], footRight: [0, 0, -.06] },
  },
  {
    look: 'tide', label: 'Tide', expect: { family: 'broad', hair: 'coiledHighCrown', cloak: false },
    // Feet planted apart, chin up, arms loose and ready.
    pose: { head: [-.06, -.08, 0], upperArmLeft: [0, 0, -.2], upperArmRight: [0, 0, .2], forearmLeft: [-.25, 0, 0], forearmRight: [-.25, 0, 0], thighLeft: [0, 0, -.07], thighRight: [0, 0, .07], footLeft: [0, 0, .07], footRight: [0, 0, -.07] },
  },
  {
    look: 'grove', label: 'Grove', expect: { family: 'slender', hair: 'bob', cloak: false },
    // A hand on the hip and the head tipped, curious.
    pose: { pelvis: [0, 0, -.03], chest: [0, -.05, .03], head: [0, -.12, -.09], upperArmLeft: [0, 0, -.5], forearmLeft: [0, 0, 1.15], upperArmRight: [0, 0, .07], thighLeft: [0, 0, -.05], footLeft: [0, 0, .05] },
  },
  {
    look: 'clay', label: 'Clay', expect: { family: 'round', hair: 'roundedCurls', cloak: false },
    // Waving hello.
    pose: { chest: [0, .05, .03], head: [0, .1, .07], upperArmRight: [-.1, 0, 2.1], forearmRight: [0, 0, .55], upperArmLeft: [0, 0, -.1] },
  },
  {
    look: 'dusk', label: 'Dusk', expect: { family: 'slender', hair: 'pairedTwists', cloak: false },
    // A step forward, glancing aside.
    pose: { head: [.06, -.18, 0], chest: [0, -.06, 0], upperArmLeft: [.18, 0, -.08], upperArmRight: [-.22, 0, .1], forearmRight: [-.35, 0, 0], thighLeft: [-.2, 0, 0], shinLeft: [.12, 0, 0], footLeft: [.08, 0, 0], thighRight: [.08, 0, 0], footRight: [-.08, 0, 0] },
  },
];
