import { createTree, treeExtent, type ForestSpecies } from './forest';
import { sitePlacements, type Bounds, type SiteLand } from './adoption';

/** Match the builder's local GrandTreeKit without adding a public protocol. */
type BuilderSpecies = 'oak' | 'lime' | 'birch' | 'autumn-gold' | 'autumn-red' | 'pine' | 'spruce' | 'cherry' | 'teal' | 'willow' | 'shrub' | 'hero-gold' | 'hero-teal' | 'hero-cherry';
type TreeShape = { readonly count:number; readonly dx:Int16Array; readonly dy:Int16Array; readonly dz:Int16Array; readonly material:Uint8Array; readonly min:readonly [number,number,number]; readonly max:readonly [number,number,number] };
const SPECIES: Record<BuilderSpecies, { family: ForestSpecies; bark:number; leaf:number; multiplier:number }> = {
  oak:{family:'gold',bark:40,leaf:48,multiplier:.7}, lime:{family:'gold',bark:40,leaf:52,multiplier:.7},
  birch:{family:'birch',bark:41,leaf:80,multiplier:.85}, 'autumn-gold':{family:'gold',bark:40,leaf:56,multiplier:.7},
  'autumn-red':{family:'gold',bark:40,leaf:60,multiplier:.7}, pine:{family:'pine',bark:42,leaf:64,multiplier:.8},
  spruce:{family:'pine',bark:42,leaf:64,multiplier:.75}, cherry:{family:'cherry',bark:43,leaf:68,multiplier:.75},
  teal:{family:'teal',bark:44,leaf:72,multiplier:.7}, willow:{family:'willow',bark:45,leaf:76,multiplier:.8},
  shrub:{family:'teal',bark:44,leaf:84,multiplier:.3}, 'hero-gold':{family:'gold',bark:40,leaf:56,multiplier:2.25},
  'hero-teal':{family:'teal',bark:44,leaf:72,multiplier:2.25}, 'hero-cherry':{family:'cherry',bark:43,leaf:68,multiplier:2.25},
};
const LEAVES: Record<ForestSpecies, readonly string[]> = {
  gold:['#9d7433','#c49340','#d8ad55'], pine:['#334f45','#416b53','#64855d'],
  cherry:['#ad7882','#d49b9e','#edbdaf'], teal:['#376b6a','#4a8b83','#72aa9c'],
  birch:['#667e43','#8da753','#b4be6c'], willow:['#6c7e42','#91a759','#b3bc70'],
};
const BARK: Record<ForestSpecies, readonly string[]> = {
  gold:['#654b3a','#806044'], pine:['#5b493c','#79614b'], cherry:['#694943','#866058'],
  teal:['#504a4a','#6a6158'], birch:['#d2c7ad','#ece0c6','#796c60'], willow:['#75664b','#908063'],
};
interface Template { readonly x:Int16Array; readonly y:Int16Array; readonly z:Int16Array; readonly shade:Uint8Array }
// Bounded reusable geometry variants prevent growing thousands of trees from scratch per worker.
const templates = new Map<string,Template>();
function template(family: ForestSpecies, seed: number): Template {
  const variant=(seed>>>0)%16, key=`${family}:${variant}`;
  const cached=templates.get(key); if(cached) return cached;
  const kit=createTree(family,`grand-shape-v1:${key}`), cells=new Map<number,number>();
  for(const box of kit.boxes) {
    const shade=LEAVES[family].indexOf(box.colour);
    const value=shade>=0?shade+1:BARK[family].includes(box.colour)?0:-1;
    if(value<0) throw new Error(`Unmapped tree colour ${box.colour}`);
    for(let z=box.min[2];z<box.min[2]+box.size[2];z++) for(let y=box.min[1];y<box.min[1]+box.size[1];y++) for(let x=box.min[0];x<box.min[0]+box.size[0];x++) {
      const key=((x+128)<<16)|((y+128)<<8)|(z+128); const old=cells.get(key);
      if(old===undefined || value===0 || old!==0) cells.set(key,value);
    }
  }
  const x=new Int16Array(cells.size), y=new Int16Array(cells.size), z=new Int16Array(cells.size), shade=new Uint8Array(cells.size);
  let i=0; for(const [k,v] of cells) { x[i]=(k>>>16)-128; y[i]=((k>>>8)&255)-128; z[i]=(k&255)-128; shade[i]=v; i++; }
  const result={x,y,z,shade}; templates.set(key,result); return result;
}
function shape(species: BuilderSpecies, seed: number, scale: number): TreeShape {
  const s=SPECIES[species]; if(!s || !Number.isFinite(seed)) throw new RangeError('Unknown tree species or seed');
  const actual=scale*s.multiplier; treeExtent(s.family,actual);
  const t=template(s.family,seed), cells=new Map<number,number>();
  const rotation=(seed>>>4)&3, mirror=((seed>>>6)&1)!==0;
  for(let i=0;i<t.x.length;i++) {
    let x=t.x[i]!, z=t.z[i]!;
    if(mirror) x=-x-1;
    for(let turn=0;turn<rotation;turn++) [x,z]=[-z-1,x];
    const x0=Math.floor(x*actual), x1=Math.max(x0+1,Math.floor((x+1)*actual));
    const y0=Math.floor(t.y[i]!*actual), y1=Math.max(y0+1,Math.floor((t.y[i]!+1)*actual));
    const z0=Math.floor(z*actual), z1=Math.max(z0+1,Math.floor((z+1)*actual));
    const value=t.shade[i]===0?s.bark:s.leaf+t.shade[i]!-1;
    for(let z=z0;z<z1;z++) for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
      // The scale bound guarantees a 10-bit signed coordinate for all authored forms.
      if(x < -512 || x > 511 || y < -512 || y > 511 || z < -512 || z > 511) throw new RangeError('Tree exceeds coordinate bounds');
      const k=((x+512)<<20)|((y+512)<<10)|(z+512), old=cells.get(k);
      if(old===undefined || value===s.bark || old!==s.bark) cells.set(k,value);
    }
  }
  const count=cells.size, dx=new Int16Array(count),dy=new Int16Array(count),dz=new Int16Array(count),material=new Uint8Array(count);
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  let i=0; for(const [k,v] of cells) { const x=(k>>>20)-512, y=((k>>>10)&1023)-512,z=(k&1023)-512; dx[i]=x;dy[i]=y;dz[i]=z;material[i]=v;
    min[0]=Math.min(min[0],x);min[1]=Math.min(min[1],y);min[2]=Math.min(min[2],z);max[0]=Math.max(max[0],x);max[1]=Math.max(max[1],y);max[2]=Math.max(max[2],z);i++; }
  return {count,dx,dy,dz,material,min,max};
}
function extent(species: BuilderSpecies, scale: number) { const s=SPECIES[species]; if(!s) throw new RangeError('Unknown tree species'); return treeExtent(s.family,scale*s.multiplier); }

