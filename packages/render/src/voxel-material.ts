import * as THREE from 'three';
import { VOXEL_METRES, type MaterialRegistry, type VoxelLattice } from '@chatdom/shared';
import type { AssetChunkMesh, LightVolume } from '@chatdom/voxel';
import type { Environment } from './atmosphere';

export interface VoxelRenderState {
  material:THREE.ShaderMaterial;
  setEnvironment(grade:Environment):void;
  setLight(volume:LightVolume):void;
  setFarLight(volume:LightVolume):void;
  setBeaconLight(volume:LightVolume):void;
  setShoreLevel(level:number,bounds:readonly [number,number,number,number]):void;
  setTerrainHeight(data:Float32Array,width:number,height:number,origin:[number,number],step:number):void;
  dispose():void;
}

/** One draw per asset, still eight bytes per vertex. High word bits hold asset-local chunk coordinates. */
export function geometryFromChunks(chunks:readonly AssetChunkMesh[],lattice:VoxelLattice):THREE.BufferGeometry {
  const count=chunks.reduce((n,c)=>n+c.mesh.vertices.length,0),codes=new Uint32Array(count),indices=new Uint32Array(chunks.reduce((n,c)=>n+c.mesh.indices.length,0));
  let vertexOffset=0,indexOffset=0;
  const bounds=new THREE.Box3();
  for(const {coordinate,mesh} of chunks) {
    if(coordinate.some(c=>c<0||c>31)) throw new Error('Asset chunk coordinate exceeds render packing');
    const chunkBits=(coordinate[0]<<16)|(coordinate[1]<<21)|(coordinate[2]<<26);
    for(let i=0;i<mesh.vertices.length;i+=2) {codes[vertexOffset*2+i]=mesh.vertices[i]!;codes[vertexOffset*2+i+1]=mesh.vertices[i+1]!|chunkBits;}
    for(let i=0;i<mesh.indices.length;i++) indices[indexOffset+i]=mesh.indices[i]!+vertexOffset;
    vertexOffset+=mesh.vertices.length/2;indexOffset+=mesh.indices.length;
    const s=VOXEL_METRES[lattice]; bounds.expandByPoint(new THREE.Vector3(...coordinate).multiplyScalar(32*s));bounds.expandByPoint(new THREE.Vector3(...coordinate).addScalar(1).multiplyScalar(32*s));
  }
  const geometry=new THREE.BufferGeometry();
  const first=new Uint32Array(count/2),second=new Uint32Array(count/2);
  for(let i=0;i<count;i+=2) {first[i/2]=codes[i]!;second[i/2]=codes[i+1]!;}
  const packed=new THREE.BufferAttribute(first,1);packed.gpuType=THREE.IntType;
  const material=new THREE.BufferAttribute(second,1);material.gpuType=THREE.IntType;
  geometry.setAttribute('aPacked',packed);geometry.setAttribute('aMaterial',material);geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.boundingBox=bounds;geometry.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());return geometry;
}

/** Voxel fog thins with height, so it runs at this share of the scene's `FogExp2` density. */
const VOXEL_FOG_SCALE=.72;

