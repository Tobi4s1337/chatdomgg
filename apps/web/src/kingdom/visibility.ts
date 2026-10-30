import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { WindowHouse } from '@chatdom/render';

/** Intersect a finite segment with a half-open box, returning parameter distance [0,1]. */
function interval(a:Vec3,b:Vec3,lo:Vec3,hi:Vec3):[number,number]|null {
  let start=0,end=1;
  for(let axis=0;axis<3;axis++) {
    const d=b[axis]!-a[axis]!;
    if(Math.abs(d)<1e-10){if(a[axis]!<lo[axis]!||a[axis]!>=hi[axis]!)return null;continue;}
    const p=(lo[axis]!-a[axis]!)/d,q=(hi[axis]!-a[axis]!)/d;
    start=Math.max(start,Math.min(p,q));end=Math.min(end,Math.max(p,q));
    if(end<=start+1e-8)return null;
  }
  return [start,end];
}

/** Exact ordered-box occupancy along a ray: later air carves really open a passage. */
export function blueprintOccludes(blueprint:VoxelBlueprint,a:Vec3,b:Vec3):boolean {
  if(!interval(a,b,[0,0,0],blueprint.size))return false;
  let solid:[number,number][]=[];
  for(const box of blueprint.boxes) {
    const hit=interval(a,b,box.from,box.to);if(!hit)continue;
    // Repaint this interval, preserving disjoint occupied sections outside it.
    const next:[number,number][]=[];
    for(const [lo,hi] of solid){if(hi<=hit[0]||lo>=hit[1])next.push([lo,hi]);else{if(lo<hit[0])next.push([lo,hit[0]]);if(hi>hit[1])next.push([hit[1],hi]);}}
    if(box.material!==0)next.push(hit);
    solid=next;
  }
  return solid.some(([lo,hi])=>hi-lo>1e-6);
}

/** Labels use actual authored shells, including door/roof openings, rather than floating through them. */
export function windowOccluded(houses:readonly WindowHouse[],camera:Vec3,window:Vec3):boolean {
  return houses.some(house=>{
    const c=Math.cos(house.yaw),s=Math.sin(house.yaw);
    const local=(p:Vec3):Vec3=>{const x=p[0]-house.position[0],z=p[2]-house.position[2];return [(c*x-s*z)*8,(p[1]-house.position[1])*8,(s*x+c*z)*8];};
    return blueprintOccludes(house.blueprint,local(camera),local(window));
  });
}
