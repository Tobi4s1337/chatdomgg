import type { Vec3 } from '@chatdom/shared';
import { currentFootprint, expandBounds, homeFrame, pointBounds, polygonDistance, rectangleDistance,
  segmentProjection, smoothstep, SpatialIndex, transformCardinalPoint } from './geometry';
import type { BoundsXZ, LandformPlan, PublicGroundSample, SettlementPlan, XZ } from './types';

export function naturalTerrainHeight(landform:LandformPlan,x:number,z:number):number {
  const {ridge,castleRise,lake}=landform,phase=(landform.seed%6283)/1000;
  const dx=x-ridge.origin[0],dz=z-ridge.origin[1],c=Math.cos(ridge.bearing),s=Math.sin(ridge.bearing);
  const across=dx*c-dz*s-5*Math.sin(z*.021+phase),along=dx*s+dz*c;
  let h=1.2+ridge.height*Math.exp(-((across/ridge.width)**2)-(along/ridge.length)**2)
    +castleRise.height*Math.exp(-((x-castleRise.centre[0])**2+(z-castleRise.centre[1])**2)/castleRise.radius**2)
    +.85*Math.sin(x*.033+landform.seed%1000)*Math.cos(z*.027)+.35*Math.sin((x+z)*.073);
  const nx=(x-lake.x)/lake.radiusX,nz=(z-lake.z)/lake.radiusZ,angle=Math.atan2(nz,nx);
  const shoreline=1+.12*Math.sin(angle*3+.35)+.055*Math.cos(angle*5-.4)+.035*Math.sin(angle*7+phase);
  const shore=(1-smoothstep(.76,1.2,Math.hypot(nx,nz)/shoreline))*(1-smoothstep(1.15,1.28,Math.max(Math.abs(nx),Math.abs(nz))));
  h=h*(1-shore)-2.8*shore;
  return h;
}

interface Influence {
  id:string;kind:PublicGroundSample['kind']|'foundation';bounds:BoundsXZ;
  rectangle?:BoundsXZ;polygon?:readonly XZ[];segment?:readonly [Vec3,Vec3];
  height:number;width:number;verge:number;paved:boolean;
}
interface Prepared {
  ground:SpatialIndex<Influence>;foundations:SpatialIndex<Influence>;
  cornerOrigin:XZ;cornerWidth:number;cornerDepth:number;cornerRows:Int32Array;corners:Float32Array;
}
const FEATHER=20;
const CACHED_CORNER_ROWS=8;
const preparedPlans=new WeakMap<SettlementPlan,Prepared>();
function prepare(plan:SettlementPlan):Prepared {
  const cached=preparedPlans.get(plan);if(cached)return cached;
  const ground=new SpatialIndex<Influence>(),foundations=new SpatialIndex<Influence>();
  const rectangle=(id:string,bounds:BoundsXZ,height:number,kind:Influence['kind'],paved:boolean)=>{
    if(kind==='foundation')bounds=expandBounds(bounds,.75);
    const influence:Influence={id,kind,bounds,rectangle:bounds,height,width:0,verge:0,paved};
    ground.add(expandBounds(bounds,FEATHER),influence);
    if(kind==='foundation')foundations.add(bounds,influence);
  };
  for(const home of plan.homes){
    rectangle(home.id,currentFootprint(home),home.position[1],'foundation',false);
    const {front,right,outward}=homeFrame(home),corners:XZ[]=[];
    for(const side of [-4,4])for(const depth of [0,3])corners.push([front[0]+right[0]*side+outward[0]*depth,front[2]+right[2]*side+outward[2]*depth]);
    rectangle(`${home.id}:apron`,pointBounds(corners),home.position[1],'forecourt',false);
  }
  const activeCourts=new Set(plan.homes.map(home=>home.courtId));
  for(const square of [plan.market,plan.castle.court,...plan.courts.filter(court=>activeCourts.has(court.id))]){
    const bounds=pointBounds(square.boundary),influence:Influence={id:square.id,kind:square===plan.market?'market':'court',
      bounds,polygon:square.boundary,height:square.elevation,width:0,verge:0,paved:true};
    ground.add(expandBounds(bounds,FEATHER),influence);
  }
  for(const module of plan.castle.modules){
    const corners:XZ[]=[];
    for(const x of [0,module.size[0]])for(const z of [0,module.size[2]]){
      const p=transformCardinalPoint(module.position,module.rotation,[x,0,z]);corners.push([p[0],p[2]]);
    }
    rectangle(module.id,pointBounds(corners),module.position[1],'foundation',false);
  }
  const active=new Set(plan.activeStreetIds);
  for(const street of plan.streets){
    if(!active.has(street.id))continue;
    for(let i=1;i<street.points.length;i++){
      const a=street.points[i-1]!,b=street.points[i]!;
      const bounds=expandBounds(pointBounds([[a[0],a[2]],[b[0],b[2]]]),street.width/2+street.verge);
      const influence:Influence={id:street.id,kind:street.kind,bounds,segment:[a,b],height:a[1],width:street.width,verge:street.verge,paved:true};
      ground.add(expandBounds(bounds,FEATHER),influence);
    }
  }
  // Include the chunk-aligned detailed surface and its occupancy halo. The same
  // metre corners define rendering, collision and light-field ground contact.
  const cornerOrigin:XZ=[Math.floor(plan.bounds.minX/16)*16-1,Math.floor(plan.bounds.minZ/16)*16-1];
  const cornerWidth=Math.ceil(plan.bounds.maxX/16)*16-cornerOrigin[0]+2;
  const cornerDepth=Math.ceil(plan.bounds.maxZ/16)*16-cornerOrigin[1]+2;
  // Eight rows cover sequential voxel/light scans without retaining another full
  // terrain field in every worker (the current town cache is under16KiB).
  const cornerRows=new Int32Array(CACHED_CORNER_ROWS).fill(-1);
  const corners=new Float32Array(cornerWidth*CACHED_CORNER_ROWS).fill(NaN);
  const value={ground,foundations,cornerOrigin,cornerWidth,cornerDepth,cornerRows,corners};preparedPlans.set(plan,value);return value;
}
function sample(influence:Influence,x:number,z:number):{distance:number;height:number} {
  if(influence.segment){
    const [a,b]=influence.segment,p=segmentProjection([a[0],a[2]],[b[0],b[2]],x,z);
    return {distance:p.distance-influence.width/2,height:a[1]+(b[1]-a[1])*p.t};
  }
  return {distance:influence.rectangle?rectangleDistance(influence.rectangle,x,z):polygonDistance(influence.polygon!,x,z),height:influence.height};
}

