import { ForgeStyleKitSchema, HousePartPlanSchema, type ForgeHouseSocket, type ForgeStyleKit, type HousePartPlan, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '@chatdom/content/materials';
import { createForgeMotif } from '@chatdom/content/forge-motifs';
import { rasterizeBlueprint } from '@chatdom/voxel';

export function homeFingerprint(home:VoxelBlueprint):string {let hash=2166136261;for(const c of JSON.stringify(home))hash=Math.imul(hash^c.charCodeAt(0),16777619);return `home-${(hash>>>0).toString(16)}`;}
function cellReader(home:VoxelBlueprint){const asset=rasterizeBlueprint(home),[sx,sy,sz]=asset.size;return (x:number,y:number,z:number)=>x<0||y<0||z<0||x>=sx||y>=sy||z>=sz?0:asset.voxels[x+sx*(y+sy*z)]!;}
/** Slots are discovered from retained occupancy, not from empty bounding-box corners or a prompt's coordinates. */
export function findForgeSockets(home:VoxelBlueprint):ForgeHouseSocket[]{
  const cell=cellReader(home),[sx,sy,sz]=home.size,roof=new Set<number>([MAT.terracotta,MAT.slate,MAT.thatch]),fingerprint=homeFingerprint(home);
  const heights=new Int16Array(sx*sz);for(let z=0;z<sz;z++)for(let x=0;x<sx;x++){let y=sy-1;while(y>=0&&!cell(x,y,z))y--;heights[x+sx*z]=y;}
  const result:ForgeHouseSocket[]=[];
  for(const kind of ['chimney','weathervane'] as const){
    const candidates:{x:number;z:number;supports:[number,number,number][];low:number;high:number;crown:number;score:number}[]=[];
    for(let z=6;z<sz-6;z+=2)for(let x=6;x<sx-6;x+=2){
      const supports:[number,number,number][]=[];let low=Infinity,high=0,ok=true;
      for(let dz=-3;dz<3&&ok;dz++)for(let dx=-3;dx<3;dx++){
        const y=heights[x+dx+sx*(z+dz)]!;
        if(y<1||!(roof.has(cell(x+dx,y,z+dz))||y>28&&[MAT.timber,MAT.bark].includes(cell(x+dx,y,z+dz) as typeof MAT.timber))){ok=false;break;}
        supports.push([x+dx,y+1,z+dz]);low=Math.min(low,y+1);high=Math.max(high,y+1);
      }
      if(!ok||high-low>20||result.some(s=>Math.hypot(x-(s.origin[0]+16),z-(s.origin[2]+16))<22))continue;
      const targetX=sx*(kind==='chimney'?.68:.25),targetZ=sz*.5;
      let crown=high;for(let Z=Math.max(0,z-10);Z<Math.min(sz,z+10);Z++)for(let X=Math.max(0,x-12);X<Math.min(sx,x+12);X++)crown=Math.max(crown,heights[X+sx*Z]!+1);
      if(crown-high>24)continue;
      candidates.push({x,z,supports,low,high,crown,score:Math.hypot(x-targetX,z-targetZ)+(high-low)*.5+(crown-high)});
    }
    const best=candidates.sort((a,b)=>a.score-b.score)[0];
    if(best)result.push({id:`roof-${kind}`,kind,origin:[best.x-16,best.low,best.z-16],supports:best.supports,hostId:home.id,hostFingerprint:fingerprint,clearanceHeight:best.crown-best.low+2});
  }
  // Front is +Z in the content contract. Keep the bracket clear of every existing pane.
  outer:for(let x=Math.floor(sx*.2);x<sx-4;x++)for(let y=30;y>=12;y--){
    let z=sz-1;while(z>=0&&!cell(x,y,z))z--;
    if(z<0||![MAT.plaster,MAT.cream,MAT.timber,MAT.bark,MAT.brick].includes(cell(x,y,z) as typeof MAT.plaster))continue;
    if(home.windows.some(w=>w.facing==='south'&&Math.abs(z+1-w.centre[2])<16&&Math.abs(x-w.centre[0])<w.width/2+4&&Math.abs(y-w.centre[1])<w.height/2+8))continue;
    if(!cell(x-1,y,z)||!cell(x,y-1,z)||!cell(x-1,y-1,z))continue;
    let clear=true;for(let X=x-4;X<x+4&&clear;X++)for(let Y=y-3;Y<y+14&&clear;Y++)for(let Z=z+1;Z<z+13;Z++)if(cell(X,Y,Z)){clear=false;break;}
    if(!clear)continue;
    result.push({id:'front-lantern',kind:'lantern',origin:[x-16,y-5,z+1],supports:[[x-1,y-1,z],[x,y,z]],hostId:home.id,hostFingerprint:fingerprint,clearanceHeight:0});break outer;
  }
  return result;
}
export interface AssembledForge {blueprint:VoxelBlueprint;emitter:[number,number,number];emitterKind:'smoke'|'glow'|null;socket:ForgeHouseSocket;plan:HousePartPlan;kit:ForgeStyleKit}
export function assembleForge(input:HousePartPlan,style:ForgeStyleKit,socket:ForgeHouseSocket):AssembledForge{
  const plan=HousePartPlanSchema.parse(input),kit=ForgeStyleKitSchema.parse(style);
  if(socket.kind!==plan.kind)throw new Error('That part does not fit this house socket.');
  if(kit.id!==`${kit.family}-native`||kit.revision!==1||kit.styleId!==STYLES[kit.family].id)throw new Error('Unregistered style kit.');
  const native=STYLES[kit.family],motif=createForgeMotif(plan.motif,kit.family),boxes:VoxelBlueprint['boxes']=[];
  const add=(from:[number,number,number],to:[number,number,number],material:number)=>boxes.push({from,to,material});
  let top=4,centreZ=16;
  if(plan.kind==='lantern'){
    centreZ=8;add([15,4,0],[17,6,9],MAT.brass);add([14,2,0],[18,8,1],native.trim);
  }else{
    const ridge=Math.max(...socket.supports.map(p=>p[1]-socket.origin[1]));
    top=Math.max(socket.clearanceHeight,ridge+(plan.kind==='chimney'? (kit.family==='tide'?9:kit.family==='grove'?5:7):8));
    // Column feet individually meet the retained slope. No carve or erasure is ever applied to the house.
    for(const p of socket.supports){const x=p[0]-socket.origin[0],y=p[1]-socket.origin[1],z=p[2]-socket.origin[2];add([x,y,z],[x+1,ridge+2,z+1],native.stone);}
    if(plan.kind==='chimney'){
      if(top-2>ridge+2)add([13,ridge+2,13],[19,top-2,19],native.stone);
      for(let y=Math.max(ridge+3,socket.clearanceHeight);y<top-2;y+=4)add([11,y,11],[21,y+1,21],kit.family==='grove'?MAT.moss:native.trim);
      add([10,top-2,10],[22,top,22],native.stone);
    }else{add([15,ridge+2,15],[17,top,17],MAT.brass);add([12,ridge+3,15],[20,ridge+4,17],MAT.brass);}
  }
  const offset:[number,number,number]=[16-motif.mount[0],top-motif.mount[1],centreZ-motif.mount[2]];
  for(const b of motif.boxes)boxes.push({material:b.material,from:b.from.map((n,i)=>n+offset[i]!) as [number,number,number],to:b.to.map((n,i)=>n+offset[i]!) as [number,number,number]});
  const size:[number,number,number]=[Math.max(32,...boxes.map(b=>b.to[0])),Math.max(32,...boxes.map(b=>b.to[1])),Math.max(32,...boxes.map(b=>b.to[2]))];
  const blueprint:VoxelBlueprint={version:1,id:`forged-${kit.family}-${plan.kind}`,kind:'prop',styleId:kit.styleId,lattice:'build',size,boxes,windows:[]};
  return {blueprint,emitter:motif.emitter.map((n,i)=>n+offset[i]!) as [number,number,number],emitterKind:plan.kind==='chimney'?'smoke':plan.kind==='lantern'?'glow':null,socket,plan,kit};
}
/** Craft/fit checks are deterministic geometry checks, explicitly not moderation verdicts. */
export function checkForge(result:AssembledForge,home:VoxelBlueprint):{solidCells:number;palette:number[]} {
  if(result.socket.hostId!==home.id||result.socket.hostFingerprint!==homeFingerprint(home))throw new Error('The house changed. Find a new socket before forging.');
  const socket=findForgeSockets(home).find(s=>s.id===result.socket.id);
  if(!socket||JSON.stringify(socket)!==JSON.stringify(result.socket))throw new Error('The house no longer supports this socket.');
  const canonical=assembleForge(result.plan,result.kit,socket);
  if(JSON.stringify(canonical.blueprint)!==JSON.stringify(result.blueprint))throw new Error('The shape differs from its registered plan.');
  const asset=rasterizeBlueprint(result.blueprint),host=cellReader(home),[sx,sy,sz]=asset.size;
  const palette=new Set<number>();let solidCells=0;
  for(let z=0;z<sz;z++)for(let y=0;y<sy;y++)for(let x=0;x<sx;x++){
    const material=asset.voxels[x+sx*(y+sy*z)]!;if(!material)continue;solidCells++;palette.add(material);
    const X=x+result.socket.origin[0],Y=y+result.socket.origin[1],Z=z+result.socket.origin[2];
    if(host(X,Y,Z))throw new Error(`The ${result.plan.kind} would cover ${home.id} at ${X},${Y},${Z}; origin ${result.socket.origin}; local ${x},${y},${z}.`);
    if(X<0||X>64||Y<0||Y>=160||Z<0||Z>home.size[2]+16)throw new Error('The piece reaches beyond this home.');
    for(const w of home.windows)if(w.facing==='south'&&Math.abs(X-w.centre[0])<=w.width/2&&Math.abs(Y-w.centre[1])<=w.height/2&&Z>=w.centre[2]&&Z<w.centre[2]+3)throw new Error('Keep the window clear.');
  }
  if(solidCells<80||solidCells>15000||palette.size>9||result.blueprint.boxes.length>600)throw new Error('The shape needs a quieter, better balanced finish.');
  // One flood from a real support proves the entire manufactured object is connected.
  const visited=new Uint8Array(asset.voxels.length),queue:number[]=[];
  const first=asset.voxels.findIndex(n=>n!==0);queue.push(first);visited[first]=1;
  for(let i=0;i<queue.length;i++){const n=queue[i]!,x=n%sx,y=Math.floor(n/sx)%sy,z=Math.floor(n/(sx*sy));for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const X=x+dx!,Y=y+dy!,Z=z+dz!;if(X<0||X>=sx||Y<0||Y>=sy||Z<0||Z>=sz)continue;const j=X+sx*(Y+sy*Z);if(asset.voxels[j]&&!visited[j]){visited[j]=1;queue.push(j);}}}
  if(queue.length!==solidCells)throw new Error('A detail is floating away from the piece.');
  return {solidCells,palette:[...palette]};
}
