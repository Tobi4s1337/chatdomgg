import * as THREE from 'three';
import { createCastle, createHome, createTree, MATERIALS, CASTLE_BEACON_ANCHOR_METRES } from '@chatdom/content';
import { VoxelWorkerPool, type AssetChunkMesh } from '@chatdom/voxel';
import { createAtmosphere, getEnvironment, createVoxelMaterial, geometryFromChunks, createWindowLights, type WindowHouse, createWater } from '@chatdom/render';
import { generateKingdom, terrainHeight, roadDistance, randomUnit, seedHash, type KingdomTier, type HomePlot } from '@chatdom/world';
import type { KingdomPresenceFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createSimulatedPresence, createHeraldPresence } from './presence-feed';
import { loadTerrain } from './terrain-client';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from './terrain-worker';
import { createLightField } from './light-field';
import { createKingdomSound } from './sound';
import { windowOccluded } from './visibility';
import { advanceDetailTransition, type DetailTransition, type DetailLevel } from './detail-transition';
import { createHorizonSurface } from './horizon';

export type CameraName='hero'|'window';
export interface NameLabel {name:string;x:number;y:number;slot:number}
export interface SceneOptions {tier:KingdomTier;seed:string;hour:number;time:number|null;camera:CameraName;source:'simulated'|'herald';signal?:AbortSignal;onProgress:(text:string,fraction:number)=>void;onNames:(names:NameLabel[])=>void;onSource:(state:string)=>void;onError:(message:string)=>void}
export interface KingdomDebug {ready:boolean;workers:number;homes:number;activeWindows:number;geometryBuilds:number;fieldUploads:number;drawCalls:number;triangles:number;time:number;hour:number;camera:CameraName;fieldBytes:number;source:string;fieldSettled:boolean}

function homeTransform(plot:HomePlot,blueprint:VoxelBlueprint):WindowHouse {
  const streetZ=plot.rotation===0?plot.lot.maxZ+4:plot.lot.minZ-4,depth=blueprint.size[2]*.125;
  return {slot:plot.slot,blueprint,position:plot.rotation===0?[plot.position[0]-4,plot.position[1],streetZ-4-depth]:[plot.position[0]+4,plot.position[1],streetZ+4+depth],yaw:plot.rotation*Math.PI/2};
}

