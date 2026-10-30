import {HOME_DEPTH_METRES,type HomeTier,type Vec3} from '@chatdom/shared';
import {randomUnit,seedHash,type KingdomConfig} from '../layout';
import {boundsOverlap,currentFootprint,expandBounds,homeFrame,pointBounds,rectangleDistance,
  roundPolyline,segmentProjection,SpatialIndex} from './geometry';
import {createCastlePlan} from './castle';
import {frontagePath,gradeRoute} from './routing';
import type {BoundsXZ,CardinalTurn,LandformPlan,PlotReservation,PublicSquare,
  SettlementHome,SettlementPlan,SettlementQuarter,StreetEdge,StreetNode,XZ} from './types';

interface RoadPoint {a:XZ;b:XZ;radius:number}
interface GrowthExit {id:string;from:XZ;to:XZ}
interface Frontage {plot:PlotReservation;front:Vec3;join:Vec3;index:number}
const names=['Hearthward','Bellflower','Copperleaf','Willowbend','Meadowgate'];
function facing(dx:number,dz:number):CardinalTurn {return Math.abs(dx)>Math.abs(dz)?dx>0?1:3:dz>0?0:2;}
function apron(plot:PlotReservation):BoundsXZ {
  const {front,right,outward}=homeFrame(plot),corners:XZ[]=[];
  for(const side of [-4,4])for(const d of [0,3])corners.push([front[0]+side*right[0]+d*outward[0],front[2]+side*right[2]+d*outward[2]]);
  return pointBounds(corners);
}

