import { createIntentSchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema, VoxelBlueprintSchema } from '@chatdom/shared';
import { MOMENT_KINDS, UNSAFE_TEXT, publicText, type TwitchMomentFeed as SharedMomentFeed } from '@chatdom/shared/twitch-moments';
import type { RaidPartyPublicFeed } from '@chatdom/shared';
import { SKY_RUNGS } from './spectacle';
import { z } from './zod';
export * from '@chatdom/shared/twitch-moments';

/** The shared feed, plus the gate party's public reader where a host already holds one (a bench, a stream view). */
export interface TwitchMomentFeed extends SharedMomentFeed {
  readonly raidParty?: RaidPartyPublicFeed;
}

// ---------------------------------------------------------------- commands

const uniqueText = (values: readonly string[]) => new Set(values.map(v => v.trim().toLocaleLowerCase('en'))).size === values.length;
const actionVariant = <const K extends string, S extends z.ZodRawShape>(kind: K, shape: S) => z.strictObject({ kind: z.literal(kind), ...shape });

export const ACTION_KINDS = ['poll-create', 'poll-end', 'prediction-create', 'prediction-settle', 'vip-add', 'announcement', 'shoutout',
  'reward-pack', 'marker', 'walker-chat'] as const;
export type ActionKind = typeof ACTION_KINDS[number];

/** A request only: no actor, scope, token or success field is supplied by a browser. */
export const TwitchActionArgsSchema = z.discriminatedUnion('kind', [
  actionVariant('poll-create', { title: publicText(1, 60), choices: z.array(publicText(1, 25)).min(2).max(5).refine(uniqueText, 'Choices must differ'),
    durationSeconds: UIntSchema.min(15).max(1800) }),
  actionVariant('poll-end', { pollKey: TokenSchema, outcome: z.enum(['terminate', 'archive']) }),
  actionVariant('prediction-create', { title: publicText(1, 45), outcomes: z.array(publicText(1, 25)).min(2).max(10).refine(uniqueText, 'Outcomes must differ'),
    windowSeconds: UIntSchema.min(30).max(1800), matchKey: TokenSchema }),
  actionVariant('prediction-settle', { predictionKey: TokenSchema, matchKey: TokenSchema, outcome: z.enum(['lock', 'cancel', 'resolve']),
    winnerId: TokenSchema.nullable() }),
  actionVariant('vip-add', { targetPersonId: PersonIdSchema }),
  actionVariant('announcement', { message: publicText(1, 500), colour: z.enum(['primary', 'blue', 'green', 'orange', 'purple']) }),
  actionVariant('shoutout', { targetKingdomId: KingdomIdSchema }),
  actionVariant('reward-pack', { enabled: z.boolean(), packKey: TokenSchema }),
  actionVariant('marker', { description: publicText(0, 140) }),
  actionVariant('walker-chat', { message: z.string().min(1).max(500).refine(text => !UNSAFE_TEXT.test(text) && text.trim().length > 0, 'Unsafe chat text'),
    replyTo: TokenSchema.nullable() }),
]).superRefine((args, ctx) => {
  if (args.kind === 'prediction-settle' && (args.outcome === 'resolve') !== (args.winnerId !== null)) {
    ctx.addIssue({ code: 'custom', path: ['winnerId'], message: 'Exactly a resolution names its winner' });
  }
});
export type TwitchActionArgs = z.infer<typeof TwitchActionArgsSchema>;
export const TwitchActionIntentSchema = createIntentSchema('twitch.action', TwitchActionArgsSchema);
export type TwitchActionIntent = z.infer<typeof TwitchActionIntentSchema>;

export const KingdomMomentArgsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('strike'), battleKey: TokenSchema }),
  z.strictObject({ kind: z.literal('haul') }),
  z.strictObject({ kind: z.literal('fireworks-chant') }),
]);
export const KingdomMomentIntentSchema = createIntentSchema('kingdom.moment', KingdomMomentArgsSchema);
export type KingdomMomentIntent = z.infer<typeof KingdomMomentIntentSchema>;

