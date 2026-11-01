import { describe, expect, it } from 'vitest';
import { placeBox, sitePlacements, type SiteLand } from './index';
import { GRAND_ARTISAN_KITS } from '../index';
import { createLighthouse, createQuay } from '../harbour';
import { CLAY } from '../kit';

describe('artisan adoption seam', () => {
  it('preserves half-open rotated boxes at negative coordinates', () => {
    expect(placeBox({min:[-2,1,-3],size:[4,2,5],colour:'#112233'},[-10,4,-20],1)).toEqual({min:[-12,5,-22],size:[5,2,4],colour:'#112233'});
    expect(() => placeBox({min:[0,0,0],size:[1,-1,1],colour:'#112233'},[0,0,0],0)).toThrow();
    expect(() => placeBox({min:[Number.MAX_SAFE_INTEGER,0,0],size:[1,1,1],colour:'#112233'},[0,0,0],0)).toThrow(RangeError);
    expect(() => placeBox({min:[0,0,0],size:[1,1,1],colour:'#112233'},[0,0,0],0.5)).toThrow(RangeError);
  });
  it('will not propose a structure without explicit clearance and supported terrain', () => {
    const size=256, ground=new Uint16Array(size*size).fill(50), water=new Uint16Array(size*size);
    const land:SiteLand={size,height:256,ground,water,seaLevel:20,seed:{seedKey:'realm'},sites:{fields:{x:128,z:128},harbour:{x:120,z:120,facing:0}}};
    expect(sitePlacements(land)).toEqual([]);
    expect(sitePlacements(land,()=>false)).toEqual([]);
    expect(sitePlacements(land,()=>true).map(p=>p.piece.id)).toEqual(['windmill']);
    water.fill(51);
    expect(sitePlacements(land,()=>true)).toEqual([]);
  });
  it('GK10 composition uses known reserve masks and refuses occupied sites', () => {
    const size=256, ground=new Uint16Array(size*size).fill(50), water=new Uint16Array(size*size), cover=new Uint8Array(size*size);
    const land={size,height:256,ground,water,cover,trees:new Float32Array(),treeCount:0,seaLevel:20,seed:{seedKey:'realm'},sites:{fields:{x:128,z:128,radius:0},harbour:{x:60,z:60,facing:0},town:{x:20,z:20,rx:8,rz:8,angle:0},castle:{x:20,z:45,radius:8}}};
    expect(GRAND_ARTISAN_KITS.compose[0]!(land).map(p=>p.piece.id)).toEqual(['windmill']);
    cover[128+128*size]=13;
    expect(GRAND_ARTISAN_KITS.compose[0]!(land)).toEqual([]);
    cover[128+128*size]=0;
    const treed={...land,trees:Float32Array.from([128,128,50,0,123,1]),treeCount:1};
    expect(GRAND_ARTISAN_KITS.compose[0]!(treed)).toEqual([]);
  });
  it('connects added footing columns to the sampled terrain', () => {
    const size=256, ground=new Uint16Array(size*size).fill(50),water=new Uint16Array(size*size);
    ground[119+120*size]=47;
    const land:SiteLand={size,height:256,ground,water,seaLevel:20,seed:{seedKey:'realm'},sites:{fields:{x:128,z:128,radius:0},harbour:{x:60,z:60,facing:0}}};
    const placement=sitePlacements(land,()=>true)[0]!;
    expect(placement.at[1]).toBe(50);
    expect(placement.piece.boxes.some(b=>b.min[0]===-9 && b.min[1]===-3 && b.min[2]===-8 && b.size[1]===3)).toBe(true);
  });
  it('supports the mill stoop itself and rejects a wet entrance', () => {
    const size=256, ground=new Uint16Array(size*size).fill(50),water=new Uint16Array(size*size);
    const index=128+138*size; ground[index]=47;
    const land:SiteLand={size,height:256,ground,water,seaLevel:20,seed:{seedKey:'realm'},sites:{fields:{x:128,z:128,radius:0},harbour:{x:60,z:60,facing:0}}};
    const mill=sitePlacements(land,kind=>kind==='windmill')[0]!;
    expect(mill.piece.boxes.some(b=>b.min[0]===0 && b.min[1]===-3 && b.min[2]===10 && b.size[1]===3)).toBe(true);
    water[index]=51;
    expect(sitePlacements(land,kind=>kind==='windmill')).toEqual([]);
  });
  it('fills only columns under the lighthouse octagonal footing', () => {
    const size=400, ground=new Uint16Array(size*size).fill(37),water=new Uint16Array(size*size).fill(42);
    const tower=createLighthouse('realm:headland');
    const base=tower.boxes.filter(b=>b.min[1]===-3);
    const covered=new Set<string>();
    for(const b of base) for(let z=b.min[2];z<b.min[2]+b.size[2];z++) for(let x=b.min[0];x<b.min[0]+b.size[0];x++) {
      covered.add(`${x},${z}`); ground[300+x+(300+z)*size]=50;water[300+x+(300+z)*size]=0;
    }
    expect(covered.has('-11,-11')).toBe(false);
    ground[300+300*size]=46;
    const land:SiteLand={size,height:256,ground,water,seaLevel:42,seed:{seedKey:'realm'},sites:{fields:{x:350,z:350,radius:0},harbour:{x:200,z:200,facing:-Math.PI/2},headland:{x:300,z:300,y:50}}};
    const lighthouse=sitePlacements(land,kind=>kind==='lighthouse')[0]!;
    expect(lighthouse.at).toEqual([300,50,300]);
    const supports=lighthouse.piece.boxes.filter(b=>b.min[1] < -3);
    expect(supports.some(b=>b.min[0]===0 && b.min[2]===0 && b.min[1]===-4 && b.size[1]===1)).toBe(true);
    expect(supports.every(b=>covered.has(`${b.min[0]},${b.min[2]}`))).toBe(true);
  });
  it.each([[0,-Math.PI/2],[1,0]] as const)('rejects water blocked under a ship bowsprit at rotation %s', (turns, facing) => {
    const size=500, ground=new Uint16Array(size*size).fill(37),water=new Uint16Array(size*size).fill(42);
    for(let distance=45;distance<=245;distance+=20) {
      const x=turns===0 ? 203 : 200+distance-1;
      const z=turns===0 ? 200-distance : 203;
      water[x+z*size]=0;
    }
    const land:SiteLand={size,height:256,ground,water,seaLevel:42,seed:{seedKey:'realm'},sites:{fields:{x:350,z:350,radius:0},harbour:{x:200,z:200,facing}}};
    const ships=sitePlacements(land,kind=>kind==='ship');
    expect(ships).toHaveLength(1);
    expect(ships[0]!.at).toEqual(turns===0 ? [230,42,155] : [245,42,230]);
  });
  it('only proposes separate lighthouse and ships where their whole supports fit', () => {
    const size=400, ground=new Uint16Array(size*size).fill(37), water=new Uint16Array(size*size).fill(42);
    for(let z=289;z<=311;z++) for(let x=289;x<=311;x++) {ground[x+z*size]=50;water[x+z*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:42,seed:{seedKey:'realm'},sites:{fields:{x:350,z:350,radius:0},harbour:{x:200,z:200,facing:-Math.PI/2},headland:{x:300,z:300,y:50}}};
    expect(sitePlacements(land,()=>true).map(p=>p.piece.id)).toEqual(['harbour-lighthouse','harbour-ship','harbour-ship']);
    for(let z=0;z<200;z++) for(let x=0;x<200;x++) water[x+z*size]=0;
    expect(sitePlacements(land,()=>true).map(p=>p.piece.id)).toEqual(['harbour-lighthouse','harbour-ship']);
  });
  it.each([0,1,2,3])('fits a grounded quay on an uneven seabed at cardinal turn %s', turns => {
    const size=512, sea=42, ground=new Uint16Array(size*size), water=new Uint16Array(size*size).fill(sea);
    for(let z=0;z<size;z++) for(let x=0;x<size;x++) ground[x+z*size]=23+(x+z)%6;
    const cell=(x:number,z:number) => { for(let i=0;i<turns;i++) [x,z]=[-z-1,x]; return [256+x,256+z] as const; };
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) {const [wx,wz]=cell(x,z);ground[wx+wz*size]=sea+5;water[wx+wz*size]=0;}
    const kit=createQuay('realm:harbour'), placed=kit.boxes.map(b=>placeBox(b,[256,sea,256],turns));
    const minX=Math.min(...placed.map(b=>b.min[0])), minZ=Math.min(...placed.map(b=>b.min[2]));
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:turns*Math.PI/2-Math.PI/2}}};
    const candidate=sitePlacements(land,(kind,b)=>kind==='harbour'&&(b.min[0]===minX || (turns===1 && b.min[0]===minX-10))&&(b.min[2]===minZ || (turns===2 && b.min[2]===minZ-10)));
    expect(candidate).toHaveLength(1);
    const quay=candidate[0]!;
    expect(quay.at).toEqual([256,sea,256]);expect(quay.turns).toBe(turns);
    expect(quay.piece.id).toBe('harbour-quay');
    const sourceStart=quay.piece.boxes.findIndex(b=>JSON.stringify(b)===JSON.stringify(kit.boxes[0]));
    expect(sourceStart).toBeGreaterThanOrEqual(0);
    expect(quay.piece.boxes.slice(sourceStart,sourceStart+kit.boxes.length)).toEqual(kit.boxes);
    const foundations=quay.piece.boxes.slice(0,sourceStart);
    for(const [x,z,colour] of [[-38,-29,CLAY.timber],[0,5,CLAY.stoneDark]] as const) {
      const [wx,wz]=cell(x,z), bed=ground[wx+wz*size]!;
      expect(foundations.some(b=>b.colour===colour && b.min[0]<=x && b.min[0]+b.size[0]>x && b.min[2]===z && b.min[1]===bed-sea && b.min[1]+b.size[1]===-5)).toBe(true);
    }
    expect(foundations.length).toBeLessThan(4_000);
  });
  it.each([0,1,2,3])('rejects terrain poking through the low landing step at turn %s', turns => {
    const size=512,sea=42,ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    const cell=(x:number,z:number) => {for(let i=0;i<turns;i++) [x,z]=[-z-1,x];return [256+x,256+z] as const;};
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) {const [wx,wz]=cell(x,z);ground[wx+wz*size]=sea+5;water[wx+wz*size]=0;}
    const kit=createQuay('realm:harbour'), boxes=kit.boxes.map(b=>placeBox(b,[256,sea,256],turns));
    const minX=Math.min(...boxes.map(b=>b.min[0])), minZ=Math.min(...boxes.map(b=>b.min[2]));
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:turns*Math.PI/2-Math.PI/2}}};
    const exact=(kind:string,b:{min:readonly number[]})=>kind==='harbour'&&(b.min[0]===minX || (turns===1 && b.min[0]===minX-10))&&(b.min[2]===minZ || (turns===2 && b.min[2]===minZ-10));
    expect(sitePlacements(land,exact)).toHaveLength(1);
    // The lowest step tops at the sea plane; this ground is below +9 but would bury it.
    const [x,z]=cell(5,-8); ground[x+z*size]=sea+1;water[x+z*size]=0;
    expect(sitePlacements(land,exact)).toEqual([]);
  });
  it('mounts quay, headland light and near-pier ships independently', () => {
    const size=512,sea=42,ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) {ground[256+x+(256+z)*size]=sea+5;water[256+x+(256+z)*size]=0;}
    for(let z=389;z<=411;z++) for(let x=389;x<=411;x++) {ground[x+z*size]=50;water[x+z*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2},headland:{x:400,z:400,y:50}}};
    const result=sitePlacements(land,()=>true);
    expect(result.map(p=>p.piece.id)).toEqual(['harbour-quay','harbour-lighthouse','harbour-ship','harbour-ship']);
    expect(result.filter(p=>p.piece.id==='harbour-ship').map(p=>p.at)).toEqual([[226,42,211],[286,42,211]]);
  });
  it.each([
    {reason:'a wet shore join',x:0,z:21,g:25,w:42},
    {reason:'a tall shore bank',x:0,z:21,g:52,w:0},
    {reason:'terrain through the deck',x:0,z:10,g:51,w:0},
    {reason:'unknown water beneath a pier',x:-38,z:-29,g:25,w:0},
    {reason:'an unknown seabed',x:-38,z:-29,g:0,w:42},
    {reason:'an obstructed deep-water berth',x:-60,z:-50,g:42,w:0},
  ])('rejects $reason', ({x,z,g,w}) => {
    const size=512,sea=42, ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) {ground[256+x+(256+z)*size]=sea+5;water[256+x+(256+z)*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    const exact=(kind:string,b:{min:readonly number[]})=>kind==='harbour'&&b.min[0]===195&&b.min[2]===224;
    const i=256+x+(256+z)*size;
    ground[i]=g;water[i]=w;
    expect(sitePlacements(land,exact)).toEqual([]);
  });
  it('searches nearby shore without moving an unverified quay', () => {
    const size=512,sea=42, ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) {ground[272+x+(256+z)*size]=sea+5;water[272+x+(256+z)*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    const candidates=sitePlacements(land,(kind,b)=>kind==='harbour'&&b.min[0]===211&&b.min[2]===224);
    expect(candidates).toHaveLength(1);expect(candidates[0]!.at).toEqual([272,42,256]);
  });
  it.each([false,true])('fits connected complete modules on a short%s shore', curved => {
    const size=512,sea=42,ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let x=-8;x<40;x++) {
      const n=Math.floor((x+8)/16), within=x-n*16, shift=curved ? 2*n+Math.round((within+8)/15*2) : 0;
      for(let z=21+shift;z<51+shift;z++) {ground[256+x+(256+z)*size]=47;water[256+x+(256+z)*size]=0;}
    }
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    const guard=(kind:string,b:{min:readonly number[];max:readonly number[]})=>kind==='harbour'&&b.min[0]!>=248&&b.max[0]!<=296;
    const placements=sitePlacements(land,guard);
    expect(placements).toHaveLength(1);
    const quay=placements[0]!;expect(quay.piece.id).toBe('harbour-quay-modular');expect(quay.at).toEqual([256,42,256]);
    expect(quay.piece.anchors.shoreEnd).toEqual([40,6,curved?27:21]);
    // Every column along both seams has a real top course; none is an inferred bridge.
    for(let x=-8;x<40;x++) {
      const n=Math.floor((x+8)/16), within=x-n*16, shift=curved ? 2*n+Math.round((within+8)/15*2) : 0;
      expect(quay.piece.boxes.some(b=>b.min[0]<=x&&b.min[0]+b.size[0]>x&&b.min[1]<=6&&b.min[1]+b.size[1]>6&&b.min[2]<=10+shift&&b.min[2]+b.size[2]>10+shift)).toBe(true);
    }
    for(let z=21;z<60;z++) {ground[256+18+(256+z)*size]=25;water[256+18+(256+z)*size]=sea;}
    expect(sitePlacements(land,guard)).toEqual([]);
  });
  it('finds a pier-first run when the first landing position is blocked', () => {
    const size=512,sea=42,ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let x=-8;x<40;x++) for(let z=21;z<51;z++) {ground[256+x+(256+z)*size]=47;water[256+x+(256+z)*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    let rejectedLanding=false;
    const guard=(kind:string,b:{min:readonly number[];max:readonly number[]})=>{
      if(kind!=='harbour'||b.min[0]!<248||b.max[0]!>296) return false;
      if(b.min[0]===264 && b.min[2]===248) {rejectedLanding=true;return false;}
      return true;
    };
    const result=sitePlacements(land,guard);
    expect(rejectedLanding).toBe(true);
    expect(result.map(p=>p.piece.id)).toEqual(['harbour-quay-modular']);
    expect(result[0]!.piece.anchors.shoreEnd?.slice(0,2)).toEqual([40,6]);
  });
  it('allows a shallow landward pier root but requires connected water under its outer half', () => {
    const size=512,sea=42,ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) {ground[256+x+(256+z)*size]=sea+5;water[256+x+(256+z)*size]=0;}
    for(const centre of [-34,26]) for(let z=-16;z<0;z++) for(let x=centre-5;x<=centre+5;x++) ground[256+x+(256+z)*size]=sea-2;
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    const guard=(kind:string,b:{min:readonly number[]})=>kind==='harbour' && b.min[0]===195 && b.min[2]===224;
    expect(sitePlacements(land,guard).map(p=>p.piece.id)).toEqual(['harbour-quay']);
    ground[256-34+(256-25)*size]=sea;water[256-34+(256-25)*size]=0;
    expect(sitePlacements(land,guard)).toEqual([]);
  });
  it('rejects a two-cell island and builds supported stairs to a low dry bank', () => {
    const size=512,sea=42,ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let z=21;z<23;z++) for(let x=-61;x<62;x++) {ground[256+x+(256+z)*size]=sea+1;water[256+x+(256+z)*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    const guard=(kind:string,b:{min:readonly number[]})=>kind==='harbour' && b.min[0]===195 && b.min[2]===224;
    expect(sitePlacements(land,guard)).toEqual([]);
    for(let z=23;z<51;z++) for(let x=-61;x<62;x++) {ground[256+x+(256+z)*size]=sea+1;water[256+x+(256+z)*size]=0;}
    const result=sitePlacements(land,guard);expect(result).toHaveLength(1);
    const boxes=result[0]!.piece.boxes;
    // Two-cell-deep, one-cell-high steps descend from deck to the bank.
    for(let i=0;i<8;i++) expect(boxes.some(b=>b.min[0]<=0 && b.min[0]+b.size[0]>0 && b.min[2]<=23+2*i && b.min[2]+b.size[2]>23+2*i && b.min[1]+b.size[1]===8-i)).toBe(true);
  });
  it('requires boundary-connected deep seawater beneath a quay and next to its berths', () => {
    const size=256,sea=42,ground=new Uint16Array(size*size).fill(sea),water=new Uint16Array(size*size);
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) ground[128+x+(128+z)*size]=sea+5;
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:0,z:0,radius:0},harbour:{x:128,z:128,facing:-Math.PI/2}}};
    expect(sitePlacements(land,kind=>kind==='harbour')).toEqual([]);
    // A deep but isolated pond is still not a navigable sea.
    for(let z=80;z<128;z++) for(let x=50;x<205;x++) {ground[x+z*size]=25;water[x+z*size]=sea;}
    expect(sitePlacements(land,kind=>kind==='harbour')).toEqual([]);
  });
  it('finds a bounded adjacent orientation for a straight coast', () => {
    const size=512,sea=42,ground=new Uint16Array(size*size).fill(25),water=new Uint16Array(size*size).fill(sea);
    for(let z=0;z<size;z++) for(let x=0;x<=233;x++) {ground[x+z*size]=sea+5;water[x+z*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:0,z:0,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    const diagnostics:{orientations:{turns:number;work:number;exhausted:boolean}[]}={orientations:[]};
    const result=sitePlacements(land,kind=>kind==='harbour',diagnostics);
    expect(result).toHaveLength(1);expect(result[0]!.turns).toBe(1);
    expect(diagnostics.orientations.map(s=>s.turns)).toEqual([0,1]);
    expect(diagnostics.orientations.every(s=>s.work<=10_001 && typeof s.exhausted==='boolean')).toBe(true);
  });
  it('does not place accepted pieces on top of one another', () => {
    const size=256,sea=42,ground=new Uint16Array(size*size).fill(50),water=new Uint16Array(size*size);
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:128,z:128,radius:0},harbour:{x:128,z:128,facing:0},headland:{x:128,z:128,y:50}}};
    const placements=sitePlacements(land,kind=>kind==='windmill'||kind==='lighthouse');
    expect(placements.map(p=>p.piece.id)).toContain('windmill');
    const bounds=placements.map(p=>p.piece.boxes.map(b=>placeBox(b,p.at,p.turns))).map(boxes=>({min:[0,1,2].map(i=>Math.min(...boxes.map(b=>b.min[i]!))),max:[0,1,2].map(i=>Math.max(...boxes.map(b=>b.min[i]!+b.size[i]!)))}));
    for(let i=0;i<bounds.length;i++) for(let j=i+1;j<bounds.length;j++) expect([0,1,2].some(d=>bounds[i]!.max[d]!<=bounds[j]!.min[d]! || bounds[j]!.max[d]!<=bounds[i]!.min[d]!)).toBe(true);
  });
  it('rejects seabed supports deeper than the 64-cell limit', () => {
    const size=512,sea=100,ground=new Uint16Array(size*size).fill(30),water=new Uint16Array(size*size).fill(sea);
    for(let z=21;z<51;z++) for(let x=-61;x<62;x++) {ground[256+x+(256+z)*size]=sea+5;water[256+x+(256+z)*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:sea,seed:{seedKey:'realm'},sites:{fields:{x:450,z:450,radius:0},harbour:{x:256,z:256,facing:-Math.PI/2}}};
    expect(sitePlacements(land,kind=>kind==='harbour')).toEqual([]);
  });
  it('keeps variants and rotations deterministic while respecting envelope bounds', () => {
    const trees=GRAND_ARTISAN_KITS.trees;
    const a=trees.shape('autumn-gold',1,1), b=trees.shape('autumn-gold',1,1), c=trees.shape('autumn-gold',17,1), d=trees.shape('autumn-gold',2,1);
    expect(a).toEqual(b);
    expect(Array.from(a.dx)).not.toEqual(Array.from(c.dx));
    expect(Array.from(a.dx)).not.toEqual(Array.from(d.dx));
    for(const scale of [.78,1.32]) for(const seed of [0,17,95]) {
      const tree=trees.shape('birch',seed,scale), extent=trees.extent('birch',scale);
      expect(tree.min[0]).toBeGreaterThanOrEqual(-extent.radius);
      expect(tree.max[0]).toBeLessThanOrEqual(extent.radius);
      expect(tree.min[2]).toBeGreaterThanOrEqual(-extent.radius);
      expect(tree.max[2]).toBeLessThanOrEqual(extent.radius);
      expect(tree.max[1]).toBeLessThanOrEqual(extent.height);
    }
  });
  it('adapts every builder species to its own supported palette IDs and exact bounds', () => {
    for (const species of ['oak','lime','birch','autumn-gold','autumn-red','pine','spruce','cherry','teal','willow','shrub','hero-gold','hero-teal','hero-cherry'] as const) {
      const shape=GRAND_ARTISAN_KITS.trees.shape(species,123,1), extent=GRAND_ARTISAN_KITS.trees.extent(species,1);
      expect(shape.count).toBeGreaterThan(0);
      expect(shape.count).toBe(shape.material.length);
      expect(shape.min[0]).toBeGreaterThanOrEqual(-extent.radius);
      expect(shape.max[2]).toBeLessThanOrEqual(extent.radius);
      expect(shape.max[1]).toBeLessThanOrEqual(extent.height);
      expect([...shape.material].every(m => m>=40 && m<=87)).toBe(true);
    }
  },30000);
});