/** Signed distances to installed public footprints, not an invented global road radius. */
export function samplePublicGround(plan:SettlementPlan,x:number,z:number):PublicGroundSample|undefined {
  let chosen:Influence|undefined,height=0,pavingDistance=Infinity,reservedDistance=Infinity;
  for(const influence of prepare(plan).ground.at(x,z)){
    if(influence.kind==='foundation')continue;
    const value=sample(influence,x,z),reserved=value.distance-influence.verge;
    if(reserved<reservedDistance){chosen=influence;height=value.height;reservedDistance=reserved;}
    if(influence.paved)pavingDistance=Math.min(pavingDistance,value.distance);
  }
  if(!chosen||reservedDistance>=FEATHER)return undefined;
  return {id:chosen.id,kind:chosen.kind as PublicGroundSample['kind'],height,pavingDistance,reservedDistance};
}

/** Authored grading at the corners of the conforming metre surface. */
function gradedHeight(plan:SettlementPlan,prepared:Prepared,x:number,z:number):number {
  const {ground,foundations}=prepared;
  for(const influence of foundations.at(x,z))if(rectangleDistance(influence.rectangle!,x,z)<=0)return influence.height;
  // The square is a single level civic floor. Roads approaching it must not
  // average a dip under the well or the stall feet inside that floor.
  for(const influence of ground.at(x,z))if(influence.kind==='market'&&polygonDistance(influence.polygon!,x,z)<=0)return influence.height;
  // One nearest sample per road avoids giving densely sampled bends extra grading influence.
  const closest=new Map<string,{distance:number;height:number;weight:number}>();
  for(const influence of ground.at(x,z)){
    const value=sample(influence,x,z);value.distance-=influence.verge;
    if(value.distance>=FEATHER)continue;
    const weight=(1-smoothstep(0,FEATHER,Math.max(0,value.distance)))**2 / (Math.max(.01,value.distance) ** 2),previous=closest.get(influence.id);
    if(weight===0)continue;
    if(previous){previous.height+=value.height*weight;previous.weight+=weight;previous.distance=Math.min(previous.distance,value.distance);}
    else closest.set(influence.id,{distance:value.distance,height:value.height*weight,weight});
  }
  for(const value of closest.values())value.height/=value.weight;
  let weighted=0,weights=0,coreHeight=0,coreCount=0;
  for(const value of closest.values()){
    if(value.distance<=0){coreHeight+=value.height;coreCount++;continue;}
    if(value.distance>=FEATHER)continue;
    const w=1-smoothstep(0,FEATHER,value.distance),odds=w/(1-w);
    weighted+=odds*value.height;weights+=odds;
  }
  if(coreCount)return coreHeight/coreCount;
  return (naturalTerrainHeight(plan.landform,x,z)+weighted)/(1+weights);
}

/**
 * One ground surface for display and authoritative half-metre occupancy. Evaluating
 * the nonlinear grade again at voxel centres made collision and light sample a
 * different surface from the displayed triangles, particularly at pad corners.
 * Metre vertices retain the authored grade; all consumers interpolate its exact
 * 00→11 triangles, with the same Float32 corner values uploaded by the renderer.
 */
export function settlementTerrainHeight(plan:SettlementPlan,x:number,z:number):number {
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('Terrain needs finite coordinates');
  const prepared=prepare(plan),left=Math.floor(x),back=Math.floor(z),u=x-left,v=z-back;
  const corner=(px:number,pz:number):number=>{
    const cx=px-prepared.cornerOrigin[0],cz=pz-prepared.cornerOrigin[1];
    if(cx<0||cz<0||cx>=prepared.cornerWidth||cz>=prepared.cornerDepth)
      return Math.fround(gradedHeight(plan,prepared,px,pz));
    const row=cz%CACHED_CORNER_ROWS,offset=row*prepared.cornerWidth;
    if(prepared.cornerRows[row]!==cz){
      prepared.cornerRows[row]=cz;prepared.corners.fill(NaN,offset,offset+prepared.cornerWidth);
    }
    const index=cx+offset,value=prepared.corners[index]!;
    if(Number.isFinite(value))return value;
    const height=Math.fround(gradedHeight(plan,prepared,px,pz));prepared.corners[index]=height;return height;
  };
  const a=corner(left,back);
  if(u===0&&v===0)return a;
  const c=corner(left+1,back+1);
  return u<=v ? a+u*(c-corner(left,back+1))+v*(corner(left,back+1)-a)
    : a+u*(corner(left+1,back)-a)+v*(c-corner(left+1,back));
}

/** Additional typed-array workspace retained by this plan's shared ground sampler. */
export function settlementTerrainWorkspaceBytes(plan:SettlementPlan):number {
  const {cornerRows,corners}=prepare(plan);
  return cornerRows.byteLength+corners.byteLength;
}
