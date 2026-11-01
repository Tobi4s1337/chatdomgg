import * as THREE from 'three';
import { AVATAR_CAPE_LIMITS, AvatarCapeBlueprintSchema, type AvatarCapeBlueprint, type MaterialRegistry } from '@chatdom/shared';
import type { VoxelRenderState } from '@chatdom/render';

export interface CitizenCapeSample {
  readonly id: string;
  /** World heading: zero faces +Z. */
  readonly heading: number;
  /** Actual travelled metres and actual speed in m/s, not requested input speed. */
  readonly distance: number;
  readonly speed: number;
  readonly opacity?: number;
}
export interface CitizenCapeOptions {
  readonly registry: MaterialRegistry;
  /** Shared environment/palette/light uniforms; the caller retains ownership. */
  readonly material: VoxelRenderState;
  readonly capacity?: number;
}
interface Motion {
  lift: number; liftVelocity: number; sway: number; swayVelocity: number;
  speed: number; heading: number; phase: number; seen: number;
}

const vertexShader = /* glsl */ `
  in vec4 aCapeShape, aCapeMotion, aCapeState, aCapeColours;
  in vec3 aCapeFit, aCapeRainbowA, aCapeRainbowB;
  in vec4 aCapePaintCloth;
  uniform float uCapeTime;
  uniform vec2 uCapeWind;
  out vec3 vWorld, vNormal;
  out vec2 vUv;
  flat out vec4 vColours;
  flat out vec3 vRainbowA, vRainbowB, vDimensions;
  flat out vec4 vPaintCloth;
  flat out float vFade, vPhase;

  // A continuous cut, with a fully pinned shoulder edge. No thickness or cubes.
  vec3 surface(vec2 st) {
    float u=st.x-.5, v=st.y, freeEnd=v*v;
    float width=aCapeShape.x, clothLength=aCapeShape.y;
    float widthAt=mix(aCapeShape.z==1.?.72:1.,aCapeShape.z==2.?.72:1.,v*(2.-v));
    float hem=1.;
    if(aCapeShape.w==1.)hem-=.14*pow(u*2.,2.);
    if(aCapeShape.w==2.)hem-=.18*(1.-abs(u*2.));
    float s=v*clothLength*hem;
    float phase=aCapeMotion.z;
    float speed=aCapeState.x;
    // Wind remains world-oriented as the wearer turns. It cannot push cloth through the body.
    float heading=aCapeState.y;
    vec2 side=vec2(cos(heading),-sin(heading));
    vec2 back=vec2(-sin(heading),-cos(heading));
    float across=dot(uCapeWind,side), behind=dot(uCapeWind,back);
    float breeze=length(uCapeWind);
    float gust=.76+.24*sin(uCapeTime*1.15+phase);
    float angle=.035+aCapeMotion.x*(.38+.62*v)+max(0.,behind)*.075*gust*v;
    float gait=sin(aCapeMotion.w*2.-v*4.+phase*.18);
    float flutter=sin(uCapeTime*(5.5+speed*1.5)-v*7.+u*2.5+phase);
    float folds=.010*(.6+.4*cos(u*18.+sin(uCapeTime*.9+phase)*v*.3))*sin(v*3.14159265);
    float trail=s*sin(angle)+freeEnd*(.016+gait*speed*.008+flutter*(.006*breeze+.014*speed));
    trail=max(.008*v,trail)+folds;
    float sway=(aCapeMotion.y+across*.045*gust)*freeEnd;
    sway+=sin(uCapeTime*1.7-v*3.+phase)*.008*breeze*freeEnd;
    return vec3(u*width*widthAt+sway,aCapeFit.x-s*cos(angle),-aCapeFit.y-trail);
  }
  void main() {
    vec3 p=surface(uv);
    // Normals follow the actual bent sheet, including its cut, folds and flutter.
    vec3 across=surface(vec2(min(1.,uv.x+.002),uv.y))-surface(vec2(max(0.,uv.x-.002),uv.y));
    vec3 down=surface(vec2(uv.x,min(1.,uv.y+.002)))-surface(vec2(uv.x,max(0.,uv.y-.002)));
    vec4 world=modelMatrix*instanceMatrix*vec4(p,1.);
    vWorld=world.xyz;
    vNormal=normalize(mat3(modelMatrix*instanceMatrix)*normalize(cross(across,down)));
    vPaintCloth=aCapePaintCloth;
    vUv=uv;vColours=aCapeColours;vRainbowA=aCapeRainbowA;vRainbowB=aCapeRainbowB;
    vDimensions=vec3(aCapeShape.xy,aCapeFit.z);vFade=aCapeState.z;vPhase=aCapeMotion.z;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp sampler3D;
  uniform sampler2D uPalette;
  uniform sampler3D uLight,uFarLight,uBeaconLight;
  uniform vec3 uSun,uAmbient,uSunDirection,uFog,uLightOrigin,uLightExtent,uFarOrigin,uFarExtent,uBeaconOrigin,uBeaconExtent;
  uniform float uSunIntensity,uAmbientIntensity,uNight,uFarCell,uBeaconCell,uCapeTime;
  in vec3 vWorld,vNormal;
  in vec2 vUv;
  flat in vec4 vColours;
  flat in vec3 vRainbowA,vRainbowB,vDimensions;
  flat in vec4 vPaintCloth;
  flat in float vFade,vPhase;
  out vec4 capeColour;
  #define gl_FragColor capeColour
  vec3 swatch(float id){return texelFetch(uPalette,ivec2(int(id)%256,int(id)/256),0).rgb;}
  vec3 linearPaint(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
  vec3 paintedRainbow(int i){
    if(i==0)return vec3(239.,75.,44.)/255.; if(i==1)return vec3(245.,138.,31.)/255.;
    if(i==2)return vec3(246.,210.,60.)/255.; if(i==3)return vec3(63.,174.,74.)/255.;
    if(i==4)return vec3(45.,95.,216.)/255.; return vec3(138.,63.,230.)/255.;
  }
  float rainbowId(int i){return i<3?vRainbowA[i]:vRainbowB[i-3];}
  float packedSample(sampler3D field,ivec3 p){return floor(texelFetch(field,p,0).r*255.+.5);}
  bool inside(vec3 p,vec3 size){return all(greaterThanEqual(p,vec3(0)))&&all(lessThan(p,size));}
  // Same packed, occlusion-aware corner field used by voxel citizens. Borrowed
  // uniform objects track uploads automatically, including replacement textures.
  float warmField(sampler3D field,vec3 origin,vec3 extent,float cellSize,vec3 normal){
    ivec3 size=ivec3(round(extent/cellSize));
    if(any(lessThanEqual(size,ivec3(0))))return 0.;
    vec3 q=(vWorld+normal*.025-origin)/cellSize;
    if(!inside(q,vec3(size)))return 0.;
    if(any(notEqual(textureSize(field,0),size+ivec3(1))))return texture(field,(vWorld+normal*cellSize-origin)/extent).r*17.;
    ivec3 cell=ivec3(floor(q));
    if(packedSample(field,cell)>=128.){
      vec3 end=vec3(cell)+step(vec3(0.),normal),distanceToFace=vec3(1e10);
      if(abs(normal.x)>.0001)distanceToFace.x=(end.x-q.x)/normal.x;
      if(abs(normal.y)>.0001)distanceToFace.y=(end.y-q.y)/normal.y;
      if(abs(normal.z)>.0001)distanceToFace.z=(end.z-q.z)/normal.z;
      q+=normal*(max(0.,min(distanceToFace.x,min(distanceToFace.y,distanceToFace.z)))+.005);
      if(!inside(q,vec3(size)))return 0.;
      cell=ivec3(floor(q));if(packedSample(field,cell)>=128.)return 0.;
    }
    vec3 f=fract(q);
    float a=mod(packedSample(field,cell),16.),b=mod(packedSample(field,cell+ivec3(1,0,0)),16.);
    float c=mod(packedSample(field,cell+ivec3(0,1,0)),16.),d=mod(packedSample(field,cell+ivec3(1,1,0)),16.);
    float e=mod(packedSample(field,cell+ivec3(0,0,1)),16.),g=mod(packedSample(field,cell+ivec3(1,0,1)),16.);
    float h=mod(packedSample(field,cell+ivec3(0,1,1)),16.),i=mod(packedSample(field,cell+ivec3(1,1,1)),16.);
    return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,i,f.x),f.y),f.z)/15.;
  }
  void main(){
    // Opaque screen-door fade follows citizen LOD without transparent sorting or a second pass.
    float noise=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
    if(vFade<=noise)discard;
    vec3 n=normalize(vNormal)*(gl_FrontFacing?1.:-1.);
    float seam=min(min(vUv.x,1.-vUv.x)*vDimensions.x,(1.-vUv.y)*vDimensions.y);
    float trim=1.-smoothstep(vDimensions.z,vDimensions.z+.004,seam);
    vec3 base;
    if(vPaintCloth.w>0.){
      // Builder paints in sRGB before conversion to linear light.
      vec3 paint=gl_FrontFacing?vPaintCloth.rgb:vRainbowA;
      if(vColours.w>0. && gl_FrontFacing){
        float band=fract(vUv.y*1.4+vUv.x*.35-uCapeTime*.22)*6.;
        int first=int(floor(band));
        paint=mix(paint,mix(paintedRainbow(first),paintedRainbow((first+1)%6),fract(band)),vColours.w);
      }
      paint=mix(paint,vRainbowB,trim);
      if(vPaintCloth.w>1.5)paint=mix(paint,vec3(.46,.45,.47),.45);
      base=linearPaint(paint);
    } else {
    base=swatch(gl_FrontFacing?vColours.x:vColours.y);
    if(vColours.w>0.){
      float band=fract(vUv.y*.52+vUv.x*.22-uCapeTime*.055+vPhase*.03)*6.;
      int first=int(floor(band));
      vec3 rainbow=mix(swatch(rainbowId(first)),swatch(rainbowId((first+1)%6)),smoothstep(0.,1.,fract(band)));
      base=mix(base,rainbow,vColours.w*.64);
      vec2 cells=vUv*vec2(4.,6.),p=fract(cells)-.5;
      float starDistance=min(abs(p.x)*5.+abs(p.y),abs(p.x)+abs(p.y)*5.);
      float star=1.-smoothstep(.14,.19+fwidth(starDistance),starDistance);
      float pulse=pow(max(0.,sin(uCapeTime*.9+dot(floor(cells),vec2(2.3,4.7))+vPhase)),6.);
      // Colour interpolation only: stars cannot emit or make paid cloth a light source.
      base=mix(base,swatch(vColours.z),star*pulse*vColours.w*.42);
    }
    base=mix(base,swatch(vColours.z),trim);
    }
    float diffuse=max(dot(n,normalize(uSunDirection)),0.);
    vec3 light=uAmbient*uAmbientIntensity*(.5+.5*max(n.y,0.))+uSun*uSunIntensity*diffuse;
    float warm=warmField(uFarLight,uFarOrigin,uFarExtent,uFarCell,n);
    vec3 uvw=(vWorld-uLightOrigin)/uLightExtent;
    if(all(greaterThan(uvw,vec3(0)))&&all(lessThan(uvw,vec3(1)))){
      vec3 edge=min(uvw,1.-uvw)*uLightExtent;
      warm=mix(warm,warmField(uLight,uLightOrigin,uLightExtent,.5,n),smoothstep(0.,4.,min(edge.x,min(edge.y,edge.z))));
    }
    light+=vec3(1.,.57,.26)*warm*warm*(.4+.6*uNight)*.95;
    float beacon=warmField(uBeaconLight,uBeaconOrigin,uBeaconExtent,uBeaconCell,n);
    light+=vec3(1.,.64,.32)*beacon*beacon*(.3+.7*uNight)*1.25;
    // A quiet neck contact darkening anchors cloth to the shoulders; no shadow sprite.
    vec3 colour=base*light*mix(.86,1.,smoothstep(0.,.22,vUv.y));
    float fogAmount=1.-exp(-length(cameraPosition-vWorld)*.00115*exp(-max(vWorld.y,0.)*.019));
    gl_FragColor=vec4(mix(colour,uFog,min(.86,fogAmount)),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function identityPhase(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296 * Math.PI * 2;
}

/** Exact critically damped response: remains stable across changing display rates. */
function spring(value: number, velocity: number, target: number, rate: number, dt: number): [number, number] {
  const displacement = value - target, decay = Math.exp(-rate * dt);
  const c = velocity + rate * displacement;
  return [target + (displacement + c * dt) * decay, (velocity - rate * c * dt) * decay];
}

/**
 * One draw for every cape cut/colour, 77 shared vertices and 120 triangles per visible
 * citizen. No per-person geometry, particle solver, palette copy or network messages.
 * beginFrame/add/endFrame must use the already culled citizen set and its current
 * back socket matrix. Back matrices include the chest pose; this renderer never
 * duplicates the rig. Damped history is keyed by the supplied identity and pruned
 * at endFrame. The caller owns solid-world clearance for the citizen/cape envelope.
 *
 * Design references (ideas only; original implementation): three.js compute cloth,
 * a58e9ecf/examples/webgpu_compute_cloth.html (MIT: pinned edge and deformed normals),
 * pmndrs/drei MeshWobbleMaterial (MIT: shader deformation). Unlike the compute demo,
 * this runs on WebGL2 and updates only two motion modes per citizen on the CPU.
 */
export function createCitizenCapeRenderer(scene: THREE.Scene, options: CitizenCapeOptions) {
  const capacity = options.capacity ?? 256;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Cape capacity must be a positive integer.');
  const geometry = new THREE.BufferGeometry();
  const { columns, rows, vertices } = AVATAR_CAPE_LIMITS;
  const positions = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2);
  const indices: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const i = y * (columns + 1) + x;
    positions.set([x / columns - .5, -y / rows, 0], i * 3);
    uv.set([x / columns, y / rows], i * 2);
    if (x < columns && y < rows) {
      const next = i + columns + 1;
      indices.push(i, i + 1, next, i + 1, next + 1, next);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  const attribute = (name: string, size: number) => {
    const data = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, data);
    return data;
  };
  const shape = attribute('aCapeShape', 4), fit = attribute('aCapeFit', 3);
  const motion = attribute('aCapeMotion', 4), state = attribute('aCapeState', 4);
  const paintCloth = attribute('aCapePaintCloth', 4);
  const colours = attribute('aCapeColours', 4), rainbowA = attribute('aCapeRainbowA', 3), rainbowB = attribute('aCapeRainbowB', 3);
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const name of ['uPalette', 'uLight', 'uFarLight', 'uBeaconLight', 'uSun', 'uAmbient', 'uSunDirection', 'uFog', 'uLightOrigin', 'uLightExtent', 'uFarOrigin', 'uFarExtent', 'uBeaconOrigin', 'uBeaconExtent', 'uSunIntensity', 'uAmbientIntensity', 'uNight', 'uFarCell', 'uBeaconCell']) {
    const shared = options.material.material.uniforms[name];
    if (!shared) { geometry.dispose(); throw new Error(`Cape lighting needs ${name}.`); }
    uniforms[name] = shared;
  }
  uniforms.uCapeTime = { value: 0 };
  uniforms.uCapeWind = { value: new THREE.Vector2(.3, .16) };
  const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'Citizen cape cloth';
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // caller culls whole citizens, including the trailing hem
  mesh.castShadow = false;
  scene.add(mesh);
  const history = new Map<string, Motion>();
  const validated = new WeakMap<AvatarCapeBlueprint, AvatarCapeBlueprint>();
  const registered = new Set(options.registry.materials.filter(m => m.id !== 0).map(m => m.id));
  let frame = 0, lastTime: number | undefined, dt = 0, open = false, disposed = false;
  function resolve(cape: AvatarCapeBlueprint): AvatarCapeBlueprint {
    const cached = validated.get(cape);
    if (cached) return cached;
    const parsed = AvatarCapeBlueprintSchema.parse(cape);
    for (const id of [...Object.values(parsed.colours), ...(parsed.shimmer?.swatches ?? [])]) {
      if (!registered.has(id)) throw new Error(`Cape ${parsed.id} uses an unregistered swatch.`);
    }
    validated.set(cape, parsed);
    return parsed;
  }
  return {
    mesh,
    get stats() { return { draws: mesh.count ? 1 : 0, capes: mesh.count, triangles: mesh.count * AVATAR_CAPE_LIMITS.triangles, trackedCitizens: history.size }; },
    beginFrame(timeSeconds: number, wind: readonly [number, number] = [.3, .16]) {
      if (disposed) throw new Error('Cape renderer has been disposed.');
      if (open) throw new Error('End the cape frame before starting another.');
      if (![timeSeconds, ...wind].every(Number.isFinite)) throw new Error('Cape time and wind must be finite.');
      if (lastTime !== undefined && timeSeconds < lastTime) history.clear();
      dt = lastTime === undefined ? 0 : Math.min(.1, Math.max(0, timeSeconds - lastTime));
      lastTime = timeSeconds;
      uniforms.uCapeTime!.value = timeSeconds;
      (uniforms.uCapeWind!.value as THREE.Vector2).set(...wind).clampLength(0, 2);
      mesh.count = 0; frame++; open = true;
    },
    add(sample: CitizenCapeSample, source: AvatarCapeBlueprint, backWorldMatrix: THREE.Matrix4, paint?: { readonly cloth: readonly [number, number, number]; readonly lining: readonly [number, number, number]; readonly trim: readonly [number, number, number]; readonly dim: boolean }) {
      if (!open) throw new Error('Begin a cape frame before adding a citizen.');
      if (mesh.count >= capacity) throw new Error(`Cape count exceeds capacity ${capacity}.`);
      if (!sample.id || ![sample.heading, sample.distance, sample.speed, sample.opacity ?? 1, ...backWorldMatrix.elements].every(Number.isFinite) || sample.speed < 0) throw new Error('Invalid citizen cape sample.');
      const cape = resolve(source);
      let item = history.get(sample.id);
      const speed = Math.min(sample.speed, 5), targetLift = Math.min(speed / 3.2, 1) * .90;
      if (!item) {
        item = { lift: targetLift, liftVelocity: 0, sway: 0, swayVelocity: 0, speed, heading: sample.heading, phase: identityPhase(sample.id), seen: -1 };
        history.set(sample.id, item);
      }
      if (item.seen === frame) throw new Error('A citizen can wear only one cape.');
      const turn = Math.atan2(Math.sin(sample.heading - item.heading), Math.cos(sample.heading - item.heading));
      [item.lift, item.liftVelocity] = spring(item.lift, item.liftVelocity, targetLift, 9, dt);
      [item.sway, item.swayVelocity] = spring(item.sway, item.swayVelocity, dt > 0 ? THREE.MathUtils.clamp(turn / dt * -.045, -.16, .16) : 0, 11, dt);
      item.speed += (speed - item.speed) * (1 - Math.exp(-dt * 7));
      item.heading = sample.heading; item.seen = frame;
      const index = mesh.count++;
      mesh.setMatrixAt(index, backWorldMatrix);
      shape.setXYZW(index, cape.width, cape.length, cape.shape === 'flared' ? 1 : cape.shape === 'tapered' ? 2 : 0, cape.hem === 'rounded' ? 1 : cape.hem === 'notched' ? 2 : 0);
      fit.setXYZ(index, cape.mount.height, cape.mount.back, cape.trimWidth);
      motion.setXYZW(index, item.lift, item.sway, item.phase, sample.distance * Math.PI * 2 / .75);
      state.setXYZW(index, item.speed, sample.heading, THREE.MathUtils.clamp(sample.opacity ?? 1, 0, 1), 0);
      colours.setXYZW(index, cape.colours.cloth, cape.colours.lining, cape.colours.trim, cape.shimmer?.strength ?? 0);
      // The look compiles sRGB paint once; reuse rainbow slots for lining and trim.
      if (paint) {
        paintCloth.setXYZW(index, ...paint.cloth, paint.dim ? 2 : 1);
        rainbowA.setXYZ(index, ...paint.lining);
        rainbowB.setXYZ(index, ...paint.trim);
      } else {
        paintCloth.setXYZW(index, 0, 0, 0, 0);
        const rainbow = cape.shimmer?.swatches;
        rainbowA.setXYZ(index, rainbow?.[0] ?? cape.colours.cloth, rainbow?.[1] ?? cape.colours.cloth, rainbow?.[2] ?? cape.colours.cloth);
        rainbowB.setXYZ(index, rainbow?.[3] ?? cape.colours.cloth, rainbow?.[4] ?? cape.colours.cloth, rainbow?.[5] ?? cape.colours.cloth);
      }
    },
    endFrame() {
      if (!open) throw new Error('No cape frame is open.');
      for (const [id, item] of history) if (item.seen !== frame) history.delete(id);
      for (const data of [mesh.instanceMatrix, shape, fit, motion, state, colours, rainbowA, rainbowB, paintCloth]) {
        data.clearUpdateRanges(); data.addUpdateRange(0, mesh.count * data.itemSize); data.needsUpdate = true;
      }
      open = false;
    },
    dispose() {
      scene.remove(mesh); geometry.dispose(); material.dispose(); mesh.dispose(); history.clear();
      open = false; disposed = true;
    },
  };
}
