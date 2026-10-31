import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELLS, type CellUniforms } from './cells';
import type { Silhouette } from './silhouette';

/**
 * The silhouette drawn in light: a cool translucent body ruled at every build cell, and a pale inked contour
 * (an inverted hull) that reads at stream distance. Both are owned copies of the traced clone surface.
 */
export function createBlueprint(silhouette: Silhouette, shared: CellUniforms) {
  const object = new THREE.Group(); object.name = 'forge-blueprint'; object.visible = false;
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(silhouette.positions, 3));
  body.setAttribute('normal', new THREE.BufferAttribute(silhouette.normals, 3));
  const welded = new THREE.BufferGeometry();
  welded.setAttribute('position', new THREE.BufferAttribute(silhouette.positions.slice(), 3));
  const hull = mergeVertices(welded, silhouette.cell * 1e-3); welded.dispose();
  hull.computeVertexNormals();
  const fillMaterial = new THREE.ShaderMaterial({
    name: 'forge-blueprint-body', transparent: true, depthWrite: true,
    uniforms: { ...shared, uBody: { value: new THREE.Color('#5fa9d6') }, uSky: { value: new THREE.Color('#c4e6ff') }, uRule: { value: new THREE.Color('#e3f4ff') }, uWarm: { value: new THREE.Color('#ffc978') }, uLock: { value: 0 }, uBodyAlpha: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vLocal,vNormal,vViewNormal,vView;
      void main(){vLocal=position;vNormal=normal;vec4 view=modelViewMatrix*vec4(position,1.);vView=view.xyz;vViewNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*view;}`,
    fragmentShader: /* glsl */`
      ${CELLS}
      uniform vec3 uBody,uSky,uRule,uWarm;uniform float uGlow,uLock,uBodyAlpha;
      varying vec3 vLocal,vNormal,vViewNormal,vView;
      void main(){
        vec3 index=cellIndex(vLocal,vNormal);float hash=cellHash(index);float age=arrival(index,hash);
        // Cells the molten metal has reached belong to the shell now.
        if(age<0.||molten(index,hash)>0.)discard;
        float fresh=1.-smoothstep(0.,.2,age);
        vec3 g=vLocal/uCell,f=abs(fract(g+.5)-.5),w=fwidth(g);
        vec3 line=1.-smoothstep(vec3(.035),vec3(.035)+w*1.2,f);
        vec3 axis=abs(vNormal);
        float rule=max(axis.x>.5?0.:line.x,max(axis.y>.5?0.:line.y,axis.z>.5?0.:line.z));
        float rim=1.-abs(dot(normalize(vViewNormal),normalize(-vView)));
        // Value first: lit tops, cooler sides, a lighter crown, and a faint per-cell variation.
        float up=max(vNormal.y,0.),side=1.-abs(vNormal.y),height=clamp((vLocal.y-uBase)/uHeight,0.,1.);
        vec3 body=mix(uBody*(.78+.16*side*(vNormal.x+vNormal.z>0.?1.:.35)),uSky,up*.75+height*.2)*(.95+.08*hash);
        vec3 colour=mix(body,uRule,rule*.3);
        colour=mix(colour,uWarm*1.1,fresh*.85);
        float alpha=((.54+.2*up+.14*rim)+rule*(.06+.12*uLock))*uGlow+fresh*.3;
        gl_FragColor=vec4(colour*(1.+.22*uLock),min(alpha,.9)*uBodyAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const inkMaterial = new THREE.ShaderMaterial({
    name: 'forge-blueprint-ink', transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { ...shared, uInk: { value: 0 }, uInkAlpha: { value: 1 }, uThickness: { value: silhouette.cell * .3 }, uColour: { value: new THREE.Color('#e4f5ff') } },
    vertexShader: /* glsl */`
      uniform float uThickness;varying vec3 vLocal,vNormal;
      void main(){vLocal=position;vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*uThickness,1.);}`,
    fragmentShader: /* glsl */`
      ${CELLS}
      uniform float uInk,uInkAlpha,uGlow;uniform vec3 uColour;
      varying vec3 vLocal,vNormal;
      void main(){
        vec3 index=cellIndex(vLocal,vNormal);float hash=cellHash(index);float age=arrival(index,hash);
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
    /** The traced surface as one owned geometry, also drawn by the molten shell. */
    body,
    /** Every value is set on every call, so the drawn state depends only on the latest arguments. */
    set(state: { visible: boolean; reveal: number; ink: number; inkAlpha: number; bodyAlpha: number; dissolve: number; glow: number; lock: number }) {
      object.visible = state.visible;
      // Once every cell is molten the body has nothing left to draw.
      fill.visible = shared.uFill.value < 1 && state.bodyAlpha > .001;
      shared.uReveal.value = state.reveal; shared.uDissolve.value = state.dissolve; shared.uGlow.value = state.glow;
      u.fill.uLock!.value = state.lock; u.fill.uBodyAlpha!.value = state.bodyAlpha; u.ink.uInk!.value = state.ink; u.ink.uInkAlpha!.value = state.inkAlpha;
    },
    dispose() { body.dispose(); hull.dispose(); fillMaterial.dispose(); inkMaterial.dispose(); },
  };
}
