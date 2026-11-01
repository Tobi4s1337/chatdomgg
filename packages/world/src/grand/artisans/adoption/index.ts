import type { ArtisanKit, KitBox, Point } from '../kit';
import { createWindmill } from '../fields';
import { createHarbour, createLighthouse, createShip } from '../harbour';
import { CLAY, KitBuilder } from '../kit';

/** Adapter data remains visual: a placement never grants a collider or a usable route. */
export interface Placement { readonly piece: ArtisanKit; readonly at: Point; readonly turns: number }
export interface Bounds { readonly min: Point; readonly max: Point }
const integer = (n: number) => Number.isSafeInteger(n);

/** A half-open box rotated around the piece origin, preserving its lattice corners. */
export function placeBox(box: KitBox, at: Point, turns: number): KitBox {
  if (!integer(turns) || !at.every(integer) || !box.min.every(integer) || !box.size.every(n => integer(n) && n > 0)) throw new RangeError('Box and placement coordinates must be safe integers');
  let [x, , z] = box.min, [sx, , sz] = box.size;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) { [x, z] = [-z - sz, x]; [sx, sz] = [sz, sx]; }
  const min: Point = [x + at[0], box.min[1] + at[1], z + at[2]], size: Point = [sx, box.size[1], sz];
  if (!min.every(integer) || !min.every((v, d) => integer(v + size[d]!))) throw new RangeError('Placed box is outside integer coordinate range');
  return { min, size, colour: box.colour };
}

