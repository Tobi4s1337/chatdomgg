import * as THREE from 'three';
import { createCivicProp } from '@chatdom/content';
import type { CardinalTurn } from '@chatdom/world';
import type { VoxelRenderState, WindowHouse } from '@chatdom/render';
import { VOXEL_METRES, type KingdomPresenceFrame, type Vec3, type VoxelBlueprint } from '@chatdom/shared';

export type RoyalBrazier = { readonly position: Vec3; readonly normal: Vec3 };
export type RoyalStandard = { readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly rotation: CardinalTurn };
export type RoyalLightSource = { position: Vec3; normal: Vec3; strength: number };

// Only the actual authored cloth and crest are safe to move. Arbitrary castles
// and edited blueprints must not have nearby masonry pulled along with them.
export function canAnimateKeep(blueprint: VoxelBlueprint): boolean {
  if (!/^castle-(hearth|tide|grove)$/.test(blueprint.id) || blueprint.lattice !== 'build') return false;
  return [59, 186].every(x => [
    { from: [x + 2, 34, 214], to: [x + 8, 62, 216], material: 13 },
    { from: [x + 4, 39, 216], to: [x + 6, 54, 217], material: 12 },
  ].every(expected => blueprint.boxes.some(box => box.material === expected.material &&
    box.from.every((v, i) => v === expected.from[i]) && box.to.every((v, i) => v === expected.to[i]))));
}

function bannerMaterial(clay: VoxelRenderState, keep: WindowHouse | undefined): THREE.ShaderMaterial | undefined {
  if (!keep || !canAnimateKeep(keep.blueprint)) return undefined;
  const original = clay.material;
  const material = original.clone();
  // Three's clone deep-copies uniforms. Keep the original uniform objects so
  // subsequent light-volume and atmosphere changes reach both materials.
  material.uniforms = { ...original.uniforms, uRoyalTime: { value: 0 },
    uRoyalOrigin: { value: new THREE.Vector3(...keep.position) },
    uRoyalYaw: { value: keep.yaw }, uRoyalCell: { value: VOXEL_METRES.build } };
  material.onBeforeRender = original.onBeforeRender;
  const declaration = 'uniform float uRoyalTime, uRoyalYaw, uRoyalCell; uniform vec3 uRoyalOrigin;';
  const anchor = 'vec4 world=modelMatrix*local;';
  if (!material.vertexShader.includes(anchor)) throw new Error('Voxel shader world transform changed');
  material.vertexShader = material.vertexShader.replace('void main(){', `${declaration}\n    void main(){`).replace(anchor, `${anchor}
      // Recover the native keep coordinates after instance LOD scaling and yaw.
      vec3 delta=world.xyz-uRoyalOrigin;
      float c=cos(uRoyalYaw), s=sin(uRoyalYaw);
      vec3 cell=vec3(c*delta.x-s*delta.z,delta.y,s*delta.x+c*delta.z)/uRoyalCell;
      bool bannerX=(cell.x>=61.-.01 && cell.x<=67.+.01)||(cell.x>=188.-.01 && cell.x<=194.+.01);
      bool cloth=(aMaterial&65535u)==13u && cell.z>=214.-.01 && cell.z<=216.+.01 && cell.y>=34.-.01 && cell.y<=62.+.01;
      bool crest=(aMaterial&65535u)==12u && cell.z>=216.-.01 && cell.z<=217.+.01 && cell.y>=39.-.01 && cell.y<=54.+.01;
      if(bannerX && (cloth||crest)){
        float hanging=clamp((62.-cell.y)/28.,0.,1.);
        float wave=(sin(uRoyalTime*.85+cell.y*.095)+.26*sin(uRoyalTime*1.65+cell.y*.29+cell.x*.35))*hanging;
        vec3 localWind=vec3(.075*wave,0.,.24*wave);
        world.xyz+=vec3(c*localWind.x+s*localWind.z,0.,-s*localWind.x+c*localWind.z);
      }`);
  return material;
}

/** Animate only the actual, unchanged authored standard, never a similarly named edit. */
export function canAnimateStandard(blueprint: VoxelBlueprint): boolean {
  const style = blueprint.id === 'civic-tide-banner-standard' ? 'tide' : blueprint.id === 'civic-hearth-banner-standard' ? 'hearth' : undefined;
  return style !== undefined && JSON.stringify(blueprint) === JSON.stringify(createCivicProp('banner-standard', style));
}

function standardBannerMaterial(clay: VoxelRenderState, standard: RoyalStandard | undefined): THREE.ShaderMaterial | undefined {
  if (!standard || !canAnimateStandard(standard.blueprint)) return undefined;
  const original = clay.material, material = original.clone();
  material.uniforms = { ...original.uniforms, uRoyalTime: { value: 0 },
    uRoyalOrigin: { value: new THREE.Vector3(...standard.position) },
    uRoyalYaw: { value: standard.rotation * Math.PI / 2 }, uRoyalCell: { value: VOXEL_METRES.build } };
  material.onBeforeRender = original.onBeforeRender;
  const anchor = 'vec4 world=modelMatrix*local;';
  if (!material.vertexShader.includes(anchor)) throw new Error('Voxel shader world transform changed');
  material.vertexShader = material.vertexShader.replace('void main(){', 'uniform float uRoyalTime, uRoyalYaw, uRoyalCell; uniform vec3 uRoyalOrigin;\n    void main(){').replace(anchor, `${anchor}
      vec3 delta=world.xyz-uRoyalOrigin;
      float c=cos(uRoyalYaw), s=sin(uRoyalYaw);
      vec3 cell=vec3(c*delta.x-s*delta.z,delta.y,s*delta.x+c*delta.z)/uRoyalCell;
      uint mat=aMaterial&65535u;
      // Field, charge and border occupy this cloth plane; pole, cords, tabs and crossbar remain fixed.
      bool cloth=(mat==7u||mat==13u||mat==18u||mat==12u) && cell.x>=.99 && cell.x<=15.01 &&
        cell.y>=23.99 && cell.y<=58.01 && cell.z>=8.99 && cell.z<=12.01;
      if(cloth){
        float hanging=clamp((58.-cell.y)/34.,0.,1.);
        float away=clamp((abs(cell.x-8.)-1.)/3.,0.,1.);
        float wave=(sin(uRoyalTime*.85+cell.y*.12+cell.x*.2)+.23*sin(uRoyalTime*1.65+cell.y*.34))*hanging*away;
        vec3 wind=vec3(.035*wave,0.,.18*wave);
        world.xyz+=vec3(c*wind.x+s*wind.z,0.,-s*wind.x+c*wind.z);
      }`);
  return material;
}

