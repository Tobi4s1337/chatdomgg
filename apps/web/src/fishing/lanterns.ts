import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';

/** One draw for warm panes on the lantern's actual outer glass, with ordinary scene occlusion. */
export function createPierLanternGlow(positions: readonly Vec3[]) {
  const geometry = new THREE.PlaneGeometry(.24, .48);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { strength: { value: 0 } },
    vertexShader: `varying vec2 pane; void main(){pane=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float strength; varying vec2 pane; void main(){vec2 p=abs(pane-.5)*2.;float edge=(1.-smoothstep(.65,1.,p.x))*(1.-smoothstep(.65,1.,p.y));float flame=exp(-dot((pane-.5)*vec2(2.8,1.6),(pane-.5)*vec2(2.8,1.6)));gl_FragColor=vec4(vec3(1.,.48,.14)*(1.1+flame)*strength,edge*strength);}`,
  });
  const root = new THREE.InstancedMesh(geometry, material, positions.length * 4);
  const transform = new THREE.Matrix4(), rotation = new THREE.Quaternion(), point = new THREE.Vector3(), axis = new THREE.Vector3(0, 1, 0), scale = new THREE.Vector3(1, 1, 1);
  let slot = 0;
  for (const [x, y, z] of positions) for (let side = 0; side < 4; side++) {
    const yaw = side * Math.PI / 2;
    point.set(x + Math.sin(yaw) * .256, y + .0625, z + Math.cos(yaw) * .256);
    rotation.setFromAxisAngle(axis, yaw); transform.compose(point, rotation, scale); root.setMatrixAt(slot++, transform);
  }
  root.instanceMatrix.needsUpdate = true;
  root.name = 'pier-lantern-glass'; root.frustumCulled = false;
  return { root, update(warmth: number) { material.uniforms.strength!.value = THREE.MathUtils.clamp(warmth, 0, 1) * .8; }, dispose() { geometry.dispose(); material.dispose(); } };
}
