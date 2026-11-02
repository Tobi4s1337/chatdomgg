import { createHomeGrowthCeremony } from './growth-ceremony';
import type { GrowthCeremonyFeed } from './growth-ceremony-feed';
import { createForgeFlight } from './forge-flight';
import { createDockActs } from './dock-acts';
import { createDockVisuals } from './dock-visuals';
import { createDockPresenter, type DockPresentationConnection } from '../stream/dock-presenter';
import * as THREE from 'three';
import { createKingdomForge, type ForgeStatus } from '../forge/scene';
import { createRealmForgeScene } from '../forge/realm-scene';
import type { RealmForgeFeed } from '../realm/adapters/forge-feed';
import { MATERIALS } from '@chatdom/content';
import { createPictureTree, TREE_SPECIES, TREE_STYLES, TREE_VARIANTS, type TreeSpecies, type StyleFamily } from '@chatdom/content/trees';
import { attachCanopy, createCanopyMaterial, groveBatches, plantGrove, type TreeSite } from './trees';
import { VoxelWorkerPool, type AssetChunkMesh } from '@chatdom/voxel';
import { createAtmosphere, getEnvironment, createVoxelMaterial, geometryFromChunks, createWindowLights, createPostStack, type WindowHouse } from '@chatdom/render';
import { createKingdomLandInterface, grandFloorSurface, type LandSurfaceAt, generateSettlementPlan, terrainHeight, samplePublicGround, randomUnit, seedHash, type KingdomTier, type SettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import type { KingdomId, KingdomPresenceFrame, Vec3, VoxelBlueprint, PresenceFeed, GrowthSceneFeed } from '@chatdom/shared';
import { CitizenChatCueSchema, PRESENCE_LEASE_MS } from '@chatdom/shared';
import { createSimulatedPresence, createHeraldPresence } from './presence-feed';
import { loadTerrain } from './terrain-client';
import { todayLandSurface } from './terrain-surface';
import { grandRecipeFor } from './grand-land/recipes';
import { foundedLandReceipt } from './grand-land/scene-receipt';
import { probePublishedLand } from './grand-land/land-availability';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import { createGrandOverview } from './grand-land/overview';
import { overviewFrame } from './grand-land/overview-pose';
import { prepareHostedGrandLand, createHostedGrandMaterial, type HostedGrandLand } from './grand-land';
import { heroLensOnLand, type HeroLens } from './grand-land/hero-lens';
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
import { createCastleContent, createCastleCourtContent } from './castle-content';
import { createGenesisWaterContent } from '../genesis/water-content';
import type { GenesisSeatContent } from '../genesis/seat-content';
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
import { RealmDockStageStateSchema, type RealmWalkerFeed } from '@chatdom/shared/realm';
import { createGroundDressing } from './ground-dressing';
import { planAdoptedCover } from './ground-dressing/adopted-cover';
import { compileFoundedScene, foundedGroundAt } from '@chatdom/world/founded-collision';
import { createFoundedInteractionRegistry, standingClear } from '@chatdom/world/interactions';
import { sampleKingdomAmbience } from './ambience';
import type { AmbienceTarget } from './ambience/types';
import { createArrivalDirector, type ArrivalAttention } from './arrival-director';
import { createShoreDressing } from './shore-dressing';
import { createKingdomMoments } from './moments';
import { skyLitEnvironment, type ScreenCaption, type TwitchMomentFeed } from '../twitch-moments';
import { createWaterSurface } from '../places/water/surface';
import { deriveWaterReaches } from '../../../../packages/world/src/places/water/reaches';
import { createSoulSceneHost } from '../soul/host';
import { foundedSoulBinding } from '../soul/founded-binding';
import { createSoulKeeperRenderer } from '../soul/keeper-renderer';
import { createRealmSoulClock } from '../soul/realm-clock';
import { createCivicLife } from './civic-life';
import { createPlaceMounts, type PlaceMounter } from './grand-land/place-mount';
import { createPlaceShot } from './grand-land/place-shot';
import type { PlaceShot } from '../interactions/places/framing';
import { createKingdomLayers } from './grand-land/kingdom-layer';
// Registered kingdom layers (effects only; solids stay founded placements): the pier's lanterns.
import './grand-land/pier-layer';
import { createSceneStills, type SceneStillOptions } from './grand-land/scene-still';
import { pierShot, type PierShotPose } from './grand-land/pier-shot';
import { createRaidMomentHooks, raidTorchLights } from './grand-land/raid-support';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { automaticSceneQuality, sceneQualityBudget, type SceneQuality } from './grand-land/scene-quality';
export type { PlaceMount, PlaceMounter } from './grand-land/place-mount';
export { registerKingdomLayer, type KingdomLayerMount, type KingdomLayerMounter } from './grand-land/kingdom-layer';
export { SCENE_QUALITIES, isSceneQuality, type SceneQuality, type SceneQualityBudget } from './grand-land/scene-quality';

const distantAirAnchor='colour=mix(colour,fogColour,min(.86,fogAmount));';
const distantAir=`colour=mix(colour,fogColour,min(.86,fogAmount));
    // Distant land and groves share this evening air. Keep the town's accepted light
    // untouched; sightline depth and low valleys separate successive rock ridges.
    float duskAir=smoothstep(.15,.65,uNight);
    float ridgeDistance=max(distanceToCamera-220.,0.);
    float valleyAir=.45+.55*exp(-max(vWorld.y-12.,0.)*.012);
    float ridgeHaze=(1.-exp(-ridgeDistance*.0009*valleyAir))*duskAir;
    vec3 lilacAir=vec3(${new THREE.Color('#9685ad').multiplyScalar(.65).toArray().join(',')});
    colour=mix(colour,lilacAir,min(.34,ridgeHaze));`;
function withDistantAir(shader:string){if(!shader.includes(distantAirAnchor))throw new Error('Distant air shader anchor missing');return shader.replace(distantAirAnchor,distantAir);}

// One short-lived presentation handoff keeps a scene revision from sending neighbours back home.
let citizenHandoff: { at: number; checkpoint: CitizenSceneCheckpoint } | undefined;

export type CameraName='hero'|'window'|'citizen'|'pier';
export interface NameLabel {name:string;x:number;y:number;slot:number;arrivalAgeSeconds?:number}
export interface PotentialKingdomView {seat?:GenesisSeatContent;plan:SettlementPlan;size:string;style:'hearth'|'tide'|'grove';camera:{eye:Vec3;target:Vec3;fov:number};/** Local SIMULATED lighting only; never crowd presence or a deed. */windowPreview?:KingdomPresenceFrame}
export interface SceneView {eye:Vec3;target:Vec3;fov:number}
export interface SceneOptions {readonly mode?:'stream'|'watching';readonly overview?:boolean;readonly places?:readonly PlaceMounter[];/** Read-only isolated history; never hands citizens to the live scene. */replay?:boolean;dockFeed?:DockPresentationConnection;/** Hidden warming scenes must explicitly activate before presenting or witnessing. */dockActive?:boolean;/** Explicit SIMULATED capture fixtures only. */simulatedDockSites?:boolean;/** Keep a replacement on complete startup coverage until its final handoff frame. */deferLandPresentation?:boolean;initialView?:SceneView;growthFeed?:GrowthSceneFeed;growthCeremonies?:GrowthCeremonyFeed;potential?:PotentialKingdomView;momentFeed?:TwitchMomentFeed;onMomentCaptions?:(captions:readonly ScreenCaption[])=>void;directArrivals?:boolean;onArrival?:(shot:Pick<ArrivalAttention,'slot'|'phase'>|null)=>void;founded?:RealmFoundedScene;foundedReceipt?:RealmFoundedManifest;presenceFeed?:PresenceFeed;forgeFeed?:RealmForgeFeed;walkerFeed?:RealmWalkerFeed;onWalkers?:(labels:readonly WalkerLabel[])=>void;realmName?:string;forgeFamily?:'hearth'|'tide'|'grove';nativeStyle?:'hearth'|'tide'|'grove';tier:KingdomTier;seed:string;firstYear?:number;year?:number;kingdomId?:KingdomId;focusSlot?:number;hour:number;time:number|null;camera:CameraName;source:'simulated'|'herald';presenceOrigin?:KingdomPresenceFrame['origin'];signal?:AbortSignal;onReady?:()=>void;onForge?:(status:ForgeStatus)=>void;onProgress:(text:string,fraction:number)=>void;onNames:(names:NameLabel[])=>void;onSpeech?:(labels:SpeechLabel[])=>void;onBuild?:(session:KingdomBuildSession|null)=>void;onHousewarming?:(name:string|null)=>void;onSource:(state:string)=>void;onError:(message:string)=>void}
export interface KingdomDebug {post?:ReturnType<ReturnType<typeof createPostStack>['diagnostics']>;citizens:number;walking:number;ready:boolean;lightingReady:boolean;workers:number;homes:number;activeWindows:number;geometryBuilds:number;fieldUploads:number;drawCalls:number;triangles:number;time:number;hour:number;camera:CameraName;fieldBytes:number;source:string;fieldSettled:boolean;shadowUpdates:number;shadowDrawCalls:number;shadowTriangles:number;shadowBytes:number;shadowEnabled:boolean;windowFieldVisited:number;beaconFieldVisited:number}

export async function createKingdomScene(canvas:HTMLCanvasElement,options:SceneOptions) {
  let disposed=false,raf=0,renderHolds=0,loaded=false,forgeCameraDirected=false,lastFrame=performance.now(),time=options.time??30,hour=options.hour,targetHour=hour,camName=options.camera;
  let capturePose:{eye:Vec3;target:Vec3;fov:number}|null=null;
  let poseRevision=0;
  let landPresentationDeferred=!!options.deferLandPresentation;
  let handoffAwaiter:{view:SceneView;resolve:()=>void;reject:(error:Error)=>void}|undefined;
  const placeShot=createPlaceShot();
  // A public feed uses the wall clock even when a capture URL carries a fixture time.
  let fixedTime=!!options.replay||(options.source==='simulated'&&!options.presenceFeed&&options.time!==null),autoCamera=options.source==='simulated'&&!options.presenceFeed&&!fixedTime&&camName==='hero',frame:KingdomPresenceFrame|undefined,fieldUploads=0,geometryBuilds=0,fieldBytes=0,nearBytes=0,farBytes=0,beaconBytes=0,nearVisited=0,farVisited=0,beaconVisited=0;
  let walk:Awaited<ReturnType<typeof createKingdomWalk>>|undefined,walkSelected=false,walkGeneration=0;
  let observed:Awaited<ReturnType<typeof createObservedWalkers>>|undefined;
  let moments:ReturnType<typeof createKingdomMoments>|undefined,momentCameraDirected=false,growthCameraDirected=false,dockCameraDirected=false;
  let dockActive=options.dockActive??false;
  let soul:ReturnType<typeof createSoulSceneHost>|undefined,soulClockTimer:ReturnType<typeof setInterval>|undefined;
  const soulClock=createRealmSoulClock();
  const earlyCleanups:(()=>void)[]=[];
  let fullDispose:(()=>void)|undefined;
  const own=<T extends {dispose():void}>(resource:T):T=>{earlyCleanups.push(()=>resource.dispose());return resource;};
  const failLight=(message:string)=>queueMicrotask(()=>{if(disposed)return;fullDispose?.();options.onError(message);});
  try {
  if(options.founded?.origin==='live'&&!options.presenceFeed)throw new Error('A live kingdom needs its room-backed public presence');
  const generated=options.founded?.plan??options.potential?.plan??generateSettlementPlan({seed:options.seed,tier:options.tier,firstYear:options.firstYear??(options.tier==='hamlet'?2025:2022),year:options.year??2026});
  const layout=!options.founded&&!options.potential&&options.nativeStyle?{...generated,homes:generated.homes.map(h=>({...h,style:options.nativeStyle!}))}:generated;
  const grandRecipe=options.founded?grandRecipeFor(String(options.founded.kingdomId)):undefined;
  // A recipe alone does not move a kingdom onto the grand floor: the realm must serve a land published for this
  // exact receipt. Until it does (no land routes yet, a receipt not yet rebound after growth, offline) the kingdom
  // keeps today's land, which its homes, doors and walk already stand on. The public grand view stays fail-closed.
  const landReceipt=grandRecipe?await foundedLandReceipt(options.founded!,options.foundedReceipt):undefined;
  const publishedLand=landReceipt?await probePublishedLand({kingdomId:String(options.founded!.kingdomId),receipt:landReceipt,...(options.signal?{signal:options.signal}:{})}):undefined;
  const useGrandLand=!!grandRecipe&&(publishedLand?.kind==='published'||!!options.overview);
  if(grandRecipe&&!useGrandLand&&publishedLand?.kind==='absent')canvas.dataset.hostedLand=JSON.stringify({phase:'absent',reason:publishedLand.reason,kingdomId:String(options.founded!.kingdomId)});
  let grandLand:HostedGrandLand|undefined;
  let overview:ReturnType<typeof createGrandOverview>|undefined,overviewView=options.initialView;
  const overviewOwnsLens=()=>!!overview&&!walkSelected&&!capturePose;
  const dockLens=new THREE.PerspectiveCamera(),dockTarget=new THREE.Vector3();
  const renderer=own(new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'}));
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{console.error('Kingdom shader failed',{vertex:gl.getShaderInfoLog(vertex),fragment:gl.getShaderInfoLog(fragment),link:gl.getProgramInfoLog(program)});throw new Error('A kingdom shader could not compile');};
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.15,2200),atmosphere=own(createAtmosphere(scene));
  let handoffPose: {view:SceneView;rotation:THREE.Quaternion;elapsed:number}|undefined;
  function startHandoff(view:SceneView){
    if(![...view.eye,...view.target,view.fov].every(Number.isFinite)||view.fov<10||view.fov>100||Math.hypot(...view.eye.map((v,i)=>v-view.target[i]!))<.01)throw new Error('Scene handoff needs a finite camera view');
    const copy:SceneView={eye:[...view.eye],target:[...view.target],fov:view.fov};
    if(options.overview&&useGrandLand){overviewView=copy;overview?.restore(copy);handoffPose=undefined;poseRevision++;return;}
    const matrix=new THREE.Matrix4().lookAt(new THREE.Vector3(...copy.eye),new THREE.Vector3(...copy.target),camera.up);
    handoffPose={view:copy,rotation:new THREE.Quaternion().setFromRotationMatrix(matrix),elapsed:0};poseRevision++;
  }
  if(options.initialView)startHandoff(options.initialView);
  // A person's quality choice scales effects only (scene-quality.ts); null keeps the automatic opening choice.
  const openedQuality=automaticSceneQuality(canvas.clientWidth);let qualityChoice:SceneQuality|null=null;
  const post=own(createPostStack(renderer,scene,camera,{quality:openedQuality,toneMapping:'aces',fog:'material'}));
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
  const placeMounts=own(createPlaceMounts({scene,camera,placements:options.founded?.placements??[],
    localFeet:()=>{const self=walk?.connected?walk.controller.debug.self:null;return self?[self.x,self.y,self.z]:null;},
    // Capture is the post stack's highest-fidelity tier; places use their high tier alongside it.
    hour:()=>hour,quality:()=>{const quality=post.diagnostics().quality;return quality==='capture'?'high':quality;}},options.places));
  const civicLife=options.founded?own(createCivicLife(scene,options.founded)):undefined;
  // Use the installed market cask as a real raised viewing spot, never a phantom support.
  const stores=installed?.props.find(prop=>/^civic-(hearth|tide)-market-stores$/.test(prop.blueprint.id));
  const barrelCentre=stores?new THREE.Vector3(.5,0,.625).applyAxisAngle(new THREE.Vector3(0,1,0),stores.yaw).add(new THREE.Vector3(...stores.position)):undefined;
  const forgeBarrel=barrelCentre&&barrelCentre.distanceTo(new THREE.Vector3(0,layout.market.elevation,8))<13?{position:barrelCentre.toArray() as Vec3,height:11/8}:undefined;
  const previousCitizens=options.replay?undefined:citizenHandoff;if(!options.replay)citizenHandoff=undefined;
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
  if(options.potential)props.push(...createGenesisWaterContent(layout,{crossing:options.potential.seat?.crossing??false}));
  const potentialSeat=installed?undefined:options.potential?.seat;
  const {buildings:castleBuildings,beaconPosition}=potentialSeat??createCastleContent(layout.castle,options.potential?.style);
  const simulatedCourt=installed?undefined:potentialSeat??createCastleCourtContent(layout.castle,options.potential?.style);
  if(simulatedCourt)props.push(...simulatedCourt.props);
  const buildings=installed?houses:[...houses,...castleBuildings],content=installed?.content??[...buildings,...props];
  const renderContent=installed?installed.content.filter(piece=>placeMounts.hostDraws(piece.placementId)):content;
  for(const {blueprint} of renderContent)blueprints.set(blueprintKey(blueprint),blueprint);
  const royal=installed?royalWindow(installed.forgeHosts):undefined;
  const presenceHouses=royal?[...houses,royal]:[...houses];
  const lifeSites=options.founded?foundedLifeSites(options.founded):{homes:generatedHomeLifeSites(houses),braziers:simulatedCourt?.braziers??[],standard:undefined};
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
  let heroFov=53,heroLand:{key:string;lens:HeroLens}|undefined;
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
    // On the grand land the same lens turns, within bounds, toward the real ranges behind the castle.
    if(grandLand){
      const key=`${portrait()}:${camera.aspect.toFixed(3)}`;
      if(heroLand?.key!==key){const land=grandLand;heroLand={key,lens:heroLensOnLand({height:(x,z)=>land.height(x,z),eye:heroEye.toArray(),target:heroTarget.toArray(),pivot:market,fov:camera.fov,aspect:camera.aspect,seaLevel:land.water.raster.seaLevel})};}
      heroEye.set(...heroLand.lens.eye);heroTarget.set(...heroLand.lens.target);
    }
  }
  const sunShadows=own(createSunShadows(renderer,{bounds:new THREE.Box3(new THREE.Vector3(layout.bounds.minX-40,-8,layout.bounds.minZ-70),new THREE.Vector3(layout.bounds.maxX+40,60,layout.bounds.maxZ+20)),resolution:portrait()?1024:2048}));
  sunShadows.bindReceiver(clay.material);sunShadows.bindReceiver(ground.material);sunShadows.bindReceiver(crowd.material.material);
  const floraMaterial=own(new THREE.ShaderMaterial({glslVersion:clay.material.glslVersion,uniforms:clay.material.uniforms,defines:clay.material.defines,alphaToCoverage:clay.material.alphaToCoverage,vertexShader:clay.material.vertexShader,fragmentShader:withDistantAir(clay.material.fragmentShader)}));
  sunShadows.bindReceiver(floraMaterial);
  const canopy=own(createCanopyMaterial(floraMaterial));
  const royalLife=own(createRoyalLife(scene,clay,installed?.forgeHosts.find(home=>home.slot===65534),lifeSites.braziers,lifeSites.standard));
  if(royalLife.keepMaterial)sunShadows.bindReceiver(royalLife.keepMaterial);
  if(royalLife.standardMaterial)sunShadows.bindReceiver(royalLife.standardMaterial);
  let dockGate:Vec3|null=null,dockPlaza:Vec3|null=null,dockGateFlame:number|null=null;
  let dockSiteFailure:string|null=null,dockReceived=0,dockWitnessed=0;
  const simulatedDockSites=!!options.simulatedDockSites&&options.source==='simulated'&&!options.presenceFeed&&!options.potential&&!options.founded;
  if(options.dockFeed){
    // The seam attests exact installed support; the horizon and water sheet do not.
    let supportedDockPoint:((x:number,z:number)=>Vec3|null)|undefined;
    if(options.founded){
      try{
        const founded=options.founded,collision=compileFoundedScene(founded);
        const land=createKingdomLandInterface({scene:founded,collision,ground:{layoutRevision:founded.layoutRevision,collisionRevision:founded.collisionRevision,
          sample:(x,z)=>x>=layout.bounds.minX&&x<layout.bounds.maxX&&z>=layout.bounds.minZ&&z<layout.bounds.maxZ?foundedGroundAt(layout,x,z):null}});
        const gate=land.moments.castleGate;
        dockGate=gate&&standingClear(collision,gate)?gate:null;
        supportedDockPoint=(x,z)=>{const point=land.groundAt(x,z);return point&&standingClear(collision,point)?point:null;};
      }catch{dockSiteFailure='Installed land has no supported dock sites';}
    }else if(simulatedDockSites){
      dockGate=layout.nodes.find(node=>node.id===layout.castle.gateNodeId)?.position??null;
      supportedDockPoint=(x,z)=>[x,terrainHeight(layout,x,z),z];
    }
    const market=layout.nodes.find(node=>node.id===layout.market.nodeId)?.position;
    if(market&&supportedDockPoint){
      // A real fire needs its whole footprint clear, including the market well,
      // carts and Forge. Use public square support, never its scenery centre alone.
      for(const [dx,dz] of [[4,3],[-4,3],[5,-5],[-5,-5]] as const){
        const point=supportedDockPoint(market[0]+dx,market[2]+dz);if(!point)continue;
        let clear=true;
        for(const ox of [-1,0,1])for(const oz of [-1,0,1]){
          const x=point[0]+ox,z=point[2]+oz,top=supportedDockPoint(x,z);
          if(!top||Math.abs(top[1]-point[1])>.05||samplePublicGround(layout,x,z)?.id!==layout.market.id)clear=false;
        }
        if(content.some(piece=>{
          const corners=[[0,0],[piece.blueprint.size[0]/8,0],[0,piece.blueprint.size[2]/8],[piece.blueprint.size[0]/8,piece.blueprint.size[2]/8]].map(([x,z])=>new THREE.Vector3(x!,0,z!).applyAxisAngle(new THREE.Vector3(0,1,0),piece.yaw).add(new THREE.Vector3(...piece.position)));
          return point[0]+1>Math.min(...corners.map(p=>p.x))&&point[0]-1<Math.max(...corners.map(p=>p.x))&&point[2]+1>Math.min(...corners.map(p=>p.z))&&point[2]-1<Math.max(...corners.map(p=>p.z));
        }))clear=false;
        if(clear){dockPlaza=point;break;}
      }
    }
  }
  const dockVisuals=options.dockFeed?own(createDockVisuals({scene,get camera(){return overviewOwnsLens()?dockLens:camera;},get target(){return overviewOwnsLens()?dockTarget:target;},gate:dockGate,gateBraziers:lifeSites.braziers.map(site=>site.position),plaza:dockPlaza,
    citizen:(slot,approvedName)=>{const subject=crowd.subject(slot);return subject&&subject.opacity>.05&&frame?.windows.some(window=>window.slot===slot&&window.present&&(approvedName===undefined||window.publicName===approvedName))?subject.position:undefined;},
    welcomeRaid:(act,elapsed)=>moments?.welcomeRaid(act,elapsed)??false,
    setHour:value=>{targetHour=value;},hour:()=>hour,cue:kind=>sound.cue(kind==='fire-light'?'beacon':'light'),gateFlame:value=>{dockGateFlame=value;},
  })):undefined;
  let dockPresenter:ReturnType<typeof createDockPresenter>|undefined;
  const dockActs=dockVisuals?own(createDockActs(dockVisuals,value=>{void dockPresenter?.drawn(value).then(accepted=>{if(accepted)dockWitnessed++;});})):undefined;
  const dockKingdomId=options.founded?.kingdomId??options.kingdomId;
  const dockOrigin=options.founded?.origin??options.presenceOrigin??(options.source==='simulated'?'simulated':'live');
  function activateDock(active=true){
    if(disposed)return;
    dockActive=active;
    if(!active){dockPresenter?.dispose();dockPresenter=undefined;dockActs?.update(Date.now(),false);dockCameraDirected=false;}
    else if(!dockPresenter&&options.dockFeed&&dockActs&&dockKingdomId){
      dockPresenter=createDockPresenter({kingdomId:dockKingdomId,origin:dockOrigin,connection:options.dockFeed,
        receive:(act,now)=>{const accepted=dockActs.receive(act,now);if(accepted){dockReceived++;poseRevision++;}return accepted;}});
    }
    poseRevision++;
  }
  let dockStateAsOf=-Infinity;
  const unsubscribeDockState=options.dockFeed?.subscribeState?.(state=>{
    if(disposed||!RealmDockStageStateSchema.safeParse(state).success||state.kingdomId!==dockKingdomId||state.origin!==dockOrigin||state.asOf<dockStateAsOf)return;
    dockStateAsOf=state.asOf;dockVisuals?.restoreState(state);poseRevision++;
  });
  if(unsubscribeDockState)earlyCleanups.push(unsubscribeDockState);
  earlyCleanups.push(()=>dockPresenter?.dispose());
  if(options.dockFeed&&dockActs){
    if(!dockKingdomId)throw new Error('Dock presentations need the installed kingdom identity');
    if(dockActive)activateDock();
  }
  function resize(){renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);post.resize(canvas.clientWidth,canvas.clientHeight,renderer.getPixelRatio());camera.aspect=canvas.clientWidth/canvas.clientHeight;setHero();focusHome(focusSlot);walk?.controller.resize(canvas.clientWidth,canvas.clientHeight);sunShadows.setResolution(portrait()?1024:2048);placeMounts.resize(canvas.clientWidth,canvas.clientHeight);}
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
  const hiddenAttachments=new Set<string>(),growthHidden=new Set<string>(),growthLifeHidden=new Set<number>();
  type RenderBatch={transitions:Map<Placement,DetailTransition>;blueprint:VoxelBlueprint;placements:readonly Placement[];levels:Map<number,THREE.InstancedMesh>;depthGeometry?:THREE.BufferGeometry};
  const batches=new Map<string,RenderBatch>();
  let buildHidden=false;
  let instancesDirty=true;
  const growth=options.founded&&options.growthCeremonies?own(createHomeGrowthCeremony({scene,founded:options.founded,feed:options.growthCeremonies,houses,pool,material:clay,registry,sound,
    maskHome(id,hidden){if(growthHidden.has(id)===hidden)return;if(hidden)growthHidden.add(id);else growthHidden.delete(id);instancesDirty=true;sunShadows.invalidate();},
    maskLife(slot,hidden){if(growthLifeHidden.has(slot)===hidden)return;if(hidden)growthLifeHidden.add(slot);else growthLifeHidden.delete(slot);windows.setHidden(slot,hidden);lastField=-Infinity;},
  })):undefined;
  const build=own(createKingdomBuild({scene,camera,canvas,pool,material:clay,home:layout.homes.find(h=>h.slot===simulation.firstSlot)!,authoredHome:first,
    ownerId:`simulated:${options.seed}:${options.tier}:juniper`,ownerName:'Juniper',source:!installed&&options.source==='simulated'?'SIMULATED':'LIVE',sound,
    onSession:session=>options.onBuild?.(session),onHousewarming:name=>options.onHousewarming?.(name),
    onHomeVisibility:hidden=>{buildHidden=hidden;windows.setHidden(simulation.firstSlot,hidden);refreshOwnHomeShadow();instancesDirty=true;lastLightFrameKey='';lastField=-Infinity;sunShadows.invalidate();},
    onStreetHome:replacement=>{if(disposed)return;for(const list of [houses,blockers,nearBlockers]){const i=list.findIndex(h=>h.slot===simulation.firstSlot);if(i>=0)list[i]=replacement??first;}field.replaceHouses(nearBlockers);farField.replaceHouses(blockers);beaconField.replaceHouses(blockers);lastField=-Infinity;},registerShadow:mesh=>sunShadows.register(mesh),
  }));
  const forgeFlight=own(createForgeFlight(scene,camera,canvas.clientWidth<600));
  const forge=own(createKingdomForge({onFlight:forgeFlight.simulated,scene,camera,canvas,pool,material:clay,anvil:new THREE.Vector3(0,layout.market.elevation,8),home:()=>build.streetHome??first,source:installed?'herald':options.source,seed:`${options.seed}:${options.tier}`,kingdomName:options.realmName??'Willowmere',family:options.forgeFamily??'tide',sound,onArrival:home=>{
    if(options.source!=='simulated'||!frame)return;
    const at=simulation.epochMs+time*1000,near=frame.windows.filter(w=>w.present).map(w=>({window:w,house:houses.find(h=>h.slot===w.slot)})).filter(p=>p.house&&p.house.slot!==home.slot).sort((a,b)=>Math.hypot(a.house!.position[0]-home.position[0],a.house!.position[2]-home.position[2])-Math.hypot(b.house!.position[0]-home.position[0],b.house!.position[2]-home.position[2])).slice(0,2);
    near.forEach(({window},i)=>crowd.receiveChat({version:1,id:`simulated-forge-${Math.floor(at)}-${i}`,kingdomId:frame!.kingdomId,epoch:frame!.epoch,origin:'simulated',slot:window.slot,asOf:Math.floor(at),expiresAt:Math.floor(at+9000),parts:[{kind:'text',text:i?'It belongs here. ✨':'Oh, look at that!'}]}));
  },onStatus:status=>options.onForge?.(status),registerShadow:mesh=>sunShadows.register(mesh)}));
  const realmForge=options.forgeFeed?own(createRealmForgeScene({onFlight:forgeFlight.realm,scene,camera,canvas,pool,material:clay,
    anvil:new THREE.Vector3(0,layout.market.elevation,8),home:slot=>(installed?.forgeHosts??houses).find(home=>home.slot===slot),sound,feed:options.forgeFeed,
    hideAttachment:(id,hidden)=>{if(hidden)hiddenAttachments.add(`forge:${id}`);else hiddenAttachments.delete(`forge:${id}`);instancesDirty=true;sunShadows.invalidate();},
    registerShadow:mesh=>sunShadows.register(mesh),
  })):undefined;
  function refreshOwnHomeShadow(){
    if(disposed)return;
    const batch=batches.get(blueprintKey(first.blueprint)),mesh=batch?.levels.get(1);if(!batch||!mesh)return;
    mesh.count=0;const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
    for(const placement of batch.placements){if(buildHidden&&placement===first)continue;matrix.compose(new THREE.Vector3(...placement.position),rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),placement.yaw),new THREE.Vector3(1,1,1));mesh.setMatrixAt(mesh.count++,matrix);}
    sunShadows.register(mesh,batch.depthGeometry?{depthGeometry:batch.depthGeometry}:undefined);instancesDirty=true;
  }
  function instance(blueprint:VoxelBlueprint,chunks:readonly AssetChunkMesh[],placements:readonly Placement[],factor:1|2|4=1,shadowChunks?:readonly AssetChunkMesh[]){
    const geometry=geometryFromChunks(chunks,'build');geometry.setAttribute('aLodFade',new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1),1));geometries.push(geometry);
    const treeBatch=treeBatches.find(batch=>batch.blueprint===blueprint);
    const match = /^tree-(oak|pine|birch|willow|elder)-(hearth|tide|grove)-(\d+)$/.exec(blueprint.id);
    const species = match?.[1] as TreeSpecies | undefined, style = match?.[2] as StyleFamily | undefined, variant = Number(match?.[3]);
    const installedTree = blueprint.kind === 'flora' && species && style && TREE_SPECIES.includes(species) && TREE_STYLES.includes(style)
      && blueprint.styleId === style && variant < TREE_VARIANTS[species] ? createPictureTree(species, style, variant) : undefined;
    const motion=treeBatch?.canopy ?? installedTree?.canopy;
    if(motion)attachCanopy(geometry,motion,installedTree?.root ?? [blueprint.size[0]/2,0,blueprint.size[2]/2]);
    const keepMesh=installed?.forgeHosts.some(home=>home.slot===65534&&blueprintKey(home.blueprint)===blueprintKey(blueprint));
    const standardMesh=lifeSites.standard&&blueprintKey(lifeSites.standard.blueprint)===blueprintKey(blueprint);
    const mesh=new THREE.InstancedMesh(geometry,motion?canopy.material:blueprint.kind==='flora'?floraMaterial:standardMesh&&royalLife.standardMaterial?royalLife.standardMaterial:keepMesh&&royalLife.keepMaterial?royalLife.keepMaterial:clay.material,placements.length);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3();
    let depthGeometry:THREE.BufferGeometry|undefined;
    if(shadowChunks!==undefined){
      if(factor!==1||motion||mesh.material!==clay.material)throw new Error('Alternate shadow geometry requires static base clay');
      depthGeometry=geometryFromChunks(shadowChunks,'build');geometries.push(depthGeometry);
    }
    placements.forEach((p,i)=>{m.compose(v.set(...p.position),q.setFromAxisAngle(new THREE.Vector3(0,1,0),p.yaw),new THREE.Vector3(factor,factor,factor));mesh.setMatrixAt(i,m);});
    mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.name=blueprint.id;scene.add(mesh);meshes.push(mesh);geometryBuilds++;
    if(factor===(blueprint.kind==='flora'?2:1))sunShadows.register(mesh,depthGeometry?{depthGeometry}:undefined);
    const batch:RenderBatch=batches.get(blueprintKey(blueprint))??{transitions:new Map<Placement,DetailTransition>(),blueprint,placements,levels:new Map<number,THREE.InstancedMesh>()};
    if(depthGeometry)batch.depthGeometry=depthGeometry;
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
        if((buildHidden&&p===first)||(p.placementId&&(hiddenAttachments.has(p.placementId)||growthHidden.has(p.placementId))))continue;
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
  const horizonSurface=useGrandLand?{geometry:new THREE.BufferGeometry(),sampleHeight:(x:number,z:number)=>terrainHeight(layout,x,z)}:createHorizonSurface(layout,{farStep:20,distantRelief:false,sampleTerrain:(x,z)=>terrainHeight(layout,x,z)});
  const horizonGeometry=horizonSurface.geometry,landHeight=(x:number,z:number)=>grandLand?.height(x,z)??horizonSurface.sampleHeight(x,z);
  earlyCleanups.push(()=>horizonGeometry.dispose());
  const coverInput={ground:landHeight,
    waterKeepOut:(x:number,z:number,margin:number)=>Math.hypot((x-layout.lake.x)/(layout.lake.radiusX+margin),(z-layout.lake.z)/(layout.lake.radiusZ+margin))<1.19,
    occupied:content,keepClear:[{x:0,z:8,radius:7}]};
  const coverPlan=planAdoptedCover(layout,coverInput);
  const dressing=own(createGroundDressing({...coverInput,land:{plan:layout,sites:[],places:{court:{boundary:layout.castle.court.boundary}}},
    seed:layout.config.seed,tier:layout.config.tier,plan:coverPlan,scene,camera,pool,clay,signal:abort.signal,
    registerShadow:mesh=>sunShadows.register(mesh)}));
  const sites:TreeSite[]=[];
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
  const plant=(id:string,kind:'court'|'grove',x:number,z:number)=>{
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
    planted.push(new THREE.Vector2(x,z));
    const lake=Math.hypot((x-layout.lake.x)/layout.lake.radiusX,(z-layout.lake.z)/layout.lake.radiusZ);
    const lot=Math.min(Infinity,...layout.reservations.map(({lot:l})=>Math.hypot(Math.max(l.minX-x,0,x-l.maxX),Math.max(l.minZ-z,0,z-l.maxZ))));
    const keep=Math.hypot(Math.max(castle.minX-x,0,x-castle.maxX),Math.max(castle.minZ-z,0,z-castle.maxZ));
    sites.push({id,zone:lake<1.55?'water':kind,position:[x,rootHeight(x,z),z],yaw:randomUnit(seedHash(`${options.seed}:tree-yaw:${id}`))*Math.PI*2,style:options.potential?.style??options.nativeStyle??options.forgeFamily??layout.homes[0]?.style??'hearth',seed:options.seed,room:Math.min(lot,samplePublicGround(layout,x,z)?.reservedDistance??Infinity,keep)+1});
  };
  const activeCourts=new Set(installed?[]:layout.homes.map(home=>home.courtId));
  for(const court of layout.courts){
    if(!activeCourts.has(court.id))continue;
    const anchor=layout.nodes.find(node=>node.id===court.nodeId)!;
    const radius=Math.max(...court.boundary.map(([x,z])=>Math.hypot(x-anchor.position[0],z-anchor.position[2])))+7;
    for(let side=0;side<8;side++){
      const angle=side*Math.PI/4;
      plant(`court:${court.id}:${side}`,'court',anchor.position[0]+Math.cos(angle)*radius,anchor.position[2]+Math.sin(angle)*radius);
    }
  }
  for(let i=0;!installed&&i<treeCount*12&&planted.length<treeCount;i++) {
    const group=Math.floor(i/7),rand=(part:string)=>randomUnit(seedHash(`${options.seed}:grove:${part}`));
    const cx=layout.bounds.minX-35+rand(`${group}:x`)*(layout.bounds.maxX-layout.bounds.minX+70);
    const cz=layout.bounds.minZ-65+rand(`${group}:z`)*(layout.bounds.maxZ-layout.bounds.minZ+45);
    const angle=rand(`${i}:angle`)*Math.PI*2,radius=Math.sqrt(rand(`${i}:radius`))*10;
    plant(`grove:${i}`,'grove',cx+Math.cos(angle)*radius,cz+Math.sin(angle)*radius);
  }
  const treeBatches=groveBatches(plantGrove(sites));
  const trees=treeBatches.map(batch=>batch.blueprint);
  // A continuous distant land silhouette lies beyond the detailed editable terrain.
  const horizonMaterial=own(new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:ground.material.uniforms,fragmentShader:withDistantAir(ground.material.fragmentShader.replace('vec3 n=normalize(vNormal);',`vec3 n=normalize(vNormal);
    // Exposed faces belong to the sculpted terrain, never to houses or the town's light grade.
    vec3 faceNormal=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
    float exposed=(1.-smoothstep(.64,.9,abs(faceNormal.y)));
    vec3 rock=vec3(${new THREE.Color('#7a6857').toArray().join(',')});
    float course=vWorld.y*.72+.45*sin(vWorld.x*.13+vWorld.z*.09)+1.1*sin((vWorld.x-vWorld.z)*.027);
    rock*=.88+.16*fract(sin(floor(course)*12.9898)*43758.5453);
    base=mix(base,rock,exposed);
    n=normalize(mix(n,faceNormal*sign(dot(faceNormal,n)),exposed*.6));`)),vertexShader:`out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}`}));const horizon=new THREE.Mesh(horizonGeometry,horizonMaterial);horizon.visible=!useGrandLand;scene.add(horizon);sunShadows.bindReceiver(horizonMaterial);if(!useGrandLand)sunShadows.register(horizon);
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
  let water=own(createWaterSurface({bodies,reaches:landform.version===2?deriveWaterReaches(landform):[],ground:{data:heightData,width:heightWidth,height:heightDepth,origin:heightOrigin,step:1},quality:waterQuality,...(layout.genesisSurface?{outsideGroundHeight:-8}:{})}));
  water.root.visible=!useGrandLand;scene.add(water.root);
  // The drawn ground under a point for feet and footsteps (land seam surfaceAt): today's terrain skin now, the grand floor once installed.
  // Panel stills read the frame the loop draws, in the same task as its present (scene-still.ts).
  const stills=createSceneStills(canvas,{requestDraw:()=>{lastRenderedKey='';}});
  // The director's pier shot, framed from the founded pier's own placements on the land actually drawn.
  let pierFrame:{key:string;pose:PierShotPose|null}|undefined;
  const pierPose=():PierShotPose|null=>{const key=grandLand?'grand':'today';if(pierFrame?.key!==key)pierFrame={key,pose:options.founded?pierShot(options.founded,landHeight):null};return pierFrame.pose;};
  let landSurface:LandSurfaceAt|null=useGrandLand?null:todayLandSurface(layout,(x,z)=>water.waterAt(x,z)?.level??null);
  // Layers are effects only: founded placements retain all solid geometry and collision.
  // The getter follows replacement water; the hidden legacy sheet offers no hosted water before installation.
  const kingdomLayers=options.founded?.kingdomId?own(createKingdomLayers({scene,camera,founded:options.founded,
    get mode(){return options.mode==='stream'?'stream':walkSelected&&walk?'walking':'watching';},
    get quality(){const quality=post.diagnostics().quality;return quality==='capture'?'high':quality;},
    hour:()=>hour,water:()=>water,signal:abort.signal,
    active:()=>!disposed&&loaded&&debug.ready&&renderHolds===0&&!options.replay&&document.visibilityState!=='hidden'
      &&canvas.isConnected&&canvas.clientWidth>0&&canvas.clientHeight>0&&canvas.getClientRects().length>0
      &&canvas.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),
  })):undefined;
  let waterFrame=0;
  const shore=own(createShoreDressing({scene,pool,clay,plan:layout,occupied:content,signal:abort.signal,registry,style:options.nativeStyle??options.forgeFamily??layout.homes[0]?.style??'hearth'}));
  function labels(){const names:NameLabel[]=[];for(const s of [...windows.getSources(),...build.getSources()]){
    if(!s.name||s.strength<.1)continue;const p=new THREE.Vector3(...s.position),to=camera.position.clone().sub(p);
    const royalPicture=s.slot===65534&&(camName==='window'||arrivalShot?.slot===65534&&arrivalShot.phase==='window');
    // The stream's wide opening still belongs to a person. Its single name plate
    // may reach a newly lit, visible window; ordinary close labels stay local.
    const wideArrival=camName==='hero'&&!arrivalCameraDirected&&!forgeCameraDirected&&(options.directArrivals||autoCamera&&time<=8)&&'arrivalAgeSeconds' in s&&s.arrivalAgeSeconds<7;
    if('arrivalAgeSeconds' in s&&s.arrivalAgeSeconds>7&&to.length()>6&&!royalPicture)continue;
    if(to.length()>(royalPicture?90:wideArrival?240:32)||to.dot(new THREE.Vector3(...s.normal))<2)continue;
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
  let forgeShade=0;
  function render(now:number){
    if(disposed||renderHolds>0)return;try {grandLand?.update(now);if(grandLand)canvas.dataset.hostedLand=JSON.stringify({...grandLand.stats,identity:grandLand.identity});const dt=Math.max(0,(now-lastFrame)/1000);lastFrame=now;
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
    hour+=Math.min(1,dt*4)*(targetHour-hour);if(Math.abs(targetHour-hour)<.001)hour=targetHour;const grade=skyLitEnvironment(getEnvironment(hour),moments?.glow());
    // Only the hot casting carries this local fire treatment. The receiving
    // house, ordinary dusk and walking retain their accepted lighting.
    const stageHeat=!walkSelected&&!capturePose?Math.max(forgeCameraDirected?(realmForge?.heat??0):0,forge.status().open?forge.heat:0):0;
    forgeShade+=(stageHeat*grade.night-forgeShade)*Math.min(1,dt*3);
    for(const state of [clay,ground]){
      state.material.uniforms.uSmithyPower!.value=forgeShade;
      state.material.uniforms.uSmithyOrigin!.value.set(0,layout.market.elevation+2.3,8);
    }
    clay.setEnvironment(grade);ground.setEnvironment(grade);forge.setEnvironment(grade);realmForge?.setEnvironment(grade);
    crowd.material.setEnvironment({...grade,ambientIntensity:Math.max(.65,grade.ambientIntensity)});
    const presentationMs=ownSimulation?simulation.epochMs+time*1000:Date.now();
    civicLife?.update(time);
    const soulEpoch=soulClock.now();
    if(soul&&soulEpoch!==null){camera.getWorldDirection(listenerRight);listenerRight.cross(camera.up).normalize();soul.update({epochMs:soulEpoch,seconds:time,population:frame?.windows.filter(window=>window.present).length??0,listener:{position:camera.position.toArray() as Vec3,right:listenerRight.toArray() as Vec3}});}
    growth?.update(now,loaded);
    const walking=walk?.frame(now,walkSelected&&!capturePose&&!build.session&&!build.housewarming&&!forge.status().open)??false;
    const overviewActive=overviewOwnsLens();
    overview?.setActive(overviewActive);
    observed?.frame(now);
    const feet=walkerSlots(walk ? walk.poses : observed?.poses??[]);
    crowd.watchForge(!!realmForge?.active()||forge.status().busy,presentationMs,[0,layout.market.elevation,8]);
    const night=THREE.MathUtils.smoothstep(Math.abs(((hour%24)+24)%24-12),4.2,6.5);
    dockVisuals?.tick(Date.now());
    crowd.gatherFire(!!dockPlaza&&!!dockVisuals?.sources().length,presentationMs,dockPlaza??[0,0,0]);
    const citizens=loaded?crowd.update(presentationMs,time,camera,build.session?new Set([simulation.firstSlot]):undefined,feet,forgeFlight.reaction(now)??growth?.reaction()??null,moments?.crowd()??dockVisuals?.crowd()??null):[];
    const lightFrame=loaded?crowd.lightFrame(presentationMs):frame;
    if(lightFrame)build.setFrame(lightFrame);
    // Potential land may show an anonymous night painting, independently of its empty
    // presence feed. Never pass those preview lights to citizens, build or the room.
    // A witnessed chat arrival lights its home immediately; walking home is the next beat.
    const windowFrame=options.potential?.windowPreview??frame;
    const lightKey=`${windowFrame?.epoch}:${windowFrame?.sequence}:${windowFrame?.windows.filter(w=>w.present).map(w=>w.slot).join(',')}`;
    if(windowFrame&&lightKey!==lastLightFrameKey){windows.setFrame(buildHidden?{...windowFrame,windows:windowFrame.windows.filter(w=>w.slot!==simulation.firstSlot)}:windowFrame);lastLightFrameKey=lightKey;lastField=-Infinity;}
    // The wide wave leads into the street at 8–12s; let its speaker greet us as
    // we join the lantern procession, before the doorway's homecoming answers.
    if(ownSimulation&&frame){const person=frame.windows.find(w=>w.slot===simulation.firstSlot);if(person?.present&&time>=6&&time<16)crowd.receiveChat({version:1,id:'simulated-evening',kingdomId:frame.kingdomId,epoch:frame.epoch,origin:'simulated',slot:simulation.firstSlot,asOf:simulation.epochMs+6000,expiresAt:simulation.epochMs+16000,parts:[{kind:'text',text:'Evening, everyone! 🌿'}]});}
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
      // First witness the town lighting up, then enter its lantern street, then rise back.
      const subject=crowd.subject(focusSlot),pull=1-THREE.MathUtils.smootherstep(time,8,12)+THREE.MathUtils.smootherstep(time,24,36);
      if(subject){const p=new THREE.Vector3(...subject.position);camera.position.copy(citizenEye);target.copy(p).add(new THREE.Vector3(0,1.05,0));}
      else {camera.position.copy(homeEye);target.copy(homeTarget);}
      camera.position.lerp(heroEye,pull);target.lerp(heroTarget,pull);
    }
    else if(camName==='citizen'){const person=crowd.subject(focusSlot);const p=person?new THREE.Vector3(...person.position):focal.clone();camera.position.copy(citizenEye);target.copy(p).add(new THREE.Vector3(0,1.05,0));}
    else if(camName==='window'){camera.position.copy(homeEye);target.copy(homeTarget);}else if(camName==='pier'&&pierPose()){const pier=pierPose()!;camera.position.set(...pier.eye);target.set(...pier.target);}else{camera.position.copy(heroEye);target.copy(heroTarget);}
    const wantedFov=autoCamera?THREE.MathUtils.lerp(48,heroFov,(1-THREE.MathUtils.smootherstep(time,8,12)+THREE.MathUtils.smootherstep(time,24,36))):camName==='citizen'?48:camName==='window'?homeFov:camName==='pier'&&pierPose()?pierPose()!.fov:heroFov;
    if(!walking&&Math.abs(camera.fov-wantedFov)>.001){camera.fov=wantedFov;camera.updateProjectionMatrix();}
    if(!installed){build.update(now,dt,hour,target);forge.update(now,target,!!build.session);}
    const forgeDirected=forgeCameraDirected=realmForge?.update(now,!overviewActive&&!walking&&!build.session&&!capturePose)??false;
    // A witnessed arrival owns only the stream lens. Walking, a chosen capture and the Forge always win.
    if(overviewActive||walking||build.session||capturePose||forgeDirected)arrivalDirector?.cancel();
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
    const permitted=!overviewActive&&!walking&&!build.session&&!capturePose&&!forgeDirected;
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
    momentCameraDirected=loaded&&!!moments?.update(presentationMs,frame,!overviewActive&&!walking&&!build.session&&!capturePose&&!forgeDirected&&!arrivalCameraDirected&&!growth?.active());
    growthCameraDirected=growth?.direct(camera,target,!overviewActive&&!walking&&!build.session&&!capturePose&&!forgeDirected&&!momentCameraDirected)??false;
    // Dock acts share this director and render loop. Only the visible promoted
    // scene may spend an act; interactive and already-owned lenses keep priority.
    const dockVisible=dockActive&&document.visibilityState!=='hidden'&&canvas.clientWidth>0&&canvas.clientHeight>0&&canvas.getClientRects().length>0;
    dockActs?.update(Date.now(),loaded&&dockVisible&&!walking&&!walkSelected&&!build.session&&!build.housewarming&&!capturePose&&!forgeDirected&&!forge.status().open&&!forge.status().busy&&!momentCameraDirected&&!growthCameraDirected&&!growth?.active()&&!handoffPose);
    dockCameraDirected=!overviewActive&&(dockVisuals?.active()??false);
    placeShot.apply(camera,target,{walking:walking||walkSelected,capture:!!capturePose||overviewActive,build:!!build.session||!!build.housewarming,
      forge:forgeDirected||forge.status().open||forge.status().busy,arrival:arrivalCameraDirected||!!arrivalShot,
      moment:momentCameraDirected,growth:growthCameraDirected||!!growth?.active(),dock:dockCameraDirected,handoff:!!handoffPose});
    if(!walking&&!forgeDirected&&!momentCameraDirected&&!growthCameraDirected&&!dockCameraDirected)camera.lookAt(target);
    if(handoffPose&&!walking&&!capturePose){
      // Preserve the outgoing lens, then yield smoothly to the production director.
      if(loaded&&!handoffAwaiter)handoffPose.elapsed+=dt;
      const blend=THREE.MathUtils.smoothstep(handoffPose.elapsed,0,1);
      camera.position.lerp(new THREE.Vector3(...handoffPose.view.eye),1-blend);
      camera.quaternion.slerp(handoffPose.rotation,1-blend);
      camera.fov=THREE.MathUtils.lerp(handoffPose.view.fov,camera.fov,blend);camera.updateProjectionMatrix();
      if(blend===1)handoffPose=undefined;
    }
    overview?.apply(camera,target);
    if(handoffAwaiter){
      camera.position.set(...handoffAwaiter.view.eye);camera.lookAt(new THREE.Vector3(...handoffAwaiter.view.target));
      camera.fov=handoffAwaiter.view.fov;camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();forgeFlight.update();walk?.interact(now);walk?.draw(now);observed?.draw(now,!walk);crowd.drawLanterns(time,night,camera,walk?.grips??observed?.grips);updateInstances(fixedTime&&autoCamera?time*1000:now);
    placeMounts.tick(dt,now);kingdomLayers?.tick(dt,now);
    canopy.sync();canopy.setWind(time,[0.8,0.6],0.8);
    homeLife.update(presentationMs,time,growthLifeHidden.size&&lightFrame?{...lightFrame,windows:lightFrame.windows.filter(w=>!growthLifeHidden.has(w.slot))}:lightFrame,hour,camera);royalLife.update(time,frame,hour,dockGateFlame);
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
    const nextWaterQuality=sceneQualityBudget(qualityChoice,openedQuality,canvas.clientWidth).water;
    if(nextWaterQuality!==waterQuality){waterQuality=nextWaterQuality;water.setQuality(waterQuality);}
    water.update({time,environment:grade,camera,sources:[
      ...[...windows.getSources(),...build.getSources()].map(source=>({...source,kind:'window' as const})),
      {position:beaconPosition,strength:beacon,kind:'beacon'},
      ...[...royalLife.sources(),...(civicLife?.sources()??[]),...forgeFire.sources(),...forgeHearth.sources(),...crowd.sources(),...(dockVisuals?.sources()??[])].map(source=>({...source,kind:'lamp' as const})),
    ]});
    dressing.hideLot(buildHidden?simulation.firstSlot:null);
    dressing.update({time,walkers:(walk?.poses??observed?.poses??[]).map(p=>[p.x,p.y,p.z] as Vec3)});
    if(now-lastField>240){lastField=now;const lightFocus=forgeDirected&&realmForge?realmForge.focusPoint:target;const centre:Vec3=[lightFocus.x,terrainHeight(layout,lightFocus.x,lightFocus.z),lightFocus.z];const sources=[...windows.getSources(),...build.getSources(),...homeLife.sources(),...(civicLife?.sources()??[]),...royalLife.sources(),...forgeFire.sources(),...forgeHearth.sources(),...crowd.sources(),...forge.sources(),...(realmForge?.sources()??[]),...(growth?.sources()??[]),...(dockVisuals?.sources()??[]),...raidTorchLights(moments?.metrics())];field.update(centre,sources);farField.update(centre,sources);beaconField.update(beaconPosition,[{position:beaconPosition,strength:beacon,normal:[0,1,0]},...windows.getSources().filter(source=>source.slot===65534),...royalLife.sources()]);}
    const people=walk??observed;
    if(people)options.onWalkers?.(people.labels().filter(label=>{
      const person=people.poses.find(p=>p.id===label.id);
      return person&&!windowOccluded(nearBlockers,[camera.position.x,camera.position.y,camera.position.z],[person.x,person.y+1.95,person.z]);
    }));
    if(now-lastNames>80){const namedHomes=labels();options.onSpeech?.(crowd.speechLabels(camera,canvas.clientWidth,canvas.clientHeight,presentationMs,namedHomes,people?.heads));options.onMomentCaptions?.(moments?.captions()??[]);lastNames=now;}
    // Fixed evidence frames have no animation between seeks. Keep the public
    // feed/watchdog alive, but don't burn SwiftShader CPU redrawing identical
    // pixels while a capture waits on fonts, a field worker or the filesystem.
    const renderKey=[dockCameraDirected?now:0,poseRevision,overview?.revision??0,placeShot.revision,placeMounts.revision,kingdomLayers?.revision??0,forge.renderRevision,build.renderRevision,loaded,time,hour,camName,geometryBuilds,grandLand?.revision??0,fixedTime?moments?.metrics().view['pennantWall.revision']??0:0,fieldUploads,frame?.epoch,frame?.sequence,canvas.width,canvas.height].join(':');
    // The stream curtain covers preparation. Keep the bounded land install/update pump running,
    // but do not redraw a hidden high-quality reflection/post stack for every installed region.
    // The sun-shadow map is refreshed only for a frame that draws: every region attached during
    // startup dirties it, and re-rendering the whole static shadow pass per install starved the pump.
    // The first loaded frame below still draws the full native view before announcing ready.
    if((loaded||!useGrandLand)&&(!grandLand||grandLand.canPresent())&&((loaded&&(!fixedTime||!!walk))||renderKey!==lastRenderedKey)){renderPhase='drawing';renderStartedAt=performance.now();if(loaded)sunShadows.updateSunDirection(grade.sunDirection);water.reflect({renderer,scene,camera,frame:++waterFrame,exclusions:atmosphere.reflectionExclusions});post.render(dt);stills.drawn();if(!landPresentationDeferred||handoffAwaiter){grandLand?.markPresented();landPresentationDeferred=false;}renderCompletedAt=performance.now();if(handoffAwaiter){const complete=handoffAwaiter;handoffAwaiter=undefined;complete.resolve();}renderPhase='drawn';lastRenderedKey=renderKey;if(dockVisible){dockActs?.drawn();if(dockVisuals?.finished())dockActs?.finish();}}
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
  function staticClayShadow(blueprint:VoxelBlueprint):boolean{
    if(blueprint.kind==='flora'||treeBatches.some(batch=>batch.blueprint===blueprint&&batch.canopy))return false;
    const key=blueprintKey(blueprint);
    return !installed?.forgeHosts.some(home=>home.slot===65534&&blueprintKey(home.blueprint)===key)
      && !(lifeSites.standard&&blueprintKey(lifeSites.standard.blueprint)===key);
  }
  const assets=[...blueprints.values(),...trees],total=assets.length*3;let completed=0;
  // Coarse geometry is available first. Every resolution is prepared in workers; window anchors stay exact.
  const assetJobs=([4,2,1] as const).flatMap(factor=>assets.map(blueprint=>({factor,blueprint})));let nextAsset=0;
  // Keep room for shore, dressing and citizen jobs in the shared bounded pool.
  const tasks:Promise<unknown>[]=Array.from({length:Math.min(8,assetJobs.length)},async()=>{
    while(nextAsset<assetJobs.length){const {factor,blueprint:b}=assetJobs[nextAsset++]!;
    const shadow=factor===1&&staticClayShadow(b);
    const job={kind:'blueprint' as const,blueprint:b,revision:1,materials:registry.materials,materialRevision:registry.revision,...(factor===1?{}:{lodFactor:factor}),...(shadow?{shadow:'opaque-faces-v1' as const}:{})};
    const result=await pool.submit(job);if(disposed||result?.kind!=='asset')return;
    const treeIndex=trees.indexOf(b);
    const placements=treeIndex>=0?treeBatches[treeIndex]!.placements:renderContent.filter(h=>blueprintKey(h.blueprint)===blueprintKey(b));
    if(shadow&&result.shadowChunks===undefined)throw new Error('The voxel worker omitted requested shadow geometry');
    instance(b,result.chunks,placements,factor,result.shadowChunks);options.onProgress(castleBuildings.some(module=>module.blueprint.id===b.id)?'Opening the castle gate':treeIndex>=0?'Planting the old woods':'Raising the homes',++completed/total);
    }
  });
  if(growth)tasks.push(growth.ready);
  tasks.push(dressing.ready);
  tasks.push(shore.prepare());
  if(useGrandLand){
    canvas.dataset.hostedLand=JSON.stringify({phase:'opening',kingdomId:String(options.founded!.kingdomId)});
    tasks.push(Promise.resolve(landReceipt!).then(receipt=>prepareHostedGrandLand({scene,camera,renderer,plan:layout,receipt,...(publishedLand?.kind==='published'?{binding:publishedLand.binding}:{}),kingdomId:String(options.founded!.kingdomId),recipe:grandRecipe!,signal:abort.signal,
      materialFactory:(palette,town)=>{const material=createHostedGrandMaterial(palette,ground,town);sunShadows.bindReceiver(material.material);return material;},
      register:mesh=>sunShadows.register(mesh),
      onProgress:fraction=>options.onProgress('Opening the wider kingdom',.7+.25*fraction),
      onError:error=>failLight(error.message),
    })).then(async land=>{
      if(disposed){land.dispose();return;}
      grandLand=land;setHero();landSurface=grandFloorSurface(layout,{seaLevel:land.water.raster.seaLevel});
      if(options.overview){
        const physical=new THREE.Box3(new THREE.Vector3(layout.bounds.minX,layout.castle.centre[1],layout.bounds.minZ),new THREE.Vector3(layout.bounds.maxX,layout.castle.centre[1],layout.bounds.maxZ));
        // Ordered installed blueprints determine the town's true vertical extent; no guessed city layout.
        for(const asset of [...houses,...props])for(const x of [0,asset.blueprint.size[0]/8])for(const y of [0,asset.blueprint.size[1]/8])for(const z of [0,asset.blueprint.size[2]/8])physical.expandByPoint(new THREE.Vector3(x,y,z).applyAxisAngle(new THREE.Vector3(0,1,0),asset.yaw).add(new THREE.Vector3(...asset.position)));
        overview=own(createGrandOverview(canvas,overviewFrame(land.bounds,physical,camera.aspect),overviewView));
        overview.setActive(overviewOwnsLens());overview.apply(camera,target);camera.updateMatrixWorld();
      }
      camera.far=Math.max(camera.far,land.bounds.getSize(new THREE.Vector3()).length()+(overview?overview.inspect().limits.maxDistance:camera.position.length()));camera.updateProjectionMatrix();
      const replacement=own(createWaterSurface({bodies:[],reaches:[],ground:land.water.ground,raster:land.water.raster,quality:waterQuality}));
      water.root.removeFromParent();water.dispose();water=replacement;scene.add(water.root);
      poseRevision++;
      await land.ready;
    }));
  }else tasks.push(loadTerrain(layout,()=>{}, {signal:abort.signal}).then(({chunks,origin})=>{
    if(disposed)return;
    for(const tile of terrainBatches(chunks)){
      const geometry=geometryFromChunks(tile,'terrain');geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);geometry.boundingSphere=geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());geometries.push(geometry);
      const mesh=new THREE.Mesh(geometry,ground.material);mesh.position.set(...origin);scene.add(mesh);sunShadows.register(mesh);meshes.push(mesh);geometryBuilds++;
    }
  }));
  function dispose(){if(disposed)return;stills.dispose();handoffAwaiter?.reject(new DOMException('The kingdom closed during view handoff','AbortError'));handoffAwaiter=undefined;const checkpoint=options.founded&&!options.replay&&crowd.checkpoint();if(checkpoint)citizenHandoff={at:Date.now(),checkpoint};disposed=true;loaded=false;debug.ready=false;cancelAnimationFrame(raf);overview?.dispose();kingdomLayers?.dispose();placeMounts.dispose();walkGeneration++;walk?.dispose();walk=undefined;observed?.dispose();observed=undefined;options.onWalkers?.([]);abort.abort();grandLand?.dispose();clearInterval(soulClockTimer);soul?.dispose();civicLife?.dispose();observer.disconnect();unsubscribe();field.dispose();farField.dispose();beaconField.dispose();growth?.dispose();unsubscribeDockState?.();dockPresenter?.dispose();dockActs?.dispose();dockVisuals?.dispose();realmForge?.dispose();forge.dispose();forgeFlight.dispose();build.dispose();crowd.dispose();homeLife.dispose();royalLife.dispose();forgeFire.dispose();forgeHearth.dispose();forgeBreath.dispose();shore.dispose();moments?.dispose();options.onMomentCaptions?.([]);pool.dispose();sunShadows.dispose();windows.dispose();atmosphere.dispose();sound.dispose();geometries.forEach(g=>g.dispose());clay.dispose();ground.dispose();canopy.dispose();floraMaterial.dispose();horizonGeometry.dispose();horizonMaterial.dispose();water.dispose();post.dispose();for(const mesh of meshes)if(mesh instanceof THREE.InstancedMesh)mesh.dispose();renderer.dispose();scene.clear();canvas.removeEventListener('webglcontextlost',contextLost);options.signal?.removeEventListener('abort',dispose);}
  function contextLost(event:Event){event.preventDefault();dispose();options.onError('The kingdom lost its rendering context');}
  canvas.addEventListener('webglcontextlost',contextLost);options.signal?.addEventListener('abort',dispose,{once:true});
  if(options.signal?.aborted)dispose();
  // These meshes already render progressively under the gate. Do not put a
  // second compileAsync barrier between those successful draws and opening:
  // KHR_parallel_shader_compile is an optional driver completion hint, and can
  // remain pending even while the scene draws. The first fully loaded render
  // opens the gate; background light readiness is reported independently.
  try {await Promise.all(tasks);
    if(disposed)throw new Error('Scene closed while loading');
    options.onProgress('Welcoming the citizens',1);await crowd.prepare();
    let foundedWorld:CollisionWorld|undefined,foundedGround:((x:number,z:number)=>Vec3|null)|undefined;
    if(options.founded&&!options.replay){
      const founded=options.founded,collision=compileFoundedScene(founded);foundedWorld=collision;
      const land=createKingdomLandInterface({scene:founded,collision,ground:{layoutRevision:founded.layoutRevision,collisionRevision:founded.collisionRevision,
        sample:(x,z)=>x>=layout.bounds.minX&&x<layout.bounds.maxX&&z>=layout.bounds.minZ&&z<layout.bounds.maxZ?foundedGroundAt(layout,x,z):null}});
      // UTC and woodland are explicit presentation defaults until Genesis supplies its biome/zone.
      const keepers=await createSoulKeeperRenderer(scene,crowd.material,pool);
      if(disposed){keepers.dispose();throw new Error('Scene closed while preparing keepers');}
      foundedGround=land.groundAt;
      soul=createSoulSceneHost(scene,foundedSoulBinding(land,'woodland',0),sound.soulHost,keepers);
      void soulClock.sync(abort.signal);
      soulClockTimer=setInterval(()=>{void soulClock.sync(abort.signal);},60_000);
    }
    if(!installed){options.onProgress('Remembering your home',1);await build.prepare();options.onProgress('Remembering your forged gifts',1);await forge.prepare();}if(options.walkerFeed&&options.founded){const world=foundedWorld??compileFoundedScene(options.founded);const next=await createObservedWalkers(scene,camera,canvas,pool,crowd.material,options.founded,options.walkerFeed,createFoundedInteractionRegistry(options.founded,world),{plan:options.founded.plan,world});if(disposed){next.dispose();throw new Error('Scene closed while preparing walkers');}observed=next;}if(disposed)throw new Error('Scene closed while preparing citizens');
    if(options.momentFeed){
      const kingdomId=options.founded?.kingdomId??options.kingdomId;
      if(!kingdomId||options.founded&&options.momentFeed.origin!==options.founded.origin)throw new Error('Moments need this kingdom and its actual source');
      const castleKeep=installed?installed.forgeHosts.find(h=>h.slot===65534):castleBuildings.find(h=>h.id===layout.castle.beaconModuleId);
      // Raid props stand and moment shots see through this scene's one adopted world and floor (raid-show SEAMS §8).
      // The options are raid-show's to forward in its own moments module; until it does, they are inert.
      const raidHooks=foundedWorld&&foundedGround?createRaidMomentHooks({world:foundedWorld,region:layout.bounds,live:()=>!disposed,groundAt:foundedGround,
        waterDepth:(x,z)=>{const sample=landSurface?.(x,z);return sample?sample.waterDepth:null;},height:landHeight,eye:()=>camera.position.toArray() as Vec3}):{};
      moments=own(createKingdomMoments({scene,camera,canvas,target,plan:layout,houses,...(castleKeep?{castleKeep}:{}),pool,material:clay,registry,kingdomId,feed:options.momentFeed,sound:sound.moments,ground:landHeight,kit:options.forgeFamily==='tide'?'tide':'hearth',signal:abort.signal,...raidHooks}));
      // Optional future spectacles prepare on their four bounded worker lanes after the citizens. The gate
      // opens on the world drawing; a failed moment view detaches itself and reports failure in inspect().
      void moments.ready.catch(()=>{});
    }
    }catch(error){dispose();throw error;}
  loaded=true;lastFrame=performance.now();options.onProgress('The gate is opening',1);
  function detachWalk(){walkGeneration++;walkSelected=false;walk?.dispose();walk=undefined;options.onWalkers?.([]);camera.clearViewOffset();camera.filmOffset=0;camera.updateProjectionMatrix();instancesDirty=true;}
  const overviewControls=overview?{orbit:overview.orbit,reset:overview.reset,inspect:overview.inspect}:undefined;
  return {layout,debug,sound,build,forge,get overview(){return overviewControls;},forgeDirecting:()=>forgeCameraDirected,momentDirecting:()=>forgeCameraDirected||arrivalCameraDirected||momentCameraDirected||growthCameraDirected||dockCameraDirected,
    /** A full-screen native replay owns the renderer budget; live subscriptions and authority remain connected. */
    suspendRendering(){
      renderHolds++;cancelAnimationFrame(raf);overview?.setActive(false);let released=false;
      return ()=>{if(released)return;released=true;renderHolds--;if(!disposed&&renderHolds===0){lastFrame=performance.now();overview?.setActive(overviewOwnsLens());raf=requestAnimationFrame(render);}};
    },
    activateDock,
    async attachWalk(binding:KingdomWalkBinding){
      if(disposed)throw new Error('The kingdom has closed');
      checkWalkBinding(options.founded,binding);
      detachWalk();const generation=walkGeneration;
      const next=await createKingdomWalk(scene,camera,canvas,pool,crowd.material,binding,options.founded!,sound);
      if(disposed||generation!==walkGeneration){next.dispose();return;}
      try{checkWalkBinding(options.founded,binding);}catch(error){next.dispose();throw error;}
      walk=next;walkSelected=true;overview?.setActive(false);capturePose=null;autoCamera=false;poseRevision++;instancesDirty=true;
    },
    detachWalk,
    walkDebug:()=>walk?.controller.debug??null,
    interactionDebug:()=>walk?.interactionDebug??null,
    walkSelected:()=>walkSelected,
    selectWalk(selected:boolean){walkSelected=selected&&!!walk;overview?.setActive(overviewOwnsLens());if(walkSelected){capturePose=null;autoCamera=false;}else walk?.controller.release();instancesDirty=true;},
    seekGrowthCeremony(seconds:number|null){growth?.seek(seconds);},
    inspect:()=>({overview:overview?.inspect()??null,placeShot:placeShot.inspect(),land:grandLand?{identity:grandLand.identity,...grandLand.stats}:null,soul:soul?.inspect(),dock:{active:dockActive,presenting:dockVisuals?.active()??false,received:dockReceived,witnessed:dockWitnessed,sites:{gate:dockGate,plaza:dockPlaza,simulated:simulatedDockSites,failure:dockSiteFailure}},growth:growth?.inspect(),water:water.diagnostics(),shadow:{...sunShadows.stats},moments:moments?.metrics(),build:'progressive-light-v1',ambience:ambienceTarget,loaded,renderPhase,renderStartedAt,renderCompletedAt,dressing:{...dressing.stats(),counts:coverPlan.report.counts},presence:{kingdomId:frame?.kingdomId??options.kingdomId??null,focusSlot,connection:frame?.connection??null},fields:{local:field.stats,kingdom:farField.stats,beacon:beaconField.stats},uploadedBytes:{local:nearBytes,kingdom:farBytes,beacon:beaconBytes}}),subject:()=>crowd.subject(focusSlot),receiveChat:(input:unknown)=>{
      if(!crowd.receiveChat(input))return false;
      const cue=CitizenChatCueSchema.parse(input),at=Date.now();
      if(cue.asOf<=at&&at-cue.asOf<=5000&&cue.expiresAt>at)arrivalDirector?.chat(cue.slot,at);
      return true;
    },clearChat:(cueIds?:readonly string[])=>crowd.clearChat(cueIds),
    captureCitizens:()=>crowd.checkpoint(),
    restoreCitizens(checkpoint:CitizenSceneCheckpoint|undefined){citizenHandoff=undefined;crowd.restoreCheckpoint(checkpoint);instancesDirty=true;},
    captureView():SceneView{
      if(overviewOwnsLens())return overview!.capture();
      const direction=camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(16).add(camera.position);
      return {eye:camera.position.toArray() as Vec3,target:direction.toArray() as Vec3,fov:camera.fov};
    },
    async handoffView(view:SceneView):Promise<void>{
      if(disposed)throw new DOMException('The kingdom closed during view handoff','AbortError');
      startHandoff(view);
      handoffAwaiter?.reject(new DOMException('View handoff was superseded','AbortError'));
      const copy:SceneView={eye:[...view.eye],target:[...view.target],fov:view.fov};
      lastField=-Infinity;instancesDirty=true;lastRenderedKey='';
      // Keep this exact lens until the existing RAF has complete land and submits its frame.
      // A warming canvas must not become visible just because an earlier lens was ready.
      return new Promise<void>((resolve,reject)=>{handoffAwaiter={view:copy,resolve,reject};});
    },
    /** Low-priority game framing; clearing it resumes the current director without resetting it. */
    setPlaceShot(shot:PlaceShot|null){placeShot.set(shot);},
    /** The drawn ground under (x, z) on the land on screen (SEAMS A2 surfaceAt); null where unknown or still loading. Presentation and audio only. */
    surfaceAt(x:number,z:number){return landSurface?.(x,z)??null;},
    /** The held pier shot's pose when the kingdom has a pier; the director offers the shot only then. */
    pierShot:()=>pierPose(),
    /** One still of the next drawn frame, scaled to width (never above the canvas), for the panel's live picture. */
    still(width:number,options?:SceneStillOptions){return stills.still(width,options);},
    setHour(value:number){targetHour=value;sound.cue('wood');},
    /** Play's ledger setting: effects scale, palette, light, near detail and dusk windows never do. Null is automatic. */
    setQuality(value:SceneQuality|null){const budget=sceneQualityBudget(value,openedQuality,canvas.clientWidth);qualityChoice=budget.choice;post.setQuality(budget.post);lastRenderedKey='';},
    quality:()=>sceneQualityBudget(qualityChoice,openedQuality,canvas.clientWidth),
    setCamera(value:CameraName){arrivalDirector?.cancel();walkSelected=false;walk?.controller.release();capturePose=null;poseRevision++;camName=value;autoCamera=false;lastField=-Infinity;sound.cue('wood');},
    /** Evidence framing only. Null returns control to the current production camera. */
    pose(eye:Vec3|null,lookAt?:Vec3,fov=43){
      if(eye===null){capturePose=null;poseRevision++;lastField=-Infinity;instancesDirty=true;return;}
      if(eye.length!==3||!lookAt||lookAt.length!==3||![...eye,...lookAt,fov].every(Number.isFinite)||fov<10||fov>100||Math.hypot(...eye.map((value,index)=>value-lookAt[index]!))<.01)throw new Error('Capture pose needs finite distinct eye/target and a 10–100 degree FOV');
      overview?.setActive(false);capturePose={eye:[...eye],target:[...lookAt],fov};poseRevision++;autoCamera=false;lastField=-Infinity;instancesDirty=true;
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
