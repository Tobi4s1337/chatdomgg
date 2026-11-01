import * as THREE from 'three';

const CORNERS = new Float32Array(12);
const INDEX = [0, 1, 2, 0, 2, 3];

/**
 * An instanced quad batch: four corner vertices, and one uvec2 per quad as an integer instance attribute.
 * Corners are rebuilt in the vertex shader from gl_VertexID; `bounds` are in the mesh's local units.
 */
export function createQuadGeometry(words: Uint32Array, bounds: THREE.Box3): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(CORNERS, 3));
  geometry.setIndex(INDEX);
  const quads = new THREE.InstancedBufferAttribute(words, 2);
  quads.gpuType = THREE.IntType;
  geometry.setAttribute('aQuad', quads);
  geometry.instanceCount = words.length / 2;
  geometry.boundingBox = bounds.clone();
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  return geometry;
}
