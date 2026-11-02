// Isolated comparison of the two production water texture encodings; this module is not a shipped route.
import * as THREE from 'three';
import { createAtmosphere, getEnvironment } from '@chatdom/render';
import { createWaterSurface } from '../../../apps/web/src/places/water/surface/surface';
import { rasterGround, type WaterRaster } from '../../../apps/web/src/places/water/surface/raster';
import type { WaterGround } from '../../../apps/web/src/places/water/surface/coverage';

type Mode = 'legacy' | 'compact';
type BenchWindow = Window & { __chatdomReady?: boolean; __compactWater?: { draw: typeof draw } };
const bench = window as BenchWindow;
const canvas = document.querySelector('canvas') ?? document.body.appendChild(document.createElement('canvas'));
document.body.style.margin = '0';
canvas.style.display = 'block';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  throw new Error(`Water bench shader: ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)} ${gl.getProgramInfoLog(program)}`);
};
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const size = 65, step = 1, origin = [-32, -32] as const, scale = 0.5, offset = -10;
const raw = new Uint16Array(size * size), levels = new Uint16Array(size * size);
const metres = new Float32Array(size * size), floatLevels = new Float32Array(size * size);
for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
  const wx = x - 32, wz = z - 32, index = x + z * size;
  const lake = Math.hypot((wx + 6) / 20, (wz - 1) / 15);
  const island = Math.hypot((wx + 5) / 3.7, (wz + 1) / 2.7);
  const brook = wx > 8 && Math.abs(wz + 5 + (wx - 8) * 0.22) < 2.4;
  const bank = Math.max(0, lake - 0.78) * 6 + 0.45 * Math.sin(wx * 0.23) * Math.cos(wz * 0.19);
  const bed = brook ? -1 : Math.max(-2.5, -2.1 + bank, island < 1.3 ? (1.3 - island) * 3 : -10);
  const quant = Math.max(0, Math.round((bed - offset) / scale));
  raw[index] = quant; metres[index] = quant * scale + offset;
  const waterLevel = brook ? (wx > 24 ? 1 : wx > 16 ? 0.5 : 0) : 0;
  const wet = (lake < 1.1 || brook) && metres[index]! < waterLevel;
  levels[index] = wet ? Math.round((waterLevel - offset) / scale) : quant;
  floatLevels[index] = wet ? waterLevel : NaN;
}
let disposeCurrent: (() => void) | undefined;