export async function createKingdomScene(canvas:HTMLCanvasElement,options:SceneOptions) {
  let disposed=false,raf=0,loaded=false,lastFrame=performance.now(),time=options.time??0,hour=options.hour,targetHour=hour,camName=options.camera;
  let fixedTime=options.time!==null,autoCamera=!fixedTime&&camName==='hero',frame:KingdomPresenceFrame|undefined,fieldUploads=0,geometryBuilds=0,fieldBytes=0,nearBytes=0,farBytes=0,beaconBytes=0;
  const earlyCleanups:(()=>void)[]=[];
  let fullDispose:(()=>void)|undefined;
  const own=<T extends {dispose():void}>(resource:T):T=>{earlyCleanups.push(()=>resource.dispose());return resource;};
  const failLight=(message:string)=>queueMicrotask(()=>{if(disposed)return;fullDispose?.();options.onError(message);});
  try {
  const layout=generateKingdom({seed:options.seed,tier:options.tier,firstYear:options.tier==='hamlet'?2025:2022,year:2026});
  const renderer=own(new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'}));
  renderer.debug.onShaderError=()=>{throw new Error('A kingdom shader could not compile');};
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.15,2200),atmosphere=own(createAtmosphere(scene));
  const clay=own(createVoxelMaterial(MATERIALS,'build')),ground=own(createVoxelMaterial(MATERIALS,'terrain'));
  // Both lattices share one GPU light volume; two materials must not double the field budget.
  for(const key of ['uLight','uLightOrigin','uLightExtent','uFarLight','uFarOrigin','uFarExtent','uFarCell','uBeaconLight','uBeaconOrigin','uBeaconExtent','uBeaconCell'])ground.material.uniforms[key]=clay.material.uniforms[key]!;
  const heightOrigin:[number,number]=[Math.floor(layout.bounds.minX)-20,Math.floor(layout.bounds.minZ)-20];
  const heightWidth=Math.ceil(layout.bounds.maxX-heightOrigin[0])+21,heightDepth=Math.ceil(layout.bounds.maxZ-heightOrigin[1])+21,heightData=new Float32Array(heightWidth*heightDepth);
  for(let z=0;z<heightDepth;z++)for(let x=0;x<heightWidth;x++)heightData[x+z*heightWidth]=terrainHeight(layout,heightOrigin[0]+x,heightOrigin[1]+z);
  ground.setTerrainHeight(heightData,heightWidth,heightDepth,heightOrigin,1);
  const pool=own(new VoxelWorkerPool({size:Math.min(4,Math.max(2,(navigator.hardwareConcurrency||4)-1)),maxQueue:192}));
  const geometries:THREE.BufferGeometry[]=[],meshes:THREE.Object3D[]=[],abort=new AbortController();
  earlyCleanups.push(()=>abort.abort());
  const sound=own(createKingdomSound());
  const blueprints=new Map<string,VoxelBlueprint>();
  const houses=layout.homes.map(plot=>{const b=createHome(plot.tier,plot.style,plot.variant);blueprints.set(b.id,b);return homeTransform(plot,b);});
  const windows=own(createWindowLights(scene,houses));
  const simulation=createSimulatedPresence(layout);
  const source=options.source==='simulated'?simulation.feed:createHeraldPresence();
  const first=houses.find(h=>h.slot===simulation.firstSlot)!;
  const firstPane=first.blueprint.windows[0]!;
  const focal=new THREE.Vector3(...firstPane.centre).multiplyScalar(.125).applyAxisAngle(new THREE.Vector3(0,1,0),first.yaw).add(new THREE.Vector3(...first.position));
  const paneAngle=({north:Math.PI,east:Math.PI/2,south:0,west:-Math.PI/2}[firstPane.facing])+first.yaw;
  const homeEye=focal.clone().add(new THREE.Vector3(Math.sin(paneAngle)*7+1.8,2.1,Math.cos(paneAngle)*7));
  const homeTarget=focal.clone().add(new THREE.Vector3(Math.cos(paneAngle)*1.3,1.1,-Math.sin(paneAngle)*1.3));
  const heroEye=new THREE.Vector3(),heroTarget=new THREE.Vector3(),target=new THREE.Vector3();
  const portrait=()=>canvas.clientWidth<canvas.clientHeight;
  let heroFov=53;
  function setHero(){
    if(options.tier==='hamlet'){heroEye.set(portrait()?52:75,portrait()?45:35,145);heroTarget.set(0,11,-2);camera.fov=portrait()?55:46;}
    else {heroEye.set(portrait()?18:58,portrait()?28:31,portrait()?280:263);heroTarget.set(0,14,5);camera.fov=portrait()?58:53;}
    heroFov=camera.fov;camera.updateProjectionMatrix();
  }
  function resize(){renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;setHero();}
  const observer=new ResizeObserver(resize);earlyCleanups.push(()=>observer.disconnect());observer.observe(canvas);resize();
  const castle=createCastle('tide');
  const castleOrigin:Vec3=[layout.castle[0]-16,layout.castle[1],layout.castle[2]-16];
  const beaconPosition:Vec3=CASTLE_BEACON_ANCHOR_METRES.map((value,axis)=>value+castleOrigin[axis]!) as unknown as Vec3;
  const field=own(createLightField(layout,[...houses,{slot:65534,blueprint:castle,position:castleOrigin,yaw:0}],volume=>{if(disposed)return;clay.setLight(volume);fieldUploads++;nearBytes=volume.estimatedPeakBytes;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The light could not reach the kingdom')));
  const farField=own(createLightField(layout,[...houses,{slot:65534,blueprint:castle,position:castleOrigin,yaw:0}],volume=>{if(disposed)return;clay.setFarLight(volume);fieldUploads++;farBytes=volume.estimatedPeakBytes;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The light could not reach the kingdom'),{mode:'kingdom'}));
  const beaconField=own(createLightField(layout,[...houses,{slot:65534,blueprint:castle,position:castleOrigin,yaw:0}],volume=>{if(disposed)return;clay.setBeaconLight(volume);fieldUploads++;beaconBytes=volume.estimatedPeakBytes;fieldBytes=nearBytes+farBytes+beaconBytes;},()=>failLight('The castle light could not reach its towers'),{mode:'beacon',position:beaconPosition}));
  let lastField=-Infinity,lastNames=-Infinity,lastActive=0,beaconCue=false;
  const unsubscribe=source.subscribe(next=>{frame=next;lastField=-Infinity;windows.setFrame(next);options.onSource(next.origin==='simulated'?'SIMULATED':next.connection==='fresh'?'LIVE CHAT':next.connection==='offline'?'STREAM RESTING':'CONNECTION LOST');},()=>{windows.clear();frame=undefined;lastField=-Infinity;options.onSource('CONNECTION LOST');});
  earlyCleanups.push(unsubscribe);
  const debug:KingdomDebug={ready:false,workers:pool.stats.size+4,homes:houses.length,activeWindows:0,geometryBuilds:0,fieldUploads:0,drawCalls:0,triangles:0,time:0,hour,camera:camName,fieldBytes:0,source:source.label,fieldSettled:false};
  type Placement={position:Vec3;yaw:number};
  type RenderBatch={transitions:Map<Placement,DetailTransition>;blueprint:VoxelBlueprint;placements:readonly Placement[];levels:Map<number,THREE.InstancedMesh>};
  const batches=new Map<string,RenderBatch>();
  let instancesDirty=true;
  function instance(blueprint:VoxelBlueprint,chunks:readonly AssetChunkMesh[],placements:readonly Placement[],factor:1|2|4=1){
    const geometry=geometryFromChunks(chunks,'build');geometry.setAttribute('aLodFade',new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1),1));geometries.push(geometry);
    const mesh=new THREE.InstancedMesh(geometry,clay.material,placements.length);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3();
    placements.forEach((p,i)=>{m.compose(v.set(...p.position),q.setFromAxisAngle(new THREE.Vector3(0,1,0),p.yaw),new THREE.Vector3(factor,factor,factor));mesh.setMatrixAt(i,m);});
    mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.name=blueprint.id;scene.add(mesh);meshes.push(mesh);geometryBuilds++;
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
        centre.copy(conservativeSize).multiplyScalar(.5).applyAxisAngle(axis,p.yaw).add(new THREE.Vector3(...p.position));
        if(!frustum.intersectsSphere(new THREE.Sphere(centre,radius)))continue;
        const distance=Math.max(0,camera.position.distanceTo(centre)-radius);
        const wanted=distance<(portrait()?22:32)?1:distance<(portrait()?55:95)?2:4;
        const available=[wanted,4,2,1].find(level=>levels.has(level))! as DetailLevel;
        const state=advanceDetailTransition(transitions.get(p),available,now,fixedTime);
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
  const {geometry:horizonGeometry,sampleHeight:landHeight}=createHorizonSurface(layout);earlyCleanups.push(()=>horizonGeometry.dispose());
  const trees=[createTree(0),createTree(1),createTree(2)];
  const treePlaces=trees.map(()=>[] as {position:Vec3;yaw:number}[]);
  const treeCount=options.tier==='hamlet'?115:260;
  const planted:THREE.Vector2[]=[];
  for(let i=0;i<treeCount*12&&planted.length<treeCount;i++) {
    const group=Math.floor(i/7),rand=(part:string)=>randomUnit(seedHash(`${options.seed}:grove:${part}`));
    const cx=layout.bounds.minX-35+rand(`${group}:x`)*(layout.bounds.maxX-layout.bounds.minX+70);
    const cz=layout.bounds.minZ-65+rand(`${group}:z`)*(layout.bounds.maxZ-layout.bounds.minZ+45);
    const angle=rand(`${i}:angle`)*Math.PI*2,radius=Math.sqrt(rand(`${i}:radius`))*10;
    const x=cx+Math.cos(angle)*radius,z=cz+Math.sin(angle)*radius;
    const inLot=layout.homes.some(h=>x>h.lot.minX-2&&x<h.lot.maxX+2&&z>h.lot.minZ-2&&z<h.lot.maxZ+2);
    const lake=Math.hypot((x-layout.lake.x)/layout.lake.radiusX,(z-layout.lake.z)/layout.lake.radiusZ);
    if(inLot||roadDistance(layout,x,z)<5.5||lake<1.19||Math.hypot(x,z+46)<28||planted.some(p=>p.distanceToSquared(new THREE.Vector2(x,z))<8))continue;
    const y=landHeight(x,z);
    planted.push(new THREE.Vector2(x,z));treePlaces[group%3]!.push({position:[x-4,y,z-4],yaw:0});
  }
  // A continuous distant land silhouette lies beyond the detailed editable terrain.
  const horizonMaterial=own(new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:ground.material.uniforms,fragmentShader:ground.material.fragmentShader,vertexShader:`out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}`}));const horizon=new THREE.Mesh(horizonGeometry,horizonMaterial);scene.add(horizon);
  const water=own(createWater(scene,{lake:layout.lake,terrain:{data:heightData,width:heightWidth,height:heightDepth,origin:heightOrigin,step:1}}));
  function labels(){const names:NameLabel[]=[];for(const s of windows.getSources()){
    if(!s.name||s.strength<.1)continue;const p=new THREE.Vector3(...s.position),to=camera.position.clone().sub(p);
    if(to.length()>32||to.dot(new THREE.Vector3(...s.normal))<2)continue;
    if(windowOccluded(houses,[camera.position.x,camera.position.y,camera.position.z],s.position))continue;
    p.y+=1.1;p.project(camera);if(p.z>1||p.z<0||Math.abs(p.x)>.91||Math.abs(p.y)>.88)continue;
    names.push({name:s.name,slot:s.slot,x:(p.x+1)*canvas.clientWidth/2,y:(1-p.y)*canvas.clientHeight/2});
  }options.onNames(names.slice(0,3));}
  const fog=new THREE.FogExp2(0x000000);scene.fog=fog;
  function render(now:number){
    if(disposed)return;try {const dt=Math.max(0,(now-lastFrame)/1000);lastFrame=now;
    if(loaded&&!fixedTime)time+=dt;
    if(options.source==='simulated')simulation.advance(time);
    hour+=Math.min(1,dt*4)*(targetHour-hour);const grade=getEnvironment(hour);clay.setEnvironment(grade);ground.setEnvironment(grade);
    windows.update(fixedTime?1:dt,hour);
    const active=frame?.windows.filter(w=>w.present).length??0,fraction=active/houses.length;
    let beacon=frame?.streamLive?Math.pow(fraction,2.4):0;
    if(options.source==='herald'&&frame?.streamLive)beacon=Math.max(.25,beacon);
    if(loaded&&active>lastActive){if(lastActive===0)sound.cue('light');else if(lastActive===1)sound.cue('wave');}lastActive=active;
    if(loaded&&beacon>.9&&!beaconCue){sound.cue('beacon');beaconCue=true;}
    if(autoCamera){
      // Rise inside the street before withdrawing over the opposite roofs.
      const lift=THREE.MathUtils.smootherstep(time,3.5,6),pull=THREE.MathUtils.smootherstep(time,6,15);
      camera.position.copy(homeEye);camera.position.y=THREE.MathUtils.lerp(homeEye.y,Math.max(22,heroEye.y),lift);camera.position.lerp(heroEye,pull);
      target.lerpVectors(homeTarget,heroTarget,THREE.MathUtils.smootherstep(time,4,13));
    }
    else if(camName==='window'){camera.position.copy(homeEye);target.copy(homeTarget);}else{camera.position.copy(heroEye);target.copy(heroTarget);}
    const wantedFov=autoCamera?THREE.MathUtils.lerp(64,heroFov,THREE.MathUtils.smootherstep(time,4,13)):camName==='window'?64:heroFov;
    if(Math.abs(camera.fov-wantedFov)>.001){camera.fov=wantedFov;camera.updateProjectionMatrix();}
    camera.lookAt(target);camera.updateMatrixWorld();updateInstances(now);
    atmosphere.update(hour,time,camera,new THREE.Vector3(...beaconPosition),beacon);
    fog.color.set(grade.fog);fog.density=.0016;
    water.update(grade,time,camera);
    if(loaded&&now-lastField>240){lastField=now;const centre:Vec3=[target.x,terrainHeight(layout,target.x,target.z),target.z];field.update(centre,windows.getSources());farField.update(centre,windows.getSources());beaconField.update(beaconPosition,[{position:beaconPosition,strength:beacon,normal:[0,1,0]}]);}
    if(now-lastNames>80){labels();lastNames=now;}
    renderer.render(scene,camera);
    Object.assign(debug,{ready:loaded,activeWindows:active,geometryBuilds,fieldUploads,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,time,hour,camera:camName,fieldBytes,fieldSettled:field.stats.publishedRevision===field.stats.requestedRevision&&!field.stats.busy&&!field.stats.queued&&farField.stats.publishedRevision===farField.stats.requestedRevision&&!farField.stats.busy&&!farField.stats.queued&&farBytes>0&&beaconField.stats.publishedRevision===beaconField.stats.requestedRevision&&!beaconField.stats.busy&&!beaconField.stats.queued&&beaconBytes>0});
    raf=requestAnimationFrame(render);
    }catch(error){dispose();options.onError('The kingdom could not render');console.error('Kingdom frame failed',error);}
  }
  fullDispose=dispose;earlyCleanups.length=0;
  raf=requestAnimationFrame(render);
  const assets=[...blueprints.values(),castle,...trees],total=assets.length*3;let completed=0;
  // Coarse geometry is available first. Every resolution is prepared in workers; window anchors stay exact.
  const tasks=([4,2,1] as const).flatMap(factor=>assets.map(async b=>{
    const job={kind:'blueprint' as const,blueprint:b,revision:1,materials:MATERIALS.materials,materialRevision:MATERIALS.revision,...(factor===1?{}:{lodFactor:factor})};
    const result=await pool.submit(job);if(disposed||result?.kind!=='asset')return;
    const treeIndex=trees.indexOf(b);
    const placements=b===castle?[{position:castleOrigin,yaw:0}]:treeIndex>=0?treePlaces[treeIndex]!:houses.filter(h=>h.blueprint.id===b.id);
    instance(b,result.chunks,placements,factor);options.onProgress(b===castle?'Opening the castle gate':treeIndex>=0?'Planting the old woods':'Raising the homes',++completed/total);
  }));
  tasks.push(loadTerrain(layout,()=>{}, {signal:abort.signal}).then(({chunks,origin})=>{if(disposed)return;const geometry=geometryFromChunks(chunks,'terrain');geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);geometry.boundingSphere=geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());geometries.push(geometry);const mesh=new THREE.Mesh(geometry,ground.material);mesh.position.set(...origin);scene.add(mesh);meshes.push(mesh);geometryBuilds++;}));
  function dispose(){if(disposed)return;disposed=true;loaded=false;debug.ready=false;cancelAnimationFrame(raf);abort.abort();observer.disconnect();unsubscribe();field.dispose();farField.dispose();beaconField.dispose();pool.dispose();windows.dispose();atmosphere.dispose();sound.dispose();geometries.forEach(g=>g.dispose());clay.dispose();ground.dispose();horizonGeometry.dispose();horizonMaterial.dispose();water.dispose();for(const mesh of meshes)if(mesh instanceof THREE.InstancedMesh)mesh.dispose();renderer.dispose();scene.clear();canvas.removeEventListener('webglcontextlost',contextLost);options.signal?.removeEventListener('abort',dispose);}
  function contextLost(event:Event){event.preventDefault();dispose();options.onError('The kingdom lost its rendering context');}
  canvas.addEventListener('webglcontextlost',contextLost);options.signal?.addEventListener('abort',dispose,{once:true});
  if(options.signal?.aborted)dispose();
  try {await Promise.all(tasks);if(disposed)throw new Error('Scene closed while loading');await renderer.compileAsync(scene,camera);if(disposed)throw new Error('Scene closed while compiling');}catch(error){dispose();throw error;}
  loaded=true;debug.ready=true;lastFrame=performance.now();options.onProgress('The first light could be yours',1);
  return {layout,debug,sound,
    setHour(value:number){targetHour=value;sound.cue('wood');},
    setCamera(value:CameraName){camName=value;autoCamera=false;lastField=-Infinity;sound.cue('wood');},
    play(){sound.unlock();sound.cue('wood');windows.clear();simulation.reset();time=0;fixedTime=false;autoCamera=true;beaconCue=false;lastActive=0;},
    seek(value:number,view?:CameraName){lastField=-Infinity;time=value;fixedTime=true;autoCamera=false;if(view)camName=view;simulation.advance(value);windows.update(1,hour);},
    capture(value:number){time=value;fixedTime=true;autoCamera=true;lastField=-Infinity;simulation.advance(value);windows.update(1,hour);},
    dispose,
  };
  } catch(error) {
    if(fullDispose)fullDispose();
    else {disposed=true;for(const cleanup of earlyCleanups.reverse()){try{cleanup();}catch{/* Finish releasing the other resources. */}}}
    throw error;
  }
}
