import { ANVIL_HERO_DRAGON_SURFACE, createAnvilHeroDragon } from '@chatdom/content/anvil-hero';
import { FORGE_MOTIFS, ForgeRunRequestSchema, ForgeStyleKitSchema, HousePartPlanSchema, type ForgeHostProfile, type ForgeHouseSocket, type ForgeStyleKit, type HousePartPlan, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '@chatdom/content/materials';
import { createForgeMotif } from '@chatdom/content/forge-motifs';
import { createForgeOrnament } from '@chatdom/content/forge-ornaments';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { canonicalSceneJson } from '@chatdom/world/founded-codec';
import { CURRENT_FORGE_STYLE_KIT_REVISION } from './plan';

export function homeFingerprint(home:VoxelBlueprint):string {let hash=2166136261;for(const c of canonicalSceneJson(home))hash=Math.imul(hash^c.charCodeAt(0),16777619);return `home-${(hash>>>0).toString(16)}`;}
interface HostSurvey {
  cell:(x:number,y:number,z:number)=>number;
  heights:Int16Array;
  sockets:Map<string,ForgeHouseSocket[]>;
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
  const survey={cell,heights,sockets:new Map<string,ForgeHouseSocket[]>()};
  surveys.set(identity,survey);if(surveys.size>2)surveys.delete(surveys.keys().next().value!);
  return survey;
}
function validateHost(home:VoxelBlueprint,hostProfile:ForgeHostProfile) {
  // Use the same bounded host contract as the orchestrator, before allocating a raster.
  ForgeRunRequestSchema.parse({words:'host survey',family:'hearth',home,hostProfile});
}
interface LanternEnvelope { minX:number; maxX:number; minZ:number; maxZ:number; height:number }
// Only authored geometry is retained here, never a host or an unbounded caller object.
let revisionTwoLanternEnvelope:Readonly<LanternEnvelope>|undefined;
function lanternEnvelope():Readonly<LanternEnvelope> {
  if(revisionTwoLanternEnvelope)return revisionTwoLanternEnvelope;
  // Relative to the chamber's centre and bottom; the ornament mounts nine cells above it.
  // Include the saddle and brace as well as the six-cell chamber. Finishes/inlays do not enlarge these boxes.
  const envelope:LanternEnvelope={minX:-4,maxX:4,minZ:-3,maxZ:3,height:9};
  for(const family of ['hearth','tide','grove'] as const)for(const name of FORGE_MOTIFS){
    const motif=name==='sleeping-dragon'?createAnvilHeroDragon(family)
      :name==='crescent-moon'||name==='watchful-owl'?createForgeMotif(name,family):createForgeOrnament(name,family,2);
    for(const box of motif.boxes){
      if(box.material===MAT.air)continue;
      envelope.minX=Math.min(envelope.minX,box.from[0]-motif.mount[0]);
      envelope.maxX=Math.max(envelope.maxX,box.to[0]-motif.mount[0]);
      envelope.minZ=Math.min(envelope.minZ,box.from[2]-motif.mount[2]);
      envelope.maxZ=Math.max(envelope.maxZ,box.to[2]-motif.mount[2]);
      envelope.height=Math.max(envelope.height,9+box.to[1]-motif.mount[1]);
    }
  }
  revisionTwoLanternEnvelope=Object.freeze(envelope);
  return revisionTwoLanternEnvelope;
}
/** Slots are discovered from retained occupancy, not from empty bounding-box corners or a prompt's coordinates. */
/** The survey defaults to the current kit, like `forgeStyleKit`; persisted parts pass their own saved revision. */
export function findForgeSockets(home:VoxelBlueprint,hostProfile:ForgeHostProfile='street-home',kitRevision:number=CURRENT_FORGE_STYLE_KIT_REVISION):ForgeHouseSocket[]{
  if(kitRevision!==1&&kitRevision!==2)throw new Error('Unregistered Forge socket revision.');
  validateHost(home,hostProfile);
  const cacheKey=`${hostProfile}:${kitRevision}`,survey=surveyHost(home),cached=survey.sockets.get(cacheKey);
  if(cached)return structuredClone(cached);
  const {cell,heights}=survey,[sx,,sz]=home.size,castle=hostProfile==='castle-keep';
  const lanternBounds=kitRevision===2?lanternEnvelope():undefined;
  const maxX=castle?sx:Math.min(64,sx),maxY=castle?Math.min(352,home.size[1]+96):160;
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
      const envelope=kind==='lantern'?lanternBounds:undefined;
      if(envelope&&(x+envelope.minX<0||x+envelope.maxX>maxX||z+envelope.minZ<0||z+envelope.maxZ>sz))continue;
      let crown=high;
      const x0=envelope?x+envelope.minX:Math.max(0,x-rx),x1=envelope?x+envelope.maxX:Math.min(sx,x+rx);
      const z0=envelope?z+envelope.minZ:Math.max(0,z-rz),z1=envelope?z+envelope.maxZ:Math.min(sz,z+rz);
      for(let Z=z0;Z<z1;Z++)for(let X=x0;X<x1;X++)crown=Math.max(crown,heights[X+sx*Z]!+1);
      if(crown-high>24)continue;
      if(envelope&&Math.max(crown+2,high+4)+envelope.height>maxY)continue;
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
    // Revision two must reserve the raised chamber AND the widest authored ornament, not just its bracket.
    const x0=lanternBounds?x+lanternBounds.minX:x-4,x1=lanternBounds?x+lanternBounds.maxX:x+4;
    const y0=y-3,y1=lanternBounds?y-1+lanternBounds.height:y+14;
    if(lanternBounds){
      const front=z+1+8+lanternBounds.maxZ;
      if(x0<0||x1>maxX||y0<0||y1>maxY||8+lanternBounds.minZ<0||front>sz)continue;
      if(home.windows.some(w=>w.facing==='south'&&x0<=w.centre[0]+w.width/2&&x1-1>=w.centre[0]-w.width/2
        &&y0<=w.centre[1]+w.height/2&&y1-1>=w.centre[1]-w.height/2&&z+1<w.centre[2]+3&&front-1>=w.centre[2]))continue;
    }
    // A local cavity can be the inside of a door: the entire +Z sightline
    // must reach the lot edge, not just clear the bracket's first 13 cells.
    let clear=true;for(let X=x0;X<x1&&clear;X++)for(let Y=y0;Y<y1&&clear;Y++)for(let Z=z+1;Z<sz;Z++)if(cell(X,Y,Z)){clear=false;break;}
    if(!clear)continue;
    const old=result.findIndex(s=>s.kind==='lantern');if(old>=0)result.splice(old,1);
    result.push({id:'front-lantern',kind:'lantern',profile:'wall',origin:[x-16,y-5,z+1],supports:[[x-1,y-1,z],[x,y,z]],hostId:home.id,hostFingerprint:fingerprint,clearanceHeight:0});break outer;
  }
  }
  if(castle)for(const socket of result)socket.hostProfile='castle-keep';
  survey.sockets.set(cacheKey,structuredClone(result));
  return result;
}
export interface AssembledForge {blueprint:VoxelBlueprint;emitter:[number,number,number];emitterKind:'smoke'|'glow'|null;socket:ForgeHouseSocket;plan:HousePartPlan;kit:ForgeStyleKit}
export function assembleForge(input:HousePartPlan,style:ForgeStyleKit,socket:ForgeHouseSocket):AssembledForge{
  const plan=HousePartPlanSchema.parse(input),kit=ForgeStyleKitSchema.parse(style);
  if(socket.kind!==plan.kind)throw new Error('That part does not fit this house socket.');
  if(kit.id!==`${kit.family}-native`||(kit.revision!==1&&kit.revision!==2)||kit.styleId!==STYLES[kit.family].id)throw new Error('Unregistered style kit.');
  const motif=plan.motif==='sleeping-dragon'?createAnvilHeroDragon(kit.family):['crescent-moon','watchful-owl'].includes(plan.motif)?createForgeMotif(plan.motif as 'sleeping-dragon'|'crescent-moon'|'watchful-owl',kit.family):createForgeOrnament(plan.motif as 'sleeping-fox'|'sunflower'|'scallop-shell'|'shooting-star',kit.family,plan.version===2?kit.revision:1);
  return composeHousePart(plan,kit,socket,motif);
}
/**
 * A finish recolours a motif's broad surface and its metal; an accent sets small enamel inlays on solid faces.
 * Eyes, horns, paws and other anatomy keep their authored materials, so a casting reads like the clay.
 */
