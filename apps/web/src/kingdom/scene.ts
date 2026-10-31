import * as THREE from 'three';
import { createKingdomForge, type ForgeStatus } from '../forge/scene';
import { createRealmForgeScene } from '../forge/realm-scene';
import type { RealmForgeFeed } from '../realm/adapters/forge-feed';
import { createTree, MATERIALS } from '@chatdom/content';
import { VoxelWorkerPool, type AssetChunkMesh } from '@chatdom/voxel';
import { createAtmosphere, getEnvironment, createVoxelMaterial, geometryFromChunks, createWindowLights, createPostStack, type WindowHouse } from '@chatdom/render';
import { generateSettlementPlan, terrainHeight, samplePublicGround, randomUnit, seedHash, type KingdomTier, type SettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import type { KingdomId, KingdomPresenceFrame, Vec3, VoxelBlueprint, PresenceFeed } from '@chatdom/shared';
import { CitizenChatCueSchema, PRESENCE_LEASE_MS } from '@chatdom/shared';
import { createSimulatedPresence, createHeraldPresence } from './presence-feed';
import { loadTerrain } from './terrain-client';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from './terrain-worker';
import { createLightField } from './light-field';
import { createKingdomSound } from './sound';
import { windowOccluded } from './visibility';
import { advanceDetailTransition, type DetailTransition, type DetailLevel } from './detail-transition';
import { createHorizonSurface } from './horizon';
import { createSunShadows } from '@chatdom/render';
import { beaconStrength } from './beacon';
import { placeSettlementContent, placeMarketContent } from './settlement-content';
import { createForgeSquareContent } from './forge-square-content';
import { createCastleContent } from './castle-content';
import { createGenesisWaterContent } from '../genesis/water-content';
import { sampleGenesisSurface } from '@chatdom/world/genesis';
import { inhabitedLightBounds } from './light-bounds';
import { terrainBatches } from './terrain-batches';
import { createKingdomBuild, type KingdomBuildSession } from './build-scene';
import { createKingdomCitizens, type CitizenSceneCheckpoint, type SpeechLabel } from './citizen-scene';
import { foundedContent } from './founded-content';
import { royalWindow } from './royal-window';
import { composeWindowCamera } from './window-camera';
import { composeRoyalCamera } from './royal-camera';
import { createHomeLife } from './home-life';
import { createRoyalLife } from './royal-life';
import { foundedLifeSites, foundedForgeSites, generatedHomeLifeSites } from './home-life-sites';
import { createForgeEmitters } from '../forge/emitters';
import { checkWalkBinding, createKingdomWalk, type KingdomWalkBinding, type WalkerLabel } from './walk-scene';
import { createObservedWalkers, walkerSlots } from './observed-walkers';
import type { RealmWalkerFeed } from '@chatdom/shared/realm';
import { createGroundDressing } from './ground-dressing';
import { planAdoptedCover } from './ground-dressing/adopted-cover';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { createFoundedInteractionRegistry } from '@chatdom/world/interactions';
import { sampleKingdomAmbience } from './ambience';
import type { AmbienceTarget } from './ambience/types';
import { createArrivalDirector, type ArrivalAttention } from './arrival-director';
import { createShoreDressing } from './shore-dressing';
import { createKingdomMoments } from './moments';
import type { ScreenCaption, TwitchMomentFeed } from '../twitch-moments';
import { createWaterSurface } from '../places/water/surface';
import { deriveWaterReaches } from '../../../../packages/world/src/places/water/reaches';

// One short-lived presentation handoff keeps a scene revision from sending neighbours back home.
let citizenHandoff: { at: number; checkpoint: CitizenSceneCheckpoint } | undefined;

export type CameraName='hero'|'window'|'citizen';
export interface NameLabel {name:string;x:number;y:number;slot:number;arrivalAgeSeconds?:number}
export interface PotentialKingdomView {plan:SettlementPlan;size:string;style:'hearth'|'tide'|'grove';camera:{eye:Vec3;target:Vec3;fov:number};/** Local SIMULATED lighting only; never crowd presence or a deed. */windowPreview?:KingdomPresenceFrame}
export interface SceneOptions {potential?:PotentialKingdomView;momentFeed?:TwitchMomentFeed;onMomentCaptions?:(captions:readonly ScreenCaption[])=>void;directArrivals?:boolean;onArrival?:(shot:Pick<ArrivalAttention,'slot'|'phase'>|null)=>void;founded?:RealmFoundedScene;presenceFeed?:PresenceFeed;forgeFeed?:RealmForgeFeed;walkerFeed?:RealmWalkerFeed;onWalkers?:(labels:readonly WalkerLabel[])=>void;realmName?:string;forgeFamily?:'hearth'|'tide'|'grove';nativeStyle?:'hearth'|'tide'|'grove';tier:KingdomTier;seed:string;firstYear?:number;year?:number;kingdomId?:KingdomId;focusSlot?:number;hour:number;time:number|null;camera:CameraName;source:'simulated'|'herald';presenceOrigin?:KingdomPresenceFrame['origin'];signal?:AbortSignal;onReady?:()=>void;onForge?:(status:ForgeStatus)=>void;onProgress:(text:string,fraction:number)=>void;onNames:(names:NameLabel[])=>void;onSpeech?:(labels:SpeechLabel[])=>void;onBuild?:(session:KingdomBuildSession|null)=>void;onHousewarming?:(name:string|null)=>void;onSource:(state:string)=>void;onError:(message:string)=>void}
export interface KingdomDebug {post?:ReturnType<ReturnType<typeof createPostStack>['diagnostics']>;citizens:number;walking:number;ready:boolean;lightingReady:boolean;workers:number;homes:number;activeWindows:number;geometryBuilds:number;fieldUploads:number;drawCalls:number;triangles:number;time:number;hour:number;camera:CameraName;fieldBytes:number;source:string;fieldSettled:boolean;shadowUpdates:number;shadowDrawCalls:number;shadowTriangles:number;shadowBytes:number;shadowEnabled:boolean;windowFieldVisited:number;beaconFieldVisited:number}

export async function createKingdomScene(canvas:HTMLCanvasElement,options:SceneOptions) {
  let disposed=false,raf=0,loaded=false,forgeCameraDirected=false,lastFrame=performance.now(),time=options.time??30,hour=options.hour,targetHour=hour,camName=options.camera;
  let capturePose:{eye:Vec3;target:Vec3;fov:number}|null=null;
  let poseRevision=0;
  // A public feed uses the wall clock even when a capture URL carries a fixture time.
  let fixedTime=options.source==='simulated'&&!options.presenceFeed&&options.time!==null,autoCamera=options.source==='simulated'&&!options.presenceFeed&&!fixedTime&&camName==='hero',frame:KingdomPresenceFrame|undefined,fieldUploads=0,geometryBuilds=0,fieldBytes=0,nearBytes=0,farBytes=0,beaconBytes=0,nearVisited=0,farVisited=0,beaconVisited=0;
  let walk:Awaited<ReturnType<typeof createKingdomWalk>>|undefined,walkSelected=false,walkGeneration=0;
  let observed:Awaited<ReturnType<typeof createObservedWalkers>>|undefined;
  let moments:ReturnType<typeof createKingdomMoments>|undefined,momentCameraDirected=false;
  const earlyCleanups:(()=>void)[]=[];
  let fullDispose:(()=>void)|undefined;
  const own=<T extends {dispose():void}>(resource:T):T=>{earlyCleanups.push(()=>resource.dispose());return resource;};
  const failLight=(message:string)=>queueMicrotask(()=>{if(disposed)return;fullDispose?.();options.onError(message);});
  try {
  if(options.founded?.origin==='live'&&!options.presenceFeed)throw new Error('A live kingdom needs its room-backed public presence');
  const generated=options.founded?.plan??options.potential?.plan??generateSettlementPlan({seed:options.seed,tier:options.tier,firstYear:options.firstYear??(options.tier==='hamlet'?2025:2022),year:options.year??2026});
  const layout=!options.founded&&!options.potential&&options.nativeStyle?{...generated,homes:generated.homes.map(h=>({...h,style:options.nativeStyle!}))}:generated;
  const renderer=own(new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'}));
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{console.error('Kingdom shader failed',{vertex:gl.getShaderInfoLog(vertex),fragment:gl.getShaderInfoLog(fragment),link:gl.getProgramInfoLog(program)});throw new Error('A kingdom shader could not compile');};
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.15,2200),atmosphere=own(createAtmosphere(scene));
  const post=own(createPostStack(renderer,scene,camera,{quality:canvas.clientWidth<600?'low':'high',toneMapping:'aces',fog:'material'}));
  const registry=options.founded?.materials??MATERIALS;
  const clay=own(createVoxelMaterial(registry,'build')),ground=own(createVoxelMaterial(registry,'terrain'));
  // Both lattices share one GPU light volume; two materials must not double the field budget.
  for(const key of ['uLight','uLightOrigin','uLightExtent','uFarLight','uFarOrigin','uFarExtent','uFarCell','uBeaconLight','uBeaconOrigin','uBeaconExtent','uBeaconCell','uBeaconPosition','uBeaconStrength'])ground.material.uniforms[key]=clay.material.uniforms[key]!;
  const heightOrigin:[number,number]=[Math.floor(layout.bounds.minX)-20,Math.floor(layout.bounds.minZ)-20];
  const heightWidth=Math.ceil(layout.bounds.maxX-heightOrigin[0])+21,heightDepth=Math.ceil(layout.bounds.maxZ-heightOrigin[1])+21,heightData=new Float32Array(heightWidth*heightDepth);
  for(let z=0;z<heightDepth;z++)for(let x=0;x<heightWidth;x++)heightData[x+z*heightWidth]=terrainHeight(layout,heightOrigin[0]+x,heightOrigin[1]+z);
  ground.setTerrainHeight(heightData,heightWidth,heightDepth,heightOrigin,1);ground.setShoreLevel(layout.lake.level,[layout.lake.x-layout.lake.radiusX*1.3,layout.lake.x+layout.lake.radiusX*1.3,layout.lake.z-layout.lake.radiusZ*1.3,layout.lake.z+layout.lake.radiusZ*1.3]);
  const pool=own(new VoxelWorkerPool({size:Math.min(4,Math.max(2,(navigator.hardwareConcurrency||4)-1)),maxQueue:192}));
  const geometries:THREE.BufferGeometry[]=[],meshes:THREE.Object3D[]=[],abort=new AbortController();
  earlyCleanups.push(()=>abort.abort());
  const sound=own(createKingdomSound());
  const blueprints=new Map<string,VoxelBlueprint>();
  const installed=options.founded?foundedContent(options.founded):undefined;
  // Use the installed market cask as a real raised viewing spot, never a phantom support.
  const stores=installed?.props.find(prop=>/^civic-(hearth|tide)-market-stores$/.test(prop.blueprint.id));
  const barrelCentre=stores?new THREE.Vector3(.5,0,.625).applyAxisAngle(new THREE.Vector3(0,1,0),stores.yaw).add(new THREE.Vector3(...stores.position)):undefined;
  const forgeBarrel=barrelCentre&&barrelCentre.distanceTo(new THREE.Vector3(0,layout.market.elevation,8))<13?{position:barrelCentre.toArray() as Vec3,height:11/8}:undefined;
  const previousCitizens=citizenHandoff;citizenHandoff=undefined;
  const crowd=own(createKingdomCitizens(scene,layout,pool,clay,!!installed&&!!royalWindow(installed.forgeHosts),previousCitizens&&Date.now()-previousCitizens.at<60000?previousCitizens.checkpoint:undefined,forgeBarrel));
  const renderKeys=new Map(options.founded?.assets.map(asset=>[asset.blueprint,asset.assetHash]));
  const blueprintKey=(b:VoxelBlueprint)=>renderKeys.get(b)??b.id;
  const {houses,props}=installed??placeSettlementContent(layout.homes,(x,z)=>terrainHeight(layout,x,z));
  const simulatedSmithy=!installed&&!options.potential?createForgeSquareContent(layout.market.elevation):undefined;
  if(simulatedSmithy)props.push(...simulatedSmithy.props);
  // Keep the meeting of the roads open. The market's well and two stalls sit
  // along its edges, as real voxel geometry in the same shadow/occlusion lists.
  if(!installed){
    const marketProps=placeMarketContent(layout.market);
    if(options.potential){
      const centre=layout.nodes.find(node=>node.id===layout.market.nodeId)!.position;
      for(const prop of marketProps)props.push({...prop,position:[prop.position[0]+centre[0],prop.position[1],prop.position[2]+centre[2]-10]});
    }else props.push(...marketProps);
  }
  if(options.potential)props.push(...createGenesisWaterContent(layout));
  const {buildings:castleBuildings,beaconPosition}=createCastleContent(layout.castle,options.potential?.style);
  const buildings=installed?houses:[...houses,...castleBuildings],content=installed?.content??[...buildings,...props];
  for(const {blueprint} of content)blueprints.set(blueprintKey(blueprint),blueprint);
  const royal=installed?royalWindow(installed.forgeHosts):undefined;
  const presenceHouses=royal?[...houses,royal]:[...houses];
  const lifeSites=options.founded?foundedLifeSites(options.founded):{homes:generatedHomeLifeSites(houses),braziers:[],standard:undefined};
  const homeLife=own(createHomeLife(scene,lifeSites.homes));
  const forgeSites=options.founded?foundedForgeSites(options.founded):simulatedSmithy??{fires:[],noses:[]};
  const forgeHearth=own(createRoyalLife(scene,clay,undefined,forgeSites.fires.filter(site=>site.normal[1]===0),undefined,true));
  const forgeFire=own(createRoyalLife(scene,clay,undefined,forgeSites.fires.filter(site=>site.normal[1]!==0),undefined,false,true));
  const forgeBreath=own(createForgeEmitters(scene));
  const windows=own(createWindowLights(scene,presenceHouses));
  // Begin the arrival among neighbours, not alone at the newest edge of town.
  const arrivalHomes=layout.homes.filter(h=>h.tier==='house');
  const arrivalHome=arrivalHomes.sort((a,b)=>{
    const neighbours=(home:typeof a)=>layout.homes.filter(h=>Math.hypot(h.position[0]-home.position[0],h.position[2]-home.position[2])<35).length;
    return neighbours(b)-neighbours(a)||Math.hypot(a.position[0],a.position[2])-Math.hypot(b.position[0],b.position[2]);
  })[0];
  const simulation=createSimulatedPresence(layout,arrivalHome?{firstSlot:arrivalHome.slot,waveSeconds:6}:undefined);
  const source=options.presenceFeed??(options.source==='simulated'?simulation.feed:createHeraldPresence('/presence-data/stream',options.kingdomId,options.presenceOrigin??'live'));
  const ownSimulation=options.source==='simulated'&&!options.presenceFeed;
  const arrivalDirector=options.directArrivals?createArrivalDirector():undefined;
  let arrivalCameraDirected=false,arrivalShot:ArrivalAttention|undefined,arrivalBlend=0,arrivalKey='';
  const arrivalEye=new THREE.Vector3(),arrivalTarget=new THREE.Vector3(),arrivalWantedEye=new THREE.Vector3(),arrivalWantedTarget=new THREE.Vector3();
  let arrivalFov=48,homeFov=64;
  const first=houses.find(h=>h.slot===simulation.firstSlot)!;
  const requestedFocus=presenceHouses.some(h=>h.slot===options.focusSlot)?options.focusSlot:undefined;
  let focusSlot=requestedFocus??(options.source==='simulated'?simulation.firstSlot:houses[0]!.slot);
  const focal=new THREE.Vector3(),homeEye=new THREE.Vector3(),homeTarget=new THREE.Vector3(),citizenEye=new THREE.Vector3();
  function focusHome(slot:number){
    const home=presenceHouses.find(h=>h.slot===slot),route=crowd.motion.routeForSlot(slot);if(!home||!route)return;
    focusSlot=slot;homeFov=64;const pane=home.blueprint.windows[0]??{centre:[home.blueprint.size[0]/2,Math.min(14,home.blueprint.size[1]/2),home.blueprint.size[2]],facing:'south' as const};
    focal.set(...pane.centre).multiplyScalar(.125).applyAxisAngle(new THREE.Vector3(0,1,0),home.yaw).add(new THREE.Vector3(...home.position));
    const angle=({north:Math.PI,east:Math.PI/2,south:0,west:-Math.PI/2}[pane.facing])+home.yaw;
    homeEye.copy(focal).add(new THREE.Vector3(Math.sin(angle)*7+1.8,2.1,Math.cos(angle)*7));
    homeTarget.copy(focal).add(new THREE.Vector3(Math.cos(angle)*1.3,1.1,-Math.sin(angle)*1.3));
    if(home!==royal){const pose=composeWindowCamera(home,route.points.at(-1)!,camera.aspect,angle);homeEye.copy(pose.eye);homeTarget.copy(pose.target);}
    else {const pose=composeRoyalCamera(home);homeEye.copy(pose.eye);homeTarget.copy(pose.target);homeFov=pose.fov;}
    citizenEye.set(...route.points.at(-1)!).add(new THREE.Vector3(Math.sin(angle)*6.5-Math.cos(angle)*13,5.5,Math.cos(angle)*6.5+Math.sin(angle)*13));
  }
  focusHome(focusSlot);
  const heroEye=new THREE.Vector3(),heroTarget=new THREE.Vector3(),target=new THREE.Vector3();
  const portrait=()=>canvas.clientWidth<canvas.clientHeight;
  let heroFov=53;
  function setHero(){
    if(options.potential){
      heroEye.set(...options.potential.camera.eye);heroTarget.set(...options.potential.camera.target);
      heroFov=options.potential.camera.fov+(portrait()?12:0);return;
    }
    // Look north from the inhabited streets: the castle crowns the scene and
    // the pitched fronts stay legible below it, rather than becoming roof dots.
    const market=layout.nodes.find(node=>node.id===layout.market.nodeId)!.position;
    const hamlet=options.tier==='hamlet';
    heroEye.set(market[0]+(portrait()?hamlet?64:150:hamlet?-65:-110),market[1]+(hamlet?31:portrait()?36:40),market[2]+(hamlet?118:160));
    heroTarget.set(layout.castle.centre[0],layout.castle.centre[1]+9,portrait()?-35:market[2]-8);
    camera.fov=portrait()?58:52;
    heroFov=camera.fov;camera.updateProjectionMatrix();
  }
  const sunShadows=own(createSunShadows(renderer,{bounds:new THREE.Box3(new THREE.Vector3(layout.bounds.minX-40,-8,layout.bounds.minZ-70),new THREE.Vector3(layout.bounds.maxX+40,60,layout.bounds.maxZ+20)),resolution:portrait()?1024:2048}));
  sunShadows.bindReceiver(clay.material);sunShadows.bindReceiver(ground.material);sunShadows.bindReceiver(crowd.material.material);
  const royalLife=own(createRoyalLife(scene,clay,installed?.forgeHosts.find(home=>home.slot===65534),lifeSites.braziers,lifeSites.standard));
  if(royalLife.keepMaterial)sunShadows.bindReceiver(royalLife.keepMaterial);
  if(royalLife.standardMaterial)sunShadows.bindReceiver(royalLife.standardMaterial);
  function resize(){renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);post.resize(canvas.clientWidth,canvas.clientHeight,renderer.getPixelRatio());camera.aspect=canvas.clientWidth/canvas.clientHeight;setHero();focusHome(focusSlot);walk?.controller.resize(canvas.clientWidth,canvas.clientHeight);sunShadows.setResolution(portrait()?1024:2048);}
  const observer=new ResizeObserver(resize);earlyCleanups.push(()=>observer.disconnect());observer.observe(canvas);resize();
  const blockers=installed?[...houses,...props.map(p=>({...p,slot:65534}))]:buildings;
  const lightBounds=inhabitedLightBounds(layout.homes);
  // Personal keep warmth belongs to the same field as street windows, outside the street-home bounds.
  for(const source of windows.getSources()){
    lightBounds.minX=Math.min(lightBounds.minX,source.position[0]-16);lightBounds.maxX=Math.max(lightBounds.maxX,source.position[0]+16);
    lightBounds.minZ=Math.min(lightBounds.minZ,source.position[2]-16);lightBounds.maxZ=Math.max(lightBounds.maxZ,source.position[2]+16);
  }
  const nearBlockers=installed?blockers:[...blockers,...props.map(p=>({...p,slot:65534}))];
  // Half-metre local occupancy resolves the little garden edges. Expanding a
  // sub-two-metre prop into whole distant cells would falsely seal the street.
  const field=own(createLightField(layout,nearBlockers,volume=>{if(disposed)return;clay.setLight(volume);fieldUploads++;nearBytes=volume.estimatedPeakBytes;nearVisited=volume.visited;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The light could not reach the kingdom')));
  const farField=own(createLightField(layout,blockers,volume=>{if(disposed)return;clay.setFarLight(volume);fieldUploads++;farBytes=volume.estimatedPeakBytes;farVisited=volume.visited;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The light could not reach the kingdom'),{mode:'kingdom',bounds:lightBounds}));
  const beaconField=own(createLightField(layout,blockers,volume=>{if(disposed)return;clay.setBeaconLight(volume);fieldUploads++;beaconBytes=volume.estimatedPeakBytes;beaconVisited=volume.visited;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The castle light could not reach its towers'),{mode:'beacon',position:beaconPosition}));
  let lastField=-Infinity,lastNames=-Infinity,lastActive=0,beaconCue=false;
  let presenceInterrupted=false,presenceExpiresAt=0;
  const unsubscribe=source.subscribe(next=>{presenceInterrupted=false;presenceExpiresAt=Math.min(Date.now()+PRESENCE_LEASE_MS,next.asOf+PRESENCE_LEASE_MS);frame=next;crowd.applyFrame(next);arrivalDirector?.observe(next,Date.now());if((options.source==='herald'||next.origin==='live')&&requestedFocus===undefined){const present=next.windows.find(w=>w.present&&presenceHouses.some(h=>h.slot===w.slot));if(present)focusHome(present.slot);}lastField=-Infinity;options.onSource(next.origin==='simulated'?'SIMULATED':next.connection==='fresh'?'LIVE CHAT':next.connection==='offline'?'STREAM RESTING':'CONNECTION LOST');},()=>{presenceInterrupted=true;arrivalDirector?.cancel();options.onSource('CONNECTION LOST');});
  earlyCleanups.push(unsubscribe);
  const debug:KingdomDebug={citizens:0,walking:0,ready:false,lightingReady:false,workers:pool.stats.size+4,homes:houses.length,activeWindows:0,geometryBuilds:0,fieldUploads:0,drawCalls:0,triangles:0,time:0,hour,camera:camName,fieldBytes:0,source:source.label,fieldSettled:false,shadowUpdates:0,shadowDrawCalls:0,shadowTriangles:0,shadowBytes:0,shadowEnabled:false,windowFieldVisited:0,beaconFieldVisited:0};
  type Placement={position:Vec3;yaw:number;placementId?:string};
  const hiddenAttachments=new Set<string>();
  type RenderBatch={transitions:Map<Placement,DetailTransition>;blueprint:VoxelBlueprint;placements:readonly Placement[];levels:Map<number,THREE.InstancedMesh>};
  const batches=new Map<string,RenderBatch>();
  let buildHidden=false;
  let instancesDirty=true;
  const build=own(createKingdomBuild({scene,camera,canvas,pool,material:clay,home:layout.homes.find(h=>h.slot===simulation.firstSlot)!,authoredHome:first,
    ownerId:`simulated:${options.seed}:${options.tier}:juniper`,ownerName:'Juniper',source:!installed&&options.source==='simulated'?'SIMULATED':'LIVE',sound,
    onSession:session=>options.onBuild?.(session),onHousewarming:name=>options.onHousewarming?.(name),
    onHomeVisibility:hidden=>{buildHidden=hidden;windows.setHidden(simulation.firstSlot,hidden);refreshOwnHomeShadow();instancesDirty=true;lastLightFrameKey='';lastField=-Infinity;sunShadows.invalidate();},
    onStreetHome:replacement=>{if(disposed)return;for(const list of [houses,blockers,nearBlockers]){const i=list.findIndex(h=>h.slot===simulation.firstSlot);if(i>=0)list[i]=replacement??first;}field.replaceHouses(nearBlockers);farField.replaceHouses(blockers);beaconField.replaceHouses(blockers);lastField=-Infinity;},registerShadow:mesh=>sunShadows.register(mesh),
  }));
  const forge=own(createKingdomForge({scene,camera,canvas,pool,material:clay,anvil:new THREE.Vector3(0,layout.market.elevation,8),home:()=>build.streetHome??first,source:installed?'herald':options.source,seed:`${options.seed}:${options.tier}`,kingdomName:options.realmName??'Willowmere',family:options.forgeFamily??'tide',sound,onArrival:home=>{
    if(options.source!=='simulated'||!frame)return;
    const at=simulation.epochMs+time*1000,near=frame.windows.filter(w=>w.present).map(w=>({window:w,house:houses.find(h=>h.slot===w.slot)})).filter(p=>p.house&&p.house.slot!==home.slot).sort((a,b)=>Math.hypot(a.house!.position[0]-home.position[0],a.house!.position[2]-home.position[2])-Math.hypot(b.house!.position[0]-home.position[0],b.house!.position[2]-home.position[2])).slice(0,2);
    near.forEach(({window},i)=>crowd.receiveChat({version:1,id:`simulated-forge-${Math.floor(at)}-${i}`,kingdomId:frame!.kingdomId,epoch:frame!.epoch,origin:'simulated',slot:window.slot,asOf:Math.floor(at),expiresAt:Math.floor(at+9000),parts:[{kind:'text',text:i?'It belongs here. ✨':'Oh, look at that!'}]}));
  },onStatus:status=>options.onForge?.(status),registerShadow:mesh=>sunShadows.register(mesh)}));
  const realmForge=options.forgeFeed?own(createRealmForgeScene({scene,camera,canvas,pool,material:clay,
    anvil:new THREE.Vector3(0,layout.market.elevation,8),home:slot=>(installed?.forgeHosts??houses).find(home=>home.slot===slot),sound,feed:options.forgeFeed,
    hideAttachment:(id,hidden)=>{if(hidden)hiddenAttachments.add(`forge:${id}`);else hiddenAttachments.delete(`forge:${id}`);instancesDirty=true;sunShadows.invalidate();},
    registerShadow:mesh=>sunShadows.register(mesh),
  })):undefined;
  function refreshOwnHomeShadow(){
    if(disposed)return;
    const batch=batches.get(blueprintKey(first.blueprint)),mesh=batch?.levels.get(1);if(!batch||!mesh)return;
    mesh.count=0;const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
    for(const placement of batch.placements){if(buildHidden&&placement===first)continue;matrix.compose(new THREE.Vector3(...placement.position),rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),placement.yaw),new THREE.Vector3(1,1,1));mesh.setMatrixAt(mesh.count++,matrix);}
    sunShadows.register(mesh);instancesDirty=true;
  }
  function instance(blueprint:VoxelBlueprint,chunks:readonly AssetChunkMesh[],placements:readonly Placement[],factor:1|2|4=1){
    const geometry=geometryFromChunks(chunks,'build');geometry.setAttribute('aLodFade',new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1),1));geometries.push(geometry);
    const keepMesh=installed?.forgeHosts.some(home=>home.slot===65534&&blueprintKey(home.blueprint)===blueprintKey(blueprint));
    const standardMesh=lifeSites.standard&&blueprintKey(lifeSites.standard.blueprint)===blueprintKey(blueprint);
    const mesh=new THREE.InstancedMesh(geometry,standardMesh&&royalLife.standardMaterial?royalLife.standardMaterial:keepMesh&&royalLife.keepMaterial?royalLife.keepMaterial:clay.material,placements.length);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3();
    placements.forEach((p,i)=>{m.compose(v.set(...p.position),q.setFromAxisAngle(new THREE.Vector3(0,1,0),p.yaw),new THREE.Vector3(factor,factor,factor));mesh.setMatrixAt(i,m);});
    mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.name=blueprint.id;scene.add(mesh);meshes.push(mesh);geometryBuilds++;
    if(factor===(blueprint.kind==='flora'?2:1))sunShadows.register(mesh);
    const batch=batches.get(blueprintKey(blueprint))??{transitions:new Map<Placement,DetailTransition>(),blueprint,placements,levels:new Map<number,THREE.InstancedMesh>()};
    batch.levels.set(factor,mesh);batches.set(blueprintKey(blueprint),batch);instancesDirty=true;
  }
  const lastInstanceEye=new THREE.Vector3(Infinity,Infinity,Infinity),lastInstanceTarget=new THREE.Vector3(),lastInstanceRotation=new THREE.Quaternion(),lastInstanceProjection=new THREE.Matrix4(),frustum=new THREE.Frustum();
  let lastInstanceAspect=0;
  function updateInstances(now:number){
    if(!instancesDirty&&lastInstanceEye.distanceToSquared(camera.position)<.00001&&lastInstanceTarget.distanceToSquared(target)<.00001&&lastInstanceAspect===camera.aspect&&lastInstanceRotation.equals(camera.quaternion)&&lastInstanceProjection.equals(camera.projectionMatrix))return;
    instancesDirty=false;lastInstanceEye.copy(camera.position);lastInstanceTarget.copy(target);lastInstanceAspect=camera.aspect;lastInstanceRotation.copy(camera.quaternion);lastInstanceProjection.copy(camera.projectionMatrix);
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),centre=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0);
    for(const {blueprint,placements,levels,transitions} of batches.values()){
      for(const mesh of levels.values())mesh.count=0;
      const conservativeSize=new THREE.Vector3(...blueprint.size.map(axis=>Math.ceil(axis/4)*4)).multiplyScalar(.125),radius=conservativeSize.length()/2;
      for(const p of placements){
        if((buildHidden&&p===first)||(p.placementId&&hiddenAttachments.has(p.placementId)))continue;
        centre.copy(conservativeSize).multiplyScalar(.5).applyAxisAngle(axis,p.yaw).add(new THREE.Vector3(...p.position));
        if(!frustum.intersectsSphere(new THREE.Sphere(centre,radius)))continue;
        const distance=Math.max(0,camera.position.distanceTo(centre)-radius);
        const wanted=distance<(portrait()?22:32)?1:distance<(portrait()?55:95)?2:4;
        const available=[wanted,4,2,1].find(level=>levels.has(level))! as DetailLevel;
        const state=advanceDetailTransition(transitions.get(p),available,now,fixedTime&&!autoCamera);
        transitions.set(p,state);
        const progress=state.progress,fading=state.active;
        if(fading)instancesDirty=true;
        const add=(level:number,fade:number)=>{const mesh=levels.get(level)!;
          matrix.compose(new THREE.Vector3(...p.position),rotation.setFromAxisAngle(axis,p.yaw),new THREE.Vector3(level,level,level));
          mesh.setMatrixAt(mesh.count,matrix);(mesh.geometry.getAttribute('aLodFade') as THREE.InstancedBufferAttribute).setX(mesh.count,fade);mesh.count++;
        };
        add(state.to,fading?progress:1);if(fading)add(state.from,-1-progress);
        if('slot' in p)windows.setDetail((p as WindowHouse).slot,state.from,state.to,state.progress);
        else if(royal&&p.position===royal.position)windows.setDetail(royal.slot,state.from,state.to,state.progress);
      }
      for(const mesh of levels.values()){mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;(mesh.geometry.getAttribute('aLodFade') as THREE.InstancedBufferAttribute).needsUpdate=true;}
    }
  }
  // Distant hills use 20 m cells on both sizes; the grounded 1 m collar stays
  // exact. One surface/sampler keeps groves grounded across viewport changes.
  const {geometry:horizonGeometry,sampleHeight:landHeight}=createHorizonSurface(layout,{farStep:20,distantRelief:!layout.genesisSurface,sampleTerrain:(x,z)=>terrainHeight(layout,x,z)});earlyCleanups.push(()=>horizonGeometry.dispose());
  const coverInput={ground:landHeight,
    waterKeepOut:(x:number,z:number,margin:number)=>Math.hypot((x-layout.lake.x)/(layout.lake.radiusX+margin),(z-layout.lake.z)/(layout.lake.radiusZ+margin))<1.19,
    occupied:content,keepClear:[{x:0,z:8,radius:7}]};
  const coverPlan=planAdoptedCover(layout,coverInput);
  const dressing=own(createGroundDressing({...coverInput,land:{plan:layout,sites:[],places:{court:{boundary:layout.castle.court.boundary}}},
    seed:layout.config.seed,tier:layout.config.tier,plan:coverPlan,scene,camera,pool,clay,signal:abort.signal,
    registerShadow:mesh=>sunShadows.register(mesh)}));
  const trees=installed?[]:[createTree(0),createTree(1),createTree(2)];
  const treePlaces=trees.map(()=>[] as {position:Vec3;yaw:number}[]);
  const treeCount=options.tier==='hamlet'?115:260;
  const planted:THREE.Vector2[]=[];
  const rootHeight=(x:number,z:number)=>{
    let height=Infinity;
    for(const dx of [-1.25,0,1.25])for(const dz of [-1.25,0,1.25])height=Math.min(height,landHeight(x+dx,z+dz));
    return height;
  };
  // Index the full future reservations, so a growing home never needs a tree
  // removed from its address. Public ground supplies its own corridor widths.
  const reservationCells=new Map<string,typeof layout.reservations[number][]>(),indexStep=16,crown=4.25;
  for(const reservation of layout.reservations){
    const lot=reservation.lot;
    for(let z=Math.floor((lot.minZ-crown)/indexStep);z<=Math.floor((lot.maxZ+crown)/indexStep);z++)for(let x=Math.floor((lot.minX-crown)/indexStep);x<=Math.floor((lot.maxX+crown)/indexStep);x++){
      const key=`${x},${z}`,entries=reservationCells.get(key)??[];entries.push(reservation);reservationCells.set(key,entries);
    }
  }
  const plant=(x:number,z:number,variant:number)=>{
    if(layout.genesisSurface){
      const shore=sampleGenesisSurface(layout.genesisSurface,x,z);
      if(shore.waterLevel!==null||shore.shoreDistance<crown)return;
    }
    const nearby=reservationCells.get(`${Math.floor(x/indexStep)},${Math.floor(z/indexStep)}`)??[];
    if(nearby.some(({lot})=>x>lot.minX-crown&&x<lot.maxX+crown&&z>lot.minZ-crown&&z<lot.maxZ+crown))return;
    if((samplePublicGround(layout,x,z)?.reservedDistance??Infinity)<crown)return;
    const castle=layout.castle.bounds;
    if(x>castle.minX-crown&&x<castle.maxX+crown&&z>castle.minZ-crown&&z<castle.maxZ+crown)return;
    if(Math.hypot((x-layout.lake.x)/layout.lake.radiusX,(z-layout.lake.z)/layout.lake.radiusZ)<1.19)return;
    if(planted.some(p=>p.distanceToSquared(new THREE.Vector2(x,z))<8))return;
    planted.push(new THREE.Vector2(x,z));treePlaces[variant]!.push({position:[x-4,rootHeight(x,z),z-4],yaw:0});
  };
  const activeCourts=new Set(installed?[]:layout.homes.map(home=>home.courtId));
  for(const [i,court] of layout.courts.entries()){
    if(!activeCourts.has(court.id))continue;
    const anchor=layout.nodes.find(node=>node.id===court.nodeId)!;
    const radius=Math.max(...court.boundary.map(([x,z])=>Math.hypot(x-anchor.position[0],z-anchor.position[2])))+7;
    for(let side=0;side<8;side++){
      const angle=side*Math.PI/4;
      plant(anchor.position[0]+Math.cos(angle)*radius,anchor.position[2]+Math.sin(angle)*radius,(i+side)%3);
    }
  }
  for(let i=0;!installed&&i<treeCount*12&&planted.length<treeCount;i++) {
    const group=Math.floor(i/7),rand=(part:string)=>randomUnit(seedHash(`${options.seed}:grove:${part}`));
    const cx=layout.bounds.minX-35+rand(`${group}:x`)*(layout.bounds.maxX-layout.bounds.minX+70);
    const cz=layout.bounds.minZ-65+rand(`${group}:z`)*(layout.bounds.maxZ-layout.bounds.minZ+45);
    const angle=rand(`${i}:angle`)*Math.PI*2,radius=Math.sqrt(rand(`${i}:radius`))*10;
    plant(cx+Math.cos(angle)*radius,cz+Math.sin(angle)*radius,group%3);
  }
  // A continuous distant land silhouette lies beyond the detailed editable terrain.
  const horizonMaterial=own(new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:ground.material.uniforms,fragmentShader:ground.material.fragmentShader,vertexShader:`out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}`}));const horizon=new THREE.Mesh(horizonGeometry,horizonMaterial);scene.add(horizon);sunShadows.bindReceiver(horizonMaterial);sunShadows.register(horizon);
  // The v1 lake has no body record. Its terrain carves the shoreline within this
  // envelope; the supplied height grid clips the surface to the actual bed.
  const landform=layout.landform;
  const coast=layout.genesisSurface?.coast;
  const ocean=coast?(()=>{
    const shore=coast.shoreline[Math.floor(coast.shoreline.length/2)]!;
    const outward=([[0,1],[1,0],[0,-1],[-1,0]] as const)[coast.oceanToward];
    // The open-water envelope extends seaward, never over the inland horizon.
    return {id:'genesis-ocean',x:shore[0]+outward[0]*1200,z:shore[1]+outward[1]*1200,
      radiusX:coast.oceanToward%2?1240:2200,radiusZ:coast.oceanToward%2?2200:1240,level:0,depth:8};
  })():undefined;
  const bodies=landform.version===2?[...landform.waters,...(ocean?[ocean]:[])]:[{...landform.lake,id:'lake',radiusX:landform.lake.radiusX*1.3,radiusZ:landform.lake.radiusZ*1.3,depth:Math.max(0,landform.lake.level+2.8)}];
  let waterQuality:'reduced'|'full'=canvas.clientWidth<600?'reduced':'full';
  const water=own(createWaterSurface({bodies,reaches:landform.version===2?deriveWaterReaches(landform):[],ground:{data:heightData,width:heightWidth,height:heightDepth,origin:heightOrigin,step:1},quality:waterQuality,...(layout.genesisSurface?{outsideGroundHeight:-8}:{})}));
  scene.add(water.root);
  let waterFrame=0;
  const shore=own(createShoreDressing({scene,pool,clay,plan:layout,occupied:content,signal:abort.signal,registry,style:options.nativeStyle??options.forgeFamily??layout.homes[0]?.style??'hearth'}));
  function labels(){const names:NameLabel[]=[];for(const s of [...windows.getSources(),...build.getSources()]){
    if(!s.name||s.strength<.1)continue;const p=new THREE.Vector3(...s.position),to=camera.position.clone().sub(p);
    const royalPicture=s.slot===65534&&(camName==='window'||arrivalShot?.slot===65534&&arrivalShot.phase==='window');
    if('arrivalAgeSeconds' in s&&s.arrivalAgeSeconds>7&&to.length()>6&&!royalPicture)continue;
    if(to.length()>(royalPicture?90:32)||to.dot(new THREE.Vector3(...s.normal))<2)continue;
    if(windowOccluded(nearBlockers,[camera.position.x,camera.position.y,camera.position.z],s.position))continue;
    p.y+=royalPicture ? .45 : 1.1+('arrivalAgeSeconds' in s ? .22*(1-Math.exp(-s.arrivalAgeSeconds*2)):0);p.project(camera);if(p.z>1||p.z<0||Math.abs(p.x)>.91||Math.abs(p.y)>.88)continue;
    names.push({name:s.name,slot:s.slot,...('arrivalAgeSeconds' in s?{arrivalAgeSeconds:s.arrivalAgeSeconds}:{}),x:(p.x+1)*canvas.clientWidth/2,y:(1-p.y)*canvas.clientHeight/2});
  }const visible=names.slice(0,3);options.onNames(visible);return new Set(visible.map(name=>name.slot));}
  const fog=new THREE.FogExp2(0x000000);scene.fog=fog;
  let lastRenderedKey='',lastLightFrameKey='';
  let announcedReady=false;
  let renderPhase:'preparing'|'drawing'|'drawn'='preparing',renderStartedAt=0,renderCompletedAt=0;
  let lastAmbience=-Infinity,ambienceTarget:AmbienceTarget={wind:0,water:0,waterPan:0};
  const listenerRight=new THREE.Vector3();
  function render(now:number){
    if(disposed)return;try {const dt=Math.max(0,(now-lastFrame)/1000);lastFrame=now;
    if(loaded&&debug.ready&&!fixedTime)time+=dt;
    if(ownSimulation)simulation.advance(time);
    // A transport retry does not revoke a still-valid presence lease or send everyone home again.
    // Keep the last public picture while visibly disconnected; expiry still dims it and forgets names.
    if(presenceInterrupted&&frame&&Date.now()>=presenceExpiresAt){
      const expiredAt=Date.now();
      windows.setFrame({...frame,connection:'stale',asOf:expiredAt,windows:frame.windows.map(window=>({...window,present:false,publicName:null,since:expiredAt}))});
      crowd.clear();arrivalDirector?.clear();frame=undefined;
      lastLightFrameKey='';lastField=-Infinity;
    }
    hour+=Math.min(1,dt*4)*(targetHour-hour);if(Math.abs(targetHour-hour)<.001)hour=targetHour;const grade=getEnvironment(hour);clay.setEnvironment(grade);ground.setEnvironment(grade);forge.setEnvironment(grade);realmForge?.setEnvironment(grade);crowd.material.setEnvironment({...grade,ambientIntensity:Math.max(.65,grade.ambientIntensity)});
    const presentationMs=ownSimulation?simulation.epochMs+time*1000:Date.now();
    const walking=walk?.frame(now,walkSelected&&!capturePose&&!build.session&&!build.housewarming&&!forge.status().open)??false;
    observed?.frame(now);
    const feet=walkerSlots(walk ? walk.poses : observed?.poses??[]);
    crowd.watchForge(!!realmForge?.active()||forge.status().busy,presentationMs,[0,layout.market.elevation,8]);
    const night=THREE.MathUtils.smoothstep(Math.abs(((hour%24)+24)%24-12),4.2,6.5);
    const citizens=loaded?crowd.update(presentationMs,time,camera,build.session?new Set([simulation.firstSlot]):undefined,feet):[];
    const lightFrame=loaded?crowd.lightFrame(presentationMs):frame;
    if(lightFrame)build.setFrame(lightFrame);
    // Potential land may show an anonymous night painting, independently of its empty
    // presence feed. Never pass those preview lights to citizens, build or the room.
    const windowFrame=options.potential?.windowPreview??lightFrame;
    const lightKey=`${windowFrame?.epoch}:${windowFrame?.sequence}:${windowFrame?.windows.filter(w=>w.present).map(w=>w.slot).join(',')}`;
    if(windowFrame&&lightKey!==lastLightFrameKey){windows.setFrame(buildHidden?{...windowFrame,windows:windowFrame.windows.filter(w=>w.slot!==simulation.firstSlot)}:windowFrame);lastLightFrameKey=lightKey;lastField=-Infinity;}
    if(ownSimulation&&frame){const person=frame.windows.find(w=>w.slot===simulation.firstSlot);if(person?.present&&time>=3&&time<9)crowd.receiveChat({version:1,id:'simulated-evening',kingdomId:frame.kingdomId,epoch:frame.epoch,origin:'simulated',slot:simulation.firstSlot,asOf:simulation.epochMs+3000,expiresAt:simulation.epochMs+9000,parts:[{kind:'text',text:'Evening, everyone! 🌿'}]});}
    const arrival=crowd.subject(simulation.firstSlot);
    if(ownSimulation&&frame&&arrival?.homeLitAtMs&&presentationMs-arrival.homeLitAtMs<6000)crowd.receiveChat({version:1,id:'simulated-home',kingdomId:frame.kingdomId,epoch:frame.epoch,origin:'simulated',slot:simulation.firstSlot,asOf:Math.ceil(arrival.homeLitAtMs),expiresAt:Math.ceil(arrival.homeLitAtMs+6000),parts:[{kind:'text',text:'Home, at last. ✨'}]});
    windows.update(fixedTime?(autoCamera?0:1):dt,hour,presentationMs);
    const active=windowFrame?.windows.filter(w=>w.present).length??0;
    const beacon=beaconStrength(lightFrame,houses.length);
    clay.setBeaconSource(beaconPosition,beacon);
    if(loaded&&active>lastActive){if(lastActive===0)sound.cue('light');else if(lastActive===1)sound.cue('wave');}lastActive=active;
    if(loaded&&beacon>.9&&!beaconCue){sound.cue('beacon');beaconCue=true;}
    if(walking){const self=walk!.poses.find(p=>p.self);if(self)target.set(self.x,self.y+1,self.z);}
    else if(autoCamera){
      // Rise inside the street before withdrawing over the opposite roofs.
      const subject=crowd.subject(focusSlot),pull=THREE.MathUtils.smootherstep(time,18,36);
      if(subject){const p=new THREE.Vector3(...subject.position);camera.position.copy(citizenEye);target.copy(p).add(new THREE.Vector3(0,1.05,0));}
      else {camera.position.copy(homeEye);target.copy(homeTarget);}
      camera.position.lerp(heroEye,pull);target.lerp(heroTarget,pull);
    }
    else if(camName==='citizen'){const person=crowd.subject(focusSlot);const p=person?new THREE.Vector3(...person.position):focal.clone();camera.position.copy(citizenEye);target.copy(p).add(new THREE.Vector3(0,1.05,0));}
    else if(camName==='window'){camera.position.copy(homeEye);target.copy(homeTarget);}else{camera.position.copy(heroEye);target.copy(heroTarget);}
    const wantedFov=autoCamera?THREE.MathUtils.lerp(48,heroFov,THREE.MathUtils.smootherstep(time,18,36)):camName==='citizen'?48:camName==='window'?homeFov:heroFov;
    if(!walking&&Math.abs(camera.fov-wantedFov)>.001){camera.fov=wantedFov;camera.updateProjectionMatrix();}
    if(!installed){build.update(now,dt,hour,target);forge.update(now,target,!!build.session);}
    const forgeDirected=forgeCameraDirected=realmForge?.update(now,!walking&&!build.session&&!capturePose)??false;
    // A witnessed arrival owns only the stream lens. Walking, a chosen capture and the Forge always win.
    if(walking||build.session||capturePose||forgeDirected)arrivalDirector?.cancel();
    arrivalShot=loaded?arrivalDirector?.sample(presentationMs,slot=>crowd.subject(slot)):undefined;
    if(arrivalShot){
      focusHome(arrivalShot.slot);
      if(arrivalShot.phase==='window'){
        arrivalWantedEye.copy(homeEye);arrivalWantedTarget.copy(homeTarget);
      }else{
        const door=crowd.motion.routeForSlot(arrivalShot.slot)!.points.at(-1)!;
        arrivalWantedTarget.set(...arrivalShot.subject.position).add(new THREE.Vector3(0,1.05,0));
        arrivalWantedEye.copy(citizenEye).sub(new THREE.Vector3(...door)).multiplyScalar(.65).add(new THREE.Vector3(...arrivalShot.subject.position));
      }
      if(arrivalBlend===0){arrivalEye.copy(camera.position);arrivalTarget.copy(target);arrivalFov=camera.fov;}
      const follow=1-Math.exp(-dt*2.8);
      arrivalEye.lerp(arrivalWantedEye,follow);arrivalTarget.lerp(arrivalWantedTarget,follow);
      arrivalFov+=( (arrivalShot.phase==='window'?homeFov:48)-arrivalFov)*follow;
    }
    const permitted=!walking&&!build.session&&!capturePose&&!forgeDirected;
    arrivalBlend=permitted?THREE.MathUtils.clamp(arrivalBlend+(arrivalShot?1:-1)*dt/1.2,0,1):0;
    arrivalCameraDirected=arrivalBlend>0;
    if(arrivalCameraDirected){
      const blend=THREE.MathUtils.smoothstep(arrivalBlend,0,1);
      camera.position.lerp(arrivalEye,blend);target.lerp(arrivalTarget,blend);
      camera.fov=THREE.MathUtils.lerp(camera.fov,arrivalFov,blend);camera.updateProjectionMatrix();
    }
    const nextArrival=arrivalShot?`${arrivalShot.slot}:${arrivalShot.phase}`:'';
    if(nextArrival!==arrivalKey){arrivalKey=nextArrival;options.onArrival?.(arrivalShot?{slot:arrivalShot.slot,phase:arrivalShot.phase}:null);}
    if(capturePose){camera.position.set(...capturePose.eye);target.set(...capturePose.target);if(camera.fov!==capturePose.fov){camera.fov=capturePose.fov;camera.updateProjectionMatrix();}}
    momentCameraDirected=loaded&&!!moments?.update(presentationMs,frame,!walking&&!build.session&&!capturePose&&!forgeDirected&&!arrivalCameraDirected);
    if(!walking&&!forgeDirected&&!momentCameraDirected)camera.lookAt(target);camera.updateMatrixWorld();walk?.interact(now);walk?.draw(now);observed?.draw(now,!walk);crowd.drawLanterns(time,night,camera,walk?.grips??observed?.grips);updateInstances(fixedTime&&autoCamera?time*1000:now);
    homeLife.update(presentationMs,time,lightFrame,hour,camera);royalLife.update(time,frame,hour);
    forgeFire.update(time,frame,hour);forgeHearth.update(time,frame,hour);
    forgeBreath.update({time,anvil:new THREE.Vector3(0,layout.market.elevation,8),activity:0,landed:forgeSites.noses.map(position=>({position:new THREE.Vector3(...position),kind:'smoke' as const}))});
    if(loaded&&now-lastAmbience>=160){
      lastAmbience=now;listenerRight.setFromMatrixColumn(camera.matrixWorld,0);
      const self=walking?walk?.poses.find(p=>p.self):undefined;
      const listener:Vec3=self?[self.x,self.y+1.4,self.z]:[camera.position.x,camera.position.y,camera.position.z];
      ambienceTarget=sampleKingdomAmbience(layout,listener,[listenerRight.x,listenerRight.y,listenerRight.z]);
    }
    if(loaded)sound.ambienceUpdate(now,ambienceTarget);
    atmosphere.update(hour,time,camera,new THREE.Vector3(...beaconPosition),beacon);
    fog.color.set(grade.fog);fog.density=grade.fogDensity;renderer.toneMappingExposure=grade.exposure;
    post.update({environment:grade,hour,focusDistance:camName==='window'||forgeDirected||forge.status().busy?camera.position.distanceTo(forgeDirected&&realmForge?realmForge.focusPoint:target):null,beacon:{position:new THREE.Vector3(...beaconPosition),strength:beacon},forge:{position:new THREE.Vector3(0,layout.market.elevation+1.6,8),strength:realmForge?.active()||forge.status().busy?1:0}});
    const nextWaterQuality=canvas.clientWidth<600?'reduced':'full';
    if(nextWaterQuality!==waterQuality){waterQuality=nextWaterQuality;water.setQuality(waterQuality);}
    water.update({time,environment:grade,camera,sources:[
      ...[...windows.getSources(),...build.getSources()].map(source=>({...source,kind:'window' as const})),
      {position:beaconPosition,strength:beacon,kind:'beacon'},
      ...[...royalLife.sources(),...forgeFire.sources(),...forgeHearth.sources(),...crowd.sources()].map(source=>({...source,kind:'lamp' as const})),
    ]});
    dressing.hideLot(buildHidden?simulation.firstSlot:null);
    dressing.update({time,walkers:(walk?.poses??observed?.poses??[]).map(p=>[p.x,p.y,p.z] as Vec3)});
    if(now-lastField>240){lastField=now;const lightFocus=forgeDirected&&realmForge?realmForge.focusPoint:target;const centre:Vec3=[lightFocus.x,terrainHeight(layout,lightFocus.x,lightFocus.z),lightFocus.z];const sources=[...windows.getSources(),...build.getSources(),...homeLife.sources(),...royalLife.sources(),...forgeFire.sources(),...forgeHearth.sources(),...crowd.sources(),...(realmForge?.sources()??[])];field.update(centre,sources);farField.update(centre,sources);beaconField.update(beaconPosition,[{position:beaconPosition,strength:beacon,normal:[0,1,0]},...windows.getSources().filter(source=>source.slot===65534),...royalLife.sources()]);}
    const people=walk??observed;
    if(people)options.onWalkers?.(people.labels().filter(label=>{
      const person=people.poses.find(p=>p.id===label.id);
      return person&&!windowOccluded(nearBlockers,[camera.position.x,camera.position.y,camera.position.z],[person.x,person.y+1.95,person.z]);
    }));
    if(now-lastNames>80){const namedHomes=labels();options.onSpeech?.(crowd.speechLabels(camera,canvas.clientWidth,canvas.clientHeight,presentationMs,namedHomes));options.onMomentCaptions?.(moments?.captions()??[]);lastNames=now;}
    if(loaded)sunShadows.updateSunDirection(grade.sunDirection);
    // Fixed evidence frames have no animation between seeks. Keep the public
    // feed/watchdog alive, but don't burn SwiftShader CPU redrawing identical
    // pixels while a capture waits on fonts, a field worker or the filesystem.
    const renderKey=[poseRevision,forge.renderRevision,build.renderRevision,loaded,time,hour,camName,geometryBuilds,fieldUploads,frame?.epoch,frame?.sequence,canvas.width,canvas.height].join(':');
    if((loaded&&(!fixedTime||!!walk))||renderKey!==lastRenderedKey){renderPhase='drawing';renderStartedAt=performance.now();water.reflect({renderer,scene,camera,frame:++waterFrame,exclusions:atmosphere.reflectionExclusions});post.render(dt);renderCompletedAt=performance.now();renderPhase='drawn';lastRenderedKey=renderKey;}
    // The gate covers loading the place, not background light refinement. The
    // full scene and presence windows have drawn; independently scheduled light
    // workers may still be waking. Captures can wait on lightingReady separately.
    Object.assign(debug,{post:post.diagnostics(),citizens:citizens.length,walking:citizens.filter(c=>c.state==='walking').length,ready:loaded&&renderCompletedAt>0,lightingReady:nearBytes>0&&farBytes>0&&beaconBytes>0,activeWindows:active,geometryBuilds,fieldUploads,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,time,hour,camera:camName,fieldBytes,shadowUpdates:sunShadows.stats.updates,shadowDrawCalls:sunShadows.stats.drawCalls,shadowTriangles:sunShadows.stats.triangles,shadowBytes:sunShadows.stats.textureBytes+sunShadows.stats.transformBytes,shadowEnabled:sunShadows.stats.enabled,windowFieldVisited:nearVisited+farVisited,beaconFieldVisited:beaconVisited,fieldSettled:field.stats.publishedRevision===field.stats.requestedRevision&&!field.stats.busy&&!field.stats.queued&&farField.stats.publishedRevision===farField.stats.requestedRevision&&!farField.stats.busy&&!farField.stats.queued&&farBytes>0&&beaconField.stats.publishedRevision===beaconField.stats.requestedRevision&&!beaconField.stats.busy&&!beaconField.stats.queued&&beaconBytes>0});
    if(debug.ready){
      (window as Window & {__chatdomReady?:boolean}).__chatdomReady=true;
      if(!announcedReady){announcedReady=true;options.onReady?.();}
    }
    raf=requestAnimationFrame(render);
    }catch(error){dispose();options.onError('The kingdom could not render');console.error('Kingdom frame failed',error);}
  }
  fullDispose=dispose;earlyCleanups.length=0;
  raf=requestAnimationFrame(render);
  const assets=[...blueprints.values(),...trees],total=assets.length*3;let completed=0;
  // Coarse geometry is available first. Every resolution is prepared in workers; window anchors stay exact.
  const assetJobs=([4,2,1] as const).flatMap(factor=>assets.map(blueprint=>({factor,blueprint})));let nextAsset=0;
  // Keep room for shore, dressing and citizen jobs in the shared bounded pool.
  const tasks:Promise<unknown>[]=Array.from({length:Math.min(8,assetJobs.length)},async()=>{
    while(nextAsset<assetJobs.length){const {factor,blueprint:b}=assetJobs[nextAsset++]!;
    const job={kind:'blueprint' as const,blueprint:b,revision:1,materials:registry.materials,materialRevision:registry.revision,...(factor===1?{}:{lodFactor:factor})};
    const result=await pool.submit(job);if(disposed||result?.kind!=='asset')return;
    const treeIndex=trees.indexOf(b);
    const placements=treeIndex>=0?treePlaces[treeIndex]!:content.filter(h=>blueprintKey(h.blueprint)===blueprintKey(b));
    instance(b,result.chunks,placements,factor);options.onProgress(castleBuildings.some(module=>module.blueprint.id===b.id)?'Opening the castle gate':treeIndex>=0?'Planting the old woods':'Raising the homes',++completed/total);
    }
  });
  tasks.push(dressing.ready);
  tasks.push(shore.prepare());
  tasks.push(loadTerrain(layout,()=>{}, {signal:abort.signal}).then(({chunks,origin})=>{
    if(disposed)return;
    for(const tile of terrainBatches(chunks)){
      const geometry=geometryFromChunks(tile,'terrain');geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);geometry.boundingSphere=geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());geometries.push(geometry);
      const mesh=new THREE.Mesh(geometry,ground.material);mesh.position.set(...origin);scene.add(mesh);sunShadows.register(mesh);meshes.push(mesh);geometryBuilds++;
    }
  }));
  function dispose(){if(disposed)return;const checkpoint=options.founded&&crowd.checkpoint();if(checkpoint)citizenHandoff={at:Date.now(),checkpoint};disposed=true;loaded=false;debug.ready=false;cancelAnimationFrame(raf);walkGeneration++;walk?.dispose();walk=undefined;observed?.dispose();observed=undefined;options.onWalkers?.([]);abort.abort();observer.disconnect();unsubscribe();field.dispose();farField.dispose();beaconField.dispose();realmForge?.dispose();forge.dispose();build.dispose();crowd.dispose();homeLife.dispose();royalLife.dispose();forgeFire.dispose();forgeHearth.dispose();forgeBreath.dispose();shore.dispose();moments?.dispose();options.onMomentCaptions?.([]);pool.dispose();sunShadows.dispose();windows.dispose();atmosphere.dispose();sound.dispose();geometries.forEach(g=>g.dispose());clay.dispose();ground.dispose();horizonGeometry.dispose();horizonMaterial.dispose();water.dispose();post.dispose();for(const mesh of meshes)if(mesh instanceof THREE.InstancedMesh)mesh.dispose();renderer.dispose();scene.clear();canvas.removeEventListener('webglcontextlost',contextLost);options.signal?.removeEventListener('abort',dispose);}
  function contextLost(event:Event){event.preventDefault();dispose();options.onError('The kingdom lost its rendering context');}
  canvas.addEventListener('webglcontextlost',contextLost);options.signal?.addEventListener('abort',dispose,{once:true});
  if(options.signal?.aborted)dispose();
  // These meshes already render progressively under the gate. Do not put a
  // second compileAsync barrier between those successful draws and opening:
  // KHR_parallel_shader_compile is an optional driver completion hint, and can
  // remain pending even while the scene draws. The first fully loaded render
  // opens the gate; background light readiness is reported independently.
  try {await Promise.all(tasks);
    if(disposed)throw new Error('Scene closed while loading');await crowd.prepare();if(!installed){await build.prepare();await forge.prepare();}if(options.walkerFeed&&options.founded){const next=await createObservedWalkers(scene,camera,canvas,pool,crowd.material,options.founded,options.walkerFeed,createFoundedInteractionRegistry(options.founded,compileFoundedScene(options.founded)));if(disposed){next.dispose();throw new Error('Scene closed while preparing walkers');}observed=next;}if(disposed)throw new Error('Scene closed while preparing citizens');
    if(options.momentFeed){
      const kingdomId=options.founded?.kingdomId??options.kingdomId;
      if(!kingdomId||options.founded&&options.momentFeed.origin!==options.founded.origin)throw new Error('Moments need this kingdom and its actual source');
      const castleKeep=installed?installed.forgeHosts.find(h=>h.slot===65534):castleBuildings.find(h=>h.id===layout.castle.beaconModuleId);
      moments=own(createKingdomMoments({scene,camera,canvas,target,plan:layout,houses,...(castleKeep?{castleKeep}:{}),pool,material:clay,registry,kingdomId,feed:options.momentFeed,sound:sound.moments,kit:options.forgeFamily==='tide'?'tide':'hearth',signal:abort.signal}));
      // Optional future spectacles prepare on their four bounded worker lanes after the citizens. The gate
      // opens on the world drawing; a failed moment view detaches itself and reports failure in inspect().
      void moments.ready.catch(()=>{});
    }
    }catch(error){dispose();throw error;}
  loaded=true;lastFrame=performance.now();options.onProgress('The gate is opening',1);
  function detachWalk(){walkGeneration++;walkSelected=false;walk?.dispose();walk=undefined;options.onWalkers?.([]);camera.clearViewOffset();camera.filmOffset=0;camera.updateProjectionMatrix();instancesDirty=true;}
  return {layout,debug,sound,build,forge,forgeDirecting:()=>forgeCameraDirected,momentDirecting:()=>forgeCameraDirected||arrivalCameraDirected||momentCameraDirected,
    async attachWalk(binding:KingdomWalkBinding){
      if(disposed)throw new Error('The kingdom has closed');
      checkWalkBinding(options.founded,binding);
      detachWalk();const generation=walkGeneration;
      const next=await createKingdomWalk(scene,camera,canvas,pool,crowd.material,binding,options.founded!,sound);
      if(disposed||generation!==walkGeneration){next.dispose();return;}
      try{checkWalkBinding(options.founded,binding);}catch(error){next.dispose();throw error;}
      walk=next;walkSelected=true;capturePose=null;autoCamera=false;poseRevision++;instancesDirty=true;
    },
    detachWalk,
    walkDebug:()=>walk?.controller.debug??null,
    interactionDebug:()=>walk?.interactionDebug??null,
    walkSelected:()=>walkSelected,
    selectWalk(selected:boolean){walkSelected=selected&&!!walk;if(walkSelected){capturePose=null;autoCamera=false;}else walk?.controller.release();instancesDirty=true;},
    inspect:()=>({water:water.diagnostics(),moments:moments?.metrics(),build:'progressive-light-v1',ambience:ambienceTarget,loaded,renderPhase,renderStartedAt,renderCompletedAt,dressing:{...dressing.stats(),counts:coverPlan.report.counts},presence:{kingdomId:frame?.kingdomId??options.kingdomId??null,focusSlot,connection:frame?.connection??null},fields:{local:field.stats,kingdom:farField.stats,beacon:beaconField.stats},uploadedBytes:{local:nearBytes,kingdom:farBytes,beacon:beaconBytes}}),subject:()=>crowd.subject(focusSlot),receiveChat:(input:unknown)=>{
      if(!crowd.receiveChat(input))return false;
      const cue=CitizenChatCueSchema.parse(input),at=Date.now();
      if(cue.asOf<=at&&at-cue.asOf<=5000&&cue.expiresAt>at)arrivalDirector?.chat(cue.slot,at);
      return true;
    },clearChat:(cueIds?:readonly string[])=>crowd.clearChat(cueIds),
    setHour(value:number){targetHour=value;sound.cue('wood');},
    setCamera(value:CameraName){arrivalDirector?.cancel();walkSelected=false;walk?.controller.release();capturePose=null;poseRevision++;camName=value;autoCamera=false;lastField=-Infinity;sound.cue('wood');},
    /** Evidence framing only. Null returns control to the current production camera. */
    pose(eye:Vec3|null,lookAt?:Vec3,fov=43){
      if(eye===null){capturePose=null;poseRevision++;lastField=-Infinity;instancesDirty=true;return;}
      if(eye.length!==3||!lookAt||lookAt.length!==3||![...eye,...lookAt,fov].every(Number.isFinite)||fov<10||fov>100||Math.hypot(...eye.map((value,index)=>value-lookAt[index]!))<.01)throw new Error('Capture pose needs finite distinct eye/target and a 10–100 degree FOV');
      capturePose={eye:[...eye],target:[...lookAt],fov};poseRevision++;autoCamera=false;lastField=-Infinity;instancesDirty=true;
    },
    play(){if(!ownSimulation)return;walkSelected=false;walk?.controller.release();capturePose=null;poseRevision++;sound.unlock();sound.cue('wood');windows.clear();crowd.clear();lastLightFrameKey='';simulation.reset();time=0;fixedTime=false;autoCamera=true;camName='hero';beaconCue=false;lastActive=0;},
    seek(value:number,view?:CameraName){if(view){walkSelected=false;walk?.controller.release();}lastField=-Infinity;if(view){capturePose=null;poseRevision++;camName=view;}if(!ownSimulation)return;time=value;fixedTime=true;autoCamera=false;simulation.advance(value);windows.update(1,hour);},
    capture(value:number){
      walkSelected=false;walk?.controller.release();
      if(!ownSimulation)throw new Error('Offline capture requires the SIMULATED feed');
      capturePose=null;poseRevision++;
      if(!fixedTime||!autoCamera||value<time)for(const batch of batches.values())batch.transitions.clear();
      time=value;fixedTime=true;autoCamera=true;camName='hero';lastField=-Infinity;
      // Sample actual reducer time, including the 0.7 s window fade; offline
      // capture must not turn each arrival instantly full-bright.
      windows.clear();simulation.advance(value,true);windows.update(0,hour);
    },
    dispose,
  };
  } catch(error) {
    if(fullDispose)fullDispose();
    else {disposed=true;for(const cleanup of earlyCleanups.reverse()){try{cleanup();}catch{/* Finish releasing the other resources. */}}}
    throw error;
  }
}
