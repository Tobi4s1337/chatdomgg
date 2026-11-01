import type { ArtisanKit, KitBox, Point } from '../kit';
import { createWindmill } from '../fields';
import { createQuay, createQuaySection, createQuayInlandStairs, createLighthouse, createShip, type QuayShoreOffset } from '../harbour';
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
interface SupportColumn { readonly x:number; readonly z:number; readonly bottom:number; readonly colour:string }
/** The lowest submerged stone/stair/pile on each column; elevated decks remain open between piles. */
function quaySupports(piece: ArtisanKit): readonly SupportColumn[] {
  const cells=new Map<string,SupportColumn>();
  for(const b of piece.boxes) {
    if(b.min[1]>0) continue;
    for(let z=b.min[2];z<b.min[2]+b.size[2];z++) for(let x=b.min[0];x<b.min[0]+b.size[0];x++) {
      const key=`${x},${z}`, previous=cells.get(key);
      if(!previous || b.min[1]<=previous.bottom) cells.set(key,{x,z,bottom:b.min[1],colour:b.colour});
      if(cells.size>10_000) throw new RangeError('Quay footprint exceeds placement budget');
    }
  }
  return [...cells.values()].sort((a,b)=>a.z-b.z || a.x-b.x);
}
/** Highest authored walkway or step surface up to the walkway top; bollards are not floor. */
function quayDeck(piece: ArtisanKit): readonly {readonly x:number;readonly z:number;readonly top:number}[] {
  const cells=new Map<string,{x:number;z:number;top:number}>();
  for(const b of piece.boxes) {
    const top=Math.min(9,b.min[1]+b.size[1]);
    if(b.min[1]>=9) continue;
    for(let z=b.min[2];z<b.min[2]+b.size[2];z++) for(let x=b.min[0];x<b.min[0]+b.size[0];x++) {
      const key=`${x},${z}`, prev=cells.get(key);
      if(!prev || top>prev.top) cells.set(key,{x,z,top});
    }
  }
  return [...cells.values()];
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
export function sitePlacements(land: SiteLand, guard?: PlacementGuard, diagnostics?: {orientations:{turns:number;work:number;exhausted:boolean;truncatedCandidates?:number}[];accessAttempts?:number}): Placement[] {
  if (!guard) return [];
  const { size, ground, water, seaLevel } = land;
  if (!integer(size) || size < 1 || ground.length !== size*size || water.length !== size*size || !integer(seaLevel) || !integer(land.height) || land.height <= 0 || !Number.isFinite(land.sites.harbour.facing)) throw new RangeError('Invalid source fields');
  const sample = (at: Point, turns: number, x: number, z: number) => {
    const [rx,rz] = rotateCell(x,z,turns), wx=rx+at[0], wz=rz+at[2]; if (wx < 0 || wz < 0 || wx >= size || wz >= size) return null;
    const i=wx+wz*size; return { ground:ground[i]!, water:water[i]! };
  };
  // Kits are immutable during this call. Cache their validated local envelope, then
  // transform that envelope once: cardinal rotations preserve exact axis-aligned extrema.
  // Unrepresentable envelopes fall back to the original per-box validation path.
  const localBounds=new WeakMap<ArtisanKit,KitBox>();
  function boundsFor(piece:ArtisanKit,at:Point,turns:number):Bounds {
    if(!piece.boxes.length) return kitBounds(piece,at,turns);
    let local=localBounds.get(piece);
    if(!local) {
      let bounds:Bounds;
      try {bounds=kitBounds(piece,[0,0,0],0);} catch {return kitBounds(piece,at,turns);}
      const size:Point=[bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1],bounds.max[2]-bounds.min[2]];
      if(!size.every(n=>integer(n) && n>0)) return kitBounds(piece,at,turns);
      local={min:bounds.min,size,colour:''};localBounds.set(piece,local);
    }
    const box=placeBox(local,at,turns);
    return {min:box.min,max:[box.min[0]+box.size[0],box.min[1]+box.size[1],box.min[2]+box.size[2]]};
  }
  const result: Placement[]=[], acceptedBounds=new WeakMap<Placement,Bounds>();
  const accept:PlacementGuard=(kind,bounds)=>guard(kind,bounds) && result.every(p=>{
    let other=acceptedBounds.get(p);
    if(!other) {other=boundsFor(p.piece,p.at,p.turns);acceptedBounds.set(p,other);}
    return [0,1,2].some(d=>bounds.max[d]!<=other.min[d]! || other.max[d]!<=bounds.min[d]!);
  });
  // A sea-level wet cell is useful for a harbour only if connected to open boundary
  // water. Compute this once for all candidates, not once per placement.
  const ocean=new Uint8Array(size*size), queue=new Int32Array(size*size);let read=0,write=0;
  const add=(x:number,z:number)=>{const i=x+z*size;if(!ocean[i] && water[i]===seaLevel && ground[i]!<seaLevel) {ocean[i]=1;queue[write++]=i;}};
  for(let x=0;x<size;x++) {add(x,0);add(x,size-1);}
  for(let z=1;z<size-1;z++) {add(0,z);add(size-1,z);}
  while(read<write) {const i=queue[read++]!,x=i%size,z=Math.floor(i/size);if(x>0)add(x-1,z);if(x+1<size)add(x+1,z);if(z>0)add(x,z-1);if(z+1<size)add(x,z+1);}
  const deepSea=(origin:Point,turn:number,x:number,z:number,depth=5)=>{
    const [rx,rz]=rotateCell(x,z,turn),wx=origin[0]+rx,wz=origin[2]+rz;
    if(wx<0||wz<0||wx>=size||wz>=size) return false;
    const i=wx+wz*size;return !!ocean[i] && ground[i]!<=seaLevel-depth;
  };
  const pierSea=(origin:Point,turn:number,x:number,z:number)=>{
    // The seaward half must float above real connected water; the landward half
    // can cross a supported shallow foreshore. Ship berths still require five cells.
    for(let dz=-16;dz<0;dz++) for(let dx=-5;dx<=5;dx++) if(!deepSea(origin,turn,x+dx,z+dz,1)) return false;
    return true;
  };
  const landingSea=(origin:Point,turn:number,x:number,z:number)=>{
    for(let dz=-4;dz<0;dz++) for(let dx=-6;dx<=6;dx++) if(!deepSea(origin,turn,x+dx,z+dz,1)) return false;
    return true;
  };
  // A berth must fit the full horizontal envelope of the authored ship, not just a wet point.
  const berth=(origin:Point,turn:number,x:number,z:number)=>{
    for(let dz=-8;dz<8;dz++) for(let dx=-30;dx<34;dx++) if(!deepSea(origin,turn,x+dx,z+dz)) return false;
    return true;
  };
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
    const at:Point=[x0,hi,z0], piece=base.finish('windmill'), bounds=boundsFor(piece,at,0);
    if(within(bounds) && accept('windmill',bounds)) {result.push({piece,at,turns:0});break;}
  }
  const h=land.sites.harbour, at:Point=[Math.round(h.x),seaLevel,Math.round(h.z)];
  // Local -Z faces the sea. Quantise the builder's outward angle to a cardinal turn.
  const baseTurns=((Math.round((h.facing+Math.PI/2)/(Math.PI/2))%4)+4)%4;
  let turns=baseTurns, work=0;
  const candidates:[number,number][]=[[0,0]];
  for(let r=8;r<=96;r+=8) for(let z=-r;z<=r;z+=8) for(let x=-r;x<=r;x+=8) if(Math.max(Math.abs(x),Math.abs(z))===r) candidates.push([x,z]);
  const profiles=new WeakMap<ArtisanKit,{supports:ReturnType<typeof quaySupports>;capFoot:ReturnType<typeof footprint>;deck:ReturnType<typeof quayDeck>}>();
  /** All source cells in a module are checked; a failed cell is never clipped. */
  function fitKit(kit:ArtisanKit,origin:Point,join:readonly (readonly [number,number])[]):ArtisanKit|null {
    if(work>=10_000 || write===0) return null;
    work++;
    let profile=profiles.get(kit);
    if(!profile) {profile={supports:quaySupports(kit),capFoot:footprint(kit,false),deck:quayDeck(kit)};profiles.set(kit,profile);}
    const {supports,capFoot,deck}=profile;let fits=true;
    for(const [x,z] of join) {
      const cell=sample(origin,turns,x,z);
      if(!cell || cell.ground<=seaLevel || cell.ground>seaLevel+9 || cell.water>cell.ground) return null;
    }
    const preliminary=boundsFor(kit,origin,turns);
    if(!within(preliminary) || !accept('harbour',preliminary)) return null;
    // A real pier, landing approach and adjacent berth must reach navigable open sea;
    // wet-looking terrain or isolated sea-height ponds do not establish a port.
    const landing=kit.anchors.landing, pier=kit.anchors.pier;
    if(landing && !landingSea(origin,turns,landing[0],landing[2])) return null;
    if(pier && (!pierSea(origin,turns,pier[0],pier[2]) || !berth(origin,turns,pier[0],pier[2]-29))) return null;
    if(kit.id==='harbour-quay' && (!pierSea(origin,turns,-34,-16) || !berth(origin,turns,-34,-45) || !pierSea(origin,turns,26,-16) || !berth(origin,turns,26,-45))) return null;
    // Include overhangs and stairs: terrain cannot intersect any part of the horizontal deck.
    for(const [x,z] of capFoot) {
      const cell=sample(origin,turns,x,z);
      if(!cell || cell.ground>seaLevel+9 || cell.water>seaLevel) {fits=false;break;}
    }
    if(!fits) return null;
    for(const {x,z,top} of deck) {
      const cell=sample(origin,turns,x,z);
      if(!cell || cell.ground>seaLevel+top) {fits=false;break;}
    }
    if(!fits) return null;
    const extensions:{x:number;z:number;start:number;end:number;colour:string}[]=[];
    for(const column of supports) {
      const cell=sample(origin,turns,column.x,column.z);
      if(!cell || cell.ground<=0 || cell.water>seaLevel || (cell.ground<seaLevel && cell.water!==seaLevel)) {fits=false;break;}
      const top=seaLevel+column.bottom, depth=top-cell.ground;
      if(depth>64) {fits=false;break;}
      if(depth>0) extensions.push({x:column.x,z:column.z,start:cell.ground-seaLevel,end:column.bottom,colour:column.colour});
    }
    if(!fits) return null;
    // Merge adjacent identical support columns before placing the authored boxes: later kit
    // details retain their source order, and the original wood/stone material reaches the bed.
    const b=new KitBuilder();
    for(let i=0;i<extensions.length;) {
      const p=extensions[i]!;let j=i+1;
      while(j<extensions.length) { const q=extensions[j]!;if(q.z!==p.z || q.x!==extensions[j-1]!.x+1 || q.start!==p.start || q.end!==p.end || q.colour!==p.colour) break;j++; }
      b.box(p.x,p.start,p.z,extensions[j-1]!.x-p.x+1,p.end-p.start,1,p.colour);i=j;
    }
    b.add(kit);
    const piece=b.finish(kit.id,kit.anchors), bounds=boundsFor(piece,origin,turns);
    return within(bounds) && accept('harbour',bounds) ? piece : null;
  }
  // Find a continuous supported stair from the authored cap to genuine dry land.
  // All six columns of every tread and the full two-row apron are sampled.
  function withAccess(piece:ArtisanKit,origin:Point,sites:readonly {x:number;z:number;top:number;slope:QuayShoreOffset}[]):ArtisanKit|null {
    if(diagnostics) diagnostics.accessAttempts=(diagnostics.accessAttempts ?? 0)+1;
    for(const site of sites) for(let n=1;n<=12;n++) {
      if(work>=10_000) return null;
      work++;
      const values:number[]=[],maxima:number[]=[];let dry=true;
      for(let row=0;row<2*n+2 && dry;row++) for(let x=-3;x<3;x++) {
        const cell=sample(origin,turns,site.x+x,site.z+23+row+Math.round((x+8)/15*site.slope));
        if(!cell || cell.ground<=seaLevel || cell.water>=cell.ground) {dry=false;break;}
        values.push(cell.ground-seaLevel);
      }
      if(!dry) continue;
      const final=values[values.length-1]!;
      if(final>site.top || values.slice(-24).some(v=>v!==final)) continue;
      for(let i=0;i<n;i++) maxima.push(Math.max(...values.slice(i*12,i*12+12)));
      const heights:number[]=[site.top];
      for(let i=1;i<n;i++) heights.push(Math.max(maxima[i]!,heights[i-1]!-1));
      if(heights[0]!<maxima[0]! || heights[n-1]!==final || heights.some((h,i)=>i>0 && h>heights[i-1]!)) continue;
      const stairs=createQuayInlandStairs(heights,values.slice(0,n*12),values.slice(n*12),site.slope);
      const b=new KitBuilder();b.add(piece);b.add(stairs,[site.x,0,site.z]);
      const joined=b.finish(piece.id,piece.anchors), bounds=boundsFor(joined,origin,turns);
      if(within(bounds) && accept('harbour',bounds)) return joined;
    }
    return null;
  }
  const quay=createQuay(`${land.seed.seedKey}:harbour`), fullJoin:(readonly [number,number])[]=[];
  for(let z=21;z<23;z++) for(let x=-61;x<62;x++) fullJoin.push([x,z]);
  let quayAt: Point | undefined;
  for(const orientation of [baseTurns,(baseTurns+1)%4,(baseTurns+3)%4]) {
  turns=orientation;work=0;let truncatedCandidates=0;
  // Visit plausible coast first: this score is only ordering, never acceptance.
  const ranked=candidates.map((offset,index)=>{
    const [wx,wz]=localToWorld(at,turns,offset[0],offset[1]), origin:Point=[wx,seaLevel,wz];
    const shore=sample(origin,turns,0,21), inland=sample(origin,turns,0,30);
    const score=Number(!!shore && shore.ground>seaLevel && shore.water<shore.ground)*4
      +Number(deepSea(origin,turns,0,-25,1))*2
      +Number(deepSea(origin,turns,0,-11,1))
      +Number(!!inland && inland.ground>seaLevel && inland.water<inland.ground);
    return {offset,index,score};
  }).sort((a,b)=>Number(b.index===0)-Number(a.index===0) || b.score-a.score || a.index-b.index);
  for(const {offset:[ox,oz]} of ranked) {
    if(work>=10_000) break;
    const [wx,wz]=localToWorld(at,turns,ox,oz), origin:Point=[wx,seaLevel,wz];
    const piece=fitKit(quay,origin,fullJoin);
    const joined=piece && withAccess(piece,origin,[{x:0,z:0,top:8,slope:0}]);
    if(joined) {result.push({piece:joined,at:origin,turns});quayAt=origin;break;}
  }
  // If no full quay fits, grow one continuous run of complete, independently checked
  // modules. Adjacent 16-cell joins share their shore elevation; no skipped modules or
  // terrain clipping can bridge a gap. A usable run includes both a landing and pier.
  if(!quayAt) {
    const variants = new Map<string,{kit:ArtisanKit;join:readonly (readonly [number,number])[]}>();
    const choices = [0,-2,2,-4,4] as const;
    for(const kind of ['frontage','landing','pier'] as const) for(const slope of choices) {
      const kit=createQuaySection(`${land.seed.seedKey}:harbour`,kind,slope), join:(readonly [number,number])[]=[];
      for(let x=-8;x<8;x++) {const shift=Math.round((x+8)/15*slope);join.push([x,21+shift],[x,22+shift]);}
      variants.set(`${kind}:${slope}`,{kit,join});
    }
    for(const {offset:[ox,oz]} of ranked) {
      if(work>=10_000) break;
      const candidateStart=work;
      const [wx,wz]=localToWorld(at,turns,ox,oz), origin:Point=[wx,seaLevel,wz];
      type Section={piece:ArtisanKit;x:number;z:number};
      const cache=new Map<string,ArtisanKit|null>(), failed=new Set<string>();
      // Identical position and feature state have identical futures. Cache each fit and
      // backtrack across turns and feature order rather than committing the first fit.
      function search(pieces:Section[],shore:number,hasPier:boolean,hasLanding:boolean):ArtisanKit|null {
        if(work>=10_000 || work-candidateStart>=128) return null;
        work++;
        const n=pieces.length;
        // The final guard can inspect the assembled envelope, so retain that envelope
        // in the state: two paths at the same shore can put their pier in different places.
        const ext=pieces.map(p=>boundsFor(p.piece,[p.x,0,p.z],0));
        const envelope=ext.length ? [0,1,2].flatMap(i=>[Math.min(...ext.map(b=>b.min[i]!)),Math.max(...ext.map(b=>b.max[i]!))]).join(':') : '';
        // Access can originate at any preceding module, so failed paths only share a
        // memo entry when their actual candidate access positions and slopes match.
        const accessSignature=pieces.map(p=>`${p.x},${p.z},${(p.piece.anchors['shore-right']?.[2] ?? 21)-(p.piece.anchors['shore-left']?.[2] ?? 21)}`).join(';');
        const state=`${n}:${shore}:${+hasPier}:${+hasLanding}:${envelope}:${accessSignature}`;
        if(failed.has(state)) return null;
        if(n>=3 && hasPier && hasLanding) {
          const assembled=new KitBuilder();for(const p of pieces) assembled.add(p.piece,[p.x,0,p.z]);
          const piece=assembled.finish('harbour-quay-modular',{shoreStart:[-8,6,21],shoreEnd:[n*16-8,6,21+shore]});
          const bounds=boundsFor(piece,origin,turns);
          if(within(bounds) && accept('harbour',bounds)) {
            const access=pieces.map(p=>({x:p.x,z:p.z,top:9,slope:((p.piece.anchors['shore-right']?.[2] ?? 21)-(p.piece.anchors['shore-left']?.[2] ?? 21)) as QuayShoreOffset}));
            const joined=withAccess(piece,origin,access);if(joined) return joined;
          }
        }
        if(n<7) {
          const missing=Number(!hasLanding)+Number(!hasPier);
          if(7-n<missing) {failed.add(state);return null;}
          // Try the rare required features before optional frontage so the bounded
          // search cannot spend its entire budget on frontage-only combinations.
          const kinds:('frontage'|'landing'|'pier')[]=[];
          if(!hasPier) kinds.push('pier');
          if(!hasLanding) kinds.push('landing');
          if(7-n>missing) kinds.push('frontage');
          for(const kind of kinds) for(const slope of choices) {
            const key=`${n}:${shore}:${kind}:${slope}`;
            let piece=cache.get(key);
            if(piece===undefined) {
              const v=variants.get(`${kind}:${slope}`)!;
              const [sx,sz]=localToWorld(origin,turns,n*16,shore);
              piece=fitKit(v.kit,[sx,seaLevel,sz],v.join);cache.set(key,piece);
            }
            if(piece) {
              const answer=search([...pieces,{piece,x:n*16,z:shore}],shore+slope,hasPier || kind==='pier',hasLanding || kind==='landing');
              if(answer) return answer;
            }
          }
        }
        failed.add(state);return null;
      }
      const piece=search([],0,false,false);
      if(!piece && work-candidateStart>=128) truncatedCandidates++;
      if(piece) {result.push({piece,at:origin,turns});quayAt=origin;break;}
    }
  }
  diagnostics?.orientations.push({turns,work,exhausted:work>=10_000 || truncatedCandidates>0,truncatedCandidates});
  if(quayAt) break;
  }
  if(!quayAt) turns=baseTurns;
  // The light and boats have independent supports and never decide whether the quay exists.
  {
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
        const tower=base.finish('harbour-lighthouse'), origin:Point=[hx,high,hz], box=boundsFor(tower,origin,0);
        if(within(box) && accept('lighthouse',box)) {result.push({piece:tower,at:origin,turns:0});break;}
      }
    }
    for(const [j,offset] of [[0,-30],[1,30]] as const) {
      const vessel=createShip(`${land.seed.seedKey}:ship:${j}`), shipFoot=footprint(vessel,false);
      for(let distance=45;distance<=245;distance+=20) {
        const [sx,sz]=localToWorld(quayAt ?? at,turns,offset,-distance), origin:Point=[sx,seaLevel,sz]; let afloat=true;
        for(const [x,z] of shipFoot) {
          const cell=sample(origin,turns,x,z);
          if(!cell || !deepSea(origin,turns,x,z)) {afloat=false;break;}
        }
        if(!afloat) continue;
        const box=boundsFor(vessel,origin,turns);
        if(within(box) && accept('ship',box)) {result.push({piece:vessel,at:origin,turns});break;}
      }
    }
  }
  return result;
}
