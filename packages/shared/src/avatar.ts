import { z } from 'zod';
import { TokenSchema } from './identity';
import { Cell3Schema, VoxelBoxSchema, type Vec3 } from './voxel';

export const AVATAR_BONES = ['root','pelvis','chest','head','upperArmLeft','forearmLeft','handLeft','upperArmRight','forearmRight','handRight','thighLeft','shinLeft','footLeft','thighRight','shinRight','footRight'] as const;
export const AvatarBoneIdSchema = z.enum(AVATAR_BONES);
export type AvatarBoneId = z.infer<typeof AvatarBoneIdSchema>;
export const AvatarAttachmentIdSchema = z.enum([...AVATAR_BONES,'hat','face','back','gripLeft','gripRight']);
export type AvatarAttachmentId = z.infer<typeof AvatarAttachmentIdSchema>;
/** Avatar cells (.0625m), +Y up, +Z forward. Offsets are parent-local bind translations. */
export const AVATAR_RIG: readonly { id: AvatarBoneId; parent: AvatarBoneId | null; offset: Vec3 }[] = [
  {id:'root',parent:null,offset:[0,0,0]}, {id:'pelvis',parent:'root',offset:[0,8,0]},
  {id:'chest',parent:'pelvis',offset:[0,4,0]}, {id:'head',parent:'chest',offset:[0,4,0]},
  {id:'upperArmLeft',parent:'chest',offset:[-5,3,0]}, {id:'forearmLeft',parent:'upperArmLeft',offset:[0,-4,0]}, {id:'handLeft',parent:'forearmLeft',offset:[0,-3,0]},
  {id:'upperArmRight',parent:'chest',offset:[5,3,0]}, {id:'forearmRight',parent:'upperArmRight',offset:[0,-4,0]}, {id:'handRight',parent:'forearmRight',offset:[0,-3,0]},
  {id:'thighLeft',parent:'pelvis',offset:[-2,0,0]}, {id:'shinLeft',parent:'thighLeft',offset:[0,-4,0]}, {id:'footLeft',parent:'shinLeft',offset:[0,-3,0]},
  {id:'thighRight',parent:'pelvis',offset:[2,0,0]}, {id:'shinRight',parent:'thighRight',offset:[0,-4,0]}, {id:'footRight',parent:'shinRight',offset:[0,-3,0]},
];
export const AVATAR_SOCKETS = {
  hat:{parent:'head',offset:[0,8,0]},face:{parent:'head',offset:[0,4,4]},back:{parent:'chest',offset:[0,2,-2]},
  gripLeft:{parent:'handLeft',offset:[0,0,1]},gripRight:{parent:'handRight',offset:[0,0,1]},
} as const satisfies Record<string,{parent:AvatarBoneId;offset:Vec3}>;
export const AVATAR_PART_LIMITS = { maxDimension:64, maxBoxes:512, maxOccupiedCells:32768 } as const;
export const AVATAR_LOOK_LIMITS = { maxParts:32, maxOccupiedCells:65536, maxTriangles:24000 } as const;
/** Translate geometry by -pivot, then attach to the named bone/socket. No ownership or equip protocol. */
export const AvatarPartBlueprintSchema = z.strictObject({
  version:z.literal(1),id:TokenSchema,lattice:z.literal('avatar'),size:Cell3Schema,
  boxes:z.array(VoxelBoxSchema).max(AVATAR_PART_LIMITS.maxBoxes),pivot:Cell3Schema,attachment:AvatarAttachmentIdSchema,
  layer:z.enum(['body','hair','garment','accessory']),
}).superRefine((part,ctx)=>{
  if(part.size.some(n=>n<1||n>AVATAR_PART_LIMITS.maxDimension))ctx.addIssue({code:'custom',message:'Invalid avatar part bounds'});
  for(const box of part.boxes)if(box.from.some((n,i)=>n<0||n>=box.to[i]!||box.to[i]!>part.size[i]!))ctx.addIssue({code:'custom',message:'Avatar box outside bounds'});
});
export type AvatarPartBlueprint = z.infer<typeof AvatarPartBlueprintSchema>;
