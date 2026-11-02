import * as THREE from 'three';

/**
 * Water effects at the pier, each one draw: expanding rings on the surface, ballistic droplets, and low mist
 * banks. Every instance lives in a ring buffer and is animated on the GPU from its birth time, so a resting pier
 * costs uniforms only and nothing is allocated per frame.
 */
export function createRings(capacity: number) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const centre = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const ring = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-1e6), 4);
  centre.setUsage(THREE.DynamicDrawUsage); ring.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCentre', centre); geometry.setAttribute('aRing', ring);
  geometry.instanceCount = capacity;
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#dfe8ea') }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true,
    vertexShader: `attribute vec3 aCentre; attribute vec4 aRing; uniform float uTime; varying vec2 vLocal; varying float vT; varying float vStrength; varying float vFog;
      void main(){ float t=(uTime-aRing.x)/aRing.y; vT=t; vStrength=aRing.w; vLocal=position.xz;
        if(t<0.||t>1.){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec4 view=viewMatrix*vec4(aCentre+vec3(position.x*aRing.z,0.,position.z*aRing.z),1.); vFog=length(view.xyz); gl_Position=projectionMatrix*view; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uFogColor; uniform float uFogDensity; varying vec2 vLocal; varying float vT; varying float vStrength; varying float vFog;
      void main(){ float d=length(vLocal); float grow=1.-pow(1.-vT,2.2); float r=.12+.88*grow; float w=.035+.07*vT;
        float band=exp(-pow((d-r)/w,2.)); float inner=exp(-pow((d-r*.62)/(w*1.4),2.))*.35*(1.-vT);
        float a=(band+inner)*vStrength*pow(1.-vT,1.35)*(1.-smoothstep(.94,1.,d)); if(a<.004)discard;
        float fog=1.-exp(-uFogDensity*uFogDensity*vFog*vFog); gl_FragColor=vec4(mix(uColor,uFogColor,fog),a*(1.-fog*.8)); }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'pier-rings'; mesh.frustumCulled = false; mesh.renderOrder = 2;
  let next = 0;
  return {
    mesh, uniforms,
    /** radius in metres, life in seconds, strength 0..1. */
    spawn(x: number, y: number, z: number, radius: number, life: number, strength: number, at: number) {
      const slot = next; next = (next + 1) % capacity;
      centre.setXYZ(slot, x, y + .012, z); ring.setXYZW(slot, at, life, radius, strength);
      centre.addUpdateRange(slot * 3, 3); ring.addUpdateRange(slot * 4, 4);
      centre.needsUpdate = true; ring.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

export function createDroplets(capacity: number) {
  const geometry = new THREE.BufferGeometry();
  const origin = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  const velocity = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  const born = new THREE.BufferAttribute(new Float32Array(capacity * 2).fill(-1e6), 2);
  for (const attribute of [origin, velocity, born]) attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', origin); geometry.setAttribute('aVelocity', velocity); geometry.setAttribute('aBorn', born);
  const uniforms = { uTime: { value: 0 }, uWater: { value: 0 }, uScale: { value: 400 }, uColor: { value: new THREE.Color('#eef4f3') } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 aVelocity; attribute vec2 aBorn; uniform float uTime; uniform float uWater; uniform float uScale; varying float vA;
      void main(){ float t=uTime-aBorn.x; vec3 p=position+aVelocity*t+vec3(0.,-4.9*t*t,0.);
        if(t<0.||t>1.6||p.y<uWater-.01){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vA=0.;return;}
        vec4 view=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*view; gl_PointSize=clamp(aBorn.y*uScale/max(.3,-view.z),1.,24.); vA=1.-smoothstep(.9,1.6,t); }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ vec2 c=gl_PointCoord*2.-1.; float d=dot(c,c); if(d>1.)discard;
      float core=1.-d; gl_FragColor=vec4(uColor*(.85+.3*core),vA*core*.9); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'pier-droplets'; points.frustumCulled = false; points.renderOrder = 3;
  let next = 0, seed = 1;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return {
    points, uniforms,
    /** A burst: `count` droplets thrown up and out from a point, `force` in metres per second. */
    burst(x: number, y: number, z: number, count: number, force: number, size: number, at: number) {
      for (let i = 0; i < count; i++) {
        const slot = next; next = (next + 1) % capacity;
        const angle = random() * Math.PI * 2, spread = (.25 + random() * .75) * force * .45, lift = force * (.55 + random() * .6);
        origin.setXYZ(slot, x + Math.cos(angle) * .05, y, z + Math.sin(angle) * .05);
        velocity.setXYZ(slot, Math.cos(angle) * spread, lift, Math.sin(angle) * spread);
        born.setXY(slot, at + random() * .04, size * (.6 + random() * .8));
      }
      origin.needsUpdate = velocity.needsUpdate = born.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

/** Low banks of mist lying on the water around the pier head: soft, drifting, fading near the eye. */
export function createMist(centres: readonly (readonly [number, number, number, number])[]) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const data = new THREE.InstancedBufferAttribute(new Float32Array(centres.flat()), 4);
  geometry.setAttribute('aBank', data); geometry.instanceCount = centres.length;
  const uniforms = { uTime: { value: 0 }, uMist: { value: 0 }, uColor: { value: new THREE.Color('#c9cfd2') } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aBank; uniform float uTime; uniform float uMist; varying vec2 vUv; varying vec3 vWorld; varying float vNear;
      void main(){ if(uMist<.01){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0])); float width=aBank.w, height=aBank.w*.16;
        vec3 world=aBank.xyz+right*position.x*width+vec3(0.,position.y*height,0.)+vec3(sin(uTime*.05+aBank.x)*1.5,0.,cos(uTime*.04+aBank.z)*1.5);
        vUv=vec2(position.x*.5+.5,position.y); vWorld=world; vec4 view=viewMatrix*vec4(world,1.); vNear=smoothstep(2.,9.,-view.z); gl_Position=projectionMatrix*view; }`,
    fragmentShader: `uniform float uTime; uniform float uMist; uniform vec3 uColor; varying vec2 vUv; varying vec3 vWorld; varying float vNear;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main(){ vec2 q=vWorld.xz*.09+vec2(uTime*.012,uTime*.007); float f=n(q)*.55+n(q*2.3+3.1)*.3+n(q*5.1-1.7)*.15;
        float edge=smoothstep(0.,.18,vUv.x)*smoothstep(1.,.82,vUv.x); float body=smoothstep(0.,.12,vUv.y)*pow(1.-vUv.y,1.6);
        float a=uMist*edge*body*smoothstep(.25,.75,f)*.42*vNear; if(a<.003)discard; gl_FragColor=vec4(uColor,a); }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'pier-mist'; mesh.frustumCulled = false; mesh.renderOrder = 4;
  return { mesh, uniforms, dispose() { geometry.dispose(); material.dispose(); } };
}