export function applyForgeFinish(plan:{motif:string;finish:'native'|'copper'|'ceramic';accent:'none'|'stars'|'leaves'|'scales'},family:'hearth'|'tide'|'grove',motif:Pick<HousePartMotif,'boxes'>):void{
  const native=STYLES[family];
  const finish=plan.finish==='copper'?MAT.forgeCopper:plan.finish==='ceramic'?MAT.cream:null;
  // Retain authored surface boxes before recolouring: merged order says nothing
  // about anatomy, and a ceramic finish can share the belly/horn material.
  const surfaces=new Set<number>(plan.motif==='sleeping-dragon'?[ANVIL_HERO_DRAGON_SURFACE[family]]:[family==='grove'?MAT.moss:native.roof,MAT.brass,MAT.goldLeaf]);
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
/** A sculpture the house-part constructions can carry: its own cells, its bottom contact and an anchor. */
export interface HousePartMotif {size:[number,number,number];boxes:VoxelBlueprint['boxes'];mount:[number,number,number];emitter:[number,number,number]}
type ComposableHousePart = {version:1|2|3;kind:'chimney'|'lantern'|'weathervane';motif:string;finish?:'native'|'copper'|'ceramic';accent?:'none'|'stars'|'leaves'|'scales'};
/**
 * The chimney, lantern and weathervane constructions around any authored motif. Kit revisions 1 and 2 reach it only
 * through `assembleForge`, with the motif it has always used, so their pieces are unchanged; revision 3 brings the
 * library. `motif` is consumed (its boxes are recoloured in place).
 */
export function composeHousePart(plan:ComposableHousePart,kit:ForgeStyleKit,socket:ForgeHouseSocket,motif:HousePartMotif):AssembledForge{
  const native=STYLES[kit.family];
  if(plan.version!==1)applyForgeFinish({motif:plan.motif,finish:plan.finish??'native',accent:plan.accent??'none'},kit.family,motif);
  if(plan.kind==='weathervane'){for(const b of motif.boxes){const z=motif.size[2]-b.to[2];b.to[2]=motif.size[2]-b.from[2];b.from[2]=z;}motif.mount[2]=motif.size[2]-motif.mount[2];motif.emitter[2]=motif.size[2]-motif.emitter[2];}
  const boxes:VoxelBlueprint['boxes']=[];
  const add=(from:[number,number,number],to:[number,number,number],material:number)=>boxes.push({from,to,material});
  let top=4,centreZ=16;
  if(socket.profile==='wall'){
    centreZ=8;add([15,4,0],[17,6,9],MAT.brass);add([14,2,0],[18,8,1],native.trim);
    if(plan.version!==1&&plan.kind==='lantern'&&kit.revision===1){
      add([14,2,6],[18,6,10],MAT.glass);
      add([15,4,6],[17,6,9],MAT.brass);
    }
  }else{
    const ridge=Math.max(...socket.supports.map(p=>p[1]-socket.origin[1]));
    top=socket.profile==='stack'?2:Math.max(socket.clearanceHeight,ridge+(plan.kind==='chimney'? (kit.family==='tide'?9:kit.family==='grove'?5:7):plan.kind==='lantern'?4:8));
    // Column feet individually meet the retained slope. No carve or erasure is ever applied to the house.
    for(const p of socket.supports){const x=p[0]-socket.origin[0],y=p[1]-socket.origin[1],z=p[2]-socket.origin[2];add([x,y,z],[x+1,ridge+2,z+1],native.stone);}
    if(plan.kind==='chimney'&&socket.profile!=='stack'){
      if(top-2>ridge+2)add([13,ridge+2,13],[19,top-2,19],native.stone);
      for(let y=Math.max(ridge+3,socket.clearanceHeight);y<top-2;y+=4)add([11,y,11],[21,y+1,21],kit.family==='grove'?MAT.moss:native.trim);
      add([10,top-2,10],[22,top,22],native.stone);
    }else if(top>ridge+2){add([15,ridge+2,15],[17,top,17],MAT.brass);if(top>ridge+4){
      // The wider lantern survey can clear a neighbouring gable above the saddle: its brace must clear it too.
      const brace=plan.version!==1&&plan.kind==='lantern'&&kit.revision>=2?Math.max(ridge+3,socket.clearanceHeight-1):ridge+3;
      add([12,brace,15],[20,brace+1,17],MAT.brass);
    }if(plan.version!==1&&plan.kind==='lantern'&&kit.revision===1){
      const glassBottom=Math.max(ridge+2,top-3);
      add([14,glassBottom,14],[18,top,18],MAT.glass);
      add([15,glassBottom,15],[17,top,17],MAT.brass);
    }}
  }
  // The lantern is a real framed chamber beneath its ornament. Keep its
  // six-cell footprint within the surveyed roof crown / wall bracket, and
  // give the glass an uninterrupted face instead of burying it in a post.
  const lantern=plan.version!==1&&plan.kind==='lantern'&&kit.revision>=2;
  if(lantern){
    add([13,top,centreZ-3],[19,top+1,centreZ+3],native.trim);
    add([14,top+1,centreZ-2],[18,top+7,centreZ+2],MAT.glass);
    for(const x of [13,18])for(const z of [centreZ-3,centreZ+2])
      add([x,top+1,z],[x+1,top+7,z+1],MAT.brass);
    // Narrow rails connect the corner posts to the glass along every face.
    add([13,top+1,centreZ-2],[14,top+7,centreZ+2],MAT.brass);
    add([18,top+1,centreZ-2],[19,top+7,centreZ+2],MAT.brass);
    add([13,top+7,centreZ-3],[19,top+8,centreZ+3],native.trim);
    add([15,top+8,centreZ-1],[17,top+9,centreZ+1],MAT.brass);
  }
  const motifTop=top+(lantern?9:0);
  const offset:[number,number,number]=[16-motif.mount[0],motifTop-motif.mount[1],centreZ-motif.mount[2]];
  for(const b of motif.boxes)boxes.push({material:b.material,from:b.from.map((n,i)=>n+offset[i]!) as [number,number,number],to:b.to.map((n,i)=>n+offset[i]!) as [number,number,number]});
  const size:[number,number,number]=[Math.max(32,...boxes.map(b=>b.to[0])),Math.max(32,...boxes.map(b=>b.to[1])),Math.max(32,...boxes.map(b=>b.to[2]))];
  const blueprint:VoxelBlueprint={version:1,id:`forged-${kit.family}-${plan.kind}`,kind:'prop',styleId:kit.styleId,lattice:'build',size,boxes,windows:[]};
  return {blueprint,emitter:lantern?[16,top+4,centreZ]:motif.emitter.map((n,i)=>n+offset[i]!) as [number,number,number],emitterKind:plan.kind==='chimney'?'smoke':plan.kind==='lantern'?'glow':null,socket,plan:plan as HousePartPlan,kit};
}
/** Craft/fit checks are deterministic geometry checks, explicitly not moderation verdicts. */
export function checkForge(result:AssembledForge,home:VoxelBlueprint,hostProfile:ForgeHostProfile='street-home'):{solidCells:number;palette:number[]} {
  validateHost(home,hostProfile);
  if((result.socket.hostProfile??'street-home')!==hostProfile)throw new Error('The piece belongs to a different host profile.');
  if(result.socket.hostId!==home.id||result.socket.hostFingerprint!==homeFingerprint(home))throw new Error('The house changed. Find a new socket before forging.');
  const socket=findForgeSockets(home,hostProfile,result.kit.revision).find(s=>s.id===result.socket.id);
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
