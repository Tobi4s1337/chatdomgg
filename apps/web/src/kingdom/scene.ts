import * as THREE from 'three';
import { createKingdomForge, type ForgeStatus } from '../forge/scene';
import { createTree, MATERIALS } from '@chatdom/content';
import { VoxelWorkerPool, type AssetChunkMesh } from '@chatdom/voxel';
import { createAtmosphere, getEnvironment, createVoxelMaterial, geometryFromChunks, createWindowLights, type WindowHouse, createWater } from '@chatdom/render';
import { generateSettlementPlan, terrainHeight, samplePublicGround, randomUnit, seedHash, type KingdomTier } from '@chatdom/world';
import type { KingdomId, KingdomPresenceFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
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
import { createCastleContent } from './castle-content';
import { inhabitedLightBounds } from './light-bounds';
import { terrainBatches } from './terrain-batches';
import { createKingdomBuild, type KingdomBuildSession } from './build-scene';
import { createKingdomCitizens, type SpeechLabel } from './citizen-scene';

export type CameraName='hero'|'window'|'citizen';
export interface NameLabel {name:string;x:number;y:number;slot:number}
export interface SceneOptions {realmName?:string;forgeFamily?:'hearth'|'tide'|'grove';nativeStyle?:'hearth'|'tide'|'grove';tier:KingdomTier;seed:string;firstYear?:number;year?:number;kingdomId?:KingdomId;focusSlot?:number;hour:number;time:number|null;camera:CameraName;source:'simulated'|'herald';presenceOrigin?:KingdomPresenceFrame['origin'];signal?:AbortSignal;onReady?:()=>void;onForge?:(status:ForgeStatus)=>void;onProgress:(text:string,fraction:number)=>void;onNames:(names:NameLabel[])=>void;onSpeech?:(labels:SpeechLabel[])=>void;onBuild?:(session:KingdomBuildSession|null)=>void;onHousewarming?:(name:string|null)=>void;onSource:(state:string)=>void;onError:(message:string)=>void}
export interface KingdomDebug {citizens:number;walking:number;ready:boolean;lightingReady:boolean;workers:number;homes:number;activeWindows:number;geometryBuilds:number;fieldUploads:number;drawCalls:number;triangles:number;time:number;hour:number;camera:CameraName;fieldBytes:number;source:string;fieldSettled:boolean;shadowUpdates:number;shadowDrawCalls:number;shadowTriangles:number;shadowBytes:number;shadowEnabled:boolean;windowFieldVisited:number;beaconFieldVisited:number}

export async function createKingdomScene(canvas:HTMLCanvasElement,options:SceneOptions) {
  let disposed=false,raf=0,loaded=false,lastFrame=performance.now(),time=options.time??30,hour=options.hour,targetHour=hour,camName=options.camera;
  let capturePose:{eye:Vec3;target:Vec3;fov:number}|null=null;
  let poseRevision=0;
  // A public feed uses the wall clock even when a capture URL carries a fixture time.
  let fixedTime=options.source==='simulated'&&options.time!==null,autoCamera=options.source==='simulated'&&!fixedTime&&camName==='hero',frame:KingdomPresenceFrame|undefined,fieldUploads=0,geometryBuilds=0,fieldBytes=0,nearBytes=0,farBytes=0,beaconBytes=0,nearVisited=0,farVisited=0,beaconVisited=0;
  const earlyCleanups:(()=>void)[]=[];
  let fullDispose:(()=>void)|undefined;
  const own=<T extends {dispose():void}>(resource:T):T=>{earlyCleanups.push(()=>resource.dispose());return resource;};
  const failLight=(message:string)=>queueMicrotask(()=>{if(disposed)return;fullDispose?.();options.onError(message);});
  try {
  const generated=generateSettlementPlan({seed:options.seed,tier:options.tier,firstYear:options.firstYear??(options.tier==='hamlet'?2025:2022),year:options.year??2026});
  const layout=options.nativeStyle?{...generated,homes:generated.homes.map(h=>({...h,style:options.nativeStyle!}))}:generated;
  const renderer=own(new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'}));
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{console.error('Kingdom shader failed',{vertex:gl.getShaderInfoLog(vertex),fragment:gl.getShaderInfoLog(fragment),link:gl.getProgramInfoLog(program)});throw new Error('A kingdom shader could not compile');};
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.15,2200),atmosphere=own(createAtmosphere(scene));
  const clay=own(createVoxelMaterial(MATERIALS,'build')),ground=own(createVoxelMaterial(MATERIALS,'terrain'));
  // Both lattices share one GPU light volume; two materials must not double the field budget.
  for(const key of ['uLight','uLightOrigin','uLightExtent','uFarLight','uFarOrigin','uFarExtent','uFarCell','uBeaconLight','uBeaconOrigin','uBeaconExtent','uBeaconCell'])ground.material.uniforms[key]=clay.material.uniforms[key]!;
  const heightOrigin:[number,number]=[Math.floor(layout.bounds.minX)-20,Math.floor(layout.bounds.minZ)-20];
  const heightWidth=Math.ceil(layout.bounds.maxX-heightOrigin[0])+21,heightDepth=Math.ceil(layout.bounds.maxZ-heightOrigin[1])+21,heightData=new Float32Array(heightWidth*heightDepth);
  for(let z=0;z<heightDepth;z++)for(let x=0;x<heightWidth;x++)heightData[x+z*heightWidth]=terrainHeight(layout,heightOrigin[0]+x,heightOrigin[1]+z);
  ground.setTerrainHeight(heightData,heightWidth,heightDepth,heightOrigin,1);ground.setShoreLevel(layout.lake.level,[layout.lake.x-layout.lake.radiusX*1.3,layout.lake.x+layout.lake.radiusX*1.3,layout.lake.z-layout.lake.radiusZ*1.3,layout.lake.z+layout.lake.radiusZ*1.3]);
  const pool=own(new VoxelWorkerPool({size:Math.min(4,Math.max(2,(navigator.hardwareConcurrency||4)-1)),maxQueue:192}));
  const geometries:THREE.BufferGeometry[]=[],meshes:THREE.Object3D[]=[],abort=new AbortController();
  earlyCleanups.push(()=>abort.abort());
  const sound=own(createKingdomSound());
  const crowd=own(createKingdomCitizens(scene,layout,pool,clay));
  const blueprints=new Map<string,VoxelBlueprint>();
  const {houses,props}=placeSettlementContent(layout.homes,(x,z)=>terrainHeight(layout,x,z));
  // Keep the meeting of the roads open. The market's well and two stalls sit
  // along its edges, as real voxel geometry in the same shadow/occlusion lists.
  props.push(...placeMarketContent(layout.market));
  const {buildings:castleBuildings,beaconPosition}=createCastleContent(layout.castle);
  const buildings=[...houses,...castleBuildings],content=[...buildings,...props];
  for(const {blueprint} of content)blueprints.set(blueprint.id,blueprint);
  const windows=own(createWindowLights(scene,houses));
  // Begin the arrival among neighbours, not alone at the newest edge of town.
  const arrivalHomes=layout.homes.filter(h=>h.tier==='house');
  const arrivalHome=arrivalHomes.sort((a,b)=>{
    const neighbours=(home:typeof a)=>layout.homes.filter(h=>Math.hypot(h.position[0]-home.position[0],h.position[2]-home.position[2])<35).length;
    return neighbours(b)-neighbours(a)||Math.hypot(a.position[0],a.position[2])-Math.hypot(b.position[0],b.position[2]);
  })[0];
  const simulation=createSimulatedPresence(layout,arrivalHome?{firstSlot:arrivalHome.slot,waveSeconds:6}:undefined);
  const source=options.source==='simulated'?simulation.feed:createHeraldPresence('/presence-data/stream',options.kingdomId,options.presenceOrigin??'live');
  const first=houses.find(h=>h.slot===simulation.firstSlot)!;
  const requestedFocus=houses.some(h=>h.slot===options.focusSlot)?options.focusSlot:undefined;
  let focusSlot=requestedFocus??(options.source==='simulated'?simulation.firstSlot:houses[0]!.slot);
  const focal=new THREE.Vector3(),homeEye=new THREE.Vector3(),homeTarget=new THREE.Vector3(),citizenEye=new THREE.Vector3();
  function focusHome(slot:number){
    const home=houses.find(h=>h.slot===slot),route=crowd.motion.routeForSlot(slot);if(!home||!route)return;
    focusSlot=slot;const pane=home.blueprint.windows[0]!;
    focal.set(...pane.centre).multiplyScalar(.125).applyAxisAngle(new THREE.Vector3(0,1,0),home.yaw).add(new THREE.Vector3(...home.position));
    const angle=({north:Math.PI,east:Math.PI/2,south:0,west:-Math.PI/2}[pane.facing])+home.yaw;
    homeEye.copy(focal).add(new THREE.Vector3(Math.sin(angle)*7+1.8,2.1,Math.cos(angle)*7));
    homeTarget.copy(focal).add(new THREE.Vector3(Math.cos(angle)*1.3,1.1,-Math.sin(angle)*1.3));
    citizenEye.set(...route.points.at(-1)!).add(new THREE.Vector3(Math.sin(angle)*6.5-Math.cos(angle)*13,5.5,Math.cos(angle)*6.5+Math.sin(angle)*13));
  }
  focusHome(focusSlot);
  const heroEye=new THREE.Vector3(),heroTarget=new THREE.Vector3(),target=new THREE.Vector3();
  const portrait=()=>canvas.clientWidth<canvas.clientHeight;
  let heroFov=53;
  function setHero(){
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
  function resize(){renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;setHero();sunShadows.setResolution(portrait()?1024:2048);}
  const observer=new ResizeObserver(resize);earlyCleanups.push(()=>observer.disconnect());observer.observe(canvas);resize();
  const blockers=buildings;
  const lightBounds=inhabitedLightBounds(layout.homes);
  const nearBlockers=[...blockers,...props.map(p=>({...p,slot:65534}))];
  // Half-metre local occupancy resolves the little garden edges. Expanding a
  // sub-two-metre prop into whole distant cells would falsely seal the street.
  const field=own(createLightField(layout,nearBlockers,volume=>{if(disposed)return;clay.setLight(volume);fieldUploads++;nearBytes=volume.estimatedPeakBytes;nearVisited=volume.visited;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The light could not reach the kingdom')));
  const farField=own(createLightField(layout,blockers,volume=>{if(disposed)return;clay.setFarLight(volume);fieldUploads++;farBytes=volume.estimatedPeakBytes;farVisited=volume.visited;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The light could not reach the kingdom'),{mode:'kingdom',bounds:lightBounds}));
  const beaconField=own(createLightField(layout,blockers,volume=>{if(disposed)return;clay.setBeaconLight(volume);fieldUploads++;beaconBytes=volume.estimatedPeakBytes;beaconVisited=volume.visited;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The castle light could not reach its towers'),{mode:'beacon',position:beaconPosition}));
  let lastField=-Infinity,lastNames=-Infinity,lastActive=0,beaconCue=false;
  const unsubscribe=source.subscribe(next=>{frame=next;crowd.applyFrame(next);if(options.source==='herald'&&requestedFocus===undefined){const present=next.windows.find(w=>w.present&&houses.some(h=>h.slot===w.slot));if(present)focusHome(present.slot);}lastField=-Infinity;options.onSource(next.origin==='simulated'?'SIMULATED':next.connection==='fresh'?'LIVE CHAT':next.connection==='offline'?'STREAM RESTING':'CONNECTION LOST');},()=>{windows.clear();crowd.clear();frame=undefined;lastField=-Infinity;options.onSource('CONNECTION LOST');});
  earlyCleanups.push(unsubscribe);
  const debug:KingdomDebug={citizens:0,walking:0,ready:false,lightingReady:false,workers:pool.stats.size+4,homes:houses.length,activeWindows:0,geometryBuilds:0,fieldUploads:0,drawCalls:0,triangles:0,time:0,hour,camera:camName,fieldBytes:0,source:source.label,fieldSettled:false,shadowUpdates:0,shadowDrawCalls:0,shadowTriangles:0,shadowBytes:0,shadowEnabled:false,windowFieldVisited:0,beaconFieldVisited:0};
  type Placement={position:Vec3;yaw:number};
  type RenderBatch={transitions:Map<Placement,DetailTransition>;blueprint:VoxelBlueprint;placements:readonly Placement[];levels:Map<number,THREE.InstancedMesh>};
  const batches=new Map<string,RenderBatch>();
  let buildHidden=false;
  let instancesDirty=true;
  const build=own(createKingdomBuild({scene,camera,canvas,pool,material:clay,home:layout.homes.find(h=>h.slot===simulation.firstSlot)!,authoredHome:first,
    ownerId:`simulated:${options.seed}:${options.tier}:juniper`,ownerName:'Juniper',source:options.source==='simulated'?'SIMULATED':'LIVE',sound,
    onSession:session=>options.onBuild?.(session),onHousewarming:name=>options.onHousewarming?.(name),
    onHomeVisibility:hidden=>{buildHidden=hidden;windows.setHidden(simulation.firstSlot,hidden);refreshOwnHomeShadow();instancesDirty=true;lastLightFrameKey='';lastField=-Infinity;sunShadows.invalidate();},
    onStreetHome:replacement=>{if(disposed)return;for(const list of [houses,blockers,nearBlockers]){const i=list.findIndex(h=>h.slot===simulation.firstSlot);if(i>=0)list[i]=replacement??first;}field.replaceHouses(nearBlockers);farField.replaceHouses(blockers);beaconField.replaceHouses(blockers);lastField=-Infinity;},registerShadow:mesh=>sunShadows.register(mesh),
  }));
  const forge=own(createKingdomForge({scene,camera,canvas,pool,material:clay,anvil:new THREE.Vector3(0,layout.market.elevation,8),home:()=>build.streetHome??first,source:options.source,seed:`${options.seed}:${options.tier}`,kingdomName:options.realmName??'Willowmere',family:options.forgeFamily??'tide',sound,onArrival:home=>{
    if(options.source!=='simulated'||!frame)return;
    const at=simulation.epochMs+time*1000,near=frame.windows.filter(w=>w.present).map(w=>({window:w,house:houses.find(h=>h.slot===w.slot)})).filter(p=>p.house&&p.house.slot!==home.slot).sort((a,b)=>Math.hypot(a.house!.position[0]-home.position[0],a.house!.position[2]-home.position[2])-Math.hypot(b.house!.position[0]-home.position[0],b.house!.position[2]-home.position[2])).slice(0,2);
    near.forEach(({window},i)=>crowd.receiveChat({version:1,id:`simulated-forge-${Math.floor(at)}-${i}`,kingdomId:frame!.kingdomId,epoch:frame!.epoch,origin:'simulated',slot:window.slot,asOf:Math.floor(at),expiresAt:Math.floor(at+9000),parts:[{kind:'text',text:i?'It belongs here. ✨':'Oh, look at that!'}]}));
  },onStatus:status=>options.onForge?.(status),registerShadow:mesh=>sunShadows.register(mesh)}));
  function refreshOwnHomeShadow(){
    if(disposed)return;
    const batch=batches.get(first.blueprint.id),mesh=batch?.levels.get(1);if(!batch||!mesh)return;
    mesh.count=0;const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
    for(const placement of batch.placements){if(buildHidden&&placement===first)continue;matrix.compose(new THREE.Vector3(...placement.position),rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),placement.yaw),new THREE.Vector3(1,1,1));mesh.setMatrixAt(mesh.count++,matrix);}
    sunShadows.register(mesh);instancesDirty=true;
  }
  function instance(blueprint:VoxelBlueprint,chunks:readonly AssetChunkMesh[],placements:readonly Placement[],factor:1|2|4=1){
    const geometry=geometryFromChunks(chunks,'build');geometry.setAttribute('aLodFade',new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1),1));geometries.push(geometry);
    const mesh=new THREE.InstancedMesh(geometry,clay.material,placements.length);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3();
    placements.forEach((p,i)=>{m.compose(v.set(...p.position),q.setFromAxisAngle(new THREE.Vector3(0,1,0),p.yaw),new THREE.Vector3(factor,factor,factor));mesh.setMatrixAt(i,m);});
    mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.name=blueprint.id;scene.add(mesh);meshes.push(mesh);geometryBuilds++;
    if(factor===(blueprint.kind==='flora'?2:1))sunShadows.register(mesh);
    const batch=batches.get(blueprint.id)??{transitions:new Map<Placement,DetailTransition>(),blueprint,placements,levels:new Map<number,THREE.InstancedMesh>()};
    batch.levels.set(factor,mesh);batches.set(blueprint.id,batch);instancesDirty=true;
  }
  const lastInstanceEye=new THREE.Vector3(Infinity,Infinity,Infinity),lastInstanceTarget=new THREE.Vector3(),frustum=new THREE.Frustum();
  let lastInstanceAspect=0;
  function updateInstances(now:number){
    if(!instancesDirty&&lastInstanceEye.distanceToSquared(camera.position)<.00001&&lastInstanceTarget.distanceToSquared(target)<.00001&&lastInstanceAspect===camera.aspect)return;
    instancesDirty=false;lastInstanceEye.copy(camera.position);lastInstanceTarget.copy(target);lastInstanceAspect=camera.aspect;
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),centre=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0);
    for(const {blueprint,placements,levels,transitions} of batches.values()){
      for(const mesh of levels.values())mesh.count=0;
      const conservativeSize=new THREE.Vector3(...blueprint.size.map(axis=>Math.ceil(axis/4)*4)).multiplyScalar(.125),radius=conservativeSize.length()/2;
      for(const p of placements){
        if(buildHidden&&p===first)continue;
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
      }
      for(const mesh of levels.values()){mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;(mesh.geometry.getAttribute('aLodFade') as THREE.InstancedBufferAttribute).needsUpdate=true;}
    }
  }
  // Distant hills use 20 m cells on both sizes; the grounded 1 m collar stays
  // exact. One surface/sampler keeps groves grounded across viewport changes.
  const {geometry:horizonGeometry,sampleHeight:landHeight}=createHorizonSurface(layout,{farStep:20,sampleTerrain:(x,z)=>terrainHeight(layout,x,z)});earlyCleanups.push(()=>horizonGeometry.dispose());
  const trees=[createTree(0),createTree(1),createTree(2)];
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
    const nearby=reservationCells.get(`${Math.floor(x/indexStep)},${Math.floor(z/indexStep)}`)??[];
    if(nearby.some(({lot})=>x>lot.minX-crown&&x<lot.maxX+crown&&z>lot.minZ-crown&&z<lot.maxZ+crown))return;
    if((samplePublicGround(layout,x,z)?.reservedDistance??Infinity)<crown)return;
    const castle=layout.castle.bounds;
    if(x>castle.minX-crown&&x<castle.maxX+crown&&z>castle.minZ-crown&&z<castle.maxZ+crown)return;
    if(Math.hypot((x-layout.lake.x)/layout.lake.radiusX,(z-layout.lake.z)/layout.lake.radiusZ)<1.19)return;
    if(planted.some(p=>p.distanceToSquared(new THREE.Vector2(x,z))<8))return;
    planted.push(new THREE.Vector2(x,z));treePlaces[variant]!.push({position:[x-4,rootHeight(x,z),z-4],yaw:0});
  };
  const activeCourts=new Set(layout.homes.map(home=>home.courtId));
  for(const [i,court] of layout.courts.entries()){
    if(!activeCourts.has(court.id))continue;
    const anchor=layout.nodes.find(node=>node.id===court.nodeId)!;
    const radius=Math.max(...court.boundary.map(([x,z])=>Math.hypot(x-anchor.position[0],z-anchor.position[2])))+7;
    for(let side=0;side<8;side++){
      const angle=side*Math.PI/4;
      plant(anchor.position[0]+Math.cos(angle)*radius,anchor.position[2]+Math.sin(angle)*radius,(i+side)%3);
    }
  }
  for(let i=0;i<treeCount*12&&planted.length<treeCount;i++) {
    const group=Math.floor(i/7),rand=(part:string)=>randomUnit(seedHash(`${options.seed}:grove:${part}`));
    const cx=layout.bounds.minX-35+rand(`${group}:x`)*(layout.bounds.maxX-layout.bounds.minX+70);
    const cz=layout.bounds.minZ-65+rand(`${group}:z`)*(layout.bounds.maxZ-layout.bounds.minZ+45);
    const angle=rand(`${i}:angle`)*Math.PI*2,radius=Math.sqrt(rand(`${i}:radius`))*10;
    plant(cx+Math.cos(angle)*radius,cz+Math.sin(angle)*radius,group%3);
  }
  // A continuous distant land silhouette lies beyond the detailed editable terrain.
  const horizonMaterial=own(new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:ground.material.uniforms,fragmentShader:ground.material.fragmentShader,vertexShader:`out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}`}));const horizon=new THREE.Mesh(horizonGeometry,horizonMaterial);scene.add(horizon);sunShadows.bindReceiver(horizonMaterial);sunShadows.register(horizon);
  const water=own(createWater(scene,{lake:layout.lake,terrain:{data:heightData,width:heightWidth,height:heightDepth,origin:heightOrigin,step:1}}));
  function labels(){const names:NameLabel[]=[];for(const s of [...windows.getSources(),...build.getSources()]){
    if(!s.name||s.strength<.1)continue;const p=new THREE.Vector3(...s.position),to=camera.position.clone().sub(p);
    if(to.length()>32||to.dot(new THREE.Vector3(...s.normal))<2)continue;
    if(windowOccluded(nearBlockers,[camera.position.x,camera.position.y,camera.position.z],s.position))continue;
    p.y+=1.1;p.project(camera);if(p.z>1||p.z<0||Math.abs(p.x)>.91||Math.abs(p.y)>.88)continue;
    names.push({name:s.name,slot:s.slot,x:(p.x+1)*canvas.clientWidth/2,y:(1-p.y)*canvas.clientHeight/2});
  }options.onNames(names.slice(0,3));}
  const fog=new THREE.FogExp2(0x000000);scene.fog=fog;
  let lastRenderedKey='',lastLightFrameKey='';
  let announcedReady=false;
  let renderPhase:'preparing'|'drawing'|'drawn'='preparing',renderStartedAt=0,renderCompletedAt=0;
  function render(now:number){
    if(disposed)return;try {const dt=Math.max(0,(now-lastFrame)/1000);lastFrame=now;
    if(loaded&&debug.ready&&!fixedTime)time+=dt;
    if(options.source==='simulated')simulation.advance(time);
    hour+=Math.min(1,dt*4)*(targetHour-hour);if(Math.abs(targetHour-hour)<.001)hour=targetHour;const grade=getEnvironment(hour);clay.setEnvironment(grade);ground.setEnvironment(grade);forge.setEnvironment(grade);crowd.material.setEnvironment({...grade,ambientIntensity:Math.max(.65,grade.ambientIntensity)});
    const presentationMs=options.source==='simulated'?simulation.epochMs+time*1000:Date.now();
    const citizens=loaded?crowd.update(presentationMs,time,camera):[];
    const lightFrame=loaded?crowd.lightFrame(presentationMs):frame;
    if(lightFrame)build.setFrame(lightFrame);
    const lightKey=`${lightFrame?.epoch}:${lightFrame?.sequence}:${lightFrame?.windows.filter(w=>w.present).map(w=>w.slot).join(',')}`;
    if(lightFrame&&lightKey!==lastLightFrameKey){windows.setFrame(buildHidden?{...lightFrame,windows:lightFrame.windows.filter(w=>w.slot!==simulation.firstSlot)}:lightFrame);lastLightFrameKey=lightKey;lastField=-Infinity;}
    if(options.source==='simulated'&&frame){const person=frame.windows.find(w=>w.slot===simulation.firstSlot);if(person?.present&&time>=3&&time<9)crowd.receiveChat({version:1,id:'simulated-evening',kingdomId:frame.kingdomId,epoch:frame.epoch,origin:'simulated',slot:simulation.firstSlot,asOf:simulation.epochMs+3000,expiresAt:simulation.epochMs+9000,parts:[{kind:'text',text:'Evening, everyone! 🌿'}]});}
    const arrival=crowd.subject(simulation.firstSlot);
    if(options.source==='simulated'&&frame&&arrival?.homeLitAtMs&&presentationMs-arrival.homeLitAtMs<6000)crowd.receiveChat({version:1,id:'simulated-home',kingdomId:frame.kingdomId,epoch:frame.epoch,origin:'simulated',slot:simulation.firstSlot,asOf:Math.ceil(arrival.homeLitAtMs),expiresAt:Math.ceil(arrival.homeLitAtMs+6000),parts:[{kind:'text',text:'Home, at last. ✨'}]});
    windows.update(fixedTime?(autoCamera?0:1):dt,hour);
    const active=lightFrame?.windows.filter(w=>w.present).length??0;
    const beacon=beaconStrength(lightFrame,houses.length);
    if(loaded&&active>lastActive){if(lastActive===0)sound.cue('light');else if(lastActive===1)sound.cue('wave');}lastActive=active;
    if(loaded&&beacon>.9&&!beaconCue){sound.cue('beacon');beaconCue=true;}
    if(autoCamera){
      // Rise inside the street before withdrawing over the opposite roofs.
      const subject=crowd.subject(focusSlot),pull=THREE.MathUtils.smootherstep(time,18,36);
      if(subject){const p=new THREE.Vector3(...subject.position);camera.position.copy(citizenEye);target.copy(p).add(new THREE.Vector3(0,1.05,0));}
      else {camera.position.copy(homeEye);target.copy(homeTarget);}
      camera.position.lerp(heroEye,pull);target.lerp(heroTarget,pull);
    }
    else if(camName==='citizen'){const person=crowd.subject(focusSlot);const p=person?new THREE.Vector3(...person.position):focal.clone();camera.position.copy(citizenEye);target.copy(p).add(new THREE.Vector3(0,1.05,0));}
    else if(camName==='window'){camera.position.copy(homeEye);target.copy(homeTarget);}else{camera.position.copy(heroEye);target.copy(heroTarget);}
    const wantedFov=autoCamera?THREE.MathUtils.lerp(48,heroFov,THREE.MathUtils.smootherstep(time,18,36)):camName==='citizen'?48:camName==='window'?64:heroFov;
    if(Math.abs(camera.fov-wantedFov)>.001){camera.fov=wantedFov;camera.updateProjectionMatrix();}
    build.update(now,dt,hour,target);forge.update(now,target,!!build.session);
    if(capturePose){camera.position.set(...capturePose.eye);target.set(...capturePose.target);if(camera.fov!==capturePose.fov){camera.fov=capturePose.fov;camera.updateProjectionMatrix();}}
    camera.lookAt(target);camera.updateMatrixWorld();updateInstances(fixedTime&&autoCamera?time*1000:now);
    atmosphere.update(hour,time,camera,new THREE.Vector3(...beaconPosition),beacon);
    fog.color.set(grade.fog);fog.density=.0016;
    water.update(grade,time,camera);
    if(now-lastField>240){lastField=now;const centre:Vec3=[target.x,terrainHeight(layout,target.x,target.z),target.z];field.update(centre,[...windows.getSources(),...build.getSources()]);farField.update(centre,[...windows.getSources(),...build.getSources()]);beaconField.update(beaconPosition,[{position:beaconPosition,strength:beacon,normal:[0,1,0]}]);}
    if(now-lastNames>80){labels();options.onSpeech?.(crowd.speechLabels(camera,canvas.clientWidth,canvas.clientHeight,presentationMs));lastNames=now;}
    if(loaded)sunShadows.updateSunDirection(grade.sunDirection);
    // Fixed evidence frames have no animation between seeks. Keep the public
    // feed/watchdog alive, but don't burn SwiftShader CPU redrawing identical
    // pixels while a capture waits on fonts, a field worker or the filesystem.
    const renderKey=[poseRevision,forge.renderRevision,build.renderRevision,loaded,time,hour,camName,geometryBuilds,fieldUploads,frame?.epoch,frame?.sequence,canvas.width,canvas.height].join(':');
    if((loaded&&!fixedTime)||renderKey!==lastRenderedKey){renderPhase='drawing';renderStartedAt=performance.now();renderer.render(scene,camera);renderCompletedAt=performance.now();renderPhase='drawn';lastRenderedKey=renderKey;}
    // The gate covers loading the place, not background light refinement. The
    // full scene and presence windows have drawn; independently scheduled light
    // workers may still be waking. Captures can wait on lightingReady separately.
    Object.assign(debug,{citizens:citizens.length,walking:citizens.filter(c=>c.state==='walking').length,ready:loaded&&renderCompletedAt>0,lightingReady:nearBytes>0&&farBytes>0&&beaconBytes>0,activeWindows:active,geometryBuilds,fieldUploads,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,time,hour,camera:camName,fieldBytes,shadowUpdates:sunShadows.stats.updates,shadowDrawCalls:sunShadows.stats.drawCalls,shadowTriangles:sunShadows.stats.triangles,shadowBytes:sunShadows.stats.textureBytes+sunShadows.stats.transformBytes,shadowEnabled:sunShadows.stats.enabled,windowFieldVisited:nearVisited+farVisited,beaconFieldVisited:beaconVisited,fieldSettled:field.stats.publishedRevision===field.stats.requestedRevision&&!field.stats.busy&&!field.stats.queued&&farField.stats.publishedRevision===farField.stats.requestedRevision&&!farField.stats.busy&&!farField.stats.queued&&farBytes>0&&beaconField.stats.publishedRevision===beaconField.stats.requestedRevision&&!beaconField.stats.busy&&!beaconField.stats.queued&&beaconBytes>0});
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
  const tasks=([4,2,1] as const).flatMap(factor=>assets.map(async b=>{
    const job={kind:'blueprint' as const,blueprint:b,revision:1,materials:MATERIALS.materials,materialRevision:MATERIALS.revision,...(factor===1?{}:{lodFactor:factor})};
    const result=await pool.submit(job);if(disposed||result?.kind!=='asset')return;
    const treeIndex=trees.indexOf(b);
    const placements=treeIndex>=0?treePlaces[treeIndex]!:content.filter(h=>h.blueprint.id===b.id);
    instance(b,result.chunks,placements,factor);options.onProgress(castleBuildings.some(module=>module.blueprint.id===b.id)?'Opening the castle gate':treeIndex>=0?'Planting the old woods':'Raising the homes',++completed/total);
  }));
  tasks.push(loadTerrain(layout,()=>{}, {signal:abort.signal}).then(({chunks,origin})=>{
    if(disposed)return;
    for(const tile of terrainBatches(chunks)){
      const geometry=geometryFromChunks(tile,'terrain');geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);geometry.boundingSphere=geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());geometries.push(geometry);
      const mesh=new THREE.Mesh(geometry,ground.material);mesh.position.set(...origin);scene.add(mesh);sunShadows.register(mesh);meshes.push(mesh);geometryBuilds++;
    }
  }));
  function dispose(){if(disposed)return;disposed=true;loaded=false;debug.ready=false;cancelAnimationFrame(raf);abort.abort();observer.disconnect();unsubscribe();field.dispose();farField.dispose();beaconField.dispose();forge.dispose();build.dispose();crowd.dispose();pool.dispose();sunShadows.dispose();windows.dispose();atmosphere.dispose();sound.dispose();geometries.forEach(g=>g.dispose());clay.dispose();ground.dispose();horizonGeometry.dispose();horizonMaterial.dispose();water.dispose();for(const mesh of meshes)if(mesh instanceof THREE.InstancedMesh)mesh.dispose();renderer.dispose();scene.clear();canvas.removeEventListener('webglcontextlost',contextLost);options.signal?.removeEventListener('abort',dispose);}
  function contextLost(event:Event){event.preventDefault();dispose();options.onError('The kingdom lost its rendering context');}
  canvas.addEventListener('webglcontextlost',contextLost);options.signal?.addEventListener('abort',dispose,{once:true});
  if(options.signal?.aborted)dispose();
  // These meshes already render progressively under the gate. Do not put a
  // second compileAsync barrier between those successful draws and opening:
  // KHR_parallel_shader_compile is an optional driver completion hint, and can
  // remain pending even while the scene draws. The first fully loaded render
  // opens the gate; background light readiness is reported independently.
  try {await Promise.all(tasks);if(disposed)throw new Error('Scene closed while loading');await crowd.prepare();await build.prepare();await forge.prepare();if(disposed)throw new Error('Scene closed while preparing citizens');}catch(error){dispose();throw error;}
  loaded=true;lastFrame=performance.now();options.onProgress('The gate is opening',1);
  return {layout,debug,sound,build,forge,
    inspect:()=>({build:'progressive-light-v1',loaded,renderPhase,renderStartedAt,renderCompletedAt,presence:{kingdomId:frame?.kingdomId??options.kingdomId??null,focusSlot,connection:frame?.connection??null},fields:{local:field.stats,kingdom:farField.stats,beacon:beaconField.stats},uploadedBytes:{local:nearBytes,kingdom:farBytes,beacon:beaconBytes}}),subject:()=>crowd.subject(focusSlot),receiveChat:(cue:unknown)=>crowd.receiveChat(cue),
    setHour(value:number){targetHour=value;sound.cue('wood');},
    setCamera(value:CameraName){capturePose=null;poseRevision++;camName=value;autoCamera=false;lastField=-Infinity;sound.cue('wood');},
    /** Evidence framing only. Null returns control to the current production camera. */
    pose(eye:Vec3|null,lookAt?:Vec3,fov=43){
      if(eye===null){capturePose=null;poseRevision++;lastField=-Infinity;instancesDirty=true;return;}
      if(eye.length!==3||!lookAt||lookAt.length!==3||![...eye,...lookAt,fov].every(Number.isFinite)||fov<10||fov>100||Math.hypot(...eye.map((value,index)=>value-lookAt[index]!))<.01)throw new Error('Capture pose needs finite distinct eye/target and a 10–100 degree FOV');
      capturePose={eye:[...eye],target:[...lookAt],fov};poseRevision++;autoCamera=false;lastField=-Infinity;instancesDirty=true;
    },
    play(){if(options.source!=='simulated')return;capturePose=null;poseRevision++;sound.unlock();sound.cue('wood');windows.clear();crowd.clear();lastLightFrameKey='';simulation.reset();time=0;fixedTime=false;autoCamera=true;camName='hero';beaconCue=false;lastActive=0;},
    seek(value:number,view?:CameraName){lastField=-Infinity;if(view){capturePose=null;poseRevision++;camName=view;}if(options.source!=='simulated')return;time=value;fixedTime=true;autoCamera=false;simulation.advance(value);windows.update(1,hour);},
    capture(value:number){
      if(options.source!=='simulated')throw new Error('Offline capture requires the SIMULATED feed');
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