/** Roads and their full future frontage reservations are planned before preview activation. */
export function generateSettlementPlan(config:KingdomConfig):SettlementPlan {
  if(!Number.isInteger(config.firstYear)||!Number.isInteger(config.year)||config.year<config.firstYear)
    throw new Error('Invalid founding years');
  if(config.tier!=='hamlet'&&config.tier!=='town')throw new Error('Invalid settlement tier');
  const seed=seedHash(config.seed),phase=(seed%6283)/1000;
  const landform:LandformPlan={version:1,seed,ridge:{origin:[0,70],bearing:.03*Math.sin(phase),length:230,width:145,height:7},
    castleRise:{centre:[25,-75],radius:78,height:14},lake:{x:200,z:225,radiusX:34,radiusZ:29,level:-.5}};
  const castle=createCastlePlan(),market:PublicSquare={id:'market',boundary:[[-15,-2],[15,-2],[15,22],[-15,22]],elevation:9,nodeId:'market'};
  const nodes:StreetNode[]=[{id:'market',kind:'market',position:[0,9,10]},{id:castle.gateNodeId,kind:'castle-gate',position:[0,20,-36]}];
  const streets:StreetEdge[]=[],courts:PublicSquare[]=[],quarters:SettlementQuarter[]=[],reservations:PlotReservation[]=[],homes:SettlementHome[]=[];
  const installed=new Set<string>(),lotIndex=new SpatialIndex<PlotReservation>();
  const roadIndex=new SpatialIndex<RoadPoint>(),growthExits:GrowthExit[]=[],parentEdges=new Map<string,StreetEdge>();
  const wet=(x:number,z:number,margin:number)=>Math.hypot((x-landform.lake.x)/(landform.lake.radiusX*1.35+margin),(z-landform.lake.z)/(landform.lake.radiusZ*1.35+margin))<1;
  const indexRoad=(points:readonly Vec3[],radius:number)=>{
    for(let i=1;i<points.length;i++){
      const a:XZ=[points[i-1]![0],points[i-1]![2]],b:XZ=[points[i]![0],points[i]![2]],value={a,b,radius};
      roadIndex.add(expandBounds(pointBounds([a,b]),9),value);
    }
  };
  const separation=(a:BoundsXZ,b:BoundsXZ)=>Math.hypot(Math.max(a.minX-b.maxX,0,b.minX-a.maxX),Math.max(a.minZ-b.maxZ,0,b.minZ-a.maxZ));
  const roadRectangleDistance=(road:RoadPoint,box:BoundsXZ):number=>{
    const [a,b]=[road.a,road.b];let low=0,high=1;
    for(const [start,end,min,max] of [[a[0],b[0],box.minX,box.maxX],[a[1],b[1],box.minZ,box.maxZ]]){
      const delta=end!-start!;
      if(!delta){if(start!<min!||start!>max!){low=2;break;}continue;}
      const t0=(min!-start!)/delta,t1=(max!-start!)/delta;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));
    }
    if(low<=high)return 0;
    let value=Math.min(Math.max(0,rectangleDistance(box,...a)),Math.max(0,rectangleDistance(box,...b)));
    for(const x of [box.minX,box.maxX])for(const z of [box.minZ,box.maxZ])value=Math.min(value,segmentProjection(a,b,x,z).distance);
    return value;
  };
  const castlePath=roundPolyline([[0,-36],[40,-28],[55,-65],[105,-65],[130,-35],[130,-8],[85,0],[0,0],[0,10]],()=>true);
  let crownDistance=0;
  const castleGrade=castlePath.map((p,i)=>{
    if(i)crownDistance+=Math.hypot(p[0]-castlePath[i-1]![0],p[1]-castlePath[i-1]![1]);
    const t=Math.max(0,Math.min(1,(crownDistance-45)/130));
    return [p[0],20-11*t*t*(3-2*t),p[1]] as const;
  });
  streets.push({id:'road:castle',from:'castle:gate',to:'market',kind:'main',name:'Crown Road',points:castleGrade,width:6,verge:1});
  indexRoad(castleGrade,6);installed.add('road:castle');
  const spineNodes:StreetNode[]=[];
  const activate=(nodeId:string)=>{let at=nodeId;while(parentEdges.has(at)){const edge=parentEdges.get(at)!;installed.add(edge.id);at=edge.from;}};
  const validPlot=(plot:PlotReservation,pending:readonly Frontage[],route:readonly Vec3[],radius:number,ends:readonly StreetNode[],exit:GrowthExit|undefined):boolean=>{
    const box=plot.lot,fore=apron(plot);
    const reach=Math.max(0,plot.quarterYear-config.firstYear-4);
    if(box.minX < -174-reach*24 || box.maxX > 174+reach*24 || box.minZ < -32 || box.maxZ > 280+reach*52)return false;
    if(boundsOverlap(box,expandBounds(castle.bounds,4))||boundsOverlap(box,expandBounds(pointBounds(market.boundary),2))
      ||boundsOverlap(box,{minX:-18,maxX:18,minZ:-36,maxZ:6}))return false;
    for(const other of lotIndex.within(expandBounds(box,8)))
      if(separation(box,other.lot)<1||boundsOverlap(fore,other.lot,1)||boundsOverlap(box,apron(other),1))return false;
    for(const other of pending)if(separation(box,other.plot.lot)<1||boundsOverlap(fore,other.plot.lot,1)||boundsOverlap(box,apron(other.plot),1))return false;
    for(const node of [...ends,...spineNodes])if(rectangleDistance(box,node.position[0],node.position[2])<8||rectangleDistance(fore,node.position[0],node.position[2])<6)return false;
    for(const x of [box.minX,(box.minX+box.maxX)/2,box.maxX])for(const z of [box.minZ,(box.minZ+box.maxZ)/2,box.maxZ])if(wet(x,z,2))return false;
    for(const road of roadIndex.within(expandBounds(box,8)))
      if(roadRectangleDistance(road,box)<road.radius+.125||roadRectangleDistance(road,fore)<road.radius+.125)return false;
    for(const corridor of exit?[...growthExits,exit]:growthExits){
      const count=Math.ceil(Math.hypot(corridor.to[0]-corridor.from[0],corridor.to[1]-corridor.from[1]));
      for(let i=0;i<=count;i++){
        const x=corridor.from[0]+(corridor.to[0]-corridor.from[0])*i/count,z=corridor.from[1]+(corridor.to[1]-corridor.from[1])*i/count;
        if(rectangleDistance(box,x,z)<4||rectangleDistance(fore,x,z)<4)return false;
      }
    }
    for(const p of route)if(rectangleDistance(box,p[0],p[2])<radius+.5||rectangleDistance(fore,p[0],p[2])<radius+.5)return false;
    return true;
  };
  const fitFrontages=(year:number,ordinal:number,routeId:string,courtId:string,points:readonly Vec3[],radius:number,ends:readonly StreetNode[],exit?:GrowthExit):Frontage[]=>{
    const chosen:Frontage[]=[],name=names[(year-config.firstYear)%names.length]!;
    let lastSample=-10,distance=0;
    for(let i=1;i<points.length-1&&ordinal+chosen.length<48;i++){
      distance+=Math.hypot(points[i]![0]-points[i-1]![0],points[i]![2]-points[i-1]![2]);
      if(distance-lastSample<.75)continue;lastSample=distance;
      const p=points[i]!,a=points[Math.max(0,i-4)]!,b=points[Math.min(points.length-1,i+4)]!;
      const dx=b[0]-a[0],dz=b[2]-a[2];if(Math.hypot(dx,dz)<1e-6)continue;
      for(const side of [-1,1])for(const extra of [0,1,2]){
        if(ordinal+chosen.length>=48)break;
        const rotation=facing(dz*side,-dx*side),dummy={position:[0,0,0] as Vec3,rotation},outward=homeFrame(dummy).outward;
        // A cardinal eight-metre frontage meets an oblique street at a corner. Account for
        // that corner and the full prop apron; a fixed radial offset rejects diagonal streets.
        const alignment=Math.abs((-dz*outward[0]+dx*outward[2])/Math.hypot(dx,dz));
        const offset=(radius+.25+3*alignment+4*Math.sqrt(Math.max(0,1-alignment*alignment)))/alignment+extra;
        const front:Vec3=[Math.round(p[0]-outward[0]*offset),Math.round(p[1]*8)/8,Math.round(p[2]-outward[2]*offset)];
        const centre:Vec3=[front[0]-outward[0]*8,front[1],front[2]-outward[2]*8];
        const n=ordinal+chosen.length,id=`plot:${year}:${n}`;
        const lot={...currentFootprint({position:centre,rotation,allowedDepth:16}),height:20 as const,depth:16 as const,frontage:8 as const};
        const plot:PlotReservation={id,quarterYear:year,ordinal:n,street:`${name} Lane`,streetId:routeId,courtId,
          approachId:`${id}:approach`,position:centre,rotation,lot};
        if(!validPlot(plot,chosen,points,radius,ends,exit))continue;
        // The whole 1.5 m entrance ribbon must reach its actual road node without another lot.
        const actualJoin=points[i%2===0?i:i+1]!,approach=frontagePath(front,outward,actualJoin);let clear=true;
        for(let k=1;k<approach.length&&clear;k++){
          const a=approach[k-1]!,b=approach[k]!,ribbon={a,b,radius:1};
          for(const other of lotIndex.within(expandBounds(pointBounds([a,b]),1)))if(roadRectangleDistance(ribbon,other.lot)<1)clear=false;
          for(const other of chosen)if(roadRectangleDistance(ribbon,other.plot.lot)<1)clear=false;
        }
        if(!clear)continue;
        chosen.push({plot,front,join:points[i%2===0?i:i+1]!,index:i%2===0?i:i+1});break;
      }
    }
    return chosen;
  };
  interface PlannedRoute {id:string;from:StreetNode;to:StreetNode;points:Vec3[];year:number;width:number;joins:Map<number,string>}
  const planned:PlannedRoute[]=[];
  const append=(id:string,from:StreetNode,to:StreetNode,path:XZ[],width=4)=>{
    const points=gradeRoute(path,from.position[1],to.position[1],0,.12);
    if(!points)throw new Error(`Road grade ${id}`);
    planned.push({id,from,to,points,year:config.firstYear,width,joins:new Map()});indexRoad(points,width/2+1);
  };
  // Contour crescents and unequal radial lanes gather around the market. The fixed
  // founding graph is independent of population and year; later land extends outside it.
  const angles=[-Math.PI/2,-1.02,-.39,.24,.88,Math.PI/2];
  const rings:StreetNode[][]=[];
  const ringCount=Math.max(4,Math.ceil((config.year-config.firstYear+1)/2));
  const at=(r:number,t:number):XZ=>{
    const sx=Math.sin(t),cz=Math.max(0,Math.cos(t)),bend=2*Math.sin(t*3+phase+r*.7);
    return [(13+r*46)*Math.sign(sx)*Math.sqrt(Math.abs(sx))+bend,10+(38+r*72)*Math.sqrt(cz)];
  };
  for(let r=0;r<ringCount;r++){
    const row=angles.map((angle,i)=>{
      const [x,z]=at(r,angle),height=9-z*.014-Math.abs(x)*.006;
      const node:StreetNode={id:`contour:${r}:${i}`,kind:'junction',position:[x,height,z]};nodes.push(node);spineNodes.push(node);return node;
    });rings.push(row);
    for(let i=1;i<row.length;i++){
      const a=angles[i-1]!,b=angles[i]!,steps=Math.ceil((80+r*100)*(b-a)),path:XZ[]=[];
      for(let j=0;j<=steps;j++)path.push(at(r,a+(b-a)*j/steps));
      append(`contour:${r}:${i}`,row[i-1]!,row[i]!,path);
    }
    for(let i=0;i<row.length;i++){
      const from=r?rings[r-1]![i]!:nodes[0]!,to=row[i]!,path:XZ[]=[];
      const length=Math.hypot(to.position[0]-from.position[0],to.position[2]-from.position[2]),steps=Math.ceil(length);
      for(let k=0;k<=steps;k++){
        const t=k/steps,bend=r?Math.sin(Math.PI*t)*3*Math.sin(i*2.1+r+phase):0;
        path.push([from.position[0]+(to.position[0]-from.position[0])*t+bend*Math.cos(angles[i]!),from.position[2]+(to.position[2]-from.position[2])*t-bend*Math.sin(angles[i]!)]);
      }
      append(`radial:${r}:${i}`,from,to,path,i===2||i===4?6:4);
    }
  }
  const west:StreetNode={id:'old-wall:end',kind:'frontier',position:[-40,9,-9]};nodes.push(west);
  const westStart=rings[3]![0]!;
  append('old-wall',westStart,west,roundPolyline([[westStart.position[0],westStart.position[2]],[-160,-9],[-40,-9]],()=>true));
  for(let q=0;q<=config.year-config.firstYear;q++){
    const node=rings[Math.min(rings.length-1,Math.floor(q/2))]![q%2?4:1]!,[x,y,z]=node.position;
    courts.push({id:`green:${config.firstYear+q}`,nodeId:node.id,elevation:y,boundary:[[x-3,z-3],[x+3,z-3],[x+3,z+3],[x-3,z+3]]});
  }
  // Public joins are sampled before homes. Later activation never splits or refits a road.
  for(const route of planned){
    let from=route.from.id,begin=0,part=0;
    for(let i=2;i<route.points.length+2;i+=2){
      const at=Math.min(i,route.points.length-1),last=at===route.points.length-1,to=last?route.to.id:route.joins.get(at)??`${route.id}:join:${at}`;
      if(!last&&!nodes.some(node=>node.id===to))nodes.push({id:to,kind:'junction',position:route.points[at]!});
      route.joins.set(at,to);
      streets.push({id:`${route.id}:${part++}`,from,to,kind:route.id.startsWith('civic:')?'main':'lane',name:route.id.startsWith('civic:')?'Market Way':`${names[(route.year-config.firstYear)%names.length]} Lane`,points:route.points.slice(begin,at+1),width:route.width,verge:1,quarterYear:route.year});
      from=to;begin=at;if(last)break;
    }
  }
  for(let year=config.firstYear;year<=config.year;year++){
    const q=year-config.firstYear,name=names[q%names.length]!,courtId=`green:${year}`,side=q%2===0?-1:1;
    const targetZ=25+Math.floor(q/2)*75;
    const routes=[...planned].sort((a,b)=>{
      const score=(r:PlannedRoute)=>Math.min(...r.points.map(p=>Math.hypot(p[0]-side*50,p[2]-targetZ)));
      return score(a)-score(b)||a.id.localeCompare(b.id);
    });
    let ordinal=0;
    for(const route of routes){
      const frontage=fitFrontages(year,ordinal,route.id,courtId,route.points,route.width/2+1,[route.from,route.to]);
      for(const item of frontage){
        const joinIndex=item.index%2===0?item.index:item.index+1,join=route.points[joinIndex]!,joinId=route.joins.get(joinIndex)!;
        const plot={...item.plot,streetId:streets.find(edge=>edge.to===joinId)!.id},frontId=`${plot.id}:front`;
        reservations.push(plot);lotIndex.add(expandBounds(plot.lot,8),plot);nodes.push({id:frontId,kind:'frontage',position:item.front});
        const path=frontagePath(item.front,homeFrame(plot).outward,join),length=path.reduce((n,p,i)=>i?n+Math.hypot(p[0]-path[i-1]![0],p[1]-path[i-1]![1]):0,0);let distance=0;
        const points=path.map((p,i)=>{if(i)distance+=Math.hypot(p[0]-path[i-1]![0],p[1]-path[i-1]![1]);const t=Math.max(0,(distance-3)/(length-3));return [p[0],item.front[1]+(join[1]-item.front[1])*t,p[1]] as const;});
        streets.push({id:plot.approachId,from:frontId,to:joinId,kind:'approach',name:plot.street,points,width:2,verge:0,quarterYear:year});
        if(plot.ordinal<(config.tier==='hamlet'?12:48)){
          const hash=seedHash(config.seed+plot.id),r=randomUnit(hash),tier:HomeTier=q===0&&plot.ordinal%7===0?'manor':r>.78?'house':r>.2?'cottage':'hut';
          homes.push({...plot,slot:q*1024+plot.ordinal,tier,allowedDepth:HOME_DEPTH_METRES[tier],style:(['hearth','tide','grove'] as const)[hash%3]!,variant:Math.floor(r*3)});
          installed.add(plot.approachId);
        }
      }
      ordinal+=frontage.length;
    }
    if(ordinal!==48)throw new Error(`Quarter ${year} has only ${ordinal}/48 clear canonical frontages`);
    quarters.push({year,name,rootNodeId:courts[q]!.nodeId,courtIds:[courtId],growthNodeIds:rings.at(-1)!.map(n=>n.id)});
  }
  // An oblique frontage can encounter a nearer public lane before its proposal
  // route. Join that lane at a real existing node, preserving the complete lot.
  const publicEdges=streets.filter(edge=>edge.kind!=='approach');
  const nodeMap=new Map(nodes.map(node=>[node.id,node]));
  type PublicSegment={a:Vec3;b:Vec3;edge:StreetEdge};
  const publicSegments=new SpatialIndex<PublicSegment>();
  for(const edge of publicEdges)for(let i=1;i<edge.points.length;i++){
    const a=edge.points[i-1]!,b=edge.points[i]!;
    publicSegments.add(pointBounds([[a[0],a[2]],[b[0],b[2]]]),{a,b,edge});
  }
  const crosses=(points:readonly Vec3[],joinId:string):boolean=>{
    const join=nodeMap.get(joinId)!.position;
    for(let i=1;i<points.length;i++){
      const a=points[i-1]!,b=points[i]!,rx=b[0]-a[0],rz=b[2]-a[2];
      for(const {a:c,b:d,edge} of publicSegments.within(pointBounds([[a[0],a[2]],[b[0],b[2]]]))){
        const sx=d[0]-c[0],sz=d[2]-c[2],den=rx*sz-rz*sx,cx=c[0]-a[0],cz=c[2]-a[2];
        if(Math.abs(den)<1e-9){
          const length=rx*rx+rz*rz;
          if(length<1e-12||Math.abs(cx*rz-cz*rx)>1e-8)continue;
          const t0=(cx*rx+cz*rz)/length,t1=((d[0]-a[0])*rx+(d[2]-a[2])*rz)/length;
          if(Math.min(1,Math.max(t0,t1))-Math.max(0,Math.min(t0,t1))>1e-7)return true;
          continue;
        }
        const t=(cx*sz-cz*sx)/den,u=(cx*rz-cz*rx)/den;
        if(t< -1e-8||t>1+1e-8||u< -1e-8||u>1+1e-8)continue;
        if(Math.hypot(a[0]+t*rx-join[0],a[2]+t*rz-join[2])<1e-6&&(edge.from===joinId||edge.to===joinId))continue;
        return true;
      }
    }
    return false;
  };
  for(const approach of streets.filter(edge=>edge.kind==='approach')){
    if(!crosses(approach.points,approach.to))continue;
    const plot=reservations.find(plot=>plot.approachId===approach.id)!;
    const {front,outward}=homeFrame(plot);
    const candidates=nodes.filter(node=>{
      if(node.kind==='frontage')return false;
      const dx=node.position[0]-front[0],dz=node.position[2]-front[2],forward=dx*outward[0]+dz*outward[2];
      return forward>3&&Math.abs(dx*outward[2]-dz*outward[0])<=forward&&Math.hypot(dx,dz)<25;
    }).sort((a,b)=>Math.hypot(a.position[0]-front[0],a.position[2]-front[2])-Math.hypot(b.position[0]-front[0],b.position[2]-front[2])||a.id.localeCompare(b.id));
    let joined=false;
    for(const candidate of candidates){
      const path=frontagePath(front,outward,candidate.position);
      const length=path.reduce((n,p,i)=>i?n+Math.hypot(p[0]-path[i-1]![0],p[1]-path[i-1]![1]):0,0);
      if(Math.abs(candidate.position[1]-front[1])>(length-3)*.12)continue;
      let distance=0;
      const points=path.map((p,i)=>{
        if(i)distance+=Math.hypot(p[0]-path[i-1]![0],p[1]-path[i-1]![1]);
        return [p[0],front[1]+(candidate.position[1]-front[1])*Math.max(0,(distance-3)/(length-3)),p[1]] as const;
      });
      if(crosses(points,candidate.id))continue;
      let clear=true;
      for(let i=1;i<path.length&&clear;i++){
        const a=path[i-1]!,b=path[i]!;
        for(const other of lotIndex.within(expandBounds(pointBounds([a,b]),1)))
          if(other.id!==plot.id&&roadRectangleDistance({a,b,radius:1},other.lot)<1)clear=false;
      }
      if(!clear)continue;
      const streetId=publicEdges.find(edge=>edge.from===candidate.id||edge.to===candidate.id)!.id;
      approach.to=candidate.id;approach.points=points;plot.streetId=streetId;
      const home=homes.find(home=>home.id===plot.id);if(home)home.streetId=streetId;
      joined=true;break;
    }
    if(!joined)throw new Error(`No clear public junction for ${plot.id}`);
  }
  // Keep curve samples, but collapse graph-only degree-two subdivisions. The
  // canonical frontage joins remain nodes; vacant samples need no repeated IDs.
  const protectedNodes=new Set([market.nodeId,castle.gateNodeId,...spineNodes.map(node=>node.id),
    ...courts.map(court=>court.nodeId),...streets.filter(edge=>edge.kind==='approach').flatMap(edge=>[edge.from,edge.to])]);
  const incident=new Map<string,StreetEdge[]>();
  for(const edge of publicEdges)for(const id of [edge.from,edge.to]){
    const list=incident.get(id)??[];list.push(edge);incident.set(id,list);
  }
  const merged=new Set<string>(),replacement=new Map<string,string>(),compact:StreetEdge[]=[];
  for(const edge of publicEdges){
    if(merged.has(edge.id))continue;
    const chain:StreetEdge={...edge,points:[...edge.points]};merged.add(edge.id);replacement.set(edge.id,chain.id);
    while(!protectedNodes.has(chain.to)&&incident.get(chain.to)?.length===2){
      const next=incident.get(chain.to)!.find(item=>!merged.has(item.id));
      if(!next||next.from!==chain.to||next.kind!==chain.kind||next.width!==chain.width||next.verge!==chain.verge)break;
      chain.points=[...chain.points,...next.points.slice(1)];chain.to=next.to;merged.add(next.id);replacement.set(next.id,chain.id);
    }
    compact.push(chain);
  }
  streets.splice(0,streets.length,...compact,...streets.filter(edge=>edge.kind==='approach'));
  for(const plot of [...reservations,...homes])plot.streetId=replacement.get(plot.streetId)??plot.streetId;
  const usedNodes=new Set(streets.flatMap(edge=>[edge.from,edge.to]));
  for(let i=nodes.length-1;i>=0;i--)if(!usedNodes.has(nodes[i]!.id)&&!protectedNodes.has(nodes[i]!.id))nodes.splice(i,1);
  const adjacency=new Map<string,{edge:StreetEdge;other:string}[]>();
  for(const edge of streets)if(edge.kind!=='approach')for(const [at,other] of [[edge.from,edge.to],[edge.to,edge.from]]){
    const next={edge,other:other!},list=adjacency.get(at!);if(list)list.push(next);else adjacency.set(at!,[next]);
  }
  const visited=new Set(['market']),queue=['market'];
  for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i]!)??[])if(!visited.has(next.other)){
    visited.add(next.other);queue.push(next.other);parentEdges.set(next.other,{...next.edge,from:queue[i]!,to:next.other});
  }
  for(const home of homes){const edge=streets.find(edge=>edge.id===home.approachId)!;activate(edge.to);}
  const activePoints:XZ[]=[];
  for(const home of homes)activePoints.push([home.lot.minX,home.lot.minZ],[home.lot.maxX,home.lot.maxZ]);
  for(const edge of streets)if(installed.has(edge.id))for(const p of edge.points)activePoints.push([p[0],p[2]]);
  activePoints.push([castle.bounds.minX,castle.bounds.minZ],[castle.bounds.maxX,castle.bounds.maxZ],
    [landform.lake.x-landform.lake.radiusX*1.3,landform.lake.z-landform.lake.radiusZ*1.3],
    [landform.lake.x+landform.lake.radiusX*1.3,landform.lake.z+landform.lake.radiusZ*1.3]);
  const bounds=expandBounds(pointBounds(activePoints),16);
  const body={version:2 as const,config:{...config},landform,homes,reservations,quarters,nodes,streets,
    activeStreetIds:[...installed].sort(),market,courts,castle,bounds,lake:landform.lake};
  return {...body,revision:`settlement:2:${seedHash(JSON.stringify(body)).toString(16)}`};
}
