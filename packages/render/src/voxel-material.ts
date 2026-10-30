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

export function createVoxelMaterial(registry:MaterialRegistry,lattice:VoxelLattice):VoxelRenderState {
  const palette=new Float32Array(65536*4);
  const kinds=['air','earth','grass','stone','wood','plaster','roof','leaf','metal','fabric','glass'];
  for(const m of registry.materials) {const colour=new THREE.Color(m.colour);palette.set([colour.r,colour.g,colour.b,kinds.indexOf(m.surface)],m.id*4);}
  const texture=new THREE.DataTexture(palette,256,256,THREE.RGBAFormat,THREE.FloatType);texture.needsUpdate=true;
  let lightTexture=new THREE.Data3DTexture(new Uint8Array(1),1,1,1);lightTexture.format=THREE.RedFormat;lightTexture.needsUpdate=true;
  let farLightTexture=new THREE.Data3DTexture(new Uint8Array(1),1,1,1);farLightTexture.format=THREE.RedFormat;farLightTexture.needsUpdate=true;
  let beaconLightTexture=new THREE.Data3DTexture(new Uint8Array(1),1,1,1);beaconLightTexture.format=THREE.RedFormat;beaconLightTexture.needsUpdate=true;
  let heightTexture=new THREE.DataTexture(new Float32Array(1),1,1,THREE.RedFormat,THREE.FloatType);heightTexture.needsUpdate=true;
  const uniforms={uScale:{value:VOXEL_METRES[lattice]},uPalette:{value:texture},uSun:{value:new THREE.Color()},uAmbient:{value:new THREE.Color()},uSunDirection:{value:new THREE.Vector3()},uSunIntensity:{value:1},uAmbientIntensity:{value:1},uFog:{value:new THREE.Color()},uNight:{value:0},uLight:{value:lightTexture},uLightOrigin:{value:new THREE.Vector3()},uLightExtent:{value:new THREE.Vector3(1,1,1)},uFarLight:{value:farLightTexture},uFarOrigin:{value:new THREE.Vector3()},uFarExtent:{value:new THREE.Vector3(1,1,1)},uFarCell:{value:2},uBeaconLight:{value:beaconLightTexture},uBeaconOrigin:{value:new THREE.Vector3()},uBeaconExtent:{value:new THREE.Vector3(1,1,1)},uBeaconCell:{value:2},uTerrainHeight:{value:heightTexture},uTerrainOrigin:{value:new THREE.Vector2()},uTerrainSize:{value:new THREE.Vector2(1,1)},uTerrainStep:{value:1},uTerrain:{value:0},uShoreLevel:{value:-1e6},uShoreBounds:{value:new THREE.Vector4()},uTerrainSoil:{value:new THREE.Color(registry.materials.find(m=>m.surface==='earth')?.colour??'#87664d')},uTerrainGrass:{value:new THREE.Color(registry.materials.find(m=>m.surface==='grass')?.colour??'#667f52')}};
  const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,vertexShader:`
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
    uniform vec3 uSun,uAmbient,uSunDirection,uFog,uLightOrigin,uLightExtent,uFarOrigin,uFarExtent,uBeaconOrigin,uBeaconExtent;
    uniform float uSunIntensity,uAmbientIntensity,uNight,uFarCell,uBeaconCell,uTerrain,uShoreLevel;
    uniform vec3 uTerrainSoil,uTerrainGrass;uniform vec4 uShoreBounds;
    in vec3 vWorld,vNormal;in float vAo,vSky,vLodFade;flat in uint vMaterial;
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
      vec3 cool=uAmbient*uAmbientIntensity*(.38+.62*max(n.y,0.))*sky;
      vec3 light=cool+uSun*uSunIntensity*diffuse*(.15+.85*vSky) /* sun-visibility */;
      vec3 uvw=(vWorld-uLightOrigin)/uLightExtent;
      float warm=surfaceField(uFarLight,uFarOrigin,uFarExtent,uFarCell,n);
      float nearBlend=0.;
      if(all(greaterThan(uvw,vec3(0)))&&all(lessThan(uvw,vec3(1)))){
        vec3 edge=min(uvw,1.-uvw)*uLightExtent;
        nearBlend=smoothstep(0.,4.,min(edge.x,min(edge.y,edge.z)));
        warm=mix(warm,surfaceField(uLight,uLightOrigin,uLightExtent,.5,n),nearBlend);
      }
      // The field is blocked by occupied cells; this adds real warm street/wall illumination, not a decal.
      light+=vec3(1.,.57,.26)*warm*warm*(.22+.78*uNight)*.95;
      float beacon=surfaceField(uBeaconLight,uBeaconOrigin,uBeaconExtent,uBeaconCell,n);
      light+=vec3(1.,.64,.32)*beacon*beacon*(.3+.7*uNight)*1.25;
      if(uTerrain>.5){
        float contact=groundContact(uFarLight,uFarOrigin,uFarExtent,uFarCell,n);
        if(nearBlend>0.)contact=mix(contact,groundContact(uLight,uLightOrigin,uLightExtent,.5,n),nearBlend);
        ao*=1.-contact*.24;
      }
      vec3 colour=base*edge*light*ao;
      vec2 cell=fract(uv*8.);float bevel=min(min(cell.x,1.-cell.x),min(cell.y,1.-cell.y));
      if(kind==3.||kind==4.||kind==6.)colour+=base*.018*(1.-smoothstep(.0,.10,bevel))*(.3+.7*diffuse)*vAo*detail;
      float distanceToCamera=length(cameraPosition-vWorld);
      float fogAmount=1.-exp(-distanceToCamera*.00115*exp(-max(vWorld.y,0.)*.019));
      colour=mix(colour,uFog,min(.86,fogAmount));
      gl_FragColor=vec4(colour,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  return {material,setEnvironment(g){uniforms.uSun.value.set(g.sun);uniforms.uAmbient.value.set(g.ambient);uniforms.uFog.value.set(g.fog);uniforms.uSunDirection.value.set(...g.sunDirection);uniforms.uSunIntensity.value=g.sunIntensity;uniforms.uAmbientIntensity.value=g.ambientIntensity;uniforms.uNight.value=g.night;},
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
