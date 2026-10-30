import * as THREE from 'three';
import { VOXEL_METRES, type MaterialRegistry, type VoxelLattice } from '@chatdom/shared';
import type { AssetChunkMesh, LightVolume } from '@chatdom/voxel';
import type { Environment } from './atmosphere';

export interface VoxelRenderState {
  material:THREE.ShaderMaterial;
  setEnvironment(grade:Environment):void;
  setLight(volume:LightVolume):void;
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
  let heightTexture=new THREE.DataTexture(new Float32Array(1),1,1,THREE.RedFormat,THREE.FloatType);heightTexture.needsUpdate=true;
  const uniforms={uScale:{value:VOXEL_METRES[lattice]},uPalette:{value:texture},uSun:{value:new THREE.Color()},uAmbient:{value:new THREE.Color()},uSunDirection:{value:new THREE.Vector3()},uSunIntensity:{value:1},uAmbientIntensity:{value:1},uFog:{value:new THREE.Color()},uNight:{value:0},uLight:{value:lightTexture},uLightOrigin:{value:new THREE.Vector3()},uLightExtent:{value:new THREE.Vector3(1,1,1)},uTerrainHeight:{value:heightTexture},uTerrainOrigin:{value:new THREE.Vector2()},uTerrainSize:{value:new THREE.Vector2(1,1)},uTerrainStep:{value:1},uTerrain:{value:0}};
  const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,vertexShader:`
    in uint aPacked; in uint aMaterial;
    uniform float uScale; out vec3 vWorld; out vec3 vNormal; out float vAo; out float vSky; flat out uint vMaterial;
    uniform sampler2D uTerrainHeight;uniform vec2 uTerrainOrigin,uTerrainSize;uniform float uTerrainStep,uTerrain;
    float groundHeight(vec2 world){vec2 uv=clamp((world-uTerrainOrigin)/uTerrainStep,vec2(0.),uTerrainSize-vec2(1.001));ivec2 p=ivec2(floor(uv));vec2 f=fract(uv);return mix(mix(texelFetch(uTerrainHeight,p,0).r,texelFetch(uTerrainHeight,p+ivec2(1,0),0).r,f.x),mix(texelFetch(uTerrainHeight,p+ivec2(0,1),0).r,texelFetch(uTerrainHeight,p+ivec2(1,1),0).r,f.x),f.y);}
    void main(){
      vec3 p=vec3(float(aPacked&63u),float((aPacked>>6u)&63u),float((aPacked>>12u)&63u));
      p+=32.*vec3(float((aMaterial>>16u)&31u),float((aMaterial>>21u)&31u),float((aMaterial>>26u)&31u));
      uint face=(aPacked>>18u)&7u;
      vec3 n=face==0u?vec3(1,0,0):face==1u?vec3(-1,0,0):face==2u?vec3(0,1,0):face==3u?vec3(0,-1,0):face==4u?vec3(0,0,1):vec3(0,0,-1);
      vec4 local=vec4(p*uScale,1.);
      #ifdef USE_INSTANCING
        local=instanceMatrix*local;n=mat3(instanceMatrix)*n;
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
    uniform sampler2D uPalette;uniform sampler3D uLight;
    uniform vec3 uSun,uAmbient,uSunDirection,uFog,uLightOrigin,uLightExtent;
    uniform float uSunIntensity,uAmbientIntensity,uNight;
    in vec3 vWorld,vNormal;in float vAo,vSky;flat in uint vMaterial;
    float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
    void main(){
      vec4 swatch=texelFetch(uPalette,ivec2(int(vMaterial&255u),int(vMaterial>>8u)),0);vec3 base=swatch.rgb;
      vec3 n=normalize(vNormal);vec2 uv=abs(n.y)>.5?vWorld.xz:abs(n.x)>.5?vWorld.zy:vWorld.xy;
      float kind=swatch.a;
      float variation=hash(floor(vWorld*8.+n*.03));base*=.95+.10*variation;
      float edge=1.;
      if(kind==3.) {vec2 stone=uv*vec2(1.65,3.2);stone.x+=mod(floor(stone.y),2.)*.5;vec2 f=fract(stone);float mortar=min(min(f.x,1.-f.x),min(f.y,1.-f.y));edge=mix(.77,1.,smoothstep(.018,.058,mortar));}
      if(kind==4.) {float grain=sin(uv.y*22.+sin(uv.x*6.)*.4);edge=.93+.045*grain;float plank=fract(uv.x*4.);edge*=mix(.78,1.,smoothstep(.015,.05,min(plank,1.-plank)));}
      if(kind==6.) {vec2 tile=uv*vec2(3.,5.);tile.x+=mod(floor(tile.y),2.)*.5;vec2 f=fract(tile);edge=.88+.12*smoothstep(.02,.08,min(f.x,min(f.y,1.-f.x)));}
      float ao=mix(.49,1.,vAo);float sky=mix(.24,1.,vSky);
      float diffuse=max(dot(n,normalize(uSunDirection)),0.);
      vec3 cool=uAmbient*uAmbientIntensity*(.52+.48*max(n.y,0.))*sky;
      vec3 light=cool+uSun*uSunIntensity*diffuse*(.24+.76*vSky);
      vec3 uvw=(vWorld+n*.51-uLightOrigin)/uLightExtent;
      float warm=0.;if(all(greaterThan(uvw,vec3(0)))&&all(lessThan(uvw,vec3(1)))) warm=texture(uLight,uvw).r*17.;
      // The field is blocked by occupied cells; this adds real warm street/wall illumination, not a decal.
      light+=vec3(1.,.43,.13)*warm*(.35+.65*uNight)*1.65;
      vec3 colour=base*edge*light*ao;
      vec2 cell=fract(uv*8.);float bevel=min(min(cell.x,1.-cell.x),min(cell.y,1.-cell.y));
      colour+=base*.035*(1.-smoothstep(.0,.10,bevel))*(.3+.7*diffuse)*vAo;
      float distanceToCamera=length(cameraPosition-vWorld);
      float fogAmount=1.-exp(-distanceToCamera*.0016*exp(-max(vWorld.y,0.)*.019));
      colour=mix(colour,uFog,min(.86,fogAmount));
      gl_FragColor=vec4(colour,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  return {material,setEnvironment(g){uniforms.uSun.value.set(g.sun);uniforms.uAmbient.value.set(g.ambient);uniforms.uFog.value.set(g.fog);uniforms.uSunDirection.value.set(...g.sunDirection);uniforms.uSunIntensity.value=g.sunIntensity;uniforms.uAmbientIntensity.value=g.ambientIntensity;uniforms.uNight.value=g.night;},
    setLight(v){const next=new THREE.Data3DTexture(v.light,v.size[0],v.size[1],v.size[2]);next.format=THREE.RedFormat;next.type=THREE.UnsignedByteType;next.minFilter=THREE.NearestFilter;next.magFilter=THREE.NearestFilter;next.unpackAlignment=1;next.needsUpdate=true;uniforms.uLight.value=next;uniforms.uLightOrigin.value.set(...v.origin);uniforms.uLightExtent.value.set(v.size[0]*v.cellSize,v.size[1]*v.cellSize,v.size[2]*v.cellSize);lightTexture.dispose();lightTexture=next;},
    setTerrainHeight(data,width,height,origin,step){heightTexture.dispose();heightTexture=new THREE.DataTexture(data,width,height,THREE.RedFormat,THREE.FloatType);heightTexture.minFilter=heightTexture.magFilter=THREE.NearestFilter;heightTexture.needsUpdate=true;uniforms.uTerrainHeight.value=heightTexture;uniforms.uTerrainOrigin.value.set(...origin);uniforms.uTerrainSize.value.set(width,height);uniforms.uTerrainStep.value=step;uniforms.uTerrain.value=1;},
    dispose(){material.dispose();texture.dispose();lightTexture.dispose();heightTexture.dispose();}};
}
