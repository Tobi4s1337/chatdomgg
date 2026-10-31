import * as THREE from 'three';
import { CELLS, type CellUniforms } from './cells';

export const SHELL_MODE = { molten: 0, heat: 1, light: 2 } as const;
export interface ShellState {
  visible: boolean;
  mode: (typeof SHELL_MODE)[keyof typeof SHELL_MODE];
  /** Cooling progress [0, 1]; cells nearest the strike give up their heat first. */
  cool: number;
  /** A short, local white-hot bloom around the strike point. */
  flash: number;
  /** Reduced-motion dissolve: cells covered in light, then cells gone. */
  cover: number;
  vanish: number;
  /** Seconds, for a calm shimmer on the molten surface only. */
  time: number;
}

/**
 * Molten metal on the part's own traced surface. While pouring it owns the cells the metal has reached; after
 * the strike it lies over the real clone as heat and gives way cell by cell to the kingdom's colours. In the
 * reduced-motion path it is the cool light the part dissolves into and settles out of.
 */
export function createShell(geometry: THREE.BufferGeometry, shared: CellUniforms, impact: THREE.Vector3) {
  const material = new THREE.ShaderMaterial({
    name: 'forge-shell', transparent: true, depthWrite: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    uniforms: {
      ...shared,
      uMode: { value: 0 }, uCool: { value: 0 }, uFlash: { value: 0 }, uCover: { value: 0 }, uVanish: { value: 0 }, uTime: { value: 0 },
      uImpact: { value: impact.clone() }, uImpactRadius: { value: Math.max(shared.uCell.value * 4, shared.uRadius.value * 1.4) },
      uWhite: { value: new THREE.Color('#fff3cf') }, uHot: { value: new THREE.Color('#ffc154') }, uOrange: { value: new THREE.Color('#ff6d1c') },
      uDeep: { value: new THREE.Color('#9a2812') }, uPale: { value: new THREE.Color('#e9f6ff') }, uGold: { value: new THREE.Color('#ffe2a8') },
    },
    vertexShader: /* glsl */`
      varying vec3 vLocal,vNormal;
      void main(){vLocal=position;vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: /* glsl */`
      ${CELLS}
      uniform int uMode;uniform float uCool,uFlash,uCover,uVanish,uTime,uImpactRadius;uniform vec3 uImpact;
      uniform vec3 uWhite,uHot,uOrange,uDeep,uPale,uGold;
      varying vec3 vLocal,vNormal;
      void main(){
        vec3 index=cellIndex(vLocal,vNormal);float hash=cellHash(index);vec3 centre=cellCentre(index);
        vec3 g=vLocal/uCell,f=abs(fract(g+.5)-.5),w=fwidth(g);
        vec3 line=1.-smoothstep(vec3(.045),vec3(.045)+w*1.3,f),axis=abs(vNormal);
        float seam=max(axis.x>.5?0.:line.x,max(axis.y>.5?0.:line.y,axis.z>.5?0.:line.z));
        float up=max(vNormal.y,0.),shade=.66+.34*up+.05*hash-.08*abs(vNormal.x);
        float near=exp(-distance(centre,uImpact)/(uCell*5.));
        vec3 colour;float alpha=1.;
        if(uMode==0){
          float age=molten(index,hash);
          if(age<=0.)discard;
          // The newest layer is white-gold; older layers deepen to orange and grow a dark skin along their seams.
          float fresh=exp(-age*.75),skin=smoothstep(.6,5.,age);
          colour=mix(uHot,uOrange,smoothstep(0.,2.6,age));
          colour=mix(colour,uDeep,skin*.5);
          colour=mix(colour,uWhite,fresh*(.5+.5*up));
          colour*=(1.-seam*.42*skin)*shade*(1.+.05*sin(uTime*2.4+hash*6.283)*(1.-skin));
          colour=mix(colour,uWhite*1.15,uFlash*near);
          colour*=1.22;
        }else if(uMode==1){
          float d=clamp(distance(centre,uImpact)/uImpactRadius,0.,1.);
          float start=.4*d+.16*hash;
          float heat=1.-smoothstep(start,start+.4,uCool);
          // Faces lose their glow first; the seams stay lit a moment longer, like iron giving up its heat.
          float face=smoothstep(.3,.62,heat),lit=seam*smoothstep(.02,.3,heat);
          alpha=max(face,lit*.95);
          if(alpha<=.01)discard;
          // At full heat it is the poured metal it was a moment ago: orange under a dark skin.
          colour=mix(uDeep,mix(uOrange,uDeep,.4),smoothstep(.3,.72,heat));
          colour*=mix(1.,1.-seam*.42,smoothstep(.45,.8,heat))*shade;
          colour=mix(colour,uOrange*1.3,lit*(1.-face));
          colour=mix(colour,uWhite*1.15,uFlash*near);
          colour*=1.18;
        }else{
          if(hash>=uCover||fract(hash*7.13+.31)<uVanish)discard;
          colour=mix(uPale,uGold,.35+.3*up)*(1.+.25*seam)*shade*1.1;
          alpha=.88;
        }
        gl_FragColor=vec4(colour,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'forge-shell'; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = .5; mesh.visible = false;
  const u = material.uniforms;
  return {
    mesh,
    /** Every value is set on every call, so the drawn state depends only on the latest arguments. */
    set(state: ShellState, pose: THREE.Matrix4) {
      mesh.visible = state.visible;
      mesh.matrix.copy(pose); mesh.matrixWorldNeedsUpdate = true;
      u.uMode!.value = state.mode; u.uCool!.value = state.cool; u.uFlash!.value = state.flash;
      u.uCover!.value = state.cover; u.uVanish!.value = state.vanish; u.uTime!.value = state.time;
      // Molten metal stands in for the hidden clone; heat and light lie over it.
      material.depthWrite = state.mode === SHELL_MODE.molten;
    },
    /** The shell shares the blueprint's geometry, which the blueprint disposes. */
    dispose() { material.dispose(); },
  };
}
