import * as THREE from 'three';
import { grandChannel } from '../../channels';
import { generateGrandLand } from '../../../../../../packages/world/src/grand/generate';
import { createVoxelizeContext, voxelizeChunk, PAD_VOLUME, padIndex } from '../../../../../../packages/world/src/grand/voxelize';
import { Cover, GRAND_CHUNK } from '../../../../../../packages/world/src/grand/types';
import { landMaterials } from '../../../../../../packages/world/src/grand/kits';
import { M } from '../../../../../../packages/world/src/grand/palette';
import { createFieldDecorSampler, fieldDecorFurrow, fieldDecorHeight, fieldDecorMaterial, FIELD_DECOR_FALLBACK } from '../../../../../../packages/world/src/grand/artisans/fields/decor';
import { createWaterDressSampler, GRAND_WATER_DRESS_GLSL } from '../../../../../../packages/world/src/grand/artisans/geology/water';
import { applyGrade, createGrandUniforms, grandGrade, GRAND_COMMON } from '../../../../../../packages/render/src/grand/light';

type Cell = { x: number; y: number; z: number; material: number };
const query = new URLSearchParams(location.search);
const kind = query.get('kit') === 'source-water' ? 'source-water' : 'source-fields';
const view = ['hero', 'street', 'coast', 'dusk'].includes(query.get('view') ?? '') ? query.get('view')! : 'hero';
const parsedHour = Number(query.get('hour') ?? (view === 'dusk' ? 19 : 17));
const hour = Number.isFinite(parsedHour) ? parsedHour : 17;
const channel = grandChannel(query.get('channel'));
const detail = document.querySelector<HTMLSpanElement>('#detail')!;
const errorLabel = document.querySelector<HTMLDivElement>('#error')!;
const resources: { dispose: () => void }[] = [];
let renderer: THREE.WebGLRenderer | undefined;
let stopped = false;
window.addEventListener('pagehide', () => { stopped = true; for (const r of resources) r.dispose(); renderer?.dispose(); }, { once: true });