export interface SiteLand {
  readonly seed: { readonly seedKey: string };
  readonly size: number; readonly height: number; readonly seaLevel: number;
  readonly ground: Uint16Array; readonly water: Uint16Array;
  readonly sites: { readonly fields: { readonly x: number; readonly z: number; readonly radius?: number }; readonly harbour: { readonly x: number; readonly z: number; readonly facing: number }; readonly headland?: { readonly x: number; readonly z: number; readonly y: number } };
}
export type PlacementGuard = (kind: 'windmill' | 'harbour' | 'lighthouse' | 'ship', bounds: Bounds) => boolean;
function localToWorld(at: Point, turns: number, x: number, z: number): [number,number] {
  for (let t=0;t<turns;t++) [x,z]=[-z,x];
  return [x+at[0],z+at[2]];
}
/** Projection on integer source columns; the base mode selects only the lowest occupied slice. */
function footprint(piece: ArtisanKit, baseOnly: boolean): readonly (readonly [number,number])[] {
  if (!piece.boxes.length) throw new RangeError('Cannot place an empty kit');
  const bottom = Math.min(...piece.boxes.map(b => b.min[1]));
  const columns = new Map<string, readonly [number,number]>();
  for(const b of piece.boxes) {
    if(baseOnly && (b.min[1]>bottom || b.min[1]+b.size[1]<=bottom)) continue;
    for(let z=b.min[2];z<b.min[2]+b.size[2];z++) for(let x=b.min[0];x<b.min[0]+b.size[0];x++) {
      columns.set(`${x},${z}`,[x,z]);
      if(columns.size>100_000) throw new RangeError('Kit footprint exceeds placement budget');
    }
  }
  return [...columns.values()];
}
/** Rotate a unit source cell, including the minus-one needed for half-open boxes. */
function rotateCell(x: number, z: number, turns: number): [number,number] {
  for(let t=0;t<turns;t++) [x,z]=[-z-1,x];
  return [x,z];
}
function kitBounds(piece: ArtisanKit, at: Point, turns: number): Bounds {
  const min: [number,number,number] = [Infinity,Infinity,Infinity], max: [number,number,number] = [-Infinity,-Infinity,-Infinity];
  for (const box of piece.boxes) { const b = placeBox(box,at,turns); for (let d=0;d<3;d++) { min[d]=Math.min(min[d]!,b.min[d]!); max[d]=Math.max(max[d]!,b.min[d]!+b.size[d]!); } }
  return { min,max };
}
/** Conservative candidate fitter. It never grades land, replaces homes or assumes unknown clearance. */
export function sitePlacements(land: SiteLand, guard?: PlacementGuard): Placement[] {
  if (!guard) return [];
  const { size, ground, water, seaLevel } = land;
  if (!integer(size) || size < 1 || ground.length !== size*size || water.length !== size*size || !integer(seaLevel) || !integer(land.height) || land.height <= 0 || !Number.isFinite(land.sites.harbour.facing)) throw new RangeError('Invalid source fields');
  const sample = (at: Point, turns: number, x: number, z: number) => {
    const [rx,rz] = rotateCell(x,z,turns), wx=rx+at[0], wz=rz+at[2]; if (wx < 0 || wz < 0 || wx >= size || wz >= size) return null;
    const i=wx+wz*size; return { ground:ground[i]!, water:water[i]! };
  };
  const result: Placement[]=[];
  const fx=Math.round(land.sites.fields.x), fz=Math.round(land.sites.fields.z);
  const within = (bounds: Bounds) => bounds.min[0]>=0 && bounds.min[1]>=0 && bounds.min[2]>=0 && bounds.max[0]<=size && bounds.max[1]<=land.height && bounds.max[2]<=size;
  // Scan the field zone in deterministic rings. A compact foundation follows actual terrain;
  // no terrain is flattened and every support column reaches the sampled solid surface.
  const offsets: [number,number][] = [[0,0]];
  const searchRadius=Math.min(96,Math.max(0,Math.floor(land.sites.fields.radius ?? 24)));
  for(let r=12;r<=searchRadius;r+=12) for(let z=-r;z<=r;z+=12) for(let x=-r;x<=r;x+=12) if(Math.max(Math.abs(x),Math.abs(z))===r) offsets.push([x,z]);
  const windmill=createWindmill(`${land.seed.seedKey}:windmill`), millFoot=footprint(windmill,true);
  for(const [ox,oz] of offsets) {
    const x0=fx+ox,z0=fz+oz, probe:Point=[x0,0,z0];
    let lo=Infinity, hi=-Infinity, dry=true;
    for(const [x,z] of millFoot) {
      const cell=sample(probe,0,x,z);
      if(!cell || cell.water>cell.ground) {dry=false;break;}
      lo=Math.min(lo,cell.ground);hi=Math.max(hi,cell.ground);
    }
    if(!dry || hi-lo>4 || hi<1) continue;
    const base=new KitBuilder();
    for(const [x,z] of millFoot) {
      const g=sample(probe,0,x,z)!.ground; if(g<hi) base.box(x,g-hi,z,1,hi-g,1,CLAY.stoneDark);
    }
    base.add(windmill);
    const at:Point=[x0,hi,z0], piece=base.finish('windmill'), bounds=kitBounds(piece,at,0);
    if(within(bounds) && guard('windmill',bounds)) {result.push({piece,at,turns:0});break;}
  }
  const h=land.sites.harbour, at:Point=[Math.round(h.x),seaLevel,Math.round(h.z)];
  // Local -Z faces the sea. Quantise the builder's outward angle to a cardinal turn.
  const turns=((Math.round((h.facing+Math.PI/2)/(Math.PI/2))%4)+4)%4;
  const piece=createHarbour(`${land.seed.seedKey}:harbour`); let supported=true;
  // Every quay-join column is dry, level and seated. Entire conservative ship envelopes
  // have sufficient water. Piles touch the seabed rather than ending in open water.
  for(let x=-60;x<=60 && supported;x++) {const s=sample(at,turns,x,21); if(!s || s.ground<seaLevel+6 || s.ground>seaLevel+9 || s.water>s.ground) supported=false;}
  // Check the complete projected ship silhouette, including sails and bowsprits.
  const harbourSeed=`${land.seed.seedKey}:harbour`;
  for(const [cx,cz,shipTurns,label] of [[-35,-45,0,'west-berth'],[28,-48,2,'east-berth']] as const) {
    const vessel=createShip(`${harbourSeed}:${label}`);
    for(const [sx,sz] of footprint(vessel,false)) {
      const [rx,rz]=rotateCell(sx,sz,shipTurns), cell=sample(at,turns,cx+rx,cz+rz);
      if(!cell || cell.water!==seaLevel || cell.ground>seaLevel-5) {supported=false;break;}
    }
  }
  for(const centre of [-34,26]) for(const px of [centre-4,centre+3]) for(let pz=-29;pz<=-1;pz+=9) for(let dz=0;dz<2;dz++) for(let dx=0;dx<2;dx++) {
    const s=sample(at,turns,px+dx,pz+dz); if(!s || s.water!==seaLevel || s.ground!==seaLevel-5) supported=false;
  }
  // The embedded lighthouse footing meets the real octagonal base under every occupied column.
  const harbourTower=createLighthouse(harbourSeed), harbourTowerFoot=footprint(harbourTower,true);
  for(const [x,z] of harbourTowerFoot) {
    const cell=sample(at,turns,54+x,20+z);
    if(!cell || cell.ground!==seaLevel+8 || cell.water>cell.ground) {supported=false;break;}
  }
  const bounds=kitBounds(piece,at,turns);
  if(supported && within(bounds) && guard('harbour',bounds)) result.push({piece,at,turns});
  else {
    // If a quay cannot be fitted, keep individually grounded landmarks instead of inventing one.
    const head=land.sites.headland;
    if(head && Number.isFinite(head.x) && Number.isFinite(head.z)) {
      const hx0=Math.round(head.x), hz0=Math.round(head.z), locations:[number,number][]=[[0,0]];
      for(let r=12;r<=60;r+=12) for(let z=-r;z<=r;z+=12) for(let x=-r;x<=r;x+=12) if(Math.max(Math.abs(x),Math.abs(z))===r) locations.push([x,z]);
      const lighthouse=createLighthouse(`${land.seed.seedKey}:headland`), towerFoot=footprint(lighthouse,true);
      const bottom=Math.min(...lighthouse.boxes.map(b => b.min[1]));
      for(const [ox,oz] of locations) {
        const hx=hx0+ox, hz=hz0+oz, probe:Point=[hx,0,hz]; let low=Infinity, high=-Infinity, dry=true;
        for(const [x,z] of towerFoot) {
          const cell=sample(probe,0,x,z);
          if(!cell || cell.water>cell.ground || cell.ground<=seaLevel) {dry=false;break;}
          low=Math.min(low,cell.ground);high=Math.max(high,cell.ground);
        }
        if(!dry || high-low>4 || high+bottom<0) continue;
        const base=new KitBuilder();
        for(const [x,z] of towerFoot) {
          const g=sample(probe,0,x,z)!.ground; if(g<high+bottom) base.box(x,g-high,z,1,high+bottom-g,1,CLAY.stoneDark);
        }
        base.add(lighthouse);
        const tower=base.finish('harbour-lighthouse'), origin:Point=[hx,high,hz], box=kitBounds(tower,origin,0);
        if(within(box) && guard('lighthouse',box)) {result.push({piece:tower,at:origin,turns:0});break;}
      }
    }
    for(const [j,offset] of [[0,-30],[1,30]] as const) {
      const vessel=createShip(`${land.seed.seedKey}:ship:${j}`), shipFoot=footprint(vessel,false);
      for(let distance=65;distance<=245;distance+=20) {
        const [sx,sz]=localToWorld(at,turns,offset,-distance), origin:Point=[sx,seaLevel,sz]; let afloat=true;
        for(const [x,z] of shipFoot) {
          const cell=sample(origin,turns,x,z);
          if(!cell || cell.water!==seaLevel || cell.ground>seaLevel-5) {afloat=false;break;}
        }
        if(!afloat) continue;
        const box=kitBounds(vessel,origin,turns);
        if(within(box) && guard('ship',box)) {result.push({piece:vessel,at:origin,turns});break;}
      }
    }
  }
  return result;
}
