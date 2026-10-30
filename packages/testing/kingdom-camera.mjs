import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run from the repository root. SSR transforms TypeScript without opening a
// browser, HTTP server or HMR socket; dependencies come from their owning package.
const root = process.cwd();
const rootRequire = createRequire(resolve(root, 'package.json'));
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
const { createServer } = await import(pathToFileURL(rootRequire.resolve('vite')).href);
const THREE = await import(pathToFileURL(resolve(dirname(webRequire.resolve('three')), 'three.module.js')).href);
const sourcePath = 'apps/web/src/kingdom/scene.ts', reportPath = 'shots/kingdom/camera-sweep.json';
const sceneSource = await readFile(resolve(root, sourcePath), 'utf8');
const sourceHash = createHash('sha256').update(sceneSource).digest('hex');
const dt = 0.005, duration = 20;
const setupStart = sceneSource.indexOf('  const firstPane=first.blueprint.windows[0]!;');
const setupEnd = sceneSource.indexOf('  const sunShadows=', setupStart);
const setupCode = sceneSource.slice(setupStart, setupEnd).replaceAll('windows[0]!', 'windows[0]');
const autoStart = sceneSource.indexOf('    if(autoCamera){');
const autoEnd = sceneSource.indexOf('\n    }\n    else if', autoStart);
const autoCode = sceneSource.slice(autoStart + '    if(autoCamera){'.length, autoEnd);
const fovCode = sceneSource.match(/ {4}const wantedFov=([^;]+);/)?.[1];
if ([setupStart, setupEnd, autoStart, autoEnd].some(index => index < 0) || !fovCode) throw new Error('Camera source layout changed');

// The continuous bound below requires this monotone lift/pull form. Reject a
// different camera algorithm instead of silently applying its old proof to it.
const compact = code => code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
const arc = compact(autoCode);
const ranges = [...arc.matchAll(/THREE\.MathUtils\.smootherstep\(time,([\d.]+),([\d.]+)\)/g)].map(match => [match[1], match[2]]);
const liftCeiling = arc.match(/Math\.max\(([\d.]+),homeEye\.y\)/)?.[1];
if (ranges.length !== 3 || !liftCeiling) throw new Error('Camera motion needs a new continuous-path proof');
const [[liftStart, liftEnd], [pullStart, pullEnd], [targetStart, targetEnd]] = ranges;
const expectedArc = `const lift=THREE.MathUtils.smootherstep(time,${liftStart},${liftEnd}),pull=THREE.MathUtils.smootherstep(time,${pullStart},${pullEnd});
  camera.position.copy(homeEye);camera.position.y=THREE.MathUtils.lerp(homeEye.y,Math.max(${liftCeiling},homeEye.y),lift);camera.position.lerp(heroEye,pull);
  target.lerpVectors(homeTarget,heroTarget,THREE.MathUtils.smootherstep(time,${targetStart},${targetEnd}));`;
