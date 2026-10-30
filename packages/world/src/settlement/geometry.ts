import type { Vec3 } from '@chatdom/shared';
import type { BoundsXZ, CardinalTurn, PlotReservation, SettlementHome, XZ } from './types';

export function transformCardinalPoint(origin: Vec3, turn: CardinalTurn, local: Vec3): Vec3 {
  const [x, y, z] = local;
  const rotated: XZ = turn === 0 ? [x,z] : turn === 1 ? [z,-x] : turn === 2 ? [-x,-z] : [-z,x];
  return [origin[0]+rotated[0], origin[1]+y, origin[2]+rotated[1]];
}
export function homeFrame(plot: Pick<PlotReservation, 'position' | 'rotation'>): { front: Vec3; right: Vec3; outward: Vec3 } {
  const right = transformCardinalPoint([0,0,0], plot.rotation, [1,0,0]);
  const outward = transformCardinalPoint([0,0,0], plot.rotation, [0,0,1]);
  return { right, outward, front: [plot.position[0]+outward[0]*8, plot.position[1], plot.position[2]+outward[2]*8] };
}
export function homeOrigin(plot: Pick<PlotReservation, 'position' | 'rotation'>, blueprintDepthMetres: number): Vec3 {
  if (!Number.isFinite(blueprintDepthMetres) || blueprintDepthMetres <= 0 || blueprintDepthMetres > 16) throw new Error('Invalid home blueprint depth');
  const { front, right, outward } = homeFrame(plot);
  return [front[0]-right[0]*4-outward[0]*blueprintDepthMetres, front[1], front[2]-right[2]*4-outward[2]*blueprintDepthMetres];
}
export function currentFootprint(plot: Pick<SettlementHome, 'position' | 'rotation' | 'allowedDepth'>): BoundsXZ {
  const {front, right, outward} = homeFrame(plot);
  const corners: XZ[] = [];
  for (const side of [-4,4]) for (const depth of [0,plot.allowedDepth])
    corners.push([front[0]+side*right[0]-depth*outward[0], front[2]+side*right[2]-depth*outward[2]]);
  return pointBounds(corners);
}
export function pointBounds(points: readonly XZ[]): BoundsXZ {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const [x,z] of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  return {minX,maxX,minZ,maxZ};
}
export function expandBounds(b:BoundsXZ, amount:number):BoundsXZ {
  return {minX:b.minX-amount,maxX:b.maxX+amount,minZ:b.minZ-amount,maxZ:b.maxZ+amount};
}
export function boundsOverlap(a:BoundsXZ,b:BoundsXZ,clearance=0):boolean {
  return a.minX<b.maxX+clearance&&a.maxX>b.minX-clearance&&a.minZ<b.maxZ+clearance&&a.maxZ>b.minZ-clearance;
}
export function rectangleDistance(b:BoundsXZ,x:number,z:number):number {
  const dx=Math.max(b.minX-x,0,x-b.maxX),dz=Math.max(b.minZ-z,0,z-b.maxZ);
  return dx||dz?Math.hypot(dx,dz):-Math.min(x-b.minX,b.maxX-x,z-b.minZ,b.maxZ-z);
}
export function segmentProjection(a:XZ,b:XZ,x:number,z:number):{distance:number;t:number} {
  const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)):0;
  return {t,distance:Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)};
}
export function polygonDistance(polygon:readonly XZ[],x:number,z:number):number {
  let inside=false,distance=Infinity;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j]!,b=polygon[i]!;
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    distance=Math.min(distance,segmentProjection(a,b,x,z).distance);
  }
  return inside?-distance:distance;
}
export function smoothstep(a:number,b:number,x:number):number {
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
}
/** Deterministic broad-phase index; each object is returned once per query. */
export class SpatialIndex<T> {
  private readonly buckets=new Map<string,T[]>();
  constructor(readonly size=16){}
  add(bounds:BoundsXZ,value:T):void {
    for(let z=Math.floor(bounds.minZ/this.size);z<=Math.floor(bounds.maxZ/this.size);z++)
      for(let x=Math.floor(bounds.minX/this.size);x<=Math.floor(bounds.maxX/this.size);x++){
        const key=`${x},${z}`,bucket=this.buckets.get(key);
        if(bucket)bucket.push(value);else this.buckets.set(key,[value]);
      }
  }
  at(x:number,z:number):readonly T[]{return this.buckets.get(`${Math.floor(x/this.size)},${Math.floor(z/this.size)}`)??[];}
  within(bounds:BoundsXZ):T[]{
    const found=new Set<T>();
    for(let z=Math.floor(bounds.minZ/this.size);z<=Math.floor(bounds.maxZ/this.size);z++)
      for(let x=Math.floor(bounds.minX/this.size);x<=Math.floor(bounds.maxX/this.size);x++)
        for(const value of this.buckets.get(`${x},${z}`)??[])found.add(value);
    return [...found];
  }
}

/** Sampled cubic corner rounding, preserving both endpoints; no edits to existing routes. */
export function roundPolyline(points:readonly XZ[],clear:(x:number,z:number)=>boolean):XZ[]{
  const rounded:XZ[]=[points[0]!];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1]!,b=points[i]!,c=points[i+1]!;
    const ab=Math.hypot(a[0]-b[0],a[1]-b[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]);
    const radius=Math.min(5,ab*.35,bc*.35),u=radius/ab,v=radius/bc;
    const start:XZ=[b[0]+(a[0]-b[0])*u,b[1]+(a[1]-b[1])*u];
    const end:XZ=[b[0]+(c[0]-b[0])*v,b[1]+(c[1]-b[1])*v],curve:XZ[]=[];
    for(let k=0;k<=12;k++){const t=k/12,s=1-t;curve.push([s*s*start[0]+2*s*t*b[0]+t*t*end[0],s*s*start[1]+2*s*t*b[1]+t*t*end[1]]);}
    if(curve.every(p=>clear(p[0],p[1])))rounded.push(...curve);else rounded.push(b);
  }
  rounded.push(points.at(-1)!);
  const result:XZ[]=[rounded[0]!];
  for(let i=1;i<rounded.length;i++){
    const a=rounded[i-1]!,b=rounded[i]!,n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])));
    for(let j=1;j<=n;j++)result.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);
  }
  return result;
}
