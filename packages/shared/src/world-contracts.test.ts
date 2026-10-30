import { describe, expect, it } from 'vitest';
import { KingdomPresenceFrameSchema, PresenceInputSchema } from './presence';
import { PRESENCE_FIXTURES, VOXEL_FIXTURE } from './world-fixtures';
import { MaterialRegistrySchema, VoxelBlueprintSchema, VOXEL_METRES, splitCell, cellIndex } from './voxel';

describe('small world consumer boundaries', () => {
  it('keeps exact lattices and negative chunk boundaries', () => {
    expect(VOXEL_METRES.terrain / VOXEL_METRES.build).toBe(4);
    expect(VOXEL_METRES.build / VOXEL_METRES.avatar).toBe(2);
    expect(splitCell(-1)).toEqual({chunk:-1,local:31});
    expect(splitCell(-32)).toEqual({chunk:-1,local:0});
    expect(splitCell(-33)).toEqual({chunk:-2,local:31});
    expect(cellIndex(31,31,31)).toBe(32767);
    expect(() => splitCell(1.2)).toThrow();
  });
  it('rejects off-bounds and excessive allocations before rasterization', () => {
    expect(VoxelBlueprintSchema.safeParse(VOXEL_FIXTURE).success).toBe(true);
    for (const size of [[256,256,256],[1,1,0],[257,1,1]]) expect(VoxelBlueprintSchema.safeParse({...VOXEL_FIXTURE,size}).success).toBe(false);
    expect(VoxelBlueprintSchema.safeParse({...VOXEL_FIXTURE,boxes:[{from:[-1,0,0],to:[1,1,1],material:3}]}).success).toBe(false);
    expect(VoxelBlueprintSchema.safeParse({...VOXEL_FIXTURE,windows:[{...VOXEL_FIXTURE.windows[0],width:1_000_000_000}]}).success).toBe(false);
  });
  it('keeps palette indexes separate from IDs and air non-occluding', () => {
    const air = {id:0,name:'air',solid:false,occludesFaces:false,occludesAo:false,blocksLight:false,colour:'#000000',surface:'air'};
    expect(MaterialRegistrySchema.safeParse({version:1,revision:0,materials:[air]}).success).toBe(true);
    expect(MaterialRegistrySchema.safeParse({version:1,revision:0,materials:[air,air]}).success).toBe(false);
    expect(MaterialRegistrySchema.safeParse({version:1,revision:0,materials:[{...air,blocksLight:true}]}).success).toBe(false);
  });
  it('cannot disclose Chatters identities or add client authority', () => {
    expect(PresenceInputSchema.parse(PRESENCE_FIXTURES.lost).kind).toBe('source-lost');
    expect(PresenceInputSchema.safeParse({...PRESENCE_FIXTURES.lost,sources:['chat','chat']}).success).toBe(false);
    expect(PresenceInputSchema.safeParse({...PRESENCE_FIXTURES.lost,sources:['walker']}).success).toBe(false);
    expect(PresenceInputSchema.safeParse({...PRESENCE_FIXTURES.lost,actor:'king'}).success).toBe(false);
    const input = PRESENCE_FIXTURES.arrival;
    expect(PresenceInputSchema.safeParse({...input,source:'chatters',coverage:'complete'}).success).toBe(false);
    expect(PresenceInputSchema.safeParse({...input,actor:'king'}).success).toBe(false);
    const frame=PRESENCE_FIXTURES.public;
    expect(KingdomPresenceFrameSchema.safeParse({...frame,windows:[{...frame.windows[0],personId:'123'}]}).success).toBe(false);
    expect(KingdomPresenceFrameSchema.safeParse({...frame,connection:'stale'}).success).toBe(false);
    expect(KingdomPresenceFrameSchema.safeParse({...frame,streamLive:false}).success).toBe(false);
    expect(KingdomPresenceFrameSchema.safeParse({...frame,windows:[frame.windows[0],frame.windows[0]]}).success).toBe(false);
  });
  it('rejects impossible stream sessions and ambiguous holds', () => {
    expect(PresenceInputSchema.safeParse({...PRESENCE_FIXTURES.stream,live:false}).success).toBe(false);
    const stream=PRESENCE_FIXTURES.stream;
    const removal={version:1,id:'remove:1',kingdomId:stream.kingdomId,observedAt:stream.observedAt,origin:stream.origin,kind:'remove',personId:'123',reason:'ban',until:1};
    expect(PresenceInputSchema.safeParse(removal).success).toBe(false);
    expect(PresenceInputSchema.safeParse({...removal,until:null}).success).toBe(true);
  });
});