const fov = compact(fovCode).match(/^autoCamera\?THREE\.MathUtils\.lerp\(([\d.]+),heroFov,THREE\.MathUtils\.smootherstep\(time,([\d.]+),([\d.]+)\)\):camName==='window'\?([\d.]+):heroFov$/);
if (arc !== compact(expectedArc) || !fov) throw new Error('Camera motion needs a new continuous-path proof');
for (const [start, end] of [...ranges, [fov[2], fov[3]]].map(range => range.map(Number))) {
  if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > duration) throw new Error('Camera motion exceeds the checked time interval');
}
const cameraArgs = sceneSource.match(/new THREE\.PerspectiveCamera\(([\d.,\s]+)\)/)?.[1].split(',').map(Number);
const farStep = Number(sceneSource.match(/createHorizonSurface\(layout,\{farStep:(10|20)\}\)/)?.[1]);
if (!cameraArgs || cameraArgs.length !== 4 || !cameraArgs.every(Number.isFinite)
  || cameraArgs[2] <= 0 || cameraArgs[3] <= cameraArgs[2] || ![10, 20].includes(farStep)) {
  throw new Error('Camera clipping or horizon configuration changed');
}
const near = cameraArgs[2], initialFov = Number(fov[1]);
const setupCamera = new Function('THREE', 'first', 'options', 'canvas', 'camera', `${setupCode}\nsetHero();return {homeEye,homeTarget,heroEye,heroTarget,target,heroFov};`);
const moveCamera = new Function('THREE', 'time', 'camera', 'homeEye', 'homeTarget', 'heroEye', 'heroTarget', 'target', 'heroFov', `const autoCamera=true,camName='hero';${autoCode}\ncamera.fov=${fovCode};camera.lookAt(target);camera.updateMatrixWorld();`);
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const grids = new Map();
const blueprintGrids = new WeakMap();
function gridFor(blueprint) {
  let result = blueprintGrids.get(blueprint);
  if (result) return result;
  const key = JSON.stringify([blueprint.size, blueprint.boxes]);
  result = grids.get(key);
  if (result) { blueprintGrids.set(blueprint, result); return result; }
  const [sx, sy, sz] = blueprint.size;
  const cells = new Uint8Array(sx * sy * sz);
  for (const box of blueprint.boxes) {
    for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) {
      const row = sx * (y + sy * z);
      cells.fill(Number(box.material !== 0), row + box.from[0], row + box.to[0]);
    }
  }
  result = { cells, sx, sy, sz };
  grids.set(key, result); blueprintGrids.set(blueprint, result);
  return result;
}
function local(point, object) {
  const x = point[0] - object.position[0], z = point[2] - object.position[2];
  const q = ((Math.round(object.yaw / (Math.PI / 2)) % 4) + 4) % 4;
  if (q === 1) return [-z * 8, (point[1] - object.position[1]) * 8, x * 8];
  if (q === 2) return [-x * 8, (point[1] - object.position[1]) * 8, -z * 8];
  if (q === 3) return [z * 8, (point[1] - object.position[1]) * 8, -x * 8];
  return [x * 8, (point[1] - object.position[1]) * 8, z * 8];
}
function broadSegment(a, b, size) {
  return size.every((end, axis) => Math.min(a[axis], b[axis]) <= end && Math.max(a[axis], b[axis]) >= 0);
}
function boxDistanceSquared(point, min, max) {
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) sum += Math.max(min[axis] - point[axis], 0, point[axis] - max[axis]) ** 2;
  return sum;
}
function nearestSolid(point, object, limit) {
  const p = local(point, object), size = object.blueprint.size;
  let best2 = (limit * 8) ** 2;
  if (boxDistanceSquared(p, [0, 0, 0], size) >= best2) return null;
  const { cells, sx, sy } = gridFor(object.blueprint);
  const radius = Math.sqrt(best2);
  const from = p.map(v => Math.max(0, Math.floor(v - radius)));
  const to = p.map((v, axis) => Math.min(size[axis] - 1, Math.floor(v + radius)));
  let found = false;
  for (let z = from[2]; z <= to[2]; z++) {
    const dz2 = Math.max(z - p[2], 0, p[2] - z - 1) ** 2;
    if (dz2 >= best2) continue;
    for (let y = from[1]; y <= to[1]; y++) {
      const dyz2 = dz2 + Math.max(y - p[1], 0, p[1] - y - 1) ** 2;
      if (dyz2 >= best2) continue;
      const row = sx * (y + sy * z);
      for (let x = from[0]; x <= to[0]; x++) {
        if (!cells[row + x]) continue;
        const distance2 = dyz2 + Math.max(x - p[0], 0, p[0] - x - 1) ** 2;
        if (distance2 < best2) { best2 = distance2; found = true; }
      }
    }
  }
  return found ? Math.sqrt(best2) / 8 : null;
}
// The 1 m inner/collar grid is piecewise affine. Outside it, every distant
// cell (including its conforming edge fan) stays below its four corner heights.
function terrainUpper(horizon, from, to, padding = 0) {
  const bounds = horizon.clipBounds;
  const outer = [Math.floor(bounds[0] / farStep) * farStep - farStep, Math.ceil(bounds[1] / farStep) * farStep + farStep,
    Math.floor(bounds[2] / farStep) * farStep - farStep, Math.ceil(bounds[3] / farStep) * farStep + farStep];
  const minX = Math.min(from[0], to[0]) - padding, maxX = Math.max(from[0], to[0]) + padding;
  const minZ = Math.min(from[2], to[2]) - padding, maxZ = Math.max(from[2], to[2]) + padding;
  const upper = step => {
    let result = -Infinity;
    for (let z = Math.floor(minZ / step) * step; z <= Math.ceil(maxZ / step) * step; z += step)
      for (let x = Math.floor(minX / step) * step; x <= Math.ceil(maxX / step) * step; x += step)
        result = Math.max(result, horizon.sampleHeight(x, z));
    return result;
  };
  if (minX >= outer[0] && maxX <= outer[1] && minZ >= outer[2] && maxZ <= outer[3]) return upper(1);
  const coarse = upper(farStep);
  return maxX >= outer[0] && minX <= outer[1] && maxZ >= outer[2] && minZ <= outer[3] ? Math.max(coarse, upper(1)) : coarse;
}
const rounded = value => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value;
try {
  const { generateKingdom } = await server.ssrLoadModule('/packages/world/src/index.ts');
  const { createSettlementContent } = await server.ssrLoadModule('/apps/web/src/kingdom/settlement-content.ts');
  const { createSimulatedPresence } = await server.ssrLoadModule('/apps/web/src/kingdom/presence-feed.ts');
  const { createCastle } = await server.ssrLoadModule('/packages/content/src/index.ts');
  const { createHorizonSurface } = await server.ssrLoadModule('/apps/web/src/kingdom/horizon.ts');
  const { blueprintOccludes } = await server.ssrLoadModule('/apps/web/src/kingdom/visibility.ts');
  const records = [], failures = [];
  for (const seed of ['lanternmere', 'willowmere']) for (const tier of ['hamlet', 'town']) {
    const layout = generateKingdom({ seed, tier, firstYear: tier === 'hamlet' ? 2025 : 2022, year: 2026 });
    const { houses, props } = createSettlementContent(layout);
    const first = houses.find(home => home.slot === createSimulatedPresence(layout).firstSlot);
    if (!first) throw new Error(`No camera home in ${seed}/${tier}`);
    const objects = [...houses.map(home => ({ ...home, category: 'home' })),
      ...props.map(prop => ({ ...prop, category: 'prop' })),
      { slot: 65534, blueprint: createCastle('tide'), position: [layout.castle[0] - 16, layout.castle[1], layout.castle[2] - 16], yaw: 0, category: 'castle' }];
    for (const object of objects) {
      if (!Number.isFinite(object.yaw) || Math.abs(object.yaw - Math.round(object.yaw / (Math.PI / 2)) * Math.PI / 2) > 1e-7) {
        throw new Error(`Camera collision checks require cardinal objects: ${object.blueprint.id}`);
      }
    }
    const horizon = createHorizonSurface(layout, { farStep });
    try {
      for (const portrait of [false, true]) {
        const canvas = { clientWidth: portrait ? 390 : 1440, clientHeight: portrait ? 844 : 900 };
        const camera = new THREE.PerspectiveCamera(cameraArgs[0], canvas.clientWidth / canvas.clientHeight, near, cameraArgs[3]);
        const setup = setupCamera(THREE, first, { tier }, canvas, camera);
        if (setup.heroEye.y < Math.max(Number(liftCeiling), setup.homeEye.y)
          || ![initialFov, setup.heroFov].every(value => Number.isFinite(value) && value > 0 && value < 180)) {
          throw new Error(`Camera endpoints violate the monotone proof: ${seed}/${tier}`);
        }
        const maxHalfHeight = near * Math.tan(Math.max(initialFov, setup.heroFov) * Math.PI / 360);
        const maxNearRadius = Math.hypot(near, maxHalfHeight, maxHalfHeight * camera.aspect);
        let previous = null, minSolid = { distance: 5, time: null, capped: true }, minTerrain = { distance: Infinity }, minNearTerrain = { distance: Infinity };
        let firstCollision = null, collisionSegments = 0, maxSegment = 0, evaluatedSamples = 0, checkedPositions = 0;
        let nearPointCollision = null, continuousTerrainClearance = Infinity, continuousNearTerrainClearance = Infinity;
        for (let sample = 0; sample <= duration / dt; sample++) {
          const time = sample * dt;
          moveCamera(THREE, time, camera, setup.homeEye, setup.homeTarget, setup.heroEye, setup.heroTarget, setup.target, setup.heroFov);
          const point = camera.position.toArray();
          evaluatedSamples++;
          if (![...point, ...setup.target.toArray(), camera.fov].every(Number.isFinite)) throw new Error('Camera produced a nonfinite pose');
          if (previous && point.every((value, axis) => value === previous[axis])) continue;
          checkedPositions++;
          if (previous) maxSegment = Math.max(maxSegment, Math.hypot(...point.map((v, axis) => v - previous[axis])));
          const terrainDistance = point[1] - horizon.sampleHeight(point[0], point[2]);
          if (terrainDistance < minTerrain.distance) minTerrain = { distance: terrainDistance, time, point };
          const forward = setup.target.clone().sub(camera.position).normalize();
          const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
          const up = new THREE.Vector3().crossVectors(right, forward).normalize();
          const halfHeight = near * Math.tan(camera.fov * Math.PI / 360), halfWidth = halfHeight * camera.aspect;
          const minY = Math.min(previous?.[1] ?? point[1], point[1]);
          continuousTerrainClearance = Math.min(continuousTerrainClearance, minY - terrainUpper(horizon, previous ?? point, point));
          continuousNearTerrainClearance = Math.min(continuousNearTerrainClearance,
            minY - maxNearRadius - terrainUpper(horizon, previous ?? point, point, maxNearRadius));
          const nearPoints = [];
          for (const side of [-1, 0, 1]) for (const vertical of [-1, 0, 1]) {
            const np = camera.position.clone().addScaledVector(forward, near).addScaledVector(right, halfWidth * side).addScaledVector(up, halfHeight * vertical).toArray();
            nearPoints.push(np);
            const clearance = np[1] - horizon.sampleHeight(np[0], np[2]);
            if (clearance < minNearTerrain.distance) minNearTerrain = { distance: clearance, time, point: np };
          }
          for (const object of objects) {
            const a = local(previous ?? point, object), b = local(point, object);
            if (broadSegment(a, b, object.blueprint.size) && blueprintOccludes(object.blueprint, a, b)) {
              collisionSegments++;
              if (!firstCollision) {
                let lo = 0, hi = 1;
                for (let iteration = 0; iteration < 24; iteration++) {
                  const mid = (lo + hi) / 2, end = a.map((v, axis) => v + (b[axis] - v) * mid);
                  if (blueprintOccludes(object.blueprint, a, end)) hi = mid; else lo = mid;
                }
                firstCollision = { time: Math.max(0, time - dt) + hi * dt, id: object.blueprint.id, slot: object.slot,
                  category: object.category, point: (previous ?? point).map((v, axis) => v + (point[axis] - v) * hi) };
              }
            }
            const distance = nearestSolid(point, object, minSolid.distance);
            if (distance !== null) minSolid = { distance, time, capped: false, id: object.blueprint.id, slot: object.slot, category: object.category, point };
            if (!nearPointCollision && boxDistanceSquared(b, [0, 0, 0], object.blueprint.size) < (maxNearRadius * 8) ** 2) {
              for (const np of nearPoints) {
                const pn = local(np, object);
                if (blueprintOccludes(object.blueprint, pn, pn)) { nearPointCollision = { time, id: object.blueprint.id, point: np }; break; }
              }
            }
          }
          previous = point;
        }
        const record = { seed, tier, viewport: portrait ? '390x844' : '1440x900', firstHome: first.blueprint.id, firstSlot: first.slot,
          objects: { homes: houses.length, props: props.length, castles: 1 }, evaluatedSamples, checkedPositions,
          homeEye: setup.homeEye.toArray(), heroEye: setup.heroEye.toArray(), heroTarget: setup.heroTarget.toArray(), heroFov: setup.heroFov, firstCollision, collisionSegments,
          minSolid, minTerrain, minNearTerrain, maxSegment, maxNearRadius,
          conservativeSweptSolidClearance: minSolid.distance - maxSegment,
          continuousNearPlaneMargin: minSolid.distance - maxSegment - maxNearRadius,
          continuousTerrainClearance, continuousNearTerrainClearance, nearPointCollision };
        records.push(record);
        const label = `${seed}/${tier}/${record.viewport}`;
        if (firstCollision || collisionSegments || nearPointCollision) failures.push(`${label}: camera or near plane intersects authored solid geometry`);
        for (const key of ['conservativeSweptSolidClearance', 'continuousNearPlaneMargin', 'continuousTerrainClearance', 'continuousNearTerrainClearance']) {
          if (!Number.isFinite(record[key]) || record[key] <= 0) failures.push(`${label}: ${key} is not positive`);
        }
        console.log(JSON.stringify(record, (_, value) => rounded(value)));
      }
    } finally { horizon.geometry.dispose(); }
  }
  const sourceUnchanged = sceneSource === await readFile(resolve(root, sourcePath), 'utf8');
  if (!sourceUnchanged) failures.push('Scene source changed during the camera sweep');
  const report = { sourcePath, sourceHash, sourceUnchanged, passed: failures.length === 0, failures, dt, duration, near, farStep,
    continuousPathBound: 'The checked lift/pull form and endpoint heights make camera x/y/z coordinates monotone. Each continuous curve section stays in its endpoint AABB. Subtracting the maximum endpoint chord from minimum sampled solid distance bounds the continuous curve. Terrain uses maxima of all covering exact 1 m or distant cell vertices. Expanding the swept XZ box and lowering its Y by the largest near-plane radius encloses the whole continuous near plane.',
    method: 'Exact ordered voxel occupancy at 0.125 m for clearance; exact ordered-box intersections for every sampled path segment; actual rendered horizon/detailed triangle sampler for terrain; nine near-plane samples per frame. Trees excluded.',
    limitations: ['Two fixed seeds and two settlement sizes, at two viewport sizes; not a universal camera collision system.',
      'Trees and other unlisted scene objects are excluded. Geometry checks do not establish visual framing, GPU performance or draw budgets.',
      'Continuous proof is restricted to the checked monotone lift/pull form; changing that algorithm requires updating this harness.'],
    records };
  await mkdir(dirname(resolve(root, reportPath)), { recursive: true });
  await writeFile(resolve(root, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: reportPath, passed: report.passed, cases: records.length, evaluatedSamples: records.reduce((sum, record) => sum + record.evaluatedSamples, 0), sourceHash, sourceUnchanged, voxelGrids: grids.size,
    gridBytes: [...grids.values()].reduce((total, grid) => total + grid.cells.byteLength, 0) }));
  if (failures.length) throw new Error(`Camera sweep failed:\n${failures.join('\n')}`);
} finally { await server.close(); }
