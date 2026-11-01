import { ANVIL_HERO_DRAGON_SURFACE, createAnvilHeroDragon } from '@chatdom/content/anvil-hero';
import { ForgeRunRequestSchema, ForgeStyleKitSchema, HousePartPlanSchema, type ForgeHostProfile, type ForgeHouseSocket, type ForgeStyleKit, type HousePartPlan, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '@chatdom/content/materials';
import { createForgeMotif } from '@chatdom/content/forge-motifs';
import { createForgeOrnament } from '@chatdom/content/forge-ornaments';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { canonicalSceneJson } from '@chatdom/world/founded-codec';

export function homeFingerprint(home:VoxelBlueprint):string {let hash=2166136261;for(const c of canonicalSceneJson(home))hash=Math.imul(hash^c.charCodeAt(0),16777619);return `home-${(hash>>>0).toString(16)}`;}
interface HostSurvey {
  cell:(x:number,y:number,z:number)=>number;
  heights:Int16Array;
  sockets:Map<ForgeHostProfile,ForgeHouseSocket[]>;
}
// Retain at most two dense hosts (a keep is ~32 MiB). Exact canonical content is
// the cache identity: equal detached snapshots share work; mutations never reuse it.
const surveys=new Map<string,HostSurvey>();
function surveyHost(home:VoxelBlueprint):HostSurvey {
  const identity=canonicalSceneJson(home),cached=surveys.get(identity);
  if(cached){surveys.delete(identity);surveys.set(identity,cached);return cached;}
  const asset=rasterizeBlueprint(home),[sx,sy,sz]=asset.size;
  const cell=(x:number,y:number,z:number)=>x<0||y<0||z<0||x>=sx||y>=sy||z>=sz?0:asset.voxels[x+sx*(y+sy*z)]!;
  const heights=new Int16Array(sx*sz);
  for(let z=0;z<sz;z++)for(let x=0;x<sx;x++){let y=sy-1;while(y>=0&&!cell(x,y,z))y--;heights[x+sx*z]=y;}
  const survey={cell,heights,sockets:new Map<ForgeHostProfile,ForgeHouseSocket[]>()};
  surveys.set(identity,survey);if(surveys.size>2)surveys.delete(surveys.keys().next().value!);
  return survey;
}
function validateHost(home:VoxelBlueprint,hostProfile:ForgeHostProfile) {
  // Use the same bounded host contract as the orchestrator, before allocating a raster.
  ForgeRunRequestSchema.parse({words:'host survey',family:'hearth',home,hostProfile});
}
/** Slots are discovered from retained occupancy, not from empty bounding-box corners or a prompt's coordinates. */
export function findForgeSockets(home:VoxelBlueprint,hostProfile:ForgeHostProfile='street-home'):ForgeHouseSocket[]{
  validateHost(home,hostProfile);
  const survey=surveyHost(home),cached=survey.sockets.get(hostProfile);
  if(cached)return structuredClone(cached);
  const {cell,heights}=survey,[sx,,sz]=home.size,castle=hostProfile==='castle-keep';
  const roof=new Set<number>([MAT.terracotta,MAT.slate,MAT.thatch]),fingerprint=homeFingerprint(home);
  const result:ForgeHouseSocket[]=[];
  // Existing masonry outlets are the native chimney socket: crown them instead of growing a duplicate stack.
  let capY=0;const masonry=new Set<number>([MAT.stone,MAT.limestone,MAT.darkStone,MAT.brick]);
  for(let z=8;z<sz-8;z++)for(let x=12;x<sx-12;x++){const y=heights[x+sx*z]!;if(y>28&&masonry.has(cell(x,y,z)))capY=Math.max(capY,y+1);}
  if(capY&&!castle){const cap:[number,number,number][]=[];for(let z=8;z<sz-8;z++)for(let x=12;x<sx-12;x++)if(heights[x+sx*z]===capY-1&&masonry.has(cell(x,capY-1,z)))cap.push([x,capY,z]);
    if(cap.length>=8){const first=cap[0]!,near=cap.filter(p=>Math.abs(p[0]-first[0])<16&&Math.abs(p[2]-first[2])<16),cx=Math.round((Math.min(...near.map(p=>p[0]))+Math.max(...near.map(p=>p[0])))/2),cz=Math.round((Math.min(...near.map(p=>p[2]))+Math.max(...near.map(p=>p[2])))/2);
      // A low side stack can sit below the adjacent gable. Crown only when the
      // complete dragon footprint clears that roof; otherwise choose a roof saddle.
      let clear=true;for(let z=Math.max(0,cz-10);z<Math.min(sz,cz+10)&&clear;z++)for(let x=Math.max(0,cx-12);x<Math.min(sx,cx+12);x++)if(heights[x+sx*z]!+1>capY){clear=false;break;}
      if(clear)result.push({id:'stack-chimney',kind:'chimney',profile:'stack',origin:[cx-16,capY,cz-16],supports:near,hostId:home.id,hostFingerprint:fingerprint,clearanceHeight:2});}
  }
  for(const kind of ['chimney','weathervane','lantern'] as const){
    if(result.some(s=>s.kind===kind))continue;
    const candidates:{x:number;z:number;supports:[number,number,number][];low:number;high:number;crown:number;score:number}[]=[];
    for(let z=6;z<sz-6;z+=2)for(let x=6;x<sx-6;x+=2){
      const supports:[number,number,number][]=[];let low=Infinity,high=0,ok=true;
      for(let dz=-3;dz<3&&ok;dz++)for(let dx=-3;dx<3;dx++){
        const y=heights[x+dx+sx*(z+dz)]!;
        if(y<1||!(roof.has(cell(x+dx,y,z+dz))||!castle&&y>28&&[MAT.timber,MAT.bark].includes(cell(x+dx,y,z+dz) as typeof MAT.timber))){ok=false;break;}
        supports.push([x+dx,y+1,z+dz]);low=Math.min(low,y+1);high=Math.max(high,y+1);
      }
      if(!ok||high-low>20||result.some(s=>Math.hypot(x-(s.origin[0]+16),z-(s.origin[2]+16))<22))continue;
      const targetX=sx*(castle?(kind==='chimney'?.82:kind==='lantern'?.66:.18):(kind==='chimney'?.68:kind==='lantern'?.72:.25)),targetZ=sz*(castle?(kind==='lantern'?.65:.82):(kind==='lantern'?.8:.5));
      const rx=kind==='chimney'?12:kind==='lantern'?6:7,rz=kind==='chimney'?10:4;
      let crown=high;for(let Z=Math.max(0,z-rz);Z<Math.min(sz,z+rz);Z++)for(let X=Math.max(0,x-rx);X<Math.min(sx,x+rx);X++)crown=Math.max(crown,heights[X+sx*Z]!+1);
      if(crown-high>24)continue;
      candidates.push({x,z,supports,low,high,crown,score:Math.hypot(x-targetX,z-targetZ)+(high-low)*.5+(crown-high)});
    }
    const best=candidates.sort((a,b)=>a.score-b.score)[0];
    if(best)result.push({id:`roof-${kind}`,kind,profile:'roof',origin:[best.x-16,best.low,best.z-16],supports:best.supports,hostId:home.id,hostFingerprint:fingerprint,clearanceHeight:best.crown-best.low+2});
  }
  // Front is +Z in the content contract. Keep the bracket clear of every existing pane.
  if(!castle){
  outer:for(let x=Math.floor(sx*.2);x<sx-4;x++)for(let y=30;y>=12;y--){
    let z=sz-1;while(z>=0&&!cell(x,y,z))z--;
    if(z<0||z+13>sz||![MAT.plaster,MAT.cream,MAT.timber,MAT.bark,MAT.brick].includes(cell(x,y,z) as typeof MAT.plaster))continue;
    if(home.windows.some(w=>w.facing==='south'&&Math.abs(z+1-w.centre[2])<16&&Math.abs(x-w.centre[0])<w.width/2+4&&Math.abs(y-w.centre[1])<w.height/2+8))continue;
    if(!cell(x-1,y,z)||!cell(x,y-1,z)||!cell(x-1,y-1,z))continue;
    // A local cavity can be the inside of a door: the entire +Z sightline
    // must reach the lot edge, not just clear the bracket's first 13 cells.
    let clear=true;for(let X=x-4;X<x+4&&clear;X++)for(let Y=y-3;Y<y+14&&clear;Y++)for(let Z=z+1;Z<sz;Z++)if(cell(X,Y,Z)){clear=false;break;}
    if(!clear)continue;
    const old=result.findIndex(s=>s.kind==='lantern');if(old>=0)result.splice(old,1);
    result.push({id:'front-lantern',kind:'lantern',profile:'wall',origin:[x-16,y-5,z+1],supports:[[x-1,y-1,z],[x,y,z]],hostId:home.id,hostFingerprint:fingerprint,clearanceHeight:0});break outer;
  }
  }
  if(castle)for(const socket of result)socket.hostProfile='castle-keep';
  survey.sockets.set(hostProfile,structuredClone(result));
  return result;
}
export interface AssembledForge {blueprint:VoxelBlueprint;emitter:[number,number,number];emitterKind:'smoke'|'glow'|null;socket:ForgeHouseSocket;plan:HousePartPlan;kit:ForgeStyleKit}
export function assembleForge(input:HousePartPlan,style:ForgeStyleKit,socket:ForgeHouseSocket):AssembledForge{
  const plan=HousePartPlanSchema.parse(input),kit=ForgeStyleKitSchema.parse(style);
  if(socket.kind!==plan.kind)throw new Error('That part does not fit this house socket.');
  if(kit.id!==`${kit.family}-native`||kit.revision!==1||kit.styleId!==STYLES[kit.family].id)throw new Error('Unregistered style kit.');
  const native=STYLES[kit.family],motif=plan.motif==='sleeping-dragon'?createAnvilHeroDragon(kit.family):['crescent-moon','watchful-owl'].includes(plan.motif)?createForgeMotif(plan.motif as 'sleeping-dragon'|'crescent-moon'|'watchful-owl',kit.family):createForgeOrnament(plan.motif as 'sleeping-fox'|'sunflower'|'scallop-shell'|'shooting-star',kit.family);
  if(plan.version===2){
    const finish=plan.finish==='copper'?MAT.forgeCopper:plan.finish==='ceramic'?MAT.cream:null;
    // Finish the broad surface; preserve sleeping eyes, horns, paws and wing
    // ribs so a metal casting keeps the same readable anatomy as native clay.
    const surfaces=new Set<number>(plan.motif==='sleeping-dragon'?[ANVIL_HERO_DRAGON_SURFACE[kit.family]]:[kit.family==='grove'?MAT.moss:native.roof,MAT.brass,MAT.goldLeaf]);
    // Retain authored surface boxes before recolouring: merged order says nothing
    // about anatomy, and a ceramic finish can share the belly/horn material.
    const surfaceBoxes=motif.boxes.filter(box=>surfaces.has(box.material));
    if(finish!==null)for(const box of surfaceBoxes)box.material=finish;
    // Authored enamel inlays sit on existing solid faces, never in empty space.
    if(plan.accent!=='none'){
      const step=plan.accent==='stars'?5:plan.accent==='leaves'?4:3;
      const inlayBoxes=plan.motif==='sleeping-dragon'?surfaceBoxes:motif.boxes.filter(b=>b.material!==MAT.air);
      for(const box of inlayBoxes.slice(0,24)){
        const [x,y,z]=box.to;if((box.from[0]+box.from[1]+box.from[2])%step)continue;
        motif.boxes.push({from:[x-1,y-1,z-1],to:[x,y,z],material:plan.accent==='leaves'?MAT.moss:native.trim});
      }
    }
  }
  if(plan.kind==='weathervane'){for(const b of motif.boxes){const z=motif.size[2]-b.to[2];b.to[2]=motif.size[2]-b.from[2];b.from[2]=z;}motif.mount[2]=motif.size[2]-motif.mount[2];motif.emitter[2]=motif.size[2]-motif.emitter[2];}
  const boxes:VoxelBlueprint['boxes']=[];
  const add=(from:[number,number,number],to:[number,number,number],material:number)=>boxes.push({from,to,material});
  let top=4,centreZ=16;
  if(socket.profile==='wall'){
    centreZ=8;add([15,4,0],[17,6,9],MAT.brass);add([14,2,0],[18,8,1],native.trim);
    if(plan.version===2&&plan.kind==='lantern')add([14,2,6],[18,6,10],MAT.glass);
  }else{
    const ridge=Math.max(...socket.supports.map(p=>p[1]-socket.origin[1]));
    top=socket.profile==='stack'?2:Math.max(socket.clearanceHeight,ridge+(plan.kind==='chimney'? (kit.family==='tide'?9:kit.family==='grove'?5:7):plan.kind==='lantern'?4:8));
    // Column feet individually meet the retained slope. No carve or erasure is ever applied to the house.
    for(const p of socket.supports){const x=p[0]-socket.origin[0],y=p[1]-socket.origin[1],z=p[2]-socket.origin[2];add([x,y,z],[x+1,ridge+2,z+1],native.stone);}
    if(plan.kind==='chimney'&&socket.profile!=='stack'){
      if(top-2>ridge+2)add([13,ridge+2,13],[19,top-2,19],native.stone);
      for(let y=Math.max(ridge+3,socket.clearanceHeight);y<top-2;y+=4)add([11,y,11],[21,y+1,21],kit.family==='grove'?MAT.moss:native.trim);
      add([10,top-2,10],[22,top,22],native.stone);
    }else if(top>ridge+2){add([15,ridge+2,15],[17,top,17],MAT.brass);if(top>ridge+4)add([12,ridge+3,15],[20,ridge+4,17],MAT.brass);if(plan.version===2&&plan.kind==='lantern')add([14,Math.max(ridge+2,top-3),14],[18,top,18],MAT.glass);}
  }
  const offset:[number,number,number]=[16-motif.mount[0],top-motif.mount[1],centreZ-motif.mount[2]];
  for(const b of motif.boxes)boxes.push({material:b.material,from:b.from.map((n,i)=>n+offset[i]!) as [number,number,number],to:b.to.map((n,i)=>n+offset[i]!) as [number,number,number]});
  const size:[number,number,number]=[Math.max(32,...boxes.map(b=>b.to[0])),Math.max(32,...boxes.map(b=>b.to[1])),Math.max(32,...boxes.map(b=>b.to[2]))];
  const blueprint:VoxelBlueprint={version:1,id:`forged-${kit.family}-${plan.kind}`,kind:'prop',styleId:kit.styleId,lattice:'build',size,boxes,windows:[]};
  return {blueprint,emitter:motif.emitter.map((n,i)=>n+offset[i]!) as [number,number,number],emitterKind:plan.kind==='chimney'?'smoke':plan.kind==='lantern'?'glow':null,socket,plan,kit};
}
/** Craft/fit checks are deterministic geometry checks, explicitly not moderation verdicts. */
export function checkForge(result:AssembledForge,home:VoxelBlueprint,hostProfile:ForgeHostProfile='street-home'):{solidCells:number;palette:number[]} {
  validateHost(home,hostProfile);
  if((result.socket.hostProfile??'street-home')!==hostProfile)throw new Error('The piece belongs to a different host profile.');
  if(result.socket.hostId!==home.id||result.socket.hostFingerprint!==homeFingerprint(home))throw new Error('The house changed. Find a new socket before forging.');
  const socket=findForgeSockets(home,hostProfile).find(s=>s.id===result.socket.id);
  if(!socket||JSON.stringify(socket)!==JSON.stringify(result.socket))throw new Error('The house no longer supports this socket.');
  const canonical=assembleForge(result.plan,result.kit,socket);
  if(JSON.stringify(canonical.blueprint)!==JSON.stringify(result.blueprint))throw new Error('The shape differs from its registered plan.');
  const asset=rasterizeBlueprint(result.blueprint),host=surveyHost(home).cell,[sx,sy,sz]=asset.size;
  const palette=new Set<number>();let solidCells=0;
  const maxX=hostProfile==='castle-keep'?home.size[0]:64,maxY=hostProfile==='castle-keep'?Math.min(352,home.size[1]+96):160;
  for(let z=0;z<sz;z++)for(let y=0;y<sy;y++)for(let x=0;x<sx;x++){
    const material=asset.voxels[x+sx*(y+sy*z)]!;if(!material)continue;solidCells++;palette.add(material);
    const X=x+result.socket.origin[0],Y=y+result.socket.origin[1],Z=z+result.socket.origin[2];
    if(host(X,Y,Z))throw new Error(`The ${result.plan.kind} would cover ${home.id} at ${X},${Y},${Z}; origin ${result.socket.origin}; local ${x},${y},${z}.`);
    if(X<0||X>=maxX||Y<0||Y>=maxY||Z<0||Z>=home.size[2])throw new Error('The piece reaches beyond this home.');
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
