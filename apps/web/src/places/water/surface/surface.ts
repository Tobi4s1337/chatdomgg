import * as THREE from 'three';
import type { Environment } from '@chatdom/render';
import type { WaterBody } from '@chatdom/world';
import type { XZ } from '@chatdom/world';
import type { WaterReach } from '../../../../../../packages/world/src/places/water/reaches';
import { assertGround, basinDistance, waterAt, type WaterAt, type WaterGround } from './coverage';
import { basinGeometry, reachGeometry } from './geometry';
import { assertRaster, rasterGeometry, rasterSamples, rasterWaterAt, type WaterRaster } from './raster';
import { FLOW_PERIOD, waterPhases } from './phases';
import { PILLAR_CAP, selectPillars, type PillarSelection, type WaterLightSource } from './pillars';
import { createPlanarReflection, type PlanarReflectionOptions, type ReflectionDiagnostics, type ReflectionFrame, type ReflectionReport } from './reflection';
import { BASIN_CAP, CONTACT_CAP, waterFragment, waterVertex } from './shader';

export type WaterQuality = 'full' | 'reduced';

/** Where something really stands in the water: a pile or stone (a point), a hull side or a weir crest (a segment). */
export interface WaterContact {
  readonly a: XZ;
  readonly b?: XZ;
  /** Half width of the object at the waterline, metres. */
  readonly radius: number;
  /** 0..1: a still pile barely rings, a weir crest is white. */
  readonly strength: number;
}

export interface WaterSurfaceOptions {
  /** Supplied still bodies (lake, millpond): the land's `WaterBody` records. */
  readonly bodies: readonly WaterBody[];
  /** Courses derived from the land's own streams (`deriveWaterReaches`). */
  readonly reaches: readonly WaterReach[];
  /** The caller's ground heights; the bed under water. Read, never owned. */
  readonly ground: WaterGround;
  /** Optional native terrain water levels, in the same grid as ground. */
  readonly raster?: WaterRaster;
  /** Bed height outside the sampled ground grid; defaults to an occluding height. */
  readonly outsideGroundHeight?: number;
  readonly contacts?: readonly WaterContact[];
  readonly quality: WaterQuality;
  readonly reflection?: PlanarReflectionOptions;
}

export interface WaterSurfaceFrame {
  /** Caller seconds. Every motion is a pure function of it. */
  readonly time: number;
  readonly environment: Environment;
  readonly camera: THREE.Camera;
  /** The caller's actual light sources this frame (windows, beacon, people-lit lamps). */
  readonly sources: readonly WaterLightSource[];
}

export interface WaterSurfaceDiagnostics {
  readonly quality: WaterQuality;
  readonly reflection: Readonly<ReflectionDiagnostics>;
  /** The plane the reflection serves this frame, or null when no water is in view. */
  readonly plane: { readonly id: string; readonly level: number } | null;
  readonly pillars: { readonly cap: number; readonly drawn: number; readonly considered: number; readonly dropped: number; readonly rejected: PillarSelection['rejected'] };
  readonly contacts: { readonly cap: number; readonly count: number };
  readonly bytes: { readonly ground: number; readonly reflection: number };
  readonly meshes: number;
  readonly triangles: number;
}

interface PlaneSample { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly weight: number }

/**
 * The water of a kingdom place: every supplied basin and course, one material, one reflection plane per frame.
 *
 * Host order each frame: `update(frame)`, then `reflect(hostFrame)` from the renderer host's explicit reflection hook
 * (W-M3), then the host's normal render. `update` invalidates the last reflection, so a host that skips `reflect`
 * draws the coherent reduced path rather than a stale image. The root, its geometries, materials, ground texture
 * and reflection target belong to the surface; the caller's ground array, scene, camera and renderer do not.
 */
