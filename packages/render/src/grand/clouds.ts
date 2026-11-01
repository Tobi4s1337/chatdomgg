import * as THREE from 'three';
import { GRAND_COMMON, type GrandUniforms } from './light';

/**
 * Voxel clouds (worldgen-at-scale §7.5): a periodic coverage field of large cells, stacked in lumpy layers
 * and greedy-merged into a few thousand quads; lit tops, shaded bellies, faded into the sky by distance.
 * The field tiles, so a 3×3 of instances drifts forever; the same field casts the moving cloud shadows.
 */
export interface GrandClouds {
  readonly mesh: THREE.InstancedMesh;
  readonly coverage: THREE.DataTexture;
  readonly tile: number;
  update(time: number, eye: THREE.Vector3): void;
  dispose(): void;
}

function periodicNoise(cells: number, period: number, seed: number) {
  const hash = (x: number, z: number) => {
    let h = (((x % period) + period) % period) * 374761393 + (((z % period) + period) % period) * 668265263 + seed * 2654435761;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, z: number) => {
    const fx = x / cells * period, fz = z / cells * period;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
  };
}

export function createGrandClouds(uniforms: GrandUniforms, options: { seed: number; cell?: number; cells?: number; height: number; cover?: number }): GrandClouds {
  const cell = options.cell ?? 8, cells = options.cells ?? 288, tile = cell * cells;
  const octaves = [periodicNoise(cells, 6, options.seed), periodicNoise(cells, 12, options.seed + 1), periodicNoise(cells, 24, options.seed + 2), periodicNoise(cells, 48, options.seed + 3)];
  const thick = new Uint8Array(cells * cells), cover = new Uint8Array(cells * cells);
  const threshold = 0.6 - (options.cover ?? 0.32) * 0.5;
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    const v = octaves[0]!(x, z) * 0.5 + octaves[1]!(x, z) * 0.28 + octaves[2]!(x, z) * 0.14 + octaves[3]!(x, z) * 0.08;
    const t = Math.max(0, Math.min(4, Math.floor((v - threshold) * 22)));
    thick[x + z * cells] = t;
    cover[x + z * cells] = Math.max(0, Math.min(255, Math.round((v - threshold + 0.05) * 900)));
  }
  const step = 3.2;
  const positions: number[] = [], normals: number[] = [];
  const quad = (p: number[][], n: [number, number, number]) => {
    for (const k of [0, 1, 2, 0, 2, 3]) { positions.push(...p[k]!); normals.push(...n); }
  };
  const at = (x: number, z: number) => thick[((x % cells + cells) % cells) + ((z % cells + cells) % cells) * cells]!;
  // Tops and bellies: greedy rectangles of equal thickness.
  const used = new Uint8Array(cells * cells);
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    const t = thick[x + z * cells]!;
    if (!t || used[x + z * cells]) continue;
    let w = 1, h = 1;
    while (x + w < cells && thick[x + w + z * cells] === t && !used[x + w + z * cells]) w++;
    grow: while (z + h < cells) { for (let i = 0; i < w; i++) if (thick[x + i + (z + h) * cells] !== t || used[x + i + (z + h) * cells]) break grow; h++; }
    for (let j = 0; j < h; j++) used.fill(1, x + (z + j) * cells, x + w + (z + j) * cells);
    const x0 = x * cell, z0 = z * cell, x1 = (x + w) * cell, z1 = (z + h) * cell, top = t * step;
    quad([[x0, top, z0], [x0, top, z1], [x1, top, z1], [x1, top, z0]], [0, 1, 0]);
    quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, -1, 0]);
  }
  // Sides wherever a neighbour is thinner.
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    const t = thick[x + z * cells]!;
    if (!t) continue;
    const x0 = x * cell, z0 = z * cell, x1 = x0 + cell, z1 = z0 + cell, top = t * step;
    const sides: [number, number, number[][], [number, number, number]][] = [
      [1, 0, [[x1, 0, z0], [x1, top, z0], [x1, top, z1], [x1, 0, z1]], [1, 0, 0]],
      [-1, 0, [[x0, 0, z1], [x0, top, z1], [x0, top, z0], [x0, 0, z0]], [-1, 0, 0]],
      [0, 1, [[x1, 0, z1], [x1, top, z1], [x0, top, z1], [x0, 0, z1]], [0, 0, 1]],
      [0, -1, [[x0, 0, z0], [x0, top, z0], [x1, top, z0], [x1, 0, z0]], [0, 0, -1]],
    ];
    for (const [dx, dz, p, n] of sides) {
      const other = at(x + dx, z + dz) * step;
      if (other >= top) continue;
      quad(p.map(v => [v[0]!, v[1]! < 1 ? other : v[1]!, v[2]!]), n);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(tile / 2, 8, tile / 2), tile);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...uniforms },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
      in vec3 position, normal; in mat4 instanceMatrix;
      out vec3 vWorld; out vec3 vNormal; out float vHeight;
      void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vWorld = w.xyz; vNormal = normal; vHeight = position.y;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 cameraPosition;
      in vec3 vWorld; in vec3 vNormal; in float vHeight; out vec4 outColour;
      ${GRAND_COMMON}
      void main(){
        vec3 n = normalize(vNormal);
        float face = n.y > .5 ? 1. : n.y < -.5 ? .62 : .84;
        float lit = max(dot(n, uSunDir), 0.);
        vec3 col = mix(uCloudShade, uCloudColor, face) * (.85 + .3 * lit) + uSunColor * .05 * lit;
        col *= .92 + .08 * hash12(floor(vWorld.xz / 8.));
        col = mix(col, col * 1.08, smoothstep(0., 12., vHeight));
        vec3 view = vWorld - cameraPosition; float dist = length(view);
        float fade = smoothstep(1400., 3600., dist);
        col = mix(col, skyColour(normalize(view), false), fade);
        outColour = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, 9);
  mesh.frustumCulled = false;
  const coverage = new THREE.DataTexture(cover, cells, cells, THREE.RedFormat, THREE.UnsignedByteType);
  coverage.wrapS = coverage.wrapT = THREE.RepeatWrapping;
  coverage.magFilter = coverage.minFilter = THREE.LinearFilter;
  coverage.needsUpdate = true;
  uniforms.uCloudMap.value = coverage;
  uniforms.uCloudTile.value = tile;
  uniforms.uCloudHeight.value = options.height;
  const matrix = new THREE.Matrix4();
  const wind = new THREE.Vector2(3.2, 1.4);
  return {
    mesh, coverage, tile,
    update(time, eye) {
      const ox = (time * wind.x) % tile, oz = (time * wind.y) % tile;
      uniforms.uCloudOffset.value.set(ox, oz);
      const bx = Math.floor((eye.x - ox) / tile) * tile + ox, bz = Math.floor((eye.z - oz) / tile) * tile + oz;
      let k = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        matrix.makeTranslation(bx + dx * tile, options.height, bz + dz * tile);
        mesh.setMatrixAt(k++, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); coverage.dispose(); },
  };
}
