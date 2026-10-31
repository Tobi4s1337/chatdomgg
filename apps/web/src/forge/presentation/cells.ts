import * as THREE from 'three';
import { RUNE_SLOTS } from './runes';
import type { Silhouette } from './silhouette';

/**
 * Per-cell decisions shared by the blueprint and the molten shell. Both draw the same traced surface and read
 * the same uniform objects, so a cell is either still drawn in light or already molten, never both or neither.
 */
export const CELLS = /* glsl */`
  uniform float uCell,uReveal,uRadius,uDissolve,uBase,uHeight,uFill,uLayers,uSpread;
  uniform vec2 uPour;
  uniform vec3 uOrigins[${RUNE_SLOTS}];uniform int uOriginCount;
  float cellHash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  vec3 cellIndex(vec3 local,vec3 normal){return floor((local-normal*uCell*.5)/uCell);}
  vec3 cellCentre(vec3 index){return (index+.5)*uCell;}
  /** Positive once the blueprint has drawn a cell; grows with its age. */
  float arrival(vec3 index,float hash){
    vec3 centre=cellCentre(index);
    float nearest=1e4;
    for(int i=0;i<${RUNE_SLOTS};i++){if(i>=uOriginCount)break;nearest=min(nearest,distance(centre,uOrigins[i]));}
    float order=mix(nearest/uRadius+hash*.12,hash,uDissolve);
    return uReveal*1.25-order;
  }
  /** Positive once molten metal has reached a cell, in layers: it rises layer by layer, spreading from the pour. */
  float molten(vec3 index,float hash){
    vec3 centre=cellCentre(index);
    float layer=(centre.y-uBase)/uCell-.5;
    float spread=min(1.,distance(centre.xz,uPour)/uSpread);
    return uFill*(uLayers+1.6)-layer-spread*.9-hash*.25;
  }`;

export type CellUniforms = ReturnType<typeof createCellUniforms>;

export function createCellUniforms(silhouette: Silhouette) {
  const size = silhouette.bounds.getSize(new THREE.Vector3()), centre = silhouette.bounds.getCenter(new THREE.Vector3());
  const origins = Array.from({ length: RUNE_SLOTS }, (_, i) => (silhouette.landings[i % Math.max(1, silhouette.landings.length)] ?? centre).clone());
  return {
    uCell: { value: silhouette.cell }, uReveal: { value: 0 }, uRadius: { value: Math.max(silhouette.cell * 4, size.length() * .62) },
    uDissolve: { value: 0 }, uOrigins: { value: origins }, uOriginCount: { value: Math.min(RUNE_SLOTS, Math.max(1, silhouette.landings.length)) },
    uBase: { value: silhouette.bounds.min.y }, uHeight: { value: Math.max(silhouette.cell, size.y) },
    uFill: { value: 0 }, uLayers: { value: Math.max(1, Math.round(size.y / silhouette.cell)) },
    uPour: { value: new THREE.Vector2(centre.x, centre.z) }, uSpread: { value: Math.max(silhouette.cell * 2, Math.hypot(size.x, size.z) * .5) },
    uGlow: { value: 1 },
  };
}
