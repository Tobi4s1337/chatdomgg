import { CONTACT } from './presentation/stage';
import * as THREE from 'three';
import { MATERIALS, type StyleKey } from '@chatdom/content';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, forgeTitle, planLocalForge, forgeRitualFrame, createForgeRefusalGate, homeFingerprint, FORGE_STAGE_TIMING, type AssembledForge } from '@chatdom/forge';
import { ForgePlacementSchema, type ForgePlacement, type ForgePhase, type Vec3, type HousePartPlan } from '@chatdom/shared';
import { geometryFromChunks, type VoxelRenderState, type WindowHouse } from '@chatdom/render';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { buildBounds } from '../build/composition';
import { addForgeFlightHeat } from './flight-heat';
import { forgeHomeShot, forgeFlightShot } from './home-shot';
import { createForgeRitualView } from './ritual-view';
import { createForgeEmitters } from './emitters';
import { createForgeRefusalPresentation, FORGE_MOOD_CAPTION_CLASS, FORGE_MOOD_DURATION } from './refusal';
import './refusal/caption.css';
import { playForgeSound, renderForgeRitualAudio } from './sound';
import {requestForgeRun,ForgeRunStopped} from './run-client';
import type { createKingdomSound } from '../kingdom/sound';

export interface ForgeStatus {open:boolean;busy:boolean;phase:ForgePhase|'idle'|'preparing'|'refusal';title:string;message:string;privateError:string|null;maker:string|null;placed:number;kept:number;family:StyleKey;plaque:string|null;runtime:'codex'|'fixture'}
interface Options {onFlight?:import('./presentation/stage').ForgePresentationOptions['onFlight'];scene:THREE.Scene;camera:THREE.PerspectiveCamera;canvas:HTMLCanvasElement;pool:VoxelWorkerPool;material:VoxelRenderState;anvil:THREE.Vector3;home:()=>WindowHouse;source:'simulated'|'herald';seed:string;kingdomName:string;family:StyleKey;sound:ReturnType<typeof createKingdomSound>;onStatus?:(status:ForgeStatus)=>void;onArrival?:(home:WindowHouse)=>void;registerShadow?:(mesh:THREE.Mesh)=>()=>void}
type Placed={mesh:THREE.Mesh;heat:ReturnType<typeof addForgeFlightHeat>;result:AssembledForge;receipt:ForgePlacement;emitter:THREE.Vector3;unshadow?:()=>void};
const LANDED_START=FORGE_STAGE_TIMING.find(([phase])=>phase==='landed')![1];
export function createKingdomForge(options:Options){
  const pieceMaterial=new THREE.ShaderMaterial({glslVersion:options.material.material.glslVersion,uniforms:options.material.material.uniforms,vertexShader:options.material.material.vertexShader,fragmentShader:options.material.material.fragmentShader.replace('vec3 colour=base*edge*light*ao;','vec3 colour=base*edge*(light+vec3(.32,.25,.17))*ao;if(vMaterial==14u)colour+=vec3(1.6,.65,.12)*uNight;')});
  const view=createForgeRitualView(options.scene,{...options.material,material:pieceMaterial}),emitters=createForgeEmitters(options.scene),refusals=createForgeRefusalGate();
  const moodRoot=new THREE.Group();options.scene.add(moodRoot);
  const moodCaption=document.createElement('p');moodCaption.className=FORGE_MOOD_CAPTION_CLASS;
  Object.assign(moodCaption.style,{position:'absolute',bottom:'42px',left:'50%',translate:'-50% 0',zIndex:'6'});
  options.canvas.parentElement?.append(moodCaption);
  const mood=createForgeRefusalPresentation({root:moodRoot,anvil:[options.anvil.x,options.anvil.y+1.43,options.anvil.z],caption:moodCaption});
  let moodStarted=-Infinity;
  view.root.position.copy(options.anvil);view.root.visible=false;
  const placed=new Map<string,Placed>(),kept=new Map<string,ForgePlacement>();
  let open=false,preparing=false,disposed=false,revision=0,now=0,start=0,fixed:number|null=null,lastPhase='',lastStatus='',privateError:string|null=null,refusalUntil=0;
  let current:{result:AssembledForge;geometry:THREE.BufferGeometry;bounds:THREE.Box3;destination:THREE.Vector3;home:WindowHouse;id:string;committed:boolean;approval:ForgePlacement['approval'];provenance:NonNullable<ForgePlacement['provenance']>}|null=null;
  let observedHome=options.home().blueprint;
  const family=options.family,fixture=new URLSearchParams(location.search).get('forgeFixture')==='1',runAbort=new AbortController();
  let waitingStage='',runStarted=0,pendingReceipt:ForgePlacement|null=null;
  const storageKey=`chatdom:forge:simulated:${options.seed}:${options.home().slot}`;
  const point=(p:readonly number[],home:WindowHouse)=>new THREE.Vector3(...p as [number,number,number]).multiplyScalar(.125).applyAxisAngle(new THREE.Vector3(0,1,0),home.yaw).add(new THREE.Vector3(...home.position));
  const elapsed=()=>fixed??Math.max(0,(now-start)/1000);
  function status():ForgeStatus{const frame=current?forgeRitualFrame(current.id,elapsed()):null;return {open,busy:preparing||!!current&&!current.committed,phase:preparing?'preparing':now<refusalUntil?'refusal':frame?.phase??'idle',title:now<refusalUntil?'The bellows need a breather':preparing?'Words in the fire':current?(current.approval?.title??forgeTitle(current.result.plan)):'What shall we make?',message:preparing?({'judging-words':'The runes circle the fire…',drafting:'The smith is listening to your wish…',assembling:'A shape is finding its place…','judging-piece':'The seal is weighing this new shape…'}[waitingStage]??'The runes circle the fire…'):current?.committed?'Made here. At home here.':frame?({words:'Words find their shape',blueprint:'A wish, drawn in light',pour:'The metal remembers',seal:'Fit for this home',strike:'',cool:'The colours of your kingdom',flight:'A gift for your home',landed:'Made here. At home here.'}[frame.phase]):'One small wish. Something that belongs to you.',privateError,maker:current?.committed&&!preparing?`First forged by ${current.provenance.makerName} · ${current.provenance.kingdomName}`:null,placed:placed.size,kept:kept.size,family,plaque:current?.approval?.plaque??null,runtime:fixture?'fixture':'codex'};}
  function publishStatus(){const value=status(),key=JSON.stringify(value);if(key!==lastStatus){lastStatus=key;options.onStatus?.(value);}}
  function save(){try{localStorage.setItem(storageKey,JSON.stringify({version:1,attached:[...placed.values()].map(p=>p.receipt),kept:[...kept.values()],pending:pendingReceipt}));}catch{privateError='This browser could not keep the piece after you leave.';}}
  async function make(plan:HousePartPlan,selected:StyleKey){
    const home=options.home(),socket=findForgeSockets(home.blueprint).find(s=>s.kind===plan.kind);if(!socket)throw new Error('Your home needs a clear place for this part.');
    const result=assembleForge(plan,forgeStyleKit(selected),socket);checkForge(result,home.blueprint);
    const mesh=await options.pool.submit({kind:'blueprint',blueprint:result.blueprint,materials:MATERIALS.materials,materialRevision:MATERIALS.revision,revision:++revision});
    if(disposed||mesh?.kind!=='asset')throw new Error('The anvil has gone cold.');
    if(socket.hostFingerprint!==homeFingerprint(options.home().blueprint))throw new Error('Your house changed while the smith was working. Your previous pieces are safe.');
    if(mesh.chunks.reduce((n,c)=>n+c.mesh.indices.length/3,0)>40000)throw new Error('This part needs a simpler finish.');
    const geometry=geometryFromChunks(mesh.chunks,'build'),designId=`${result.kit.id}-${homeFingerprint(result.blueprint)}`;
    const lineage=[...placed.values()].map(p=>p.receipt).concat([...kept.values()]).find(p=>p.provenance?.designId===designId)?.provenance;
    return {result,geometry,bounds:buildBounds(result.blueprint),destination:point(socket.origin,home),home,id:`local-${Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}`,committed:false,approval:undefined as ForgePlacement['approval'],provenance:lineage??{source:'simulated' as const,makerId:'simulated-juniper',makerName:'Juniper',kingdomKey:options.seed,kingdomName:options.kingdomName,firstForgedAt:Date.now(),designId} };
  }
  function receiptFor(work:NonNullable<typeof current>):ForgePlacement{
    return {version:1,id:work.id,hostId:work.home.blueprint.id,hostFingerprint:homeFingerprint(work.home.blueprint),socketId:work.result.socket.id,kitId:work.result.kit.id,kitRevision:work.result.kit.revision,plan:work.result.plan,origin:work.result.socket.origin,provenance:work.provenance,...(work.approval?{approval:work.approval}:{})};
  }
  function install(work:NonNullable<typeof current>){
    // Recheck host at arrival; an edit while the piece flies cannot attach to an obsolete roof.
    checkForge(work.result,options.home().blueprint);
    const id=work.result.socket.id,old=placed.get(id);if(old){kept.set(old.receipt.id,old.receipt);old.unshadow?.();options.scene.remove(old.mesh);old.mesh.geometry.dispose();(old.mesh.material as THREE.Material).dispose();}
    const landedMaterial=pieceMaterial.clone();landedMaterial.uniforms={...pieceMaterial.uniforms};const heat=addForgeFlightHeat(landedMaterial);
    const mesh=new THREE.Mesh(work.geometry,landedMaterial);mesh.position.copy(work.destination);mesh.rotation.y=work.home.yaw;mesh.frustumCulled=false;options.scene.add(mesh);mesh.updateMatrixWorld(true);
    const receipt=receiptFor(work);
    const emitter=point(work.result.emitter.map((n,i)=>n+work.result.socket.origin[i]!),work.home);
    const entry:Placed={mesh,heat,result:work.result,receipt,emitter};const unshadow=options.registerShadow?.(mesh);if(unshadow)entry.unshadow=unshadow;placed.set(id,entry);kept.delete(work.id);work.committed=true;if(pendingReceipt?.id===work.id)pendingReceipt=null;save();
  }
  async function submit(words:string){
    if(now<refusalUntil||preparing||current&&!current.committed||options.source!=='simulated'||disposed)return false;
    void options.sound.unlock().then(ready=>{if(ready&&!disposed&&preparing)playForgeSound(options.sound,'words');});privateError=null;open=true;preparing=true;fixed=null;runStarted=now;waitingStage='judging-words';view.beginWords();publishStatus();
    try{
      let plan:HousePartPlan,approval:ForgePlacement['approval'];
      if(fixture)plan=planLocalForge(words);else{const home=options.home().blueprint,approved=await requestForgeRun({words,family,home},stage=>{waitingStage=stage;publishStatus();},runAbort.signal);
        if(disposed)return false;if(approved.hostFingerprint!==homeFingerprint(options.home().blueprint))throw new Error('Your house changed while the smith was working. Your previous pieces are safe.');plan=approved.draft.plan;approval={runId:approved.runId,title:approved.draft.title,plaque:approved.draft.plaque};}
      const work=await make(plan,family);work.approval=approval;pendingReceipt=receiptFor(work);save();
      if(current&&!current.committed)current.geometry.dispose();current=work;view.setPiece(work.geometry,work.bounds,work.destination);start=now-(fixture?0:3000);lastPhase='';preparing=false;publishStatus();return true;
    }catch(error){if(disposed||runAbort.signal.aborted)return false;preparing=false;if(current?.committed)current=null;privateError=error instanceof Error?error.message:'The forge needs another wish.';
      // No request words, name, ID or reason enter the public soot beat.
      if(fixture||error instanceof ForgeRunStopped&&error.outcome==='refuse'){const beat=refusals.beat(now);if(beat?.kind==='refusal'){refusalUntil=now+FORGE_MOOD_DURATION*1000;moodStarted=now;mood.play(beat);playForgeSound(options.sound,'refusal');}}publishStatus();return false;
    }
  }
  async function prepare(){
    if(options.source!=='simulated')return;
    let data:unknown;try{data=JSON.parse(localStorage.getItem(storageKey)??'[]');}catch{return;}
    const envelope=data as {version?:number;attached?:unknown[];kept?:unknown[];pending?:unknown};
    const attached=Array.isArray(data)?data:envelope?.version===1&&Array.isArray(envelope.attached)?envelope.attached:[];
    if(!Array.isArray(data)&&Array.isArray(envelope?.kept))for(const raw of envelope.kept.slice(0,256)){const parsed=ForgePlacementSchema.safeParse(raw);if(parsed.success)kept.set(parsed.data.id,parsed.data);}
    if(attached.length>3)return;
    if(envelope?.pending){const parsed=ForgePlacementSchema.safeParse(envelope.pending);if(parsed.success){const at=attached.findIndex(raw=>(raw as ForgePlacement)?.socketId===parsed.data.socketId);if(at>=0)attached.splice(at,1);attached.push(parsed.data);}}
    for(const raw of attached){try{const receipt=ForgePlacementSchema.parse(raw),home=options.home();if(receipt.hostFingerprint!==homeFingerprint(home.blueprint)){kept.set(receipt.id,receipt);continue;}
      const style=receipt.kitId.replace('-native','') as StyleKey;if(!['hearth','tide','grove'].includes(style))continue;
      const work=await make(receipt.plan,style);work.id=receipt.id;work.approval=receipt.approval;if(receipt.provenance)work.provenance=receipt.provenance;if(disposed){work.geometry.dispose();return;}install(work);
    }catch{const parsed=ForgePlacementSchema.safeParse(raw);if(parsed.success)kept.set(parsed.data.id,parsed.data);}}
    save();
  }
  function clearStale(){for(const [id,item] of placed)if(item.receipt.hostFingerprint!==homeFingerprint(options.home().blueprint)){kept.set(item.receipt.id,item.receipt);item.unshadow?.();item.mesh.geometry.dispose();(item.mesh.material as THREE.Material).dispose();options.scene.remove(item.mesh);placed.delete(id);if(current?.result.socket.id===id)current=null;privateError='Your forged pieces are kept safely while the house changes.';save();}}
  function update(timeMs:number,target:THREE.Vector3,hidden:boolean){
    now=timeMs;moodRoot.visible=!hidden&&open;mood.update(hidden||!open?Infinity:(now-moodStarted)/1000);if(observedHome!==options.home().blueprint){observedHome=options.home().blueprint;clearStale();revision++;}view.root.visible=!hidden;for(const item of placed.values())item.mesh.visible=!hidden;
    const frame=current?forgeRitualFrame(current.id,elapsed()):null;
    const waiting=preparing?{ritualId:'pending',phase:'words' as const,elapsed:(now-runStarted)/1000,phaseProgress:0,duration:21,source:'simulated' as const}:null;
    view.update(open?(waiting??frame):null, preparing?waitingStage==='drafting':!!frame&&frame.elapsed<5);
    if(frame&&frame.phase!==lastPhase){playForgeSound(options.sound,frame.phase);lastPhase=frame.phase;}
    if(current&&frame){
      if(frame.phase==='flight'){
        const t=THREE.MathUtils.smootherstep(frame.phaseProgress/CONTACT,0,1),from=options.anvil.clone().add(new THREE.Vector3(-current.bounds.getCenter(new THREE.Vector3()).x,1.6-current.bounds.min.y,-current.bounds.getCenter(new THREE.Vector3()).z));
        const world=from.lerp(current.destination,t);world.y+=Math.sin(Math.PI*t)*Math.min(28,10+options.anvil.distanceTo(current.destination)*.15);
        view.piece.position.copy(view.root.worldToLocal(world));view.piece.rotation.y=current.home.yaw*t;view.piece.visible=true;
      }
      if(open&&!hidden&&!preparing&&(frame.phase==='flight'||frame.phase==='landed')&&options.onFlight){
        const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
        if(reduced)options.onFlight(null,null);else{view.piece.updateWorldMatrix(true,false);const at=current.bounds.getCenter(new THREE.Vector3()).setY(current.bounds.max.y+.15).applyMatrix4(view.piece.matrixWorld);options.onFlight(frame,[at.x,at.y,at.z],current.destination.toArray());}
      }
      if(frame.phase==='landed'&&!current.committed){try{install(current);options.onArrival?.(current.home);}catch(error){privateError=String(error);current.geometry.dispose();current=null;}view.piece.visible=false;}
      if(frame.phase==='landed')view.piece.visible=false;
    }
    for(const item of placed.values())item.heat.update(item.receipt.id===current?.id?frame:null);
    if(!open||hidden||preparing||!frame||(frame.phase!=='flight'&&frame.phase!=='landed'))options.onFlight?.(null,null);
    const landed=[...placed.values()].filter(p=>p.result.emitterKind).map(p=>({position:p.emitter,kind:p.result.emitterKind!}));
    emitters.update({time:fixed??now/1000,anvil:options.anvil.clone().add(new THREE.Vector3(0,1.6,0)),activity:open&&frame?.phase==='pour'?1:0,fillHeight:current&&frame?.phase==='pour'?current.bounds.getSize(new THREE.Vector3()).y*frame.phaseProgress:0,landed:hidden?[]:landed,strike:frame?.phase==='strike'?1-frame.phaseProgress:0});
    if(!open||hidden)return;
    options.camera.clearViewOffset();const portrait=options.canvas.clientWidth<640;
    const size=current?current.bounds.getSize(new THREE.Vector3()):new THREE.Vector3(2,2,2);
    // Fit the complete casting and its anvil in both orientations, including the
    // wide sleeping body. Height alone cropped broad parts on narrow screens.
    const stageHeight=Math.max(4.8,1.6+size.y+2.7),stageTarget=options.anvil.clone().add(new THREE.Vector3(3.475,stageHeight*.5,-2.275));
    const halfFov=THREE.MathUtils.degToRad(43*.5),aspect=options.canvas.clientWidth/options.canvas.clientHeight;
    const backward=new THREE.Vector3(-7,2.4,11).normalize(),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),backward).normalize(),up=new THREE.Vector3().crossVectors(backward,right);
    let fit=8;
    for(const x of [-1.7,8.65])for(const y of [0,stageHeight])for(const z of [-6,1.45]){
      const corner=new THREE.Vector3(x-3.475,y-stageHeight*.5,z+2.275),depth=corner.dot(backward),tan=Math.tan(halfFov)*.87;
      fit=Math.max(fit,depth+Math.max(Math.abs(corner.dot(right))/(tan*aspect),Math.abs(corner.dot(up))/tan));
    }
    const stageEye=stageTarget.clone().add(backward.multiplyScalar(fit+.6));
    let look=stageTarget,eye=stageEye;
    if(!preparing&&current&&frame&&(frame.phase==='flight'||frame.phase==='landed')){
      const roof=current.bounds.clone().translate(new THREE.Vector3(...current.result.socket.origin).multiplyScalar(.125));
      const homeShot=forgeHomeShot(buildBounds(current.home.blueprint),roof,new THREE.Vector3(...current.home.position),current.home.yaw,
        options.canvas.clientWidth,options.canvas.clientHeight,Math.max(0,frame.elapsed-LANDED_START));
      const homeEye=homeShot.target.clone().add(homeShot.offset);
      if(frame.phase==='flight'){
        view.piece.updateWorldMatrix(true,false);
        const shot=forgeFlightShot(buildBounds(current.home.blueprint),current.bounds,view.piece.matrixWorld,
          new THREE.Vector3(...current.home.position),current.home.yaw,options.canvas.clientWidth,options.canvas.clientHeight,frame.phaseProgress);
        look=shot.target;eye=look.clone().add(shot.offset);
      }else{look=homeShot.target;eye=homeEye;}
    }
    if(portrait)eye=look.clone().add(eye.clone().sub(look).multiplyScalar(1.22));
    options.camera.position.copy(eye);target.copy(look);options.camera.fov=43;
    // Keep the object above the prompt card while retaining a real town horizon.
    options.camera.setViewOffset(options.canvas.clientWidth,options.canvas.clientHeight,portrait?0:-105,portrait?105:15,options.canvas.clientWidth,options.canvas.clientHeight);options.camera.updateProjectionMatrix();publishStatus();
  }
  async function refit(){
    if(preparing||current&&!current.committed)return;const receipt=[...kept.values()].at(-1);if(!receipt)return;
    preparing=true;privateError=null;publishStatus();
    try{const work=await make(receipt.plan,receipt.kitId.replace('-native','') as StyleKey);work.id=receipt.id;work.approval=receipt.approval;if(receipt.provenance)work.provenance=receipt.provenance;install(work);current=work;view.setPiece(work.geometry,work.bounds,work.destination);fixed=21;options.sound.cue('wood');}
    catch{privateError='This piece is kept safely. The house still needs a clear socket for it.';}finally{preparing=false;publishStatus();}
  }
  function castingHeat(){
    if(!open||preparing||!current||current.committed||!view.root.visible)return 0;
    const frame=forgeRitualFrame(current.id,elapsed());
    return frame.phase==='pour'||frame.phase==='strike'?1:frame.phase==='seal'?.85:frame.phase==='cool'?1-frame.phaseProgress:0;
  }
  return {prepare,submit,update,status,refit,setEnvironment:view.setEnvironment,
    get heat(){return castingHeat();},
    sources():readonly {position:Vec3;normal:Vec3;strength:number}[]{
      const strength=castingHeat();
      if(strength<=0)return [];
      // Match the room-fed casting: the metal lights the actual paving and faces,
      // rather than glowing only in the post stack.
      return [
        {position:[options.anvil.x,options.anvil.y+1.88,options.anvil.z],normal:[0,1,0],strength},
        {position:[options.anvil.x-.5,options.anvil.y+1.73,options.anvil.z-.4],normal:[-1,0,0],strength},
      ];
    },
    captureAudio:()=>{if(options.source!=='simulated')throw new Error('Offline audio is only available in the local simulation.');return renderForgeRitualAudio();},get renderRevision(){return open||placed.size?(fixed??now)+revision:revision;},get placements(){return [...placed.values()].map(p=>p.receipt);},
    open(){if(options.source!=='simulated')return;clearStale();open=true;options.sound.unlock();options.sound.cue('wood');publishStatus();},
    close(){if(now<refusalUntil||preparing||current&&!current.committed)return;open=false;options.camera.clearViewOffset();publishStatus();},
    seek(seconds:number){if(options.source!=='simulated'||!current)return;fixed=Math.max(0,seconds);revision++;},
    dispose(){disposed=true;options.onFlight?.(null,null);runAbort.abort();for(const p of placed.values()){p.unshadow?.();p.mesh.geometry.dispose();(p.mesh.material as THREE.Material).dispose();options.scene.remove(p.mesh);}if(current&&!current.committed)current.geometry.dispose();mood.dispose();options.scene.remove(moodRoot);moodCaption.remove();view.dispose();emitters.dispose();pieceMaterial.dispose();},
  };
}