export function createRoyalLife(scene: THREE.Scene, clay: VoxelRenderState, keep: WindowHouse | undefined, braziers: readonly RoyalBrazier[], standard?: RoyalStandard, hearth = false): {
  keepMaterial: THREE.ShaderMaterial | undefined;
  standardMaterial: THREE.ShaderMaterial | undefined;
  update(timeSeconds: number, frame: KingdomPresenceFrame | undefined, hour: number): void;
  sources(): readonly RoyalLightSource[];
  dispose(): void;
} {
  const keepMaterial = bannerMaterial(clay, keep);
  const standardMaterial = standardBannerMaterial(clay, standard);
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  const uniforms = { uTime: { value: 0 } };
  const flame = new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; uniform float uTime;
      void main(){vUv=uv; vec3 p=position; float h=uv.y;
      p.x+=h*h*(.10*sin(uTime*5.0+uv.y*5.0)+.04*sin(uTime*10.47+uv.y*11.));
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader: `varying vec2 vUv; uniform float uTime;
      void main(){float y=vUv.y; float x=vUv.x-.5;
      float flicker=.5+.5*sin(uTime*10.4719755);
      float width=(.12+.34*pow(1.-y,.8))*(.9+.1*flicker);
      float tongues=max(sin(vUv.x*19.+uTime*5.5),sin(vUv.x*29.-uTime*4.));
      float tip=1.-smoothstep(.66+.11*tongues,.97,y);
      float shape=(1.-smoothstep(width*.6,width,abs(x)))*smoothstep(0.,.11,y)*tip;
      vec3 colour=mix(vec3(1.,.19,.015),vec3(1.,.73,.22),clamp((1.-y)*.9,0.,1.));
      gl_FragColor=vec4(colour,shape*.53);}` });
  const glow = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;void main(){vec2 p=(vUv-.5)*vec2(1.,1.3);float a=pow(max(0.,1.-length(p)*2.),2.);gl_FragColor=vec4(1.,.29,.045,a*.12);}` });
  const glowGeometry = new THREE.PlaneGeometry(1.5, 1.5);
  glowGeometry.translate(0, .45, 0);
  const flameGeometry = new THREE.PlaneGeometry(.72, 1.25, 8, 12);
  flameGeometry.translate(0, .625, 0);
  const sparkGeometry = new THREE.BufferGeometry();
  const points: number[] = [];
  for (let i = 0; i < 12; i++) points.push((i % 3 - 1) * .15, i / 12, Math.sin(i * 7.1) * .13);
  sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const sparks = new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; varying float vFade;
      void main(){float age=fract(position.y+uTime*.31); vec3 p=vec3(position.x+sin(age*7.+position.y*20.)*.09,age*1.7,position.z);
      vFade=sin(age*3.14159); vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(25./-mv.z,1.,4.);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying float vFade;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(1.,.42,.08,smoothstep(.5,.1,d)*vFade*.65);}` });
  const lightSources: RoyalLightSource[] = braziers.map(({ position, normal }, i) => {
    const group = new THREE.Group(); group.position.set(...position);
    for (let j = 0; j < 3; j++) { const mesh = new THREE.Mesh(flameGeometry, flame); mesh.rotation.y = j * Math.PI / 3 + i * .31; group.add(mesh); }
    for (let j = 0; j < 2; j++) { const mesh = new THREE.Mesh(glowGeometry, glow); mesh.rotation.y = j * Math.PI / 2; group.add(mesh); }
    group.add(new THREE.Points(sparkGeometry, sparks)); root.add(group);
    return { position: [position[0], position[1] + .2, position[2]], normal, strength: 0 };
  });
  return { keepMaterial, standardMaterial,
    update(timeSeconds, frame) {
      uniforms.uTime.value = timeSeconds;
      if (keepMaterial) keepMaterial.uniforms.uRoyalTime!.value = timeSeconds;
      if (standardMaterial) standardMaterial.uniforms.uRoyalTime!.value = timeSeconds;
      const live = hearth || (!!frame?.streamLive && frame.connection === 'fresh');
      root.visible = live;
      for (const source of lightSources) source.strength = live ? .8 : 0;
    },
    sources: () => lightSources,
    dispose() { scene.remove(root); flameGeometry.dispose(); glowGeometry.dispose(); sparkGeometry.dispose(); flame.dispose(); glow.dispose(); sparks.dispose(); keepMaterial?.dispose(); standardMaterial?.dispose(); },
  };
}
