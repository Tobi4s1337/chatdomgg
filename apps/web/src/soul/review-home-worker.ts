import type * as THREE from 'three';
import { buildSoulReviewHome } from './review-home';
import type { HomeBuffer, HomeRequest, HomeResponse } from './review-home-loader';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<HomeRequest>) => void) | null;
  postMessage: (response: HomeResponse, transfer: ArrayBuffer[]) => void;
};

scope.onmessage = ({ data }) => {
  try {
    const home = buildSoulReviewHome(data.blueprint, data.materials, data.roofMaterial);
    const transfer: ArrayBuffer[] = [];
    const pack = (geometry: THREE.BufferGeometry): HomeBuffer => {
      const position = geometry.getAttribute('position').array as Float32Array;
      const normal = geometry.getAttribute('normal').array as Float32Array;
      const color = geometry.getAttribute('color')?.array as Float32Array | undefined;
      transfer.push(position.buffer as ArrayBuffer, normal.buffer as ArrayBuffer);
      if (color) transfer.push(color.buffer as ArrayBuffer);
      geometry.dispose();
      return color ? { position, normal, color } : { position, normal };
    };
    const surfaces = home.surfaces.map(({ material, geometry }) => ({ material, data: pack(geometry) }));
    scope.postMessage({ id: data.id, surfaces, snow: pack(home.snow) }, transfer);
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Home worker failed.' }, []);
  }
};
