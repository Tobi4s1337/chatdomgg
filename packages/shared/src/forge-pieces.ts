import { z } from 'zod';
import { TokenSchema } from './identity';
import { Cell3Schema, VoxelBlueprintSchema } from './voxel';

export const ForgePieceKindSchema = z.enum(['floor','wall','roof','door','window','porch','chimney','trim']);
export type ForgePieceKind = z.infer<typeof ForgePieceKindSchema>;
export const PieceSpaceSchema = z.strictObject({from:Cell3Schema,to:Cell3Schema}).refine(box=>box.from.every((n,i)=>n<box.to[i]!), 'Empty piece space');
/** Local build-cell anchors. Equal profiles, coincident points and opposed normals mate. */
export const ForgeConnectorSchema = z.strictObject({
  id:TokenSchema,profile:TokenSchema,point:Cell3Schema,normal:z.enum(['north','east','south','west','up','down']),
});
export const ForgePieceDefinitionSchema = z.strictObject({
  version:z.literal(1),id:TokenSchema,familyId:TokenSchema,kind:ForgePieceKindSchema,
  blueprint:VoxelBlueprintSchema,connectors:z.array(ForgeConnectorSchema).max(32),clearanceBoxes:z.array(PieceSpaceSchema).max(32),
  door:z.strictObject({leaf:VoxelBlueprintSchema,hinge:Cell3Schema,openQuarterTurns:z.union([z.literal(1),z.literal(-1)]),passage:PieceSpaceSchema,threshold:Cell3Schema}).optional(),
}).superRefine((piece,ctx)=>{
  if(new Set(piece.connectors.map(c=>c.id)).size!==piece.connectors.length)ctx.addIssue({code:'custom',message:'Duplicate connector ID'});
  if(piece.door&&piece.kind!=='door')ctx.addIssue({code:'custom',message:'Only a door piece carries a hinged leaf'});
  for(const connector of piece.connectors)if(connector.point.some((n,i)=>n<0||n>piece.blueprint.size[i]!))ctx.addIssue({code:'custom',message:'Connector outside piece bounds'});
});
export type ForgeConnector = z.infer<typeof ForgeConnectorSchema>;
export type ForgePieceDefinition = z.infer<typeof ForgePieceDefinitionSchema>;
