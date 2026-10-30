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
export function terrainHeight(layout: KingdomLayout,x:number,z:number):number {
  const seed=seedHash(layout.config.seed)%1000;
  const castleHill=12*Math.exp(-(x*x/2500+(z+46)*(z+46)/2800));
  const base=1.2+castleHill+1.1*Math.sin(x*.033+seed)*Math.cos(z*.027)+.5*Math.sin((x+z)*.073);
  let h=base;
  // Smooth foundations are authored terrain, not floating houses or stepped dirt plinths.
  for(const quarter of layout.quarters) {
    const width=layout.config.tier==='hamlet'?44:124;
    const weight=(1-smoothstep(width,width+15,Math.abs(x)))*(1-smoothstep(20,26,Math.abs(z-quarter.streetZ)));
    h=h*(1-weight)+quarter.elevation*weight;
  }
  const castleWeight=(1-smoothstep(19,30,Math.abs(x)))*(1-smoothstep(20,30,Math.abs(z+46)));
  h=h*(1-castleWeight)+13*castleWeight;
  const lake=layout.lake,d=Math.sqrt(((x-lake.x)/lake.radiusX)**2+((z-lake.z)/lake.radiusZ)**2);
  const shore=1-smoothstep(.83,1.25,d); h=h*(1-shore)-2.8*shore;
  return h;
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