function run(): void {
  const land = generateGrandLand(channel.seed);
  const cropIds: Record<string, readonly number[]> = { wheat: [M.crop.wheat, M.crop.wheatPale], lavender: [M.crop.lavender, M.crop.lavenderDark], cabbage: [M.crop.cabbage] };
  const cropQuery = query.get('crop');
  if (kind === 'source-fields' && cropQuery && !Object.hasOwn(cropIds,cropQuery)) throw new Error(`Unknown crop ${cropQuery}; use wheat, lavender or cabbage.`);
  const supported = new Set<number>(cropQuery && cropIds[cropQuery] ? cropIds[cropQuery] : Object.values(cropIds).flat());
  const plot = land.plots.find(p => supported.has(p.crop));
  if (kind === 'source-fields' && !plot) throw new Error(`This channel has no ${cropQuery ?? 'supported'} plot for this study.`);
  const cropName = plot ? Object.entries(cropIds).find(([,ids]) => ids.includes(plot.crop))?.[0] ?? 'unknown' : null;
  let cx = plot ? Math.floor((plot.x0 + plot.x1) / 2) : 0;
  let cz = plot ? Math.floor((plot.z0 + plot.z1) / 2) : 0;
  const sampleWater = createWaterDressSampler(land);
  if (kind === 'source-water') {
    // Find a real inland wet location with nearby dry ground; no synthetic shore.
    let best = -1;
    for (let z = 40; z < land.size - 40; z += 8) for (let x = 40; x < land.size - 40; x += 8) {
      const i = x + z * land.size;
      if (land.water[i]! <= land.ground[i]! || land.cover[i] === Cover.sea) continue;
      let score = 0;
      for (let dz = -24; dz <= 24; dz += 8) for (let dx = -24; dx <= 24; dx += 8) {
        const n = x + dx + (z + dz) * land.size;
        score += land.water[n]! > land.ground[n]! && land.cover[n] !== Cover.sea ? 1 : 0;
      }
      // Prefer a broad water body with a visible margin, rather than the ocean.
      if (score > best && score < 48) { best = score; cx = x; cz = z; }
    }
    if (best < 0) throw new Error('No inland water cells in this channel.');
  }
  const span = 64, x0 = Math.max(0, Math.min(land.size - span, cx - span / 2)), z0 = Math.max(0, Math.min(land.size - span, cz - span / 2));
  const ctx = createVoxelizeContext(land), cache = new Map<string, Uint8Array>();
  const source = (x: number, y: number, z: number) => {
    const bx = Math.floor(x / GRAND_CHUNK), by = Math.floor(y / GRAND_CHUNK), bz = Math.floor(z / GRAND_CHUNK);
    const key = `${bx}:${by}:${bz}`;
    let chunk = cache.get(key);
    if (!chunk) { chunk = new Uint8Array(PAD_VOLUME); voxelizeChunk(ctx, 0, bx, by, bz, chunk); cache.set(key, chunk); }
    return chunk[padIndex(x - bx * GRAND_CHUNK, y - by * GRAND_CHUNK, z - bz * GRAND_CHUNK)]!;
  };
  const field = createFieldDecorSampler(land), cells: Cell[] = [], waters: Cell[] = [];
  let fieldColumns = 0, dressedColumns = 0, waterColumns = 0, minGround = Infinity, maxGround = -Infinity;
  for (let z = z0; z < z0 + span; z++) for (let x = x0; x < x0 + span; x++) {
    const i = x + z * land.size, g = land.ground[i]!, w = land.water[i]!, cover = land.cover[i]!;
    if (!g) continue;
    minGround = Math.min(minGround, g); maxGround = Math.max(maxGround, g);
    let top = source(x, g - 1, z);
    const p = land.plots[land.plot[i]! - 1];
    if (cover === Cover.field && p) {
      fieldColumns++;
      const furrow = fieldDecorFurrow(p, x, z);
      if (furrow !== null) top = furrow ? M.crop.furrow : M.crop.ploughed;
    }
    cells.push({ x, y: g - 1, z, material: top });
    if (kind === 'source-fields') {
      const profile = field(x,z);
      if (profile !== FIELD_DECOR_FALLBACK) {
        if (profile > 0) dressedColumns++;
        for (let h=0; h<fieldDecorHeight(profile); h++) cells.push({ x, y: g+h, z, material: fieldDecorMaterial(profile,h) });
      } else {
        // Exact original producer output for noncandidate columns, capped to its first 3 cells.
        for (let h=0;h<3;h++) { const material=source(x,g+h,z); if (material && material !== M.water && material !== M.sea) cells.push({x,y:g+h,z,material}); }
      }
    }
    const observation = sampleWater(x,z);
    if (observation?.wet && w > g) {
      waterColumns++;
      // Exposed top and real depth, clipped to eight cells for this bounded specimen.
      for (let y=Math.max(g,w-8);y<w;y++) waters.push({ x,y,z,material:M.water });
    }
  }
  const palette = new Map(landMaterials(land).map(m => [m.id, new THREE.Color(m.colour)]));
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(`Shader compilation failed: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`);
  };
  renderer.setPixelRatio(1); renderer.setSize(innerWidth,innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene(), grade = grandGrade(hour, 0.8);
  scene.background = grade.fog.clone(); renderer.toneMappingExposure = grade.exposure;
  scene.add(new THREE.HemisphereLight(grade.sky, grade.ground, 1.6));
  const sun = new THREE.DirectionalLight(grade.sun, Math.max(.8, grade.sunIntensity)); sun.position.copy(grade.sunDirection).multiplyScalar(90); scene.add(sun);
  const geometry = new THREE.BoxGeometry(.5,.5,.5); resources.push(geometry);
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1 }); resources.push(groundMat);
  const mesh = new THREE.InstancedMesh(geometry, groundMat, cells.length); resources.push(mesh);
  const matrix = new THREE.Matrix4(); const baseY = land.ground[Math.floor(cx)+Math.floor(cz)*land.size]!;
  cells.forEach((c,i) => { matrix.makeTranslation((c.x-cx)*.5,(c.y-baseY)*.5,(c.z-cz)*.5); mesh.setMatrixAt(i,matrix); mesh.setColorAt(i,palette.get(c.material) ?? new THREE.Color('#8c7054')); });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; scene.add(mesh);
  const uniforms = { ...createGrandUniforms(), uSourceOrigin: { value: new THREE.Vector3(cx*.5,baseY*.5,cz*.5) }, uWaterBase: { value: (palette.get(M.water) ?? new THREE.Color('#3f8fa6')).clone() } }; applyGrade(uniforms,grade); uniforms.uTime.value = 1.25;
  resources.push(uniforms.uCloudMap.value);
  const waterMat = new THREE.ShaderMaterial({ uniforms, vertexShader: `varying vec3 vWorld; varying vec3 vNormal; void main(){ vec4 p=instanceMatrix*vec4(position,1.); vec4 world=modelMatrix*p; vWorld=world.xyz; vNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*world; }`, fragmentShader: `varying vec3 vWorld; varying vec3 vNormal; uniform vec3 uSourceOrigin, uWaterBase; ${GRAND_COMMON} ${GRAND_WATER_DRESS_GLSL} void main(){ vec3 n=normalize(vNormal); vec3 view=normalize(vWorld-cameraPosition); vec3 col=grandDressWater(uWaterBase,vec3(.85),vec3(.8,.9,1.),1.,view,n,vWorld+uSourceOrigin); gl_FragColor=vec4(col,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`, });
  resources.push(waterMat);
  const waterMesh = new THREE.InstancedMesh(geometry,waterMat,waters.length); resources.push(waterMesh);
  waters.forEach((c,i) => { matrix.makeTranslation((c.x-cx)*.5,(c.y-baseY)*.5,(c.z-cz)*.5); waterMesh.setMatrixAt(i,matrix); });
  waterMesh.instanceMatrix.needsUpdate=true; scene.add(waterMesh);
  const aspect = innerWidth/innerHeight, extent = view === 'street' ? 13 : view === 'coast' ? 19 : 25;
  const halfHeight = view === 'street' ? extent : extent / Math.min(1,aspect);
  const camera = new THREE.OrthographicCamera(-halfHeight*aspect,halfHeight*aspect,halfHeight,-halfHeight,.1,300);
  const angle = view === 'street' ? [22,14,30] : view === 'coast' ? [-30,24,35] : [35,38,45];
  camera.position.set(angle[0]!,angle[1]!,angle[2]!); camera.lookAt(0,0,0); camera.updateProjectionMatrix();
  renderer.compile(scene,camera); renderer.render(scene,camera); renderer.getContext().finish();
  const gl = renderer.getContext();
  if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL reported an error during the fixture render.');
  if (stopped) return;
  detail.textContent = `${kind === 'source-fields' ? 'Field candidate' : 'Water shader'} · ${channel.name} · ${view} · ${hour}:00. One-cell surface slice; fixed-light water fixture. Isolated specimen, not native-land acceptance.`;
  const stats = { kind, channel: channel.login, view, hour, source: 'generated GrandLand', crop: kind === 'source-fields' && plot ? { id: plot.crop, name: cropName } : null, bounds: { x0,z0,span }, reviewedColumns: span*span, fieldColumns, dressedColumns, waterColumns, sourceChunks: cache.size, groundRange: [minGround,maxGround], waterCells: waters.length, groundAndPlantCells: cells.length, candidate: kind === 'source-fields' ? 'source terrain surface + sampled candidate furrows and plants' : 'source ground and water cells + exact GRAND_WATER_DRESS_GLSL', limitations: 'one-cell surface slice and fixed-light water fixture; no native placements, full-land LOD, collision, PCF scene lighting or shadow acceptance' };
  Object.assign(window, { __artisanReview: { stats }, __chatdomReady: true });
}
try { run(); } catch (error) { errorLabel.textContent = error instanceof Error ? error.message : String(error); throw error; }
