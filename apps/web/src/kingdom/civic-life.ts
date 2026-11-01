import * as THREE from 'three';
import { growthCivicLights, growthCivicWater, type CivicBridgeSite } from '@chatdom/content/growth-civic';
import { VOXEL_METRES, type GrowthCivicPlace, type Vec3 } from '@chatdom/shared';
import { transformCardinalPoint, type RealmFoundedScene, type RealmFoundedPlacement } from '@chatdom/world';
import type { LightFieldSource } from './light-field';

const CELL = VOXEL_METRES.build;
const FORM = /^growth-(hearth|tide)-(market|tavern|forge|castle-court|bridge)-([1-9]\d*)$/;
const SPAN = /^water-(hearth|tide)-bridge-(\d+)-(\d+)$/;

type CivicMount = { placement: RealmFoundedPlacement; place: GrowthCivicPlace; level: number; bridge: CivicBridgeSite | undefined };
/** Resolve only actual installed, asset-backed civic forms. The bridge's authored site is its installed span. */
export function civicLifeMounts(scene: Pick<RealmFoundedScene, 'assets' | 'placements'>): CivicMount[] {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const spans = scene.placements.filter(p => p.id === 'civic:site:v1:bridge:span');
  const mounts: CivicMount[] = [];
  for (const p of scene.placements) {
    const blueprint = assets.get(p.assetHash), match = blueprint && FORM.exec(blueprint.id);
    if (!match || p.id !== `civic:growth:v1:${match[2]}` || blueprint.lattice !== 'build') continue;
    const level = Number(match[3]);
    if (!Number.isSafeInteger(level)) continue;
    let bridge: CivicBridgeSite | undefined;
    if (match[2] === 'bridge') {
      const span = spans.length === 1 ? spans[0] : undefined;
      const spanId = span && assets.get(span.assetHash)?.id;
      const site = spanId && SPAN.exec(spanId);
      if (!span || !site || site[1] !== match[1] || span.rotation !== p.rotation || span.position.some((v, i) => v !== p.position[i])) continue;
      const water = Number(site[2]), bank = Number(site[3]);
      // Site dimensions are build-cell integers; reject malformed data before constructing geometry.
      if (!Number.isSafeInteger(water) || !Number.isSafeInteger(bank) || water < 2 || water > 32 || bank <= water || bank > 64) continue;
      bridge = { water, bank };
    }
    mounts.push({ placement: p, place: match[2] as GrowthCivicPlace, level, bridge });
  }
  return mounts;
}

/** Public civic fixtures, independent of citizen presence. All coordinates are world metres. */
export function civicLightSources(scene: Pick<RealmFoundedScene, 'assets' | 'placements'>): LightFieldSource[] {
  return civicLifeMounts(scene).flatMap(({ placement, place, level, bridge }) =>
    growthCivicLights(place, level, bridge).filter(light => light.kind !== 'hearth').map(light => {
      const normal = transformCardinalPoint([0, 0, 0], placement.rotation, [0, 0, 1]);
      // Begin just outside the glass so the field can flood the surrounding air.
      const local: Vec3 = [light.centre[0] * CELL, light.centre[1] * CELL, light.centre[2] * CELL + .25];
      return { position: transformCardinalPoint(placement.position, placement.rotation, local), normal,
        strength: light.kind === 'window' ? .55 : .7 };
    }));
}

/** The scene owns this alongside its light fields; no presence frame is consumed. */
export function createCivicLife(scene: THREE.Scene, founded: Pick<RealmFoundedScene, 'assets' | 'placements'>): {
  update(timeSeconds: number): void; sources(): readonly LightFieldSource[]; dispose(): void;
} {
  const root = new THREE.Group(); root.name = 'public-civic-life'; scene.add(root);
  const geometry: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const waterTime = { value: 0 };
  const lightSources = civicLightSources(founded);
  const glow = new THREE.MeshBasicMaterial({ color: 0xffbd65, toneMapped: false, side: THREE.DoubleSide });
  const halo = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec2 vUv; void main(){float a=pow(max(0.,1.-length((vUv-.5)*2.)),2.);gl_FragColor=vec4(1.,.42,.08,a*.32);}' });
  materials.push(glow, halo);
  for (const { placement, place, level, bridge } of civicLifeMounts(founded)) {
    const group = new THREE.Group(); group.position.set(...placement.position); group.rotation.y = placement.rotation * Math.PI / 2; root.add(group);
    for (const light of growthCivicLights(place, level, bridge)) {
      if (light.kind === 'hearth') continue; // The installed forge hearth already owns its flame and field.
      const [x, y, z] = light.centre.map(n => n * CELL) as [number, number, number];
      const centre = new THREE.PlaneGeometry(light.kind === 'window' ? .5 : .25, light.kind === 'window' ? .75 : .45);
      geometry.push(centre);
      const face = new THREE.Mesh(centre, glow); face.position.set(x, y, z + .012); group.add(face);
      const aura = new THREE.PlaneGeometry(1.5, 1.5); geometry.push(aura);
      for (let i = 0; i < 2; i++) { const mesh = new THREE.Mesh(aura, halo); mesh.position.set(x, y, z + .025); mesh.rotation.y = i * Math.PI / 2; group.add(mesh); }
    }
    const water = growthCivicWater(place, level);
    if (!water) continue;
    const [x, y, z] = water.from, [X, , Z] = water.to;
    const surface = new THREE.PlaneGeometry((X - x) * CELL, (Z - z) * CELL); geometry.push(surface);
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: waterTime }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){
        ${place === 'castle-court' ? 'if(vUv.x>.35 && vUv.x<.65 && vUv.y>.2 && vUv.y<.8) discard;' : ''}
        float ripple=sin(vUv.x*19.+uTime*1.7)*sin(vUv.y*23.-uTime*1.2);
        gl_FragColor=vec4(vec3(.23,.48,.52)+ripple*.035,.82);}` });
    materials.push(material);
    const mesh = new THREE.Mesh(surface, material); mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x + X) * CELL / 2, y * CELL + .012, (z + Z) * CELL / 2); group.add(mesh);
  }
  return { update(timeSeconds) { if (Number.isFinite(timeSeconds)) waterTime.value = timeSeconds; }, sources: () => lightSources,
    dispose() { scene.remove(root); geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}
