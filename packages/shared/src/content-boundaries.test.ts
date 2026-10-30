import {expect,it} from 'vitest';
import {AvatarPartBlueprintSchema,AVATAR_RIG,AVATAR_SOCKETS} from './avatar';
import {ForgePieceDefinitionSchema} from './forge-pieces';
it('anchors a chibi head and grip in avatar cells without accepting build data',()=>{
  const positions=new Map<string,number[]>();
  for(const bone of AVATAR_RIG){const parent=bone.parent?positions.get(bone.parent)!:[0,0,0];positions.set(bone.id,bone.offset.map((n,i)=>n+parent[i]!));}
  expect(positions.get('head')).toEqual([0,16,0]);
  expect(positions.get('handLeft')).toEqual([-5,8,0]);
  expect(AVATAR_SOCKETS.hat.offset).toEqual([0,8,0]);
  const part={version:1,id:'fixture-head',lattice:'avatar',size:[8,8,8],boxes:[{from:[0,0,0],to:[8,8,8],material:24}],pivot:[4,0,4],attachment:'head',layer:'body'};
  expect(AvatarPartBlueprintSchema.parse(part)).toEqual(part);
  expect(AvatarPartBlueprintSchema.safeParse({...part,lattice:'build'}).success).toBe(false);
  expect(AvatarPartBlueprintSchema.safeParse({...part,attachment:'unknown'}).success).toBe(false);
});
it('keeps Forge connector and hinged-door metadata outside the strict blueprint',()=>{
  const blueprint={version:1,id:'fixture-door',styleId:'hearth',kind:'prop',lattice:'build',size:[32,32,4],boxes:[{from:[0,0,0],to:[4,32,4],material:5}],windows:[]};
  const piece={version:1,id:'fixture-door',familyId:'hearthfold',kind:'door',blueprint,connectors:[{id:'left',profile:'wall-32',point:[0,16,2],normal:'west'}],clearanceBoxes:[],door:{leaf:{...blueprint,id:'fixture-leaf'},hinge:[4,0,2],openQuarterTurns:1,passage:{from:[4,0,0],to:[28,28,4]},threshold:[16,0,2]}};
  expect(ForgePieceDefinitionSchema.parse(piece)).toEqual(piece);
  expect(ForgePieceDefinitionSchema.safeParse({...piece,connectors:[piece.connectors[0],piece.connectors[0]]}).success).toBe(false);
  expect(ForgePieceDefinitionSchema.safeParse({...piece,kind:'wall'}).success).toBe(false);
});
