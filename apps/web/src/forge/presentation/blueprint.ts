import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RUNE_SLOTS } from './runes';
import type { Silhouette } from './silhouette';

/** Cell-quantised arrival shared by the fill and its contour, so both appear voxel by voxel. */
const ARRIVAL = /* glsl */`
  uniform float uCell,uReveal,uRadius,uDissolve;
  uniform vec3 uOrigins[${RUNE_SLOTS}];uniform int uOriginCount;
  float cellHash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  /** Positive once a cell has arrived; grows with its age. */
  float arrival(vec3 local,vec3 normal,out float hash){
    vec3 index=floor((local-normal*uCell*.5)/uCell);
    vec3 centre=(index+.5)*uCell;hash=cellHash(index);
    float nearest=1e4;
    for(int i=0;i<${RUNE_SLOTS};i++){if(i>=uOriginCount)break;nearest=min(nearest,distance(centre,uOrigins[i]));}
    float order=mix(nearest/uRadius+hash*.12,hash,uDissolve);
    return uReveal*1.25-order;
  }`;

/**
 * The silhouette drawn in light: a cool translucent body ruled at every build cell, and a pale inked contour
 * (an inverted hull) that reads at stream distance. Both are owned copies of the traced clone surface.
 */
export function createBlueprint(silhouette: Silhouette) {
  const object = new THREE.Group(); object.name = 'forge-blueprint'; object.visible = false;
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(silhouette.positions, 3));
  body.setAttribute('normal', new THREE.BufferAttribute(silhouette.normals, 3));
  const welded = new THREE.BufferGeometry();
  welded.setAttribute('position', new THREE.BufferAttribute(silhouette.positions.slice(), 3));
  const hull = mergeVertices(welded, silhouette.cell * 1e-3); welded.dispose();
  hull.computeVertexNormals();
  const size = silhouette.bounds.getSize(new THREE.Vector3());
  const origins = Array.from({ length: RUNE_SLOTS }, (_, i) => (silhouette.landings[i % Math.max(1, silhouette.landings.length)] ?? silhouette.bounds.getCenter(new THREE.Vector3())).clone());
  const shared = {
    uCell: { value: silhouette.cell }, uReveal: { value: 0 }, uRadius: { value: Math.max(silhouette.cell * 4, size.length() * .62) },
    uDissolve: { value: 0 }, uOrigins: { value: origins }, uOriginCount: { value: Math.min(RUNE_SLOTS, Math.max(1, silhouette.landings.length)) },
    uGlow: { value: 1 },
  };
  const fillMaterial = new THREE.ShaderMaterial({
    name: 'forge-blueprint-body', transparent: true, depthWrite: true,
    uniforms: { ...shared, uFill: { value: new THREE.Color('#5fa9d6') }, uSky: { value: new THREE.Color('#c4e6ff') }, uRule: { value: new THREE.Color('#e3f4ff') }, uBase: { value: silhouette.bounds.min.y }, uHeight: { value: Math.max(silhouette.cell, size.y) }, uWarm: { value: new THREE.Color('#ffc978') }, uLock: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vLocal,vNormal,vViewNormal,vView;
      void main(){vLocal=position;vNormal=normal;vec4 view=modelViewMatrix*vec4(position,1.);vView=view.xyz;vViewNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*view;}`,
    fragmentShader: /* glsl */`
      ${ARRIVAL}
      uniform vec3 uFill,uSky,uRule,uWarm;uniform float uGlow,uLock,uBase,uHeight;
      varying vec3 vLocal,vNormal,vViewNormal,vView;
      void main(){
        float hash;float age=arrival(vLocal,vNormal,hash);
        if(age<0.)discard;
        float fresh=1.-smoothstep(0.,.2,age);
        vec3 g=vLocal/uCell,f=abs(fract(g+.5)-.5),w=fwidth(g);
        vec3 line=1.-smoothstep(vec3(.035),vec3(.035)+w*1.2,f);
        vec3 axis=abs(vNormal);
        float rule=max(axis.x>.5?0.:line.x,max(axis.y>.5?0.:line.y,axis.z>.5?0.:line.z));
        float rim=1.-abs(dot(normalize(vViewNormal),normalize(-vView)));
        // Value first: lit tops, cooler sides, a lighter crown, and a faint per-cell variation.
        float up=max(vNormal.y,0.),side=1.-abs(vNormal.y),height=clamp((vLocal.y-uBase)/uHeight,0.,1.);
        vec3 body=mix(uFill*(.78+.16*side*(vNormal.x+vNormal.z>0.?1.:.35)),uSky,up*.75+height*.2)*(.95+.08*hash);
        vec3 colour=mix(body,uRule,rule*.3);
        colour=mix(colour,uWarm*1.1,fresh*.85);
        float alpha=((.54+.2*up+.14*rim)+rule*(.06+.12*uLock))*uGlow+fresh*.3;
        gl_FragColor=vec4(colour*(1.+.22*uLock),min(alpha,.9));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const inkMaterial = new THREE.ShaderMaterial({
    name: 'forge-blueprint-ink', transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { ...shared, uInk: { value: 0 }, uInkAlpha: { value: 1 }, uThickness: { value: silhouette.cell * .3 }, uBase: { value: silhouette.bounds.min.y }, uHeight: { value: Math.max(silhouette.cell, size.y) }, uColour: { value: new THREE.Color('#e4f5ff') } },
    vertexShader: /* glsl */`
      uniform float uThickness;varying vec3 vLocal,vNormal;
      void main(){vLocal=position;vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*uThickness,1.);}`,
    fragmentShader: /* glsl */`
      ${ARRIVAL}
      uniform float uInk,uInkAlpha,uBase,uHeight,uGlow;uniform vec3 uColour;
      varying vec3 vLocal,vNormal;
      void main(){
        float hash;float age=arrival(vLocal,vNormal,hash);
        float drawn=clamp((uInk*1.14-(vLocal.y-uBase)/uHeight)/.06,0.,1.);
        if(age<0.||drawn<=0.)discard;
        gl_FragColor=vec4(uColour*(.95+.25*uGlow),.95*drawn*uInkAlpha*min(uGlow,1.));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const fill = new THREE.Mesh(body, fillMaterial); fill.name = 'forge-blueprint-body'; fill.renderOrder = 1; fill.frustumCulled = false;
  const ink = new THREE.Mesh(hull, inkMaterial); ink.name = 'forge-blueprint-ink'; ink.renderOrder = 2; ink.frustumCulled = false;
  object.add(fill, ink);
  const u = { fill: fillMaterial.uniforms, ink: inkMaterial.uniforms };
  return {
    object,
    /** Every value is set on every call, so the drawn state depends only on the latest arguments. */
    set(state: { visible: boolean; reveal: number; ink: number; inkAlpha: number; dissolve: number; glow: number; lock: number }) {
      object.visible = state.visible;
      shared.uReveal.value = state.reveal; shared.uDissolve.value = state.dissolve; shared.uGlow.value = state.glow;
      u.fill.uLock!.value = state.lock; u.ink.uInk!.value = state.ink; u.ink.uInkAlpha!.value = state.inkAlpha;
    },
    dispose() { body.dispose(); hull.dispose(); fillMaterial.dispose(); inkMaterial.dispose(); },
  };
}
