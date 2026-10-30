import { z } from 'zod';
import { TokenSchema } from './identity';
import { Cell3Schema, StyleIdSchema } from './voxel';

/** The spell chooses a registered construction; it cannot supply voxels, code, identity or approval. */
export const HousePartPlanSchema = z.discriminatedUnion('kind', [
  z.strictObject({ version:z.literal(1), kind:z.literal('chimney'), motif:z.literal('sleeping-dragon') }),
  z.strictObject({ version:z.literal(1), kind:z.literal('lantern'), motif:z.literal('crescent-moon') }),
  z.strictObject({ version:z.literal(1), kind:z.literal('weathervane'), motif:z.literal('watchful-owl') }),
]);
export type HousePartPlan = z.infer<typeof HousePartPlanSchema>;
export const ForgeStyleKitSchema = z.strictObject({version:z.literal(1),id:TokenSchema,styleId:StyleIdSchema,family:z.enum(['hearth','tide','grove']),revision:z.number().int().positive()});
export type ForgeStyleKit = z.infer<typeof ForgeStyleKitSchema>;
/** Host-derived cells in the immutable home blueprint; never accepted from the prompt. */
export interface ForgeHouseSocket {
  id:string; kind:HousePartPlan['kind']; origin:[number,number,number];
  /** Local points where the foundation meets the retained host surface. */
  supports: [number,number,number][];
  hostId:string; hostFingerprint:string; clearanceHeight:number;
}
export const ForgePlacementSchema=z.strictObject({version:z.literal(1),id:TokenSchema,hostId:TokenSchema,hostFingerprint:TokenSchema,socketId:TokenSchema,kitId:TokenSchema,kitRevision:z.number().int().positive(),plan:HousePartPlanSchema,origin:Cell3Schema});
export type ForgePlacement=z.infer<typeof ForgePlacementSchema>;
export const FORGE_PHASES=['words','blueprint','pour','seal','strike','cool','flight','landed'] as const;
export type ForgePhase=typeof FORGE_PHASES[number];
/** Public observations are separate from requests. A refusal has no attribution or text fields. */
export type ForgePublicBeat = {kind:'work';ritualId:string;phase:ForgePhase;elapsed:number;duration:number}
  | {kind:'refusal';variant:0|1|2};
export interface ForgeRitualFrame {ritualId:string;phase:ForgePhase;elapsed:number;phaseProgress:number;duration:number;source:'simulated'|'live'}
export const FORGE_REFUSAL_INTERVAL_MS=600_000;
