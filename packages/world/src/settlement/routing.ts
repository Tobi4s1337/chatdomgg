import type {Vec3} from '@chatdom/shared';
import {roundPolyline} from './geometry';
import type {XZ} from './types';

class MinHeap {
  values:{key:number;score:number}[]=[];
  push(key:number,score:number):void {
    const item={key,score};let i=this.values.length;this.values.push(item);
    while(i>0){const p=(i-1)>>1;if(this.values[p]!.score<=score)break;this.values[i]=this.values[p]!;i=p;}
    this.values[i]=item;
  }
  pop():{key:number;score:number}|undefined {
    const first=this.values[0],last=this.values.pop();if(!last||!this.values.length)return first;
    let i=0;
    while(i*2+1<this.values.length){let next=i*2+1;if(next+1<this.values.length&&this.values[next+1]!.score<this.values[next]!.score)next++;
      if(this.values[next]!.score>=last.score)break;this.values[i]=this.values[next]!;i=next;}
    this.values[i]=last;return first;
  }
}

/** A bounded terrain-cost search, followed by checked smoothing of this new route only. */
export function traceRoute(start:XZ,end:XZ,clear:(x:number,z:number)=>boolean,height:(x:number,z:number)=>number):XZ[]|undefined {
  const step=2,margin=34,minX=Math.floor((Math.min(start[0],end[0])-margin)/step)*step;
  const minZ=Math.floor((Math.min(start[1],end[1])-margin)/step)*step;
  const columns=Math.ceil((Math.max(start[0],end[0])+margin-minX)/step)+1,rows=Math.ceil((Math.max(start[1],end[1])+margin-minZ)/step)+1;
  const size=columns*rows,source=Math.round((start[0]-minX)/step)+columns*Math.round((start[1]-minZ)/step);
  const target=Math.round((end[0]-minX)/step)+columns*Math.round((end[1]-minZ)/step);
  const cost=new Float64Array(size);cost.fill(Infinity);cost[source]=0;
  const parents=new Int32Array(size);parents.fill(-1);
  const open=new MinHeap(),state=new Uint8Array(size),heights=new Float64Array(size);heights.fill(NaN);
  const position=(key:number):XZ=>[minX+(key%columns)*step,minZ+Math.floor(key/columns)*step];
  const allowed=(key:number):boolean=>{
    if(!state[key]){const p=position(key);state[key]=clear(p[0],p[1])?1:2;}
    return state[key]===1;
  };
  const elevation=(key:number):number=>{if(Number.isNaN(heights[key])){const p=position(key);heights[key]=height(p[0],p[1]);}return heights[key]!;};
  const heuristic=(key:number)=>{const p=position(key);return Math.hypot(p[0]-end[0],p[1]-end[1]);};
  open.push(source,heuristic(source));let visits=0;
  while(open.values.length&&visits++<18000){
    const current=open.pop()!,key=current.key;if(current.score>cost[key]!+heuristic(key)+1e-8)continue;
    if(key===target){
      const path:XZ[]=[];let at=key;while(at!==-1){path.push(position(at));at=parents[at]!;}path.reverse();path[0]=start;path[path.length-1]=end;
      // Remove only collinear search steps. A line-of-sight shortcut would erase terrain intent.
      const simplified:XZ[]=[path[0]!];
      for(let i=1;i<path.length-1;i++){
        const a=path[i-1]!,b=path[i]!,c=path[i+1]!;
        if(Math.abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))>1e-6)simplified.push(b);
      }
      simplified.push(end);return roundPolyline(simplified,clear);
    }
    const x=key%columns,z=Math.floor(key/columns);
    for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){
      const nx=x+dx!,nz=z+dz!;if(nx<0||nz<0||nx>=columns||nz>=rows)continue;
      const next=nx+columns*nz;if(!allowed(next))continue;
      if(dx&&dz&&(!allowed(x+dx+columns*z)||!allowed(x+columns*(z+dz))))continue;
      const distance=Math.hypot(dx!,dz!)*step,gradient=Math.abs(elevation(next)-elevation(key))/distance;
      const change=distance*(1+gradient*gradient*28),nextCost=cost[key]!+change;
      if(nextCost>=cost[next]!)continue;cost[next]=nextCost;parents[next]=key;open.push(next,nextCost+heuristic(next));
    }
  }
  return undefined;
}

/** Flat junction aprons with a bounded, continuous derivative into the longitudinal grade. */
export function gradeRoute(points:readonly XZ[],from:number,to:number,apron=18,maxGrade=.12):Vec3[]|undefined {
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]!+Math.hypot(points[i]![0]-points[i-1]![0],points[i]![1]-points[i-1]![1]));
  const length=distances.at(-1)!,flat=Math.min(apron,length*.35),ramp=4,run=length-flat*2-ramp;
  if(Math.abs(to-from)>maxGrade*Math.max(0,run))return undefined;
  const integral=(distance:number):number=>{
    const t=distance-flat;if(t<=0)return 0;if(t>=length-flat*2)return run;
    if(t<ramp)return t*t/(2*ramp);
    if(t>length-flat*2-ramp){const tail=length-flat*2-t;return run-tail*tail/(2*ramp);}
    return t-ramp/2;
  };
  return points.map((point,i)=>[point[0],run>0?from+(to-from)*integral(distances[i]!)/run:from,point[1]] as const);
}

/** Leave a cardinal frontage perpendicularly before joining an oblique street. The first
 * segment has a butt end on the fence; its full two-metre ribbon stays outside the lot. */
export function frontagePath(front:Vec3,outward:Vec3,join:Vec3):XZ[] {
  const exit:XZ=[front[0]+outward[0]*3,front[2]+outward[2]*3];
  return roundPolyline([[front[0],front[2]],exit,[join[0],join[2]]],()=>true);
}