export function createWaterSurface(options: WaterSurfaceOptions) {
  const { bodies, reaches, ground } = options;
  assertGround(ground);
  if (options.raster) assertRaster(options.raster, ground);
  const outsideGroundHeight = options.outsideGroundHeight ?? 1e4;
  if (!Number.isFinite(outsideGroundHeight)) throw new RangeError('Outside ground height must be finite');
  if (!options.raster && !bodies.length && !reaches.length) throw new RangeError('Water needs at least one supplied basin or course');
  for (const body of bodies) {
    if (![body.x, body.z, body.radiusX, body.radiusZ, body.level].every(Number.isFinite) || !(body.radiusX > 0 && body.radiusZ > 0))
      throw new RangeError(`Water body ${body.id} is not a finite outline`);
  }
  if (bodies.length > BASIN_CAP) throw new RangeError(`At most ${BASIN_CAP} basins per surface`);
  let quality = options.quality;
  if (quality !== 'full' && quality !== 'reduced') throw new RangeError(`Unknown water quality "${String(quality)}"`);

  const quantized = ground.encoding === 'quantized';
  const heights = new THREE.DataTexture(ground.data, ground.width, ground.height,
    quantized ? THREE.RedIntegerFormat : THREE.RedFormat, quantized ? THREE.UnsignedShortType : THREE.FloatType);
  if (quantized) heights.internalFormat = 'R16UI';
  heights.minFilter = heights.magFilter = THREE.NearestFilter;
  heights.unpackAlignment = quantized ? 2 : 4;
  heights.generateMipmaps = false; heights.needsUpdate = true;
  const reflection = createPlanarReflection(options.reflection);
  if (quality === 'reduced') reflection.setMode('reduced');

  const v4 = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
  const shared = {
    uHeight: { value: heights }, uOrigin: { value: new THREE.Vector2(...ground.origin) },
    uSize: { value: new THREE.Vector2(ground.width + (options.raster ? 1 : 0), ground.height + (options.raster ? 1 : 0)) }, uStep: { value: ground.step },
    uGroundScale: { value: quantized ? ground.scale : 1 }, uGroundOffset: { value: quantized ? ground.offset : 0 },
    uOutsideGroundHeight: { value: outsideGroundHeight },
    uBasins: { value: v4(BASIN_CAP) }, uBasinLevels: { value: new Array<number>(BASIN_CAP).fill(-1e6) }, uBasinCount: { value: options.raster ? 0 : bodies.length },
    uWind: { value: new THREE.Vector3() }, uFlowPhase: { value: new THREE.Vector2() },
    uFlowOffset0: { value: new THREE.Vector2() }, uFlowOffset1: { value: new THREE.Vector2() }, uFlowPeriod: { value: FLOW_PERIOD },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() }, uSunDirection: { value: new THREE.Vector3(0, 1, 0) }, uAmbient: { value: new THREE.Color() },
    uFog: { value: new THREE.Color() }, uSunIntensity: { value: 0 }, uAmbientIntensity: { value: 0 }, uNight: { value: 0 }, uFogDensity: { value: 0 },
    uReflection: { value: null as THREE.Texture | null }, uReflectMatrix: { value: reflection.textureMatrix },
    uReflectValid: { value: 0 }, uReflectLevel: { value: 0 },
    uPillarCount: { value: 0 }, uPillarPos: { value: v4(PILLAR_CAP) }, uPillarShape: { value: v4(PILLAR_CAP) },
    uContactCount: { value: 0 }, uContactA: { value: v4(CONTACT_CAP) },
    uContactB: { value: Array.from({ length: CONTACT_CAP }, () => new THREE.Vector2()) },
  };
  bodies.forEach((body, i) => { shared.uBasins.value[i]!.set(body.x, body.z, body.radiusX, body.radiusZ); shared.uBasinLevels.value[i] = body.level; });
  // A blank 1×1 stands in for the target until the first pass, so the sampler is always bound to a real texture.
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
  shared.uReflection.value = blank;

  const root = new THREE.Group();
  root.name = 'water-surface';
  const materials: THREE.ShaderMaterial[] = [];
  const meshes: THREE.Mesh[] = [];
  const material = (mode: 0 | 1, own: Record<string, THREE.IUniform>) => {
    const made = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: waterVertex, fragmentShader: waterFragment,
      defines: quantized ? { QUANTIZED_GROUND: 1 } : {},
      uniforms: { ...shared, uMode: { value: mode }, ...own },
      transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending,
    });
    made.name = mode === 0 ? 'water-basin' : 'water-course';
    materials.push(made);
    return made;
  };
  const courseMaterial = !options.raster && reaches.length ? material(1, { uBasin: { value: new THREE.Vector4() }, uFeather: { value: 0 }, uWindAmp: { value: 0.45 } }) : null;
  if (options.raster) {
    const mesh = new THREE.Mesh(rasterGeometry(options.raster, ground), material(1, { uBasin: { value: new THREE.Vector4() }, uFeather: { value: 0 }, uWindAmp: { value: 1 } }));
    mesh.name = 'water:raster'; meshes.push(mesh);
  }
  for (const body of options.raster ? [] : bodies) {
    const mesh = new THREE.Mesh(basinGeometry(body), material(0, {
      uBasin: { value: new THREE.Vector4(body.x, body.z, body.radiusX, body.radiusZ) }, uFeather: { value: 0.75 }, uWindAmp: { value: 1 },
    }));
    mesh.name = `water:${body.id}`; meshes.push(mesh);
  }
  for (const reach of options.raster ? [] : reaches) {
    const mesh = new THREE.Mesh(reachGeometry(reach), courseMaterial!);
    mesh.name = `water:${reach.id}`; meshes.push(mesh);
  }
  for (const mesh of meshes) { mesh.matrixAutoUpdate = false; mesh.renderOrder = 4; root.add(mesh); }
  root.updateMatrixWorld(true);

  // Samples that decide which plane the one reflection pass serves: area-weighted points of every water.
  const samples: PlaneSample[] = [];
  if (options.raster) samples.push(...rasterSamples(options.raster, ground));
  for (const body of options.raster ? [] : bodies) {
    const n = 7;
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const u = (i + 0.5) / n * 2 - 1, v = (k + 0.5) / n * 2 - 1;
      if (Math.hypot(u, v) > 1) continue;
      samples.push({ id: body.id, x: body.x + u * body.radiusX, y: body.level, z: body.z + v * body.radiusZ, weight: (4 * body.radiusX * body.radiusZ) / (n * n) });
    }
  }
  for (const reach of options.raster ? [] : reaches) reach.points.forEach((point, i) => {
    const next = reach.points[Math.min(i + 1, reach.points.length - 1)]!, prev = reach.points[Math.max(i - 1, 0)]!;
    samples.push({ id: reach.id, x: point.position[0], y: point.level, z: point.position[1], weight: point.width * (next.s - prev.s) / 2 });
  });

  const query = (x: number, z: number): WaterAt | null => options.raster ? rasterWaterAt(options.raster, ground, x, z) : waterAt(bodies, reaches, ground, x, z);
  const viewProjection = new THREE.Matrix4(), eye = new THREE.Vector3(), probe = new THREE.Vector4();
  let plane: { id: string; level: number } | null = null;
  let selection: PillarSelection = { pillars: [], considered: 0, rejected: { dark: 0, below: 0, offView: 0, dry: 0, facing: 0 }, dropped: 0 };
  let contactCount = 0;

  function choosePlane(): { id: string; level: number } | null {
    // Levels within 5 cm serve as one plane at their weighted mean; the plane with most visible water per distance²
    // wins, ties by id. Water off that plane fades to the reduced path in the shader.
    const score = new Map<number, { id: string; level: number; weight: number; sum: number }>();
    for (const s of samples) {
      if (!(eye.y > s.y + 0.05)) continue;
      probe.set(s.x, s.y, s.z, 1).applyMatrix4(viewProjection);
      if (!(probe.w > 0) || Math.abs(probe.x / probe.w) > 1.05 || Math.abs(probe.y / probe.w) > 1.05) continue;
      const key = Math.round(s.y / 0.05), d2 = (s.x - eye.x) ** 2 + (s.y - eye.y) ** 2 + (s.z - eye.z) ** 2;
      const entry = score.get(key) ?? { id: s.id, level: s.y, weight: 0, sum: 0 };
      const w = s.weight / Math.max(d2, 1);
      entry.weight += w; entry.sum += w * s.y; entry.level = entry.sum / entry.weight;
      if (s.id < entry.id) entry.id = s.id;
      score.set(key, entry);
    }
    let best: { id: string; level: number; weight: number; sum: number } | null = null;
    for (const entry of score.values()) if (!best || entry.weight > best.weight || (entry.weight === best.weight && entry.id < best.id)) best = entry;
    return best && { id: best.id, level: best.level };
  }

  function setContacts(contacts: readonly WaterContact[]): void {
    if (contacts.length > CONTACT_CAP) throw new RangeError(`At most ${CONTACT_CAP} water contacts; got ${contacts.length}`);
    // Every contact is checked before any is written, so a rejected set leaves the previous one intact.
    for (const contact of contacts) {
      const b = contact.b ?? contact.a;
      if (![...contact.a, ...b, contact.radius, contact.strength].every(Number.isFinite) || contact.radius < 0)
        throw new RangeError('A water contact must be finite with a non-negative radius');
    }
    contacts.forEach((contact, i) => {
      const b = contact.b ?? contact.a;
      shared.uContactA.value[i]!.set(contact.a[0], contact.a[1], b[0], b[1]);
      shared.uContactB.value[i]!.set(contact.radius, Math.min(1, Math.max(0, contact.strength)));
    });
    contactCount = contacts.length;
    shared.uContactCount.value = contactCount;
  }
  setContacts(options.contacts ?? []);

  let disposed = false;
  return {
    root,
    /** Sets this frame's sky, motion, chosen plane and pillars. Pure in `frame`: a backward seek gives the same uniforms. */
    update(frame: WaterSurfaceFrame): void {
      if (disposed) return;
      const env = frame.environment, phases = waterPhases(frame.time);
      shared.uWind.value.set(...phases.wind);
      shared.uFlowPhase.value.set(...phases.flow);
      shared.uFlowOffset0.value.set(...phases.offsets[0]); shared.uFlowOffset1.value.set(...phases.offsets[1]);
      shared.uZenith.value.set(env.zenith); shared.uHorizon.value.set(env.horizon); shared.uGlow.value.set(env.glow);
      shared.uSun.value.set(env.sun); shared.uSunDirection.value.fromArray(env.sunDirection).normalize();
      shared.uAmbient.value.set(env.ambient); shared.uFog.value.set(env.fog);
      shared.uSunIntensity.value = env.sunIntensity; shared.uAmbientIntensity.value = env.ambientIntensity;
      shared.uNight.value = env.night; shared.uFogDensity.value = env.fogDensity * 0.72;

      const camera = frame.camera;
      camera.updateMatrixWorld();
      if ('matrixWorldInverse' in camera) (camera as THREE.Camera).matrixWorldInverse.copy(camera.matrixWorld).invert();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      eye.setFromMatrixPosition(camera.matrixWorld);
      plane = choosePlane();
      // Last frame's reflection is never reused: until `reflect` succeeds this frame, water takes the reduced path.
      shared.uReflectValid.value = 0;
      selection = plane
        ? selectPillars(frame.sources, { eye: [eye.x, eye.y, eye.z], viewProjection: viewProjection.elements }, plane.level, query)
        : { pillars: [], considered: frame.sources.length, rejected: { dark: 0, below: 0, offView: frame.sources.length, dry: 0, facing: 0 }, dropped: 0 };
      selection.pillars.forEach((pillar, i) => {
        shared.uPillarPos.value[i]!.set(...pillar.position, pillar.strength);
        shared.uPillarShape.value[i]!.set(pillar.halfAngle, pillar.kind === 'beacon' ? 0.2 : pillar.kind === 'lamp' ? 0.09 : 0.065, pillar.kind === 'beacon' ? 2 : pillar.kind === 'lamp' ? 1 : 0, 0);
      });
      shared.uPillarCount.value = selection.pillars.length;
    },
    /** W-M3: the host's single reflection pass for this frame, before its normal render. */
    reflect(frame: ReflectionFrame): ReflectionReport {
      if (disposed) return { rendered: false, valid: false, reason: 'reduced' };
      if (!plane) return { rendered: false, valid: false, reason: 'below' };
      const report = reflection.render(frame, plane.level, [root]);
      const ok = report.valid && reflection.valid && reflection.texture !== null;
      shared.uReflection.value = ok ? reflection.texture : blank;
      shared.uReflectValid.value = ok ? 1 : 0;
      shared.uReflectLevel.value = plane.level;
      return report;
    },
    setQuality(next: WaterQuality): void {
      if (next !== 'full' && next !== 'reduced') throw new RangeError(`Unknown water quality "${String(next)}"`);
      quality = next; reflection.setMode(next);
      if (next === 'reduced') { shared.uReflectValid.value = 0; shared.uReflection.value = blank; }
    },
    setContacts,
    /** The supplied water at a point, as the surface draws it. */
    waterAt: query,
    /** Is (x, z) inside basin `id`'s supplied outline? */
    insideBasin(id: string, x: number, z: number): boolean { const body = bodies.find(b => b.id === id); return !!body && basinDistance(body, x, z) < 1; },
    diagnostics(): WaterSurfaceDiagnostics {
      let triangles = 0;
      for (const mesh of meshes) triangles += (mesh.geometry.index?.count ?? 0) / 3;
      return {
        quality, reflection: reflection.diagnostics, plane,
        pillars: { cap: PILLAR_CAP, drawn: selection.pillars.length, considered: selection.considered, dropped: selection.dropped, rejected: selection.rejected },
        contacts: { cap: CONTACT_CAP, count: contactCount },
        bytes: { ground: ground.data.byteLength, reflection: reflection.diagnostics.targetBytes },
        meshes: meshes.length, triangles,
      };
    },
    /** Disposes only what the surface made; removes its root from wherever the caller put it. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const made of materials) made.dispose();
      heights.dispose(); blank.dispose(); reflection.dispose();
    },
  };
}
export type WaterSurface = ReturnType<typeof createWaterSurface>;
