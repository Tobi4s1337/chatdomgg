import { KingdomIdSchema, PersonIdSchema } from './identity';
import { PresenceInputSchema, KingdomPresenceFrameSchema } from './presence';
import { VoxelBlueprintSchema } from './voxel';

export const WORLD_FIXTURE_TIME = 1_798_320_000_000;
export const WORLD_FIXTURE_KINGDOM = KingdomIdSchema.parse('900000000000000001');
export const WORLD_FIXTURE_PERSON = PersonIdSchema.parse('900000000000000002');
export const PRESENCE_FIXTURES = {
  stream: PresenceInputSchema.parse({version:1,id:'sim:stream:1',kingdomId:WORLD_FIXTURE_KINGDOM,observedAt:WORLD_FIXTURE_TIME,origin:'simulated',kind:'stream',live:true,sessionId:'sim:night:1'}),
  arrival: PresenceInputSchema.parse({version:1,id:'sim:arrival:1',kingdomId:WORLD_FIXTURE_KINGDOM,observedAt:WORLD_FIXTURE_TIME,origin:'simulated',kind:'observe',source:'chat',coverage:'activity',people:[{personId:WORLD_FIXTURE_PERSON,disclosure:'named',displayName:'Juniper'}]}),
  public: KingdomPresenceFrameSchema.parse({version:1,kingdomId:WORLD_FIXTURE_KINGDOM,epoch:'sim:1',sequence:1,asOf:WORLD_FIXTURE_TIME,origin:'simulated',streamLive:true,connection:'fresh',windows:[{slot:0,present:true,publicName:'Juniper',since:WORLD_FIXTURE_TIME}]}),
};
export const VOXEL_FIXTURE = VoxelBlueprintSchema.parse({version:1,id:'fixture:window',styleId:'hearth',kind:'home',lattice:'build',size:[16,24,8],boxes:[{from:[0,0,0],to:[16,24,8],material:3},{from:[4,8,0],to:[12,20,8],material:0}],windows:[{id:'presence',centre:[8,14,8],width:8,height:12,facing:'south'}]});
