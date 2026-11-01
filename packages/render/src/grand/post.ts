import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * HDR to screen for the grand land: bloom that only takes the sun glint and emissives (threshold above
 * lit diffuse), a gentle grade (saturation kept in foliage, warm highlights, a soft vignette), then AgX,
 * which lets highlights desaturate toward the sun without turning greens yellow.
 */
export interface GrandPost {
  readonly composer: EffectComposer;
  setSize(width: number, height: number, ratio: number): void;
  render(): void;
  dispose(): void;
}

export function createGrandPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, options: { samples: number; bloom: boolean }): GrandPost {
  const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: options.samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 1.15);
  if (options.bloom) composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uSaturation: { value: 1.12 }, uVignette: { value: 0.22 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uSaturation, uVignette; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(.2126, .7152, .0722));
        c.rgb = mix(vec3(l), c.rgb, uSaturation);
        c.rgb *= mix(vec3(1.), vec3(1.03, 1.0, .95), smoothstep(.6, 2.5, l));
        vec2 d = vUv - .5; c.rgb *= 1. - uVignette * smoothstep(.25, .85, dot(d, d) * 2.2);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    composer,
    setSize(width, height, ratio) { composer.setPixelRatio(ratio); composer.setSize(width, height); bloom.resolution.set(width * ratio / 2, height * ratio / 2); },
    render() { composer.render(); },
    dispose() { composer.dispose(); target.dispose(); },
  };
}
