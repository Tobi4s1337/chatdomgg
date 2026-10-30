import { z } from 'zod';
import { TokenSchema } from './identity';
import { Cell3Schema, StyleIdSchema, VoxelBlueprintSchema } from './voxel';

/** The spell chooses a registered construction; it cannot supply voxels, code, identity or approval. */
const LegacyHousePartPlanSchema = z.discriminatedUnion('kind', [
  z.strictObject({ version:z.literal(1), kind:z.literal('chimney'), motif:z.literal('sleeping-dragon') }),
  z.strictObject({ version:z.literal(1), kind:z.literal('lantern'), motif:z.literal('crescent-moon') }),
  z.strictObject({ version:z.literal(1), kind:z.literal('weathervane'), motif:z.literal('watchful-owl') }),
]);
export const FORGE_MOTIFS=['sleeping-dragon','crescent-moon','watchful-owl','sleeping-fox','sunflower','scallop-shell','shooting-star'] as const;
/** A wish composes authored silhouettes and finishes. The model never submits cells or coordinates. */
export const ComposedHousePartPlanSchema=z.strictObject({version:z.literal(2),kind:z.enum(['chimney','lantern','weathervane']),motif:z.enum(FORGE_MOTIFS),finish:z.enum(['native','copper','ceramic']),accent:z.enum(['none','stars','leaves','scales'])});
export const HousePartPlanSchema=z.union([LegacyHousePartPlanSchema,ComposedHousePartPlanSchema]);
export type HousePartPlan = z.infer<typeof HousePartPlanSchema>;
export const ForgeDraftSchema=z.strictObject({plan:ComposedHousePartPlanSchema,title:z.string().min(1).max(64),plaque:z.string().min(1).max(120)});
export type ForgeDraft=z.infer<typeof ForgeDraftSchema>;
/** Local development citizens remain simulated even when the spell and judges are real. */
export const ForgeRunRequestSchema=z.strictObject({words:z.string().trim().min(1).max(240),family:z.enum(['hearth','tide','grove']),home:VoxelBlueprintSchema}).superRefine(({home},ctx)=>{
  if(home.lattice!=='build'||home.size[0]>64||home.size[1]>160||home.size[2]>128||home.boxes.length>6000)ctx.addIssue({code:'custom',message:'A Forge run needs one bounded house.'});
  if(home.boxes.reduce((sum,b)=>sum+b.to.reduce((volume,n,i)=>volume*(n-b.from[i]!),1),0)>32*1024*1024)ctx.addIssue({code:'custom',message:'This home needs a simpler Forge survey.'});
});
export type ForgeRunRequest=z.infer<typeof ForgeRunRequestSchema>;
export const ForgeRunEventSchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('stage'),stage:z.enum(['judging-words','drafting','assembling','judging-piece'])}),
  z.strictObject({type:z.literal('approved'),runId:TokenSchema,draft:ForgeDraftSchema,hostFingerprint:TokenSchema}),
  z.strictObject({type:z.literal('stopped'),outcome:z.enum(['cold','hold','refuse']),message:z.string().max(240)}),
]);
export type ForgeRunEvent=z.infer<typeof ForgeRunEventSchema>;
export const ForgeStyleKitSchema = z.strictObject({version:z.literal(1),id:TokenSchema,styleId:StyleIdSchema,family:z.enum(['hearth','tide','grove']),revision:z.number().int().positive()});
export type ForgeStyleKit = z.infer<typeof ForgeStyleKitSchema>;
/** Host-derived cells in the immutable home blueprint; never accepted from the prompt. */
export interface ForgeHouseSocket {
  id:string; kind:HousePartPlan['kind']; profile:'roof'|'stack'|'wall'; origin:[number,number,number];
  /** Local points where the foundation meets the retained host surface. */
  supports: [number,number,number][];
  hostId:string; hostFingerprint:string; clearanceHeight:number;
}
export const ForgePlacementSchema=z.strictObject({version:z.literal(1),id:TokenSchema,hostId:TokenSchema,hostFingerprint:TokenSchema,socketId:TokenSchema,kitId:TokenSchema,kitRevision:z.number().int().positive(),plan:HousePartPlanSchema,origin:Cell3Schema,provenance:z.strictObject({source:z.literal('simulated'),makerId:TokenSchema,makerName:z.string().min(1).max(64),kingdomKey:TokenSchema,kingdomName:z.string().min(1).max(64),firstForgedAt:z.number().int().nonnegative(),designId:TokenSchema}).optional()});
export type ForgePlacement=z.infer<typeof ForgePlacementSchema>;
export const FORGE_PHASES=['words','blueprint','pour','seal','strike','cool','flight','landed'] as const;
export type ForgePhase=typeof FORGE_PHASES[number];
/** Public observations are separate from requests. A refusal has no attribution or text fields. */
export type ForgePublicBeat = {kind:'work';ritualId:string;phase:ForgePhase;elapsed:number;duration:number}
  | {kind:'refusal';variant:0|1|2};
export interface ForgeRitualFrame {ritualId:string;phase:ForgePhase;elapsed:number;phaseProgress:number;duration:number;source:'simulated'|'live'}
export const FORGE_REFUSAL_INTERVAL_MS=600_000;
