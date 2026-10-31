import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import { emberPose, emptyPose, fireflyPose, type GlowPose } from './ambient';
import { EFFECTS_BUDGET, glowCapacity, isQuality } from './budget';
import { GlowLayer } from './glow-layer';
import { hashString, seedHash, slotKey } from './random';
import type { Effects, EffectsDiagnostics, EffectsFrame, EffectsQuality, EffectSource } from './types';

export type { Effects, EffectsDiagnostics, EffectsFrame, EffectsQuality, EffectSource, FlightCue, FlightSample, ShaftSource, SparkBurst } from './types';
export { EFFECTS_BUDGET, EFFECTS_QUALITIES, glowCapacity } from './budget';

const KIND = { firefly: 0x1f1e, ember: 0xe3b0 } as const;
type Kind = keyof typeof KIND;
const POSE: Record<Kind, (key: number, x: number, y: number, z: number, time: number, wx: number, wz: number, out: GlowPose) => boolean> = {
  firefly: fireflyPose, ember: emberPose,
};
/** How far a kind's particles can stray from their source, for view culling (embers add their wind carry). */
const SPREAD: Record<Kind, number> = { firefly: 3.6, ember: 3 };
const MAX_ID_LENGTH = 256;
const MAX_SOURCES = Math.max(...Object.values(EFFECTS_BUDGET).flatMap(b => [b.fireflies.sources, b.embers.sources]));

interface Picked { id: string; key: number; x: number; y: number; z: number; distance: number }

const finiteVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);

/**
 * The effects library: one deterministic vocabulary of small lights and air for the existing HDR scene. The caller
 * owns the scene, camera and every input; this owns one transparent draw per particle family and nothing else.
 */
export function createEffects(options: { scene: THREE.Scene; camera: THREE.Camera; seed: number; quality: EffectsQuality }): Effects {
  const { scene, camera } = options;
  const seed = seedHash(options.seed);
  let quality: EffectsQuality = isQuality(options.quality) ? options.quality : 'balanced';
  let disposed = false, idle = true;
  const glow = new GlowLayer(glowCapacity(quality), EFFECTS_BUDGET[quality].pixels);
  scene.add(glow.mesh);

  const keys = new Map<string, number>();
  const sourceKey = (id: string) => {
    let key = keys.get(id);
    if (key === undefined) {
      if (keys.size >= 4096) keys.clear();
      key = hashString(id); keys.set(id, key);
    }
    return key;
  };
  const picked: Picked[] = Array.from({ length: MAX_SOURCES }, () => ({ id: '', key: 0, x: 0, y: 0, z: 0, distance: 0 }));
  const seen = new Set<string>();
  const pose = emptyPose();
  const eye = new THREE.Vector3(), viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum(), sphere = new THREE.Sphere();
  const counts = { firefly: 0, ember: 0, skipped: 0 };

  /** Keeps the `limit` nearest visible sources, ordered by (distance, id) so input order never matters. */
  function select(sources: readonly EffectSource[] | undefined, limit: number, reach: number, spread: number): number {
    let n = 0;
    seen.clear();
    if (!Array.isArray(sources)) return 0;
    for (const source of sources as readonly unknown[]) {
      const s = source as Partial<EffectSource> | null;
      if (!s || typeof s.id !== 'string' || !s.id || s.id.length > MAX_ID_LENGTH || !finiteVec3(s.position) || seen.has(s.id)) { counts.skipped++; continue; }
      seen.add(s.id);
      const [x, y, z] = s.position;
      const distance = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
      sphere.center.set(x, y, z); sphere.radius = spread;
      if (distance > reach || !frustum.intersectsSphere(sphere)) { counts.skipped++; continue; }
      // Insertion into a short sorted list; anything past the limit is over budget.
      let at = n;
      while (at > 0 && (picked[at - 1]!.distance > distance || (picked[at - 1]!.distance === distance && picked[at - 1]!.id > s.id))) at--;
      if (at >= limit) { counts.skipped++; continue; }
      if (n === limit) counts.skipped++;
      else n++;
      const slot = picked[n - 1]!;
      for (let i = n - 1; i > at; i--) picked[i] = picked[i - 1]!;
      picked[at] = slot;
      slot.id = s.id; slot.key = sourceKey(s.id); slot.x = x; slot.y = y; slot.z = z; slot.distance = distance;
    }
    return n;
  }

  function emit(kind: Kind, sources: readonly EffectSource[] | undefined, time: number, wx: number, wz: number): void {
    const budget = EFFECTS_BUDGET[quality][kind === 'firefly' ? 'fireflies' : 'embers'];
    const spread = SPREAD[kind] + (kind === 'ember' ? Math.min(8, Math.hypot(wx, wz)) * 2.4 : 0);
    const n = select(sources, budget.sources, budget.reach, spread);
    counts[kind] = n;
    for (let s = 0; s < n; s++) {
      const source = picked[s]!;
      const fade = 1 - THREE.MathUtils.smoothstep(source.distance, budget.reach * .8, budget.reach);
      for (let i = 0; i < budget.perSource; i++) {
        if (!POSE[kind](slotKey(seed, KIND[kind], source.key, i), source.x, source.y, source.z, time, wx, wz, pose)) continue;
        pose.alpha *= fade;
        if (pose.alpha > .002) glow.push(pose);
      }
    }
  }

  return {
    update(frame: EffectsFrame): void {
      if (disposed) return;
      counts.firefly = 0; counts.ember = 0; counts.skipped = 0;
      glow.begin();
      idle = !frame || typeof frame !== 'object' || !Number.isFinite(frame.time);
      if (!idle) {
        camera.updateMatrixWorld();
        eye.setFromMatrixPosition(camera.matrixWorld);
        viewProjection.copy(camera.matrixWorld).invert().premultiply(camera.projectionMatrix);
        frustum.setFromProjectionMatrix(viewProjection);
        const wind = finiteVec3(frame.wind) ? frame.wind : [0, 0, 0];
        emit('firefly', frame.fireflies, frame.time, wind[0], wind[2]);
        emit('ember', frame.embers, frame.time, wind[0], wind[2]);
      }
      glow.end();
    },
    setQuality(next: EffectsQuality): void {
      if (disposed || !isQuality(next) || next === quality) return;
      quality = next;
      glow.resize(glowCapacity(quality), EFFECTS_BUDGET[quality].pixels);
    },
    reset(): void {
      if (disposed) return;
      glow.clear();
      idle = true;
      counts.firefly = 0; counts.ember = 0; counts.skipped = 0;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      glow.dispose();
      keys.clear(); seen.clear();
    },
    diagnostics(): EffectsDiagnostics {
      const max = EFFECTS_BUDGET[quality].pixels.max;
      return {
        quality, disposed, idle,
        glow: { capacity: glow.capacity, count: glow.drawn, fireflySources: counts.firefly, emberSources: counts.ember,
          skipped: counts.skipped, maxCoveragePixels: glow.drawn * max * max },
      };
    },
  };
}
