import type { AvatarAttachmentId, AvatarCapeBlueprint, AvatarPartBlueprint, Vec3 } from '@chatdom/shared';
import type { AvatarPose, BodyFamily, HairForm, HairSwatchId, LookReport, SkinSwatchId } from '../avatars/index';
import type { Sculpt } from '../avatars/sculpt';

/**
 * Keepers of places: the few townsfolk a kingdom has (World-Tree §3). Each keeps one place, carries no presence light,
 * is never counted, never speaks in Twitch chat and steps indoors as real people fill the town. Everything in this module
 * is a deterministic content proposal; navigation, speech delivery and interaction runtime belong to main.
 */
export const KEEPER_ROLES = ['innkeeper', 'lamplighter', 'ferryman'] as const;
export type KeeperRole = (typeof KEEPER_ROLES)[number];

/**
 * A small shared family of temperaments (the Animal Crossing lesson in World-Tree §3): each role is authored once per
 * temperament, so more keepers never need writing from scratch. It colours stance, idle motion, costume and lines.
 */
export const KEEPER_TEMPERAMENTS = ['hearty', 'wry', 'gentle'] as const;
export type KeeperTemperament = (typeof KEEPER_TEMPERAMENTS)[number];

export type KeeperKitId = 'hearth' | 'tide' | 'grove';

/** Registered avatar-palette keys a keeper's costume may draw on, chosen per kingdom kit. */
export interface KeeperPalette {
  readonly kit: KeeperKitId;
  /** The kit's main livery cloth (waistcoat, coat, smock). */
  readonly livery: number;
  /** A quieter second cloth (breeches, lining, scarf). */
  readonly quiet: number;
  /** A small bright accent (kerchief, hat band, piping). */
  readonly accent: number;
  /** Leather and wood: belts, boots, tool handles. */
  readonly leather: number;
  /** Metal fittings: buckles, buttons, hooks, bands. */
  readonly metal: number;
  /** Pale cloth: aprons, shirts, cloths. */
  readonly pale: number;
  /** The kit's stone, for a rare weight or whetstone. */
  readonly stone: number;
}

export interface KeeperCostumeInput {
  readonly body: BodyFamily;
  readonly palette: KeeperPalette;
  readonly temperament: KeeperTemperament;
  readonly skin: SkinSwatchId;
  readonly hair: HairSwatchId;
}

/**
 * A tool part and the points a routine aims with it. Points are root-local rest cells (the same frame the part is
 * authored in), so a posed tip is `partMatrix × (point − pivot)`.
 */
export interface KeeperTool {
  readonly id: string;
  readonly parts: readonly AvatarPartBlueprint[];
  /**
   * Named points on the tool: a pole's hook, a broom's bristle line, a cloth's centre. `at` is in root-local rest cells
   * and rides `attachment` (the grip or bone of the part that carries it).
   */
  readonly points: Readonly<Record<string, { readonly attachment: AvatarAttachmentId; readonly at: Vec3 }>>;
}

export interface KeeperCostume {
  /** Recolour of the neutral garb's linen shirt and earth breeches. */
  readonly dye: { readonly shirt: number; readonly breeches: number };
  /** Rolled sleeves: forearm linen shows skin instead. */
  readonly rolledSleeves: boolean;
  /** Rigid garment and accessory parts, always worn. */
  readonly garments: readonly AvatarPartBlueprint[];
  /** Tools the routines take up; at most one is in hand at a time, the rest stay stowed (not drawn). */
  readonly tools: readonly KeeperTool[];
  /**
   * Headwear the hair is cut to fit under: every hair cell at or above `ceiling` (root-local row) and every cell of
   * `exclude` is removed. Null when the role wears nothing on the head.
   */
  readonly hat: { readonly ceiling: number; readonly exclude?: Sculpt } | null;
  /** Coat tails or a cloak as the frozen thin cloth sheet on the back socket, moved by the citizen cape renderer. */
  readonly cape: AvatarCapeBlueprint | null;
}

/** What a keeper's place offers to work at. Positions are supplied by the host from placed content (`KeeperPlaceSite`). */
export const KEEPER_FIXTURE_KINDS = ['door', 'lamp', 'bench', 'barrel', 'sign', 'mooring', 'water-edge'] as const;
export type KeeperFixtureKind = (typeof KEEPER_FIXTURE_KINDS)[number];

/** One timed key of a looping act. `t` runs 0..1 over the act's cycle; poses ease between keys. */
export interface KeeperKey { readonly t: number; readonly pose: AvatarPose }

/**
 * A grounded routine act at a fixture: where to stand, which way to face, what is in hand and a looping pose cycle.
 * `reach` (fixture-local metres, +Z the fixture's front) is where the tool point `toolPoint` lands at the act's `reachKey`;
 * the routine tests hold every act to it.
 */
export interface KeeperAct {
  readonly id: string;
  readonly label: string;
  readonly at: KeeperFixtureKind;
  /** Stand point in fixture-local metres (+Z out of the fixture's front, +X the fixture's own local +X). */
  readonly stand: readonly [x: number, z: number];
  /** Heading relative to the fixture: `toward` faces the fixture, `away` faces out from it, or explicit radians. */
  readonly face: 'toward' | 'away' | number;
  /** Seconds per cycle. */
  readonly cycle: number;
  /** How many cycles make one visit before the keeper moves on. */
  readonly repeats: number;
  readonly keys: readonly KeeperKey[];
  /** Tool in hand for this act, by `KeeperTool.id`; null for empty hands. */
  readonly tool: string | null;
  readonly reach: { readonly key: number; readonly toolPoint: string; readonly target: Vec3; readonly tolerance: number } | null;
  /** Realm hours in which this act is chosen, as a half-open [from, to) range that may wrap midnight. */
  readonly hours: readonly [from: number, to: number];
}

export interface KeeperRoleDefinition {
  readonly role: KeeperRole;
  /** What a viewer should read from across the street. */
  readonly silhouette: string;
  /** The fixture kinds this role needs at its place; a place without one of them cannot host the role's routine. */
  readonly needs: readonly KeeperFixtureKind[];
  readonly bodies: Readonly<Record<KeeperTemperament, BodyFamily>>;
  /** Hair forms that suit the role and fit its headwear; the seed picks one. */
  readonly hairForms: readonly HairForm[];
  costume(input: KeeperCostumeInput): KeeperCostume;
  readonly acts: readonly KeeperAct[];
  /** Per-temperament stance laid under every act: weight, head tilt, shoulders. */
  readonly stance: Readonly<Record<KeeperTemperament, AvatarPose>>;
}

export interface KeeperLookSpec {
  readonly role: KeeperRole;
  readonly temperament: KeeperTemperament;
  readonly kit: KeeperKitId;
  readonly body: BodyFamily;
  readonly skin: SkinSwatchId;
  readonly hair: { readonly form: HairForm; readonly swatch: HairSwatchId };
}

export interface KeeperLook {
  readonly id: string;
  readonly spec: KeeperLookSpec;
  /** Body, hair and garments: always drawn. */
  readonly parts: readonly AvatarPartBlueprint[];
  readonly tools: readonly KeeperTool[];
  readonly cape: AvatarCapeBlueprint | null;
  /** Budget report for the heaviest variant (every part plus the largest tool). */
  readonly report: LookReport;
}