/** GK10 is an independent, uninhabited render domain: protect all known reservations and
 * settlement footprints. GK11 must use sitePlacements with its installed-scene clearance guard. */
type RenderLand = SiteLand & { readonly cover: Uint8Array; readonly trees: Float32Array; readonly treeCount: number; readonly sites: SiteLand['sites'] & {
  readonly town: { readonly x:number; readonly z:number; readonly rx:number; readonly rz:number; readonly angle:number };
  readonly castle: { readonly x:number; readonly z:number; readonly radius:number };
} };
function renderClearance(land:RenderLand, bounds:Bounds):boolean {
  if(land.cover.length!==land.size*land.size || bounds.min[0]<0 || bounds.min[2]<0 || bounds.max[0]>land.size || bounds.max[2]>land.size) return false;
  const species:readonly BuilderSpecies[]=['oak','lime','birch','autumn-gold','autumn-red','pine','spruce','cherry','teal','willow','shrub','hero-gold','hero-teal','hero-cherry'];
  if(!Number.isSafeInteger(land.treeCount) || land.treeCount<0 || land.trees.length<land.treeCount*6) return false;
  for(let i=0;i<land.treeCount;i++) {
    const off=i*6, x=land.trees[off]!, z=land.trees[off+1]!, y=land.trees[off+2]!, name=species[land.trees[off+3]!], scale=land.trees[off+5]!;
    if(!name || ![x,y,z,scale].every(Number.isFinite) || scale<=0) return false;
    const e=extent(name,scale);
    if(x+e.radius>=bounds.min[0] && x-e.radius<bounds.max[0] && z+e.radius>=bounds.min[2] && z-e.radius<bounds.max[2] && y+e.height>=bounds.min[1] && y-8<bounds.max[1]) return false;
  }
  const {town,castle}=land.sites;
  if(![town.x,town.z,town.rx,town.rz,town.angle,castle.x,castle.z,castle.radius].every(Number.isFinite) || town.rx<=0 || town.rz<=0 || castle.radius<=0) return false;
  const c=Math.cos(town.angle),s=Math.sin(town.angle);
  for(let z=bounds.min[2];z<bounds.max[2];z++) for(let x=bounds.min[0];x<bounds.max[0];x++) {
    if(land.cover[x+z*land.size]===13) return false;
    const dx=x-town.x,dz=z-town.z,u=(dx*c+dz*s)/town.rx,v=(-dx*s+dz*c)/town.rz;
    if(u*u+v*v<1.44 || (x-castle.x)**2+(z-castle.z)**2<(castle.radius*1.3)**2) return false;
  }
  return true;
}
export const GRAND_ARTISAN_KITS = { trees: { extent, shape }, compose: [(land:RenderLand) => sitePlacements(land,(_kind,bounds) => renderClearance(land,bounds))] };
export { sitePlacements, type SiteLand, type Bounds };
