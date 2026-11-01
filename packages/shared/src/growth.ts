import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema, type KingdomId } from './identity';
import { HomeTierSchema } from './voxel';

/** Tent is an arrival entitlement, not a new voxel lattice or a purchasable tier. */
export const GrowthHomeStageSchema = z.enum(['tent', ...HomeTierSchema.options]);
export type GrowthHomeStage = z.infer<typeof GrowthHomeStageSchema>;
export const GrowthCivicPlaceSchema = z.enum(['tavern', 'forge', 'market', 'bridge', 'castle-court']);
export type GrowthCivicPlace = z.infer<typeof GrowthCivicPlaceSchema>;

export const GrowthHomeViewSchema = z.strictObject({
  plotId: TokenSchema,
  stage: GrowthHomeStageSchema,
  qualifiedDays: UIntSchema,
  /** Proven minimum only: ten confirmed minutes per qualified day, never total watch time. */
  qualifiedMinutes: UIntSchema,
  currentStreak: UIntSchema,
  bestStreak: UIntSchema,
  nextGoal: z.strictObject({ stage: HomeTierSchema, requiredDays: UIntSchema.min(1), remainingDays: UIntSchema }).nullable(),
}).superRefine((home, ctx) => {
  if (home.currentStreak > home.bestStreak || home.bestStreak > home.qualifiedDays) {
    ctx.addIssue({ code: 'custom', message: 'A streak cannot exceed its witnessed qualified days' });
  }
  if (home.qualifiedMinutes !== home.qualifiedDays * 10) {
    ctx.addIssue({ code: 'custom', message: 'Qualified minutes are the proven ten-minute daily minimum' });
  }
  if (home.nextGoal && (GrowthHomeStageSchema.options.indexOf(home.nextGoal.stage) <= GrowthHomeStageSchema.options.indexOf(home.stage)
    || home.nextGoal.remainingDays !== Math.max(0, home.nextGoal.requiredDays - home.qualifiedDays))) {
    ctx.addIssue({ code: 'custom', message: 'The next home goal must be forward and use witnessed days' });
  }
});
export type GrowthHomeView = z.infer<typeof GrowthHomeViewSchema>;

const beat = { sourceSeq: UIntSchema.min(1), at: EpochMsSchema };
/** Public presentation only. No person ID, roster, receipt, chat text or authority command. */
export const GrowthSceneBeatSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...beat, kind: z.literal('home-grown'), plotId: TokenSchema,
    from: GrowthHomeStageSchema, to: HomeTierSchema, qualifiedDays: UIntSchema }),
  z.strictObject({ ...beat, kind: z.literal('civic-levelled'), place: GrowthCivicPlaceSchema,
    from: UIntSchema.min(1), to: UIntSchema.min(2) }),
  z.strictObject({ ...beat, kind: z.literal('streak-reached'), plotId: TokenSchema, days: UIntSchema.min(1) }),
]).superRefine((value, ctx) => {
  if (value.kind === 'home-grown' && GrowthHomeStageSchema.options.indexOf(value.to) <= GrowthHomeStageSchema.options.indexOf(value.from)
    || value.kind === 'civic-levelled' && value.to <= value.from) {
    ctx.addIssue({ code: 'custom', message: 'Growth beats only move forward' });
  }
});
export type GrowthSceneBeat = z.infer<typeof GrowthSceneBeatSchema>;

/** Room-owned read snapshot. Fixtures/replays use simulated origin, never mint live credit. */
export const GrowthSceneFrameSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  sequence: UIntSchema, asOf: EpochMsSchema,
  homes: z.array(GrowthHomeViewSchema).max(65535),
  civic: z.strictObject({ tavern: UIntSchema.min(1), forge: UIntSchema.min(1), market: UIntSchema.min(1),
    bridge: UIntSchema.min(1), 'castle-court': UIntSchema.min(1) }),
  /** Recent presentation window only; Chronicle reads the durable fact log, not this bounded tail. */
  beats: z.array(GrowthSceneBeatSchema).max(128),
}).superRefine((frame, ctx) => {
  if (new Set(frame.homes.map(home => home.plotId)).size !== frame.homes.length
    || frame.beats.some(value => value.sourceSeq > frame.sequence || value.at > frame.asOf
      || 'plotId' in value && !frame.homes.some(home => home.plotId === value.plotId))) {
    ctx.addIssue({ code: 'custom', message: 'Growth must cite this snapshot and its plots' });
  }
});
export type GrowthSceneFrame = z.infer<typeof GrowthSceneFrameSchema>;

/** Private reducer snapshot only. Never publish this, even when a citizen has disclosed their name. */
export interface GrowthPrivateCitizen {
  readonly qualifiedDays: number;
  readonly lastQualifiedOrdinal: number | null;
  readonly streak: number;
  readonly bestStreak: number;
  readonly home: { readonly plotId: string; readonly stage: GrowthHomeStage } | null;
}
export interface GrowthPrivateState {
  readonly version: 1;
  readonly policyVersion: 1;
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly sequence: number;
  readonly asOf: number;
  readonly session: { readonly id: string; readonly startedAt: number } | null;
  readonly day: { readonly index: number; readonly ordinal: number; readonly qualified: boolean } | null;
  readonly citizens: Readonly<Record<string, GrowthPrivateCitizen>>;
  readonly civic: { readonly qualifiedDays: number; readonly personDays: number;
    readonly levels: Readonly<Record<GrowthCivicPlace, number>> };
}

export interface GrowthSceneFeed {
  readonly label: 'LIVE' | 'SIMULATED';
  subscribe(receive: (frame: GrowthSceneFrame) => void, unavailable: () => void): () => void;
}