async function draw(mode: Mode, width: number, height: number) {
  if (mode !== 'legacy' && mode !== 'compact') throw new Error('Expected legacy or compact');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid dimensions');
  bench.__chatdomReady = false;
  disposeCurrent?.();
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, width / height, 0.1, 500);
  camera.position.set(36, 29, 44); camera.lookAt(-2, 0, 0); camera.updateMatrixWorld();
  const environment = getEnvironment(17.5);
  renderer.toneMappingExposure = environment.exposure;
  const before = new Set(scene.children), atmosphere = createAtmosphere(scene);
  const skyObjects = scene.children.filter(object => !before.has(object));
  atmosphere.update(17.5, 30, camera, new THREE.Vector3(0, -1000, 0), 0);
  scene.fog = new THREE.FogExp2(environment.fog, environment.fogDensity * 0.45);
  scene.add(new THREE.HemisphereLight(0xc9dfec, 0x706744, 2));
  const sun = new THREE.DirectionalLight(0xffdda8, 2.2); sun.position.set(-20, 40, 15); scene.add(sun);
  const ownedGeometries: THREE.BufferGeometry[] = [], ownedMaterials: THREE.Material[] = [];
  const geometry = new THREE.BufferGeometry(), positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const color = new THREE.Color();
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const h = metres[x + z * size]!;
    positions.push(x - 32, h, z - 32);
    color.set(h < -0.5 ? 0x786f52 : h < 0.7 ? 0x9d936a : h < 2 ? 0x698452 : 0x536f45);
    const variation = 0.92 + 0.08 * Math.sin(x * 0.59 + z * 0.37); colors.push(color.r * variation, color.g * variation, color.b * variation);
    if (x < size - 1 && z < size - 1) { const i = x + z * size; indices.push(i, i + size, i + size + 1, i, i + size + 1, i + 1); }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  ownedGeometries.push(geometry); ownedMaterials.push(groundMaterial); scene.add(new THREE.Mesh(geometry, groundMaterial));
  function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: number) {
    const g = new THREE.BoxGeometry(sx, sy, sz), m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 });
    ownedGeometries.push(g); ownedMaterials.push(m); const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); scene.add(mesh); return mesh;
  }
  // Small waterside house and its warm panes give the reflection something real to carry.
  box(-16, 4.2, -18, 6, 5, 5, 0xb3a581);
  const roof = box(-16, 7.2, -18, 7, 1.8, 6, 0x64493b); roof.rotation.z = 0.1;
  box(-17.6, 4.6, -15.46, 1, 1.25, 0.1, 0xf9c675); box(-14.8, 4.6, -15.46, 1, 1.25, 0.1, 0xf9c675);
  for (const [x, z] of [[-25, -15], [-22, 12], [20, -20], [24, 10], [-7, -2], [-3, -1]] as const) {
    const gx = Math.max(0, Math.min(64, Math.round(x + 32))), gz = Math.max(0, Math.min(64, Math.round(z + 32))), h = metres[gx + gz * size]!;
    box(x, h + 1, z, 0.65, 2, 0.65, 0x65503c);
    box(x, h + 3, z, 3.3, 3.2, 3.3, 0x496b4a); box(x + 0.3, h + 4.7, z, 2.1, 1.7, 2.1, 0x608055);
  }
  const ground: WaterGround = mode === 'compact'
    ? { data: raw, width: size, height: size, origin, step, encoding: 'quantized', scale, offset }
    : { data: metres, width: size, height: size, origin, step };
  const raster: WaterRaster = mode === 'compact'
    ? { levels, dryGround: raw, seaLevel: 0, encoding: 'quantized', scale, offset }
    : { levels: floatLevels, seaLevel: 0 };
  const water = createWaterSurface({ bodies: [], reaches: [], ground, raster, quality: 'full' });
  scene.add(water.root);
  const mesh = water.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const nativeTexture = mesh.material.uniforms.uHeight!.value as THREE.DataTexture;
  let legacyTexture: THREE.DataTexture | undefined;
  if (mode === 'legacy') {
    const padded = rasterGround(ground);
    legacyTexture = new THREE.DataTexture(padded.data, padded.width, padded.height, THREE.RedFormat, THREE.FloatType);
    legacyTexture.minFilter = legacyTexture.magFilter = THREE.NearestFilter;
    legacyTexture.generateMipmaps = false; legacyTexture.needsUpdate = true;
    mesh.material.uniforms.uHeight!.value = legacyTexture;
    // Restore the former direct texelFetch sampling, including the padded final row/column.
    // This compares the previous sampling path against compact edge clamping, not two uses of the new helper.
    const shader = mesh.material.fragmentShader;
    let replacements = 0;
    mesh.material.fragmentShader = shader.replace(/groundTexel\(p( \+ ivec2\([01], [01]\))?\)/g, (_match, delta: string | undefined) => {
      replacements++; return `texelFetch(uHeight, p${delta ?? ''}, 0).r`;
    });
    if (replacements !== 4) throw new Error('Legacy sampling comparison no longer matches the production shader');
  }
  water.update({ time: 30, environment, camera, sources: [
    { position: [-17.6, 4.6, -15.4], strength: 0.9, kind: 'window', normal: [0, 0, 1] },
    { position: [-14.8, 4.6, -15.4], strength: 0.9, kind: 'window', normal: [0, 0, 1] },
  ] });
  const reflection = water.reflect({ renderer, scene, camera, frame: 1, exclusions: skyObjects });
  renderer.render(scene, camera);
  const gl = renderer.getContext(), pixels = new Uint8Array(width * height * 4);
  gl.finish(); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const digest = await crypto.subtle.digest('SHA-256', pixels);
  const pixelHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const result = { ready: true, mode, width, height, pixelHash, nonzeroPixels: pixels.filter((v, i) => i % 4 !== 3 && v !== 0).length,
    textureBytes: mode === 'compact' ? raw.byteLength : (legacyTexture!.image.data as Float32Array).byteLength,
    groundAliases: nativeTexture.image.data === ground.data,
    queries: [[-10, 2], [-5, -1], [20, -8], [31.5, 31.5]].map(([x, z]) => water.waterAt(x!, z!)), reflection };
  disposeCurrent = () => { water.dispose(); atmosphere.dispose(); legacyTexture?.dispose(); for (const g of ownedGeometries) g.dispose(); for (const m of ownedMaterials) m.dispose(); };
  bench.__chatdomReady = true;
  return result;
}
bench.__compactWater = { draw };
