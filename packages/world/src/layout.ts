import type { SettlementPlan } from './settlement/types';
import { settlementTerrainHeight } from './settlement/terrain';
import { HOME_DEPTH_METRES, type HomeTier, type Vec3 } from '@chatdom/shared';

export type KingdomTier = 'hamlet' | 'town';
export interface KingdomConfig { seed: string; tier: KingdomTier; firstYear: number; year: number }
export interface HomePlot {
  id: string; slot: number; quarterYear: number; street: string; ordinal: number;
  position: Vec3; rotation: 0 | 2; tier: HomeTier; style: 'hearth' | 'tide' | 'grove'; variant: number;
  /** Axis-aligned reserved rectangle in world metres; front fence alone changes with home tier. */
  lot: { minX: number; maxX: number; minZ: number; maxZ: number; height: 20; depth: 16; frontage: 8 };
  allowedDepth: number;
}
export interface TenureQuarter { year:number; name:string; streetZ:number; elevation:number }
export interface KingdomLayout {
  config: KingdomConfig; homes: HomePlot[]; quarters: TenureQuarter[];
  castle: Vec3; beacon: Vec3; bounds: {minX:number;maxX:number;minZ:number;maxZ:number};
  lake: {x:number;z:number;radiusX:number;radiusZ:number;level:number};
}
export function seedHash(text: string): number {
  let h=2166136261; for(let i=0;i<text.length;i++) { h^=text.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0;
}
export function randomUnit(seed:number): number { let t=seed+0x6d2b79f5; t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296; }

/** Each year owns an east/west growth corridor. New lots append outward; old coordinates never move. */
export function generateKingdom(config: KingdomConfig): KingdomLayout {
  if (!Number.isInteger(config.firstYear) || !Number.isInteger(config.year) || config.year<config.firstYear || config.year-config.firstYear>30) throw new Error('Invalid founding years');
  const quarters:TenureQuarter[]=[], homes:HomePlot[]=[];
  const count=config.tier==='hamlet'?12:48;
  const quarterNames=['Hearthward','Bellflower','Copperleaf','Willowbend','Meadowgate'];
  for(let year=config.firstYear;year<=config.year;year++) {
    const q=year-config.firstYear,streetZ=q*42;
    const elevation=Math.max(1,9-q*1.75);
    const name=quarterNames[q%quarterNames.length]!;
    quarters.push({year,name,streetZ,elevation});
    for(let ordinal=0;ordinal<count;ordinal++) {
      const pair=Math.floor(ordinal/4),east=(ordinal%4)<2, south=ordinal%2===1;
      const x=(east?1:-1)*(14+pair*9),z=streetZ+(south?12:-12);
      const id=`plot:${year}:${ordinal}`, hash=seedHash(config.seed+id),r=randomUnit(hash);
      const tier:HomeTier=q===0&&ordinal%7===0?'manor':r>.78?'house':r>.2?'cottage':'hut';
      const style=(['hearth','tide','grove'] as const)[hash%3]!;
      homes.push({id,slot:q*1024+ordinal,quarterYear:year,street:`${name} Lane`,ordinal,
        position:[x,elevation,z],rotation:south?2:0,tier,style,variant:Math.floor(r*3),
        lot:{minX:x-4,maxX:x+4,minZ:south?streetZ+4:streetZ-20,maxZ:south?streetZ+20:streetZ-4,height:20,depth:16,frontage:8},allowedDepth:HOME_DEPTH_METRES[tier]});
    }
  }
  const extent=config.tier==='hamlet'?52:132, lastZ=quarters.at(-1)!.streetZ;
  const castle:Vec3=[0,13,-46];
  return {config,homes,quarters,castle,beacon:[castle[0],castle[1]+23.5,castle[2]],
    bounds:{minX:-extent-38,maxX:extent+38,minZ:-102,maxZ:lastZ+100},
    lake:{x:42,z:lastZ+63,radiusX:config.tier==='hamlet'?30:62,radiusZ:30,level:-.5}};
}

function smoothstep(a:number,b:number,x:number):number { const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t); }
interface GroundPad { minX:number;maxX:number;minZ:number;maxZ:number;height:number }
interface TerrainPreparation { buckets:Map<string,GroundPad[]>;quarters:TenureQuarter[];seed:number;phase:number }
const PAD_FEATHER=12, PAD_BUCKET=16;
// Layouts are authored snapshots. Growth supplies a new snapshot with the same stable addresses;
// a cache never owns or changes the home/lot data, and is released with its layout.
const terrainPreparations=new WeakMap<KingdomLayout,TerrainPreparation>();
function prepareTerrain(layout:KingdomLayout):TerrainPreparation {
  const cached=terrainPreparations.get(layout);if(cached)return cached;
  const buckets=new Map<string,GroundPad[]>(),quarters=[...layout.quarters].sort((a,b)=>a.streetZ-b.streetZ);
  const pads:GroundPad[]=layout.homes.map(home=>{
    const north=home.rotation===0,front=north?home.lot.maxZ:home.lot.minZ;
    return {minX:home.lot.minX,maxX:home.lot.maxX,minZ:north?front-home.allowedDepth:front,
      maxZ:north?front:front+home.allowedDepth,height:home.position[1]};
  });
  const roadEnd=layout.config.tier==='hamlet'?44:124;
  // Paving and the authored street-edge props share a modest eight-metre-wide corridor.
  for(const quarter of quarters)pads.push({minX:-roadEnd,maxX:roadEnd,minZ:quarter.streetZ-4,maxZ:quarter.streetZ+4,height:quarter.elevation});
  pads.push({minX:layout.castle[0]-17,maxX:layout.castle[0]+17,
    minZ:layout.castle[2]-18,maxZ:layout.castle[2]+20,height:layout.castle[1]});
  for(const pad of pads)for(let z=Math.floor((pad.minZ-PAD_FEATHER)/PAD_BUCKET);z<=Math.floor((pad.maxZ+PAD_FEATHER)/PAD_BUCKET);z++)
    for(let x=Math.floor((pad.minX-PAD_FEATHER)/PAD_BUCKET);x<=Math.floor((pad.maxX+PAD_FEATHER)/PAD_BUCKET);x++){
      const key=`${x},${z}`,bucket=buckets.get(key);if(bucket)bucket.push(pad);else buckets.set(key,[pad]);
    }
  const hash=seedHash(layout.config.seed),prepared={buckets,quarters,seed:hash%1000,phase:(hash%6283)/1000};
  terrainPreparations.set(layout,prepared);return prepared;
}
function settlementGrade(layout:KingdomLayout,quarters:readonly TenureQuarter[],z:number):number {
  const first=quarters[0]!,last=quarters.at(-1)!,gate=layout.castle[2]+20;
  if(z<=gate)return layout.castle[1];
  if(z<first.streetZ-20)return layout.castle[1]+(first.elevation-layout.castle[1])*smoothstep(gate,first.streetZ-20,z);
  if(z<=first.streetZ+4)return first.elevation;
  for(let i=1;i<quarters.length;i++){
    const previous=quarters[i-1]!,next=quarters[i]!;
    if(z<next.streetZ-4)return previous.elevation+(next.elevation-previous.elevation)*smoothstep(previous.streetZ+4,next.streetZ-4,z);
    if(z<=next.streetZ+4)return next.elevation;
  }
  return last.elevation;
}
export function terrainHeight(layout: KingdomLayout | SettlementPlan,x:number,z:number):number {
  if ('version' in layout && layout.version === 2) return settlementTerrainHeight(layout,x,z);
  return legacyTerrainHeight(layout as KingdomLayout,x,z);
}
function legacyTerrainHeight(layout: KingdomLayout,x:number,z:number):number {
  const {buckets,quarters,seed,phase}=prepareTerrain(layout);
  let influence=0,weightedElevation=0;
  for(const pad of buckets.get(`${Math.floor(x/PAD_BUCKET)},${Math.floor(z/PAD_BUCKET)}`)??[]){
    const dx=Math.max(pad.minX-x,0,x-pad.maxX),dz=Math.max(pad.minZ-z,0,z-pad.maxZ);
    if(dx===0&&dz===0)return pad.height;
    const distance=Math.hypot(dx,dz);if(distance>=PAD_FEATHER)continue;
    const weight=1-smoothstep(0,PAD_FEATHER,distance);
    if(weight===1)return pad.height;
    // Normalized odds retain exact footprint contact and blend overlapping rounded skirts.
    const odds=weight/(1-weight);influence+=odds;weightedElevation+=odds*pad.height;
  }
  const grade=settlementGrade(layout,quarters,z),lastStreet=quarters.at(-1)!.streetZ;
  const ridgeWidth=layout.config.tier==='hamlet'?62:150,centre=5*Math.sin(z*.021+phase);
  const beyond=Math.max(0,-z-56)/50+Math.max(0,z-lastStreet-4)/58;
  const ridge=Math.exp(-(((x-centre)/ridgeWidth)**2)-beyond*beyond);
  let h=1.2+Math.max(0,grade-1.2)*ridge+1.1*Math.sin(x*.033+seed)*Math.cos(z*.027)+.5*Math.sin((x+z)*.073);
  const lake=layout.lake,nx=(x-lake.x)/lake.radiusX,nz=(z-lake.z)/lake.radiusZ,angle=Math.atan2(nz,nx);
  const shoreline=1+.12*Math.sin(angle*3+.35)+.055*Math.cos(angle*5-.4)+.035*Math.sin(angle*7+phase);
  // Carve the bays before mandatory pads. The outer fade keeps the complete shoreline inside
  // the bounded water plane, including seeds with a low natural bank beside a wide bay.
  const shore=(1-smoothstep(.76,1.2,Math.hypot(nx,nz)/shoreline))*(1-smoothstep(1.15,1.28,Math.max(Math.abs(nx),Math.abs(nz))));
  h=h*(1-shore)-2.8*shore;
  h=(h+weightedElevation)/(1+influence);
  // A gently graded central road connects the fixed street elevations; it is not a terrace.
  const spine=(1-smoothstep(2.25,6,Math.abs(x-2*Math.sin(z*.03))))
    *smoothstep(layout.castle[2]-26,layout.castle[2]-18,z)*(1-smoothstep(lastStreet+25,lastStreet+37,z));
  return h+(grade-h)*spine;
}

/** Road centre lines are also consumed by future occupancy/navigation; the surface is terrain. */
export function roadDistance(layout:KingdomLayout,x:number,z:number):number {
  let d=Infinity;
  for(const q of layout.quarters) {
    const length=layout.config.tier==='hamlet'?44:124;
    if(Math.abs(x)<length) d=Math.min(d,Math.abs(z-q.streetZ));
  }
  if(z>-30&&z<layout.quarters.at(-1)!.streetZ+25) d=Math.min(d,Math.abs(x-2*Math.sin(z*.03)));
  return d;
}
