import { describe, expect, it } from 'vitest';
import { placeBox, sitePlacements, type SiteLand } from './index';
import { GRAND_ARTISAN_KITS } from '../index';
import { createLighthouse } from '../harbour';

describe('artisan adoption seam', () => {
  it('preserves half-open rotated boxes at negative coordinates', () => {
    expect(placeBox({min:[-2,1,-3],size:[4,2,5],colour:'#112233'},[-10,4,-20],1)).toEqual({min:[-12,5,-22],size:[5,2,4],colour:'#112233'});
    expect(() => placeBox({min:[0,0,0],size:[1,-1,1],colour:'#112233'},[0,0,0],0)).toThrow();
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
    for(let distance=65;distance<=245;distance+=20) {
      const x=turns===0 ? 203 : 200+distance-1;
      const z=turns===0 ? 200-distance : 203;
      water[x+z*size]=0;
    }
    const land:SiteLand={size,height:256,ground,water,seaLevel:42,seed:{seedKey:'realm'},sites:{fields:{x:350,z:350,radius:0},harbour:{x:200,z:200,facing}}};
    const ships=sitePlacements(land,kind=>kind==='ship');
    expect(ships).toHaveLength(1);
    expect(ships[0]!.at).toEqual(turns===0 ? [230,42,135] : [265,42,230]);
  });
  it('checks the complete bowsprit projection for ships inside a full harbour', () => {
    const size=500, ground=new Uint16Array(size*size).fill(37), water=new Uint16Array(size*size).fill(42);
    for(let x=190;x<=310;x++) {ground[x+271*size]=50;water[x+271*size]=0;}
    const tower=createLighthouse('realm:harbour');
    for(const b of tower.boxes.filter(b=>b.min[1]===-3)) for(let z=b.min[2];z<b.min[2]+b.size[2];z++) for(let x=b.min[0];x<b.min[0]+b.size[0];x++) {
      const i=304+x+(270+z)*size; ground[i]=50;water[i]=0;
    }
    const land:SiteLand={size,height:256,ground,water,seaLevel:42,seed:{seedKey:'realm'},sites:{fields:{x:420,z:420,radius:0},harbour:{x:250,z:250,facing:-Math.PI/2}}};
    expect(sitePlacements(land,kind=>kind==='harbour').map(p=>p.piece.id)).toEqual(['harbour']);
    water[248+205*size]=0;
    expect(sitePlacements(land,kind=>kind==='harbour')).toEqual([]);
  });
  it('only proposes separate lighthouse and ships where their whole supports fit', () => {
    const size=400, ground=new Uint16Array(size*size).fill(37), water=new Uint16Array(size*size).fill(42);
    for(let z=289;z<=311;z++) for(let x=289;x<=311;x++) {ground[x+z*size]=50;water[x+z*size]=0;}
    const land:SiteLand={size,height:256,ground,water,seaLevel:42,seed:{seedKey:'realm'},sites:{fields:{x:350,z:350,radius:0},harbour:{x:200,z:200,facing:-Math.PI/2},headland:{x:300,z:300,y:50}}};
    expect(sitePlacements(land,()=>true).map(p=>p.piece.id)).toEqual(['harbour-lighthouse','harbour-ship','harbour-ship']);
    for(let z=0;z<200;z++) for(let x=0;x<200;x++) water[x+z*size]=0;
    expect(sitePlacements(land,()=>true).map(p=>p.piece.id)).toEqual(['harbour-lighthouse','harbour-ship']);
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
