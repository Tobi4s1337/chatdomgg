import * as THREE from 'three';
import { GRAND_COMMON, type GrandUniforms } from './light';

/** The sky dome: zenith over horizon, the sun's gold veil and disc, and stars once night falls. */
export function createGrandSky(uniforms: GrandUniforms): THREE.Mesh {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...uniforms },
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
      in vec3 position; out vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vDir; out vec4 outColour;
      ${GRAND_COMMON}
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = skyColour(d, true);
        if (uStars > 0.01 && d.y > 0.) {
          vec3 cell = floor(d * 420.);
          float star = step(.9975, hash13(cell)) * smoothstep(0., .25, d.y) * (.4 + .6 * hash13(cell + 3.1));
          col += vec3(.9, .92, 1.) * star * uStars * 1.4;
        }
        outColour = vec4(col, 1.);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.copy(camera.position);
    sky.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.9);
    sky.updateMatrixWorld();
  };
  return sky;
}