export function createVoxelMaterial(registry:MaterialRegistry,lattice:VoxelLattice):VoxelRenderState {
  const palette=new Float32Array(65536*4);
  const kinds=['air','earth','grass','stone','wood','plaster','roof','leaf','metal','fabric','glass'];
  for(const m of registry.materials) {const colour=new THREE.Color(m.colour);palette.set([colour.r,colour.g,colour.b,kinds.indexOf(m.surface)],m.id*4);}
  const texture=new THREE.DataTexture(palette,256,256,THREE.RGBAFormat,THREE.FloatType);texture.needsUpdate=true;
  let lightTexture=new THREE.Data3DTexture(new Uint8Array(1),1,1,1);lightTexture.format=THREE.RedFormat;lightTexture.needsUpdate=true;
  let farLightTexture=new THREE.Data3DTexture(new Uint8Array(1),1,1,1);farLightTexture.format=THREE.RedFormat;farLightTexture.needsUpdate=true;
  let beaconLightTexture=new THREE.Data3DTexture(new Uint8Array(1),1,1,1);beaconLightTexture.format=THREE.RedFormat;beaconLightTexture.needsUpdate=true;
  let heightTexture=new THREE.DataTexture(new Float32Array(1),1,1,THREE.RedFormat,THREE.FloatType);heightTexture.needsUpdate=true;
  const uniforms={uScale:{value:VOXEL_METRES[lattice]},uPalette:{value:texture},uSun:{value:new THREE.Color()},uAmbient:{value:new THREE.Color()},uSunDirection:{value:new THREE.Vector3()},uSunIntensity:{value:1},uAmbientIntensity:{value:1},uFog:{value:new THREE.Color()},uShadow:{value:new THREE.Color()},uGlow:{value:new THREE.Color()},uFogDensity:{value:.00115},uSkyZenith:{value:new THREE.Color()},uSkyHorizon:{value:new THREE.Color()},uNight:{value:0},uLight:{value:lightTexture},uLightOrigin:{value:new THREE.Vector3()},uLightExtent:{value:new THREE.Vector3(1,1,1)},uFarLight:{value:farLightTexture},uFarOrigin:{value:new THREE.Vector3()},uFarExtent:{value:new THREE.Vector3(1,1,1)},uFarCell:{value:2},uBeaconLight:{value:beaconLightTexture},uBeaconOrigin:{value:new THREE.Vector3()},uBeaconExtent:{value:new THREE.Vector3(1,1,1)},uBeaconCell:{value:2},uTerrainHeight:{value:heightTexture},uTerrainOrigin:{value:new THREE.Vector2()},uTerrainSize:{value:new THREE.Vector2(1,1)},uTerrainStep:{value:1},uTerrain:{value:0},uShoreLevel:{value:-1e6},uShoreBounds:{value:new THREE.Vector4()},uTerrainSoil:{value:new THREE.Color(registry.materials.find(m=>m.surface==='earth')?.colour??'#87664d')},uTerrainGrass:{value:new THREE.Color(registry.materials.find(m=>m.surface==='grass')?.colour??'#667f52')},uGlassKind:{value:kinds.indexOf('glass')},uGlassDither:{value:0}};
  const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,alphaToCoverage:true,vertexShader:`
    in uint aPacked; in uint aMaterial;
    out float vLodFade;
    #ifdef USE_INSTANCING
      in float aLodFade;
    #endif
    uniform float uScale; out vec3 vWorld; out vec3 vNormal; out float vAo; out float vSky; flat out uint vMaterial;
    uniform sampler2D uTerrainHeight;uniform vec2 uTerrainOrigin,uTerrainSize;uniform float uTerrainStep,uTerrain;
    float groundHeight(vec2 world){vec2 uv=clamp((world-uTerrainOrigin)/uTerrainStep,vec2(0.),uTerrainSize-vec2(1.001));ivec2 p=ivec2(floor(uv));vec2 f=fract(uv);return mix(mix(texelFetch(uTerrainHeight,p,0).r,texelFetch(uTerrainHeight,p+ivec2(1,0),0).r,f.x),mix(texelFetch(uTerrainHeight,p+ivec2(0,1),0).r,texelFetch(uTerrainHeight,p+ivec2(1,1),0).r,f.x),f.y);}
    void main(){
      vec3 p=vec3(float(aPacked&63u),float((aPacked>>6u)&63u),float((aPacked>>12u)&63u));
      p+=32.*vec3(float((aMaterial>>16u)&31u),float((aMaterial>>21u)&31u),float((aMaterial>>26u)&31u));
      uint face=(aPacked>>18u)&7u;
      vec3 n=face==0u?vec3(1,0,0):face==1u?vec3(-1,0,0):face==2u?vec3(0,1,0):face==3u?vec3(0,-1,0):face==4u?vec3(0,0,1):vec3(0,0,-1);
      vec4 local=vec4(p*uScale,1.);vLodFade=1.;
      #ifdef USE_INSTANCING
        local=instanceMatrix*local;n=mat3(instanceMatrix)*n;vLodFade=aLodFade;
      #endif
      vec4 world=modelMatrix*local;
      if(uTerrain>.5){float h=groundHeight(world.xz);{world.y=h;n=normalize(vec3(groundHeight(world.xz-vec2(.5,0.))-groundHeight(world.xz+vec2(.5,0.)),1.,groundHeight(world.xz-vec2(0.,.5))-groundHeight(world.xz+vec2(0.,.5))));}}
      vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*n);
      vAo=float((aPacked>>21u)&3u)/3.;vSky=float((aPacked>>23u)&15u)/15.;vMaterial=aMaterial&65535u;
      if(uTerrain>.5)vAo=mix(.8,1.,vAo);
      gl_Position=projectionMatrix*viewMatrix*world;
    }`,fragmentShader:`
    out vec4 voxelColour;
    #define gl_FragColor voxelColour
    precision highp sampler3D;
    uniform sampler2D uPalette;uniform sampler3D uLight,uFarLight,uBeaconLight;
    uniform vec3 uSun,uAmbient,uSunDirection,uFog,uShadow,uGlow,uSkyZenith,uSkyHorizon,uLightOrigin,uLightExtent,uFarOrigin,uFarExtent,uBeaconOrigin,uBeaconExtent;
    uniform float uSunIntensity,uAmbientIntensity,uFogDensity,uNight,uFarCell,uBeaconCell,uTerrain,uShoreLevel;
    uniform float uGlassKind,uGlassDither;
    uniform vec3 uTerrainSoil,uTerrainGrass;uniform vec4 uShoreBounds;
    in vec3 vWorld,vNormal;in float vAo,vSky,vLodFade;flat in uint vMaterial;
    const int BAYER[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
    // Forty-eight half-metre cell steps reach 14-24 m toward the sun: across a room, its eaves and its lane.
    const int SUN_LINE_CELLS=48;
    // Blocked path, in cells, an opening's edge may cross; below the one cell every solid slab costs.
    const float SUN_LINE_EDGE=.8;
    float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
    float packedSample(sampler3D field,ivec3 cell){return floor(texelFetch(field,cell,0).r*255.+.5);}
    bool fieldInside(vec3 p,vec3 size){return all(greaterThanEqual(p,vec3(0)))&&all(lessThan(p,size));}
    // Corners are shared between neighbouring air cells. The worker has already
    // separated disconnected air components; solids are never filtered as light.
    float surfaceField(sampler3D field,vec3 origin,vec3 extent,float cellSize,vec3 normal){
      ivec3 size=ivec3(round(extent/cellSize));
      if(any(lessThanEqual(size,ivec3(0))))return 0.;
      vec3 q=(vWorld+normal*.025-origin)/cellSize;
      if(!fieldInside(q,vec3(size)))return 0.;
      if(any(notEqual(textureSize(field,0),size+ivec3(1)))){
        // Generic LightVolume callers retain the conservative nearest path.
        return texture(field,(vWorld+normal*cellSize-origin)/extent).r*17.;
      }
      ivec3 cell=ivec3(floor(q));
      if(packedSample(field,cell)>=128.){
        // Escape only the surface's containing coarse cell. Do not leap over
        // another occupied cell as a fixed one-metre normal bias could do.
        vec3 end=vec3(cell)+step(vec3(0.),normal);
        vec3 distanceToFace=vec3(1e10);
        if(abs(normal.x)>.0001)distanceToFace.x=(end.x-q.x)/normal.x;
        if(abs(normal.y)>.0001)distanceToFace.y=(end.y-q.y)/normal.y;
        if(abs(normal.z)>.0001)distanceToFace.z=(end.z-q.z)/normal.z;
        q+=normal*(max(0.,min(distanceToFace.x,min(distanceToFace.y,distanceToFace.z)))+.005);
        if(!fieldInside(q,vec3(size)))return 0.;
        cell=ivec3(floor(q));
        if(packedSample(field,cell)>=128.)return 0.;
      }
      vec3 f=fract(q);
      float a=mod(packedSample(field,cell),16.);
      float b=mod(packedSample(field,cell+ivec3(1,0,0)),16.);
      float c=mod(packedSample(field,cell+ivec3(0,1,0)),16.);
      float d=mod(packedSample(field,cell+ivec3(1,1,0)),16.);
      float e=mod(packedSample(field,cell+ivec3(0,0,1)),16.);
      float g=mod(packedSample(field,cell+ivec3(1,0,1)),16.);
      float h=mod(packedSample(field,cell+ivec3(0,1,1)),16.);
      float i=mod(packedSample(field,cell+ivec3(1,1,1)),16.);
      return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,i,f.x),f.y),f.z)/15.;
    }
    float blockerAt(sampler3D field,ivec3 cell,ivec3 size){
      if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,size)))return 0.;
      return step(128.,packedSample(field,cell));
    }
    // Direct sun indoors. The town-wide sun map is too coarse to find a window or a doorway, and the baked sky
    // term that hides its leaks through walls also dims the sun that really comes in. The near field's half-metre
    // light blockers (glass and open carves are clear) answer the actual line to the sun instead, walking whole
    // cells from the receiver's own air cell and giving up as clear past the field. Crossing any slab of blocker
    // cells costs at least one cell of path, so under one cell of blocked path is an opening's quantised edge:
    // it fades the line rather than closing it, and a real 0.4 m reveal is not read as a one-metre tunnel.
    // reach returns the metres the line covered, so the map need only answer for casters beyond it.
    float sunLine(vec3 normal,vec3 direction,out float reach){
      reach=0.;
      ivec3 size=ivec3(round(uLightExtent/.5));
      if(any(lessThanEqual(size,ivec3(0)))||any(notEqual(textureSize(uLight,0),size+ivec3(1))))return 0.;
      vec3 q=(vWorld+normal*.025-uLightOrigin)/.5;
      if(!fieldInside(q,vec3(size)))return 0.;
      ivec3 cell=ivec3(floor(q));
      if(packedSample(uLight,cell)>=128.){
        vec3 end=vec3(cell)+step(vec3(0.),normal),distanceToFace=vec3(1e10);
        if(abs(normal.x)>.0001)distanceToFace.x=(end.x-q.x)/normal.x;
        if(abs(normal.y)>.0001)distanceToFace.y=(end.y-q.y)/normal.y;
        if(abs(normal.z)>.0001)distanceToFace.z=(end.z-q.z)/normal.z;
        q+=normal*(max(0.,min(distanceToFace.x,min(distanceToFace.y,distanceToFace.z)))+.005);
        if(!fieldInside(q,vec3(size)))return 0.;
        cell=ivec3(floor(q));
        if(packedSample(uLight,cell)>=128.)return 0.;
      }
      ivec3 stepTo=ivec3(sign(direction));
      vec3 delta=vec3(abs(direction.x)>1e-5?1./abs(direction.x):1e10,abs(direction.y)>1e-5?1./abs(direction.y):1e10,abs(direction.z)>1e-5?1./abs(direction.z):1e10);
      vec3 next=vec3(abs(direction.x)>1e-5?(float(cell.x)+step(0.,direction.x)-q.x)/direction.x:1e10,
        abs(direction.y)>1e-5?(float(cell.y)+step(0.,direction.y)-q.y)/direction.y:1e10,
        abs(direction.z)>1e-5?(float(cell.z)+step(0.,direction.z)-q.z)/direction.z:1e10);
      float blocked=0.,start=dot(q-(vWorld-uLightOrigin)/.5,direction),walked=0.;
      for(int i=0;i<SUN_LINE_CELLS;i++){
        float enter=min(next.x,min(next.y,next.z));walked=enter;
        if(next.x<=enter){cell.x+=stepTo.x;next.x+=delta.x;}
        else if(next.y<=enter){cell.y+=stepTo.y;next.y+=delta.y;}
        else{cell.z+=stepTo.z;next.z+=delta.z;}
        if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,size)))break;
        if(packedSample(uLight,cell)>=128.){
          float leave=min(next.x,min(next.y,next.z));
          blocked+=leave-enter;
          if(blocked>=SUN_LINE_EDGE)return 0.;
        }
      }
      reach=(start+walked)*.5;
      return 1.-smoothstep(.25,SUN_LINE_EDGE,blocked);
    }
    // Ground contact comes from the same authored blockers, sampled just above
    // the ground. It is independent of presence and adds no decorative splats.
    float groundContact(sampler3D field,vec3 origin,vec3 extent,float cellSize,vec3 normal){
      ivec3 size=ivec3(round(extent/cellSize));
      if(any(lessThanEqual(size,ivec3(0)))||any(notEqual(textureSize(field,0),size+ivec3(1))))return 0.;
      vec3 q=(vWorld+normal*(cellSize*.8)-origin)/cellSize;
      if(!fieldInside(q,vec3(size)))return 0.;
      int layer=int(floor(q.y));
      vec2 p=q.xz-.5, f=fract(p);ivec2 cell=ivec2(floor(p));
      return mix(mix(blockerAt(field,ivec3(cell.x,layer,cell.y),size),blockerAt(field,ivec3(cell.x+1,layer,cell.y),size),f.x),
        mix(blockerAt(field,ivec3(cell.x,layer,cell.y+1),size),blockerAt(field,ivec3(cell.x+1,layer,cell.y+1),size),f.x),f.y);
    }
    void main(){
      float threshold=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
      if(vLodFade>=0.&&threshold>=vLodFade)discard;
      if(vLodFade<0.&&threshold<-vLodFade-1.)discard;
      vec4 swatch=texelFetch(uPalette,ivec2(int(vMaterial&255u),int(vMaterial>>8u)),0);vec3 base=swatch.rgb;
      vec3 n=normalize(vNormal);vec2 uv=abs(n.y)>.5?vWorld.xz:abs(n.x)>.5?vWorld.zy:vWorld.xy;
      float kind=swatch.a;
      // A bank follows continuous rendered height, rather than the material ID of
      // a whole one-metre triangle poking through the water's edge.
      if(uTerrain>.5&&vWorld.y<uShoreLevel+.7&&vWorld.x>uShoreBounds.x&&vWorld.x<uShoreBounds.y&&vWorld.z>uShoreBounds.z&&vWorld.z<uShoreBounds.w){
        vec3 bank=mix(uTerrainSoil,uTerrainGrass,.8)*.82;
        base=mix(bank,uTerrainGrass,smoothstep(uShoreLevel-.05,uShoreLevel+.4,vWorld.y));kind=2.;
      }
      float detail=1.-smoothstep(.12,.55,max(length(dFdx(uv)),length(dFdy(uv))));
      float variation=hash(floor(vWorld*8.+n*.03));base*=1.+(.03*variation-.015)*detail;
      if(kind==2.)base*=.91+.075*sin(vWorld.x*.13)*sin(vWorld.z*.17)+.04*sin((vWorld.x+vWorld.z)*.43);
      float edge=1.;
      if(kind==3.) {vec2 stone=uv*vec2(1.65,3.2);stone.x+=mod(floor(stone.y),2.)*.5;vec2 f=fract(stone);float mortar=min(min(f.x,1.-f.x),min(f.y,1.-f.y));edge=mix(.77,1.,smoothstep(.018,.058,mortar));}
      if(kind==4.) {float grain=sin(uv.y*22.+sin(uv.x*6.)*.4);edge=.93+.045*grain;float plank=fract(uv.x*4.);edge*=mix(.78,1.,smoothstep(.015,.05,min(plank,1.-plank)));}
      if(kind==6.) {vec2 tile=uv*vec2(3.,5.);tile.x+=mod(floor(tile.y),2.)*.5;vec2 f=fract(tile);edge=.88+.12*smoothstep(.02,.08,min(f.x,min(f.y,1.-f.x)));}
      edge=mix(kind==3.?.96:kind==4.?.94:kind==6.?.95:1.,edge,detail);
      float ao=mix(.49,1.,vAo);float sky=mix(.24,1.,vSky);
      float diffuse=max(dot(n,normalize(uSunDirection)),0.);
      // Open faces take the hour's sky fill; occluded ones sink toward its shadow tint, so a shadowed
      // wall reads blue at noon and indigo at dusk rather than grey.
      float facing=.5+.5*max(n.y,0.);
      vec3 cool=mix(uShadow*.62,uAmbient,sky)*uAmbientIntensity*facing*(.4+.6*sky);
      float sunSeen=1. /* sun-visibility */;
      float sunLit=sunSeen*(.15+.85*vSky);
      // Under a roof the near field's own line to the sun decides. The town map, whose texels would blur the
      // window frame across the patch, is asked only about casters beyond the line, in the air where it ended.
      float sheltered=1.-smoothstep(.55,.85,vSky);
      if(sheltered>0.&&diffuse>0.&&uSunIntensity>0.){
        vec3 toSun=normalize(uSunDirection);float reach;
        float line=sunLine(n,toSun,reach);
        #ifdef SUN_SHADOW_RECEIVER
          if(line>0.)line*=sunShadowInAir(vWorld+toSun*reach);
        #endif
        sunLit=max(sunLit,sheltered*line);
      }
      vec3 light=cool+uSun*uSunIntensity*diffuse*sunLit;
      vec3 uvw=(vWorld-uLightOrigin)/uLightExtent;
      float warm=surfaceField(uFarLight,uFarOrigin,uFarExtent,uFarCell,n);
      float nearBlend=0.;
      if(all(greaterThan(uvw,vec3(0)))&&all(lessThan(uvw,vec3(1)))){
        vec3 edge=min(uvw,1.-uvw)*uLightExtent;
        nearBlend=smoothstep(0.,4.,min(edge.x,min(edge.y,edge.z)));
        warm=mix(warm,surfaceField(uLight,uLightOrigin,uLightExtent,.5,n),nearBlend);
      }
      // The field is blocked by occupied cells; this adds real warm street/wall illumination, not a decal.
      // The flood falls off linearly with (Manhattan) distance, so the ground under a window is a metre or two
      // further from it than the wall. A 1.3 power (not a square) carries the pool 3-5 m onto the wall and
      // the cobbles below and still rolls to zero without a ring; the soft cap below keeps the core from
      // clipping. The colour falls from a warm core through amber. It reads fully from dusk (night .2, about
      // 18.5 h) and is absent by day.
      float pool=pow(warm,1.3);
      float poolAmount=pool*smoothstep(0.,.2,uNight)*1.3;
      vec3 poolColour=mix(vec3(1.,.34,.09),vec3(1.,.71,.44),pool);
      float beacon=surfaceField(uBeaconLight,uBeaconOrigin,uBeaconExtent,uBeaconCell,n);
      float beaconAmount=beacon*beacon*(.3+.7*uNight)*1.25;
      // Overlapping warm light shares one soft cap, so lit plaster never clips to white.
      float warmTotal=poolAmount+beaconAmount;
      float warmCapped=warmTotal<.6?warmTotal:.6+.6*(1.-exp((.6-warmTotal)/.6));
      light+=(poolColour*poolAmount+vec3(1.,.64,.32)*beaconAmount)*(warmCapped/max(warmTotal,1e-4));
      if(uTerrain>.5){
        float contact=groundContact(uFarLight,uFarOrigin,uFarExtent,uFarCell,n);
        if(nearBlend>0.)contact=mix(contact,groundContact(uLight,uLightOrigin,uLightExtent,.5,n),nearBlend);
        ao*=1.-contact*.24;
      }
      vec3 colour=base*edge*light*ao;
      if(kind==10.){
        // Glass reflects the sky it faces: dark blue-grey at night, pale sky by day, never a black hole
        // and never its own warm albedo. A lit room is the presence pane's job, not every pane's.
        vec3 view=normalize(vWorld-cameraPosition),mirror=reflect(view,n);
        vec3 seen=mix(uSkyHorizon,uSkyZenith,smoothstep(.0,.65,mirror.y));
        seen=mix(uFog*.42,seen,smoothstep(-.3,.04,mirror.y));
        float fresnel=.42+.5*pow(1.-max(dot(-view,n),0.),3.);
        vec3 inside=base*.1*light;
        colour=mix(inside,seen*mix(.62,.42,uNight),fresnel)*ao+poolColour*poolAmount*.12;
      }
      vec2 cell=fract(uv*8.);float bevel=min(min(cell.x,1.-cell.x),min(cell.y,1.-cell.y));
      if(kind==3.||kind==4.||kind==6.)colour+=base*.018*(1.-smoothstep(.0,.10,bevel))*(.3+.7*diffuse)*vAo*detail;
      // Glass is still clay geometry in this opaque pass. Its coverage lets the lit reveal and
      // room behind show through, while it reflects the hour's sky and catches the sun.
      float cover=1.;
      if(abs(kind-uGlassKind)<.5){
        vec3 eye=normalize(vWorld-cameraPosition),r=reflect(eye,n);
        float fresnel=pow(1.-abs(dot(eye,n)),4.);
        float glint=pow(max(dot(r,normalize(uSunDirection)),0.),140.)*uSunIntensity*(1.-uNight);
        colour+=uSun*glint*1.4;
        cover=clamp(mix(.24,.9,fresnel)+glint*.6,0.,1.);
        if(uGlassDither>.5){
          // Without multisampling, an ordered screen pattern stands in for fractional coverage.
          ivec2 b=ivec2(mod(gl_FragCoord.xy,4.));
          if((float(BAYER[b.x+b.y*4])+.5)/16.>=cover)discard;
          cover=1.;
        }
      }
      float distanceToCamera=length(cameraPosition-vWorld);
      float fogAmount=1.-exp(-distanceToCamera*uFogDensity*exp(-max(vWorld.y,0.)*.019));
      // Distance takes the sky's colour, warmer where the view runs toward a low sun.
      vec3 view=normalize(vec3(vWorld.x-cameraPosition.x,0.,vWorld.z-cameraPosition.z)+vec3(.0001,0.,0.));
      vec3 sunFlat=normalize(vec3(uSunDirection.x,0.,uSunDirection.z)+vec3(.0001,0.,0.));
      vec3 fogColour=uFog+uGlow*pow(max(dot(view,sunFlat),0.),3.)*.8;
      colour=mix(colour,fogColour,min(.86,fogAmount));
      gl_FragColor=vec4(colour,1.);
      gl_FragColor.a=cover;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  // Alpha-to-coverage needs a multisampled target; otherwise glass falls back to an ordered pattern.
  let coverageTarget:THREE.WebGLRenderTarget|null|undefined;
  material.onBeforeRender=renderer=>{
    const target=renderer.getRenderTarget();
    if(target===coverageTarget)return;
    coverageTarget=target;
    const samples=target?target.samples:renderer.getContext().getContextAttributes()?.antialias?4:0;
    uniforms.uGlassDither.value=samples>0?0:1;
  };
return {material,setEnvironment(g){uniforms.uSun.value.set(g.sun);uniforms.uAmbient.value.set(g.ambient);uniforms.uFog.value.set(g.fog);uniforms.uSkyZenith.value.set(g.zenith);uniforms.uSkyHorizon.value.set(g.horizon);uniforms.uShadow.value.set(g.shadow);uniforms.uGlow.value.set(g.glow);uniforms.uFogDensity.value=g.fogDensity*VOXEL_FOG_SCALE;uniforms.uSunDirection.value.set(...g.sunDirection);uniforms.uSunIntensity.value=g.sunIntensity;uniforms.uAmbientIntensity.value=g.ambientIntensity;uniforms.uNight.value=g.night;},
    setLight(v){lightTexture=uploadVolume(lightTexture,v);uniforms.uLight.value=lightTexture;uniforms.uLightOrigin.value.set(...v.origin);uniforms.uLightExtent.value.set(v.size[0]*v.cellSize,v.size[1]*v.cellSize,v.size[2]*v.cellSize);},
    setFarLight(v){farLightTexture=uploadVolume(farLightTexture,v);uniforms.uFarLight.value=farLightTexture;uniforms.uFarOrigin.value.set(...v.origin);uniforms.uFarExtent.value.set(v.size[0]*v.cellSize,v.size[1]*v.cellSize,v.size[2]*v.cellSize);uniforms.uFarCell.value=v.cellSize;},
    setBeaconLight(v){beaconLightTexture=uploadVolume(beaconLightTexture,v);uniforms.uBeaconLight.value=beaconLightTexture;uniforms.uBeaconOrigin.value.set(...v.origin);uniforms.uBeaconExtent.value.set(v.size[0]*v.cellSize,v.size[1]*v.cellSize,v.size[2]*v.cellSize);uniforms.uBeaconCell.value=v.cellSize;},
    setShoreLevel(level,bounds){if(!Number.isFinite(level)||bounds.some(value=>!Number.isFinite(value)))throw new Error('Shore level and bounds must be finite');uniforms.uShoreLevel.value=level;uniforms.uShoreBounds.value.set(...bounds);},
    setTerrainHeight(data,width,height,origin,step){heightTexture.dispose();heightTexture=new THREE.DataTexture(data,width,height,THREE.RedFormat,THREE.FloatType);heightTexture.minFilter=heightTexture.magFilter=THREE.NearestFilter;heightTexture.needsUpdate=true;uniforms.uTerrainHeight.value=heightTexture;uniforms.uTerrainOrigin.value.set(...origin);uniforms.uTerrainSize.value.set(width,height);uniforms.uTerrainStep.value=step;uniforms.uTerrain.value=1;},
    dispose(){material.dispose();texture.dispose();lightTexture.dispose();farLightTexture.dispose();beaconLightTexture.dispose();heightTexture.dispose();}};
}

function uploadVolume(current:THREE.Data3DTexture,volume:LightVolume):THREE.Data3DTexture {
  const samples=(volume as LightVolume & { readonly surfaceSamples?: Uint8Array }).surfaceSamples;
  const size=volume.size.map(value=>value+(samples?1:0)) as [number,number,number];
  if(samples&&samples.length!==size[0]*size[1]*size[2])throw new Error('Invalid reconstructed light volume');
  const data=samples??volume.light;
  let texture=current;
  if(current.image.width!==size[0]||current.image.height!==size[1]||current.image.depth!==size[2]){
    current.dispose();texture=new THREE.Data3DTexture(data,...size);
    texture.format=THREE.RedFormat;texture.type=THREE.UnsignedByteType;texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.unpackAlignment=1;
  }else texture.image.data=data;
  texture.needsUpdate=true;return texture;
}
