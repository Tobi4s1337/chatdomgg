import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';

/**
 * Small hanging lantern flames for the lot: the builder's lantern on the scaffold and the housewarming garland.
 * Each is a camera-facing glass glow with a soft halo; their positions also feed the kingdom's light field, so the
 * walls and the street beneath them warm as they come on.
 */
export interface LanternGlow { readonly position: Vec3; readonly strength: number }

const CAPACITY = 24;

export function createLanternGlows(scene: THREE.Scene) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const centre = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  geometry.setAttribute('aCentre', centre); geometry.setAttribute('aGlow', glow);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uFlicker: { value: 0 } },
    vertexShader: `attribute vec3 aCentre;attribute float aGlow;varying vec2 vP;varying float vGlow;varying float vSeed;uniform float uFlicker;
      void main(){vP=position.xy;vSeed=aCentre.x*3.1+aCentre.z*1.7;vGlow=aGlow*(.92+.08*sin(uFlicker*7.3+vSeed*5.)*sin(uFlicker*3.1+vSeed));
      vec4 mv=viewMatrix*vec4(aCentre,1.);mv.xy+=position.xy*.42;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec2 vP;varying float vGlow;varying float vSeed;
      void main(){vec2 p=vP*vec2(1.,.82);float d=length(p);float flame=1.-smoothstep(.04,.2,length(vec2(p.x*1.5,p.y+.02)));
      float halo=(1.-smoothstep(.12,1.,d));halo*=halo;
      vec3 colour=mix(vec3(1.,.42,.1),vec3(1.,.83,.5),flame);
      float a=vGlow*(flame*1.4+halo*.42);gl_FragColor=vec4(colour*a,a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }` });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.renderOrder = 4; scene.add(mesh);
  return {
    set(lanterns: readonly LanternGlow[], time: number) {
      let n = 0;
      for (const lantern of lanterns) {
        if (n >= CAPACITY || lantern.strength <= .001) continue;
        centre.setXYZ(n, ...lantern.position); glow.setX(n, lantern.strength); n++;
      }
      geometry.instanceCount = n; centre.needsUpdate = glow.needsUpdate = true;
      material.uniforms.uFlicker!.value = time;
    },
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
