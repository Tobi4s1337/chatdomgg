import * as THREE from 'three';
import type { KingdomPresenceFrame, Vec3 } from '@chatdom/shared';

export interface HomeLifeSite { readonly slot: number; readonly mouths: readonly Vec3[]; readonly lantern: Vec3 | null; readonly normal: Vec3 }
export interface HomeLifeSource { readonly id: string; readonly slot: number; readonly position: Vec3; readonly normal: Vec3; level: number; readonly name: null; strength: number }

const MAX_STACKS = 96, PUFFS = 5, LIFE = 3.6;
const clamp = THREE.MathUtils.clamp;
const fract = (n: number) => n - Math.floor(n);
const hash = (n: number) => fract(Math.sin(n * 127.1 + 13.7) * 43758.5453);

/** Presence and all positions come from the placed homes; this creates no homes or people. */
export function createHomeLife(scene: THREE.Scene, sites: readonly HomeLifeSite[]) {
  const sources = sites.map(site => site.lantern ? { id: `home-lantern:${site.slot}`, slot: site.slot, position: site.lantern, normal: site.normal, level: 0, name: null, strength: 0 } satisfies HomeLifeSource : undefined);
  const lightSources = sources.filter((source): source is NonNullable<typeof source> => source !== undefined);
  const bySlot = new Map(sites.map((site, index) => [site.slot, index]));
  const ages = new Float64Array(sites.length);
  const strengths = new Float32Array(sites.length);
  const candidates = sites.flatMap((site, index) => site.mouths.map((mouth, mouthIndex) => ({ index, mouth, mouthIndex, distance: 0 })));

  // One plane per actual lantern face. Geometry stays bounded regardless of frame count.
  const lanternGeometry = new THREE.PlaneGeometry(1, 1);
  const lanternAlpha = new THREE.InstancedBufferAttribute(new Float32Array(sites.length), 1);
  lanternGeometry.setAttribute('aGlow', lanternAlpha);
  const lanternMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute float aGlow; varying float vGlow; varying vec2 vUv; void main(){vGlow=aGlow;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float vGlow; varying vec2 vUv; void main(){vec2 p=abs(vUv-.5)*2.;float glass=1.-smoothstep(.26,.43,max(p.x,p.y*.84));float halo=(1.-smoothstep(.10,1.,length(p)))*.24;float a=vGlow*max(glass*.94,halo);vec3 colour=mix(vec3(1.,.38,.07),vec3(1.,.76,.34),glass);gl_FragColor=vec4(colour,a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}` });
  const lanterns = new THREE.InstancedMesh(lanternGeometry, lanternMaterial, sites.length);
  lanterns.frustumCulled = false;
  const mat = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(.62, .74, 1);
  const forward = new THREE.Vector3(0, 0, 1), normal = new THREE.Vector3();
  sites.forEach((site, i) => {
    if (!site.lantern) { mat.makeScale(0, 0, 0); lanterns.setMatrixAt(i, mat); return; }
    normal.set(...site.normal).normalize(); q.setFromUnitVectors(forward, normal);
    pos.set(...site.lantern).addScaledVector(normal, .008);
    mat.compose(pos, q, scale); lanterns.setMatrixAt(i, mat);
  });
  lanterns.instanceMatrix.needsUpdate = true;
  scene.add(lanterns);

  // Camera-facing instanced quads avoid platform point-size limits. Soft overlapping lobes read as smoke, not sparks.
  const puffGeometry = new THREE.InstancedBufferGeometry();
  puffGeometry.index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
  puffGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3));
  const centre = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STACKS * PUFFS * 3), 3);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STACKS * PUFFS), 1);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STACKS * PUFFS), 1);
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STACKS * PUFFS), 1);
  const warmth = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STACKS * PUFFS), 1);
  puffGeometry.setAttribute('aCentre', centre); puffGeometry.setAttribute('aSize', size); puffGeometry.setAttribute('aOpacity', opacity); puffGeometry.setAttribute('aShape', shape); puffGeometry.setAttribute('aWarmth', warmth);
  puffGeometry.instanceCount = 0;
  const puffMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 aCentre;attribute float aSize;attribute float aOpacity;attribute float aShape;attribute float aWarmth;varying vec2 vP;varying float vOpacity;varying float vShape;varying float vDistance;varying float vWarmth;void main(){vP=position.xy;vOpacity=aOpacity;vShape=aShape;vWarmth=aWarmth;vec4 mv=viewMatrix*vec4(aCentre,1.);vDistance=length(mv.xyz);mv.xy+=position.xy*aSize;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec2 vP;varying float vOpacity;varying float vShape;varying float vDistance;varying float vWarmth;void main(){vec2 p=vP;float angle=atan(p.y,p.x);float edge=1.+.12*sin(angle*3.+vShape*6.28)+.08*sin(angle*5.-vShape*9.);float d=length(p*vec2(1.,1.12))/edge;float a=(1.-smoothstep(.12,1.,d))*vOpacity;vec3 colour=mix(vec3(.16,.17,.19),vec3(.15,.125,.19),smoothstep(50.,120.,vDistance));colour=mix(colour,vec3(.40,.19,.06),vWarmth*.7);gl_FragColor=vec4(colour,a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}` });
  const smoke = new THREE.Mesh(puffGeometry, puffMaterial); smoke.frustumCulled = false; smoke.renderOrder = 3; scene.add(smoke);
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), sample = new THREE.Vector3(), sphere = new THREE.Sphere(sample, 4);
  const windows = new Map<number, { present: boolean; since: number }>();
  let disposed = false;
  return {
    update(atMs: number, timeSeconds: number, frame: KingdomPresenceFrame | undefined, hour: number, camera: THREE.Camera) {
      if (disposed) return;
      windows.clear();
      if (frame && frame.connection !== 'stale') for (const window of frame.windows) if (window.present && bySlot.has(window.slot)) windows.set(window.slot, window);
      // Daylight mutes the glass overlay; the source retains its presence transition.
      const h = ((hour % 24) + 24) % 24;
      const night = THREE.MathUtils.smoothstep(Math.abs(h - 12), 4.2, 6.5);
      for (let i = 0; i < sites.length; i++) {
        const w = windows.get(sites[i]!.slot);
        const age = w ? Math.max(0, (atMs - w.since) / 1000) : 0;
        const strength = w ? clamp(age / .7, 0, 1) : 0;
        ages[i] = age; strengths[i] = strength;
        const source = sources[i];
        if (source) { source.strength = strength * .5; source.level = Math.round(source.strength * 15); }
        lanternAlpha.setX(i, source ? strength * (.24 + .76 * night) : 0);
      }
      lanternAlpha.needsUpdate = true;
      camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
      let count = 0;
      for (const candidate of candidates) {
        const m = candidate.mouth; const dx = m[0] - camera.position.x, dy = m[1] - camera.position.y, dz = m[2] - camera.position.z;
        candidate.distance = dx * dx + dy * dy + dz * dz;
      }
      candidates.sort((a, b) => a.distance - b.distance);
      let stacks = 0;
      for (const c of candidates) {
        if (stacks >= MAX_STACKS) break;
        const age = ages[c.index]! - .2;
        if (strengths[c.index]! <= 0 || age <= 0 || c.distance > 320 * 320) continue;
        sample.set(c.mouth[0], c.mouth[1] + 1.5, c.mouth[2]);
        if (!frustum.intersectsSphere(sphere)) continue;
        stacks++;
        // A few steady hearths breathe across the wide town, rather than a white
        // tuft on every roof. The close homecoming keeps its own chimney alive.
        const wide = THREE.MathUtils.smoothstep(Math.sqrt(c.distance), 50, 120);
        const smokeWeight = 1 - wide * (hash(sites[c.index]!.slot * 17 + 5) < .24 ? 0 : 1);
        const lifetime = LIFE - wide * 1.4;
        for (let j = 0; j < PUFFS; j++) {
          const stackSeed = sites[c.index]!.slot * 13 + c.mouthIndex * 97;
          const seed = stackSeed + j * 31;
          const phase = fract(age / lifetime - j / PUFFS);
          // Do not backfill smoke before the first puff would have been emitted.
          const started = age >= j * lifetime / PUFFS;
          // A shared wind bends every plume; the growing eddy offsets keep individual puffs from forming a stripe.
          const eddy = timeSeconds * .38 + stackSeed * .3 + phase * 5 + hash(seed) * 2;
          const curl = .22 * phase;
          const drift = 1 + wide * (hash(stackSeed) - .5) * .5;
          centre.setXYZ(count, c.mouth[0] + phase * 1.65 * drift + Math.sin(eddy) * curl, c.mouth[1] + .08 + phase * (1.8 - wide * .35), c.mouth[2] + phase * .55 + Math.cos(eddy) * curl);
          size.setX(count, (.20 + phase * .28 + hash(seed) * .07) * (1 + wide * .15));
          shape.setX(count, hash(seed + 17));
          warmth.setX(count, 1 - THREE.MathUtils.smoothstep(phase, .04, .26));
          opacity.setX(count, started ? THREE.MathUtils.smoothstep(phase, 0, .1) * (1 - THREE.MathUtils.smoothstep(phase, .42 - wide * .2, 1 - wide * .25)) * (.15 + wide * .06) * smokeWeight * Math.min(1, age / .7) * (1 - THREE.MathUtils.smoothstep(Math.sqrt(c.distance), 240, 320)) : 0);
          count++;
        }
      }
      puffGeometry.instanceCount = count; centre.needsUpdate = size.needsUpdate = opacity.needsUpdate = shape.needsUpdate = warmth.needsUpdate = true;
    },
    sources() { return lightSources; },
    dispose() { if (disposed) return; disposed = true; scene.remove(lanterns, smoke); lanterns.dispose(); lanternGeometry.dispose(); lanternMaterial.dispose(); puffGeometry.dispose(); puffMaterial.dispose(); },
  };
}