export const RejectionReasonSchema = z.enum(['permission', 'revoked', 'ineligible', 'rate-limit', 'conflict', 'invalid', 'moderation']);
export const ActionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('accepted'), intentId: TokenSchema, receiptKey: TokenSchema, acceptedAt: EpochMsSchema, providerId: TokenSchema.nullable() }),
  z.strictObject({ status: z.literal('rejected'), intentId: TokenSchema, reason: RejectionReasonSchema, retryAt: EpochMsSchema.nullable() }),
  z.strictObject({ status: z.literal('unavailable'), intentId: TokenSchema }),
  z.strictObject({ status: z.literal('unknown'), intentId: TokenSchema, reconciliationKey: TokenSchema }),
]);
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const CapabilityReasonSchema = z.enum(['ready', 'permission', 'revoked', 'ineligible', 'rate-limit', 'unavailable']);
export const CapabilitySchema = z.strictObject({ available: z.boolean(), reason: CapabilityReasonSchema, retryAt: EpochMsSchema.nullable() })
  .refine(c => c.available === (c.reason === 'ready'), 'Only a ready capability is available');
export type Capability = z.infer<typeof CapabilitySchema>;

/** Illustrative port from Spec 20; the backend re-checks permission on every call. */
export interface ActionPort<I extends { id: string; args: { kind: string } }> {
  capabilities(): ReadonlyMap<I['args']['kind'], Capability>;
  submit(intent: I, signal: AbortSignal): Promise<ActionResult>;
  reconcile(reconciliationKey: string, signal: AbortSignal): Promise<ActionResult>;
}

// ---------------------------------------------------------------- presentation

const Finite = z.number().finite();
export const Vec3Schema = z.tuple([Finite, Finite, Finite]);
export const CameraPoseSchema = z.strictObject({ eye: Vec3Schema, target: Vec3Schema, fov: z.number().min(10).max(100) })
  .refine(p => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]) > 0.05, 'Eye and target must differ');
export type CameraPose = z.infer<typeof CameraPoseSchema>;

const Unit = z.number().min(0).max(1);
export const SafeRectSchema = z.strictObject({ x: Unit, y: Unit, width: Unit, height: Unit }).refine(r => r.x + r.width <= 1 && r.y + r.height <= 1, 'Rectangle leaves the picture');
export const PresentationSchema = z.strictObject({
  layout: z.enum(['stage', 'window', 'strip']), mood: z.enum(['calm', 'show']), busy: z.boolean(), visible: z.boolean(),
  safeRects: z.array(SafeRectSchema).max(8), autoOpenKinds: z.array(z.enum(MOMENT_KINDS)).max(MOMENT_KINDS.length)
    .refine(kinds => new Set(kinds).size === kinds.length, 'Duplicate kind'),
});
export type Presentation = z.infer<typeof PresentationSchema>;

// ---------------------------------------------------------------- spectacle inputs

/**
 * The monarch's approved fixed ladder: one to six steps from the fixed set of sky reactions, strictly rising, the
 * first from a single Bit. A reaction to an ordinary cheer, never a shop, and no step wakes the dragon.
 */
export const CheerLadderSchema = z.array(z.strictObject({ minBits: UIntSchema.min(1).max(100_000_000), rung: z.enum(SKY_RUNGS) })).min(1).max(6)
  .refine(steps => steps[0]!.minBits === 1, 'The ladder starts at one Bit')
  .refine(steps => steps.every((step, i) => i === 0 || step.minBits > steps[i - 1]!.minBits), 'Thresholds rise strictly')
  .refine(steps => new Set(steps.map(s => s.rung)).size === steps.length, 'Each reaction appears once');

/** Spec 24's approved emote effect, structurally narrowed: exact revision and origin, immutable voxel frames. */
export const ApprovedEffectSchema = z.strictObject({
  id: TokenSchema, revision: UIntSchema, origin: z.enum(['live', 'simulated']),
  frames: z.array(z.strictObject({ blueprint: VoxelBlueprintSchema, durationMs: UIntSchema.min(16).max(10_000) })).min(1).max(16),
  periodMs: UIntSchema.min(16).max(60_000),
});
