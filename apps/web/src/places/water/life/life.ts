import * as THREE from 'three';
import { geometryFromChunks, type Environment } from '@chatdom/render';
import type { MaterialRegistry, Vec3, VoxelAsset } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { PlacedEmitter } from '../../../../../../packages/world/src/places/water/anchors';
import { createCritter, type Critter, type CritterKind } from '../../../../../../packages/content/src/places/water/critters/index';
import type { WaterLightSource } from '../surface/pillars';
import { RING_CAP, RING_LIFE, ringsAt, soundsBetween, type WaterLifeSound } from './events';
import { FLOATER_CAP, assertFloater, floaterAt, floaterKey, floaterTrack, liveFloaters, type FloaterAction, type FloaterTrack } from './floaters';
import type { Habitat } from './habitat';
import { fireflies, flourDust, glowTexture, mist, rings, splash, SPLASH_LIFE, weirSpray, wheelSpray, type DustInput, type WeirSprayInput } from './layers';
import { planWaterLife, type LifePlan } from './plan';
import {
  boatSway, dragonflyPose, duckPose, FISH_AIRTIME, fishInAir, fishJump, fishLanding, fishPose, FISH_SLOT, heronPose, kingfisherPose,
  noonPresence, restingPose, wheelAngle, WHEEL_RPM, type Pose,
} from './poses';
import { seedOf } from './random';

/** Avatar-lattice cell, metres: the creatures' own scale. */
const H = 0.0625;

/** A turning wheel the caller has placed: its object, and the axle pivot/axis in that object's parent space. */
export interface WheelMount {
  readonly object: THREE.Object3D;
  readonly pivot: Vec3;
  readonly axis: Vec3;
  /** Rim radius and bucket width, metres; the tail water's level below it. */
  readonly radius: number;
  readonly width: number;
  readonly level: number;
}
/** A moored boat the caller has placed, and where its painter is tied, in the object's parent space. */
export interface BoatMount { readonly object: THREE.Object3D; readonly tether: Vec3 }

export interface WaterLifeOptions {
  /** The caller's whole-number seed (the kingdom's). */
  readonly seed: number;
  readonly habitat: Habitat;
  /** Reed beds' footing centres, from the placed shore pieces: the heron, dragonflies and fireflies keep to them. */
  readonly reeds: readonly Vec3[];
  /** Caller-owned: the avatar-lattice voxel material, the worker pool and the registry its jobs mesh with. */
  readonly critters: { readonly material: THREE.Material; readonly pool: VoxelWorkerPool; readonly registry: MaterialRegistry };
  readonly wheels?: readonly WheelMount[];
  readonly boats?: readonly BoatMount[];
  readonly weirs?: readonly WeirSprayInput[];
  /** Mill doors flour dust drifts from: the door's face centre and its outward normal. */
  readonly doors?: readonly DustInput[];
  /** The place's physical lamps (placed piece emitters); they show only the strengths the host resolves. */
  readonly lamps?: readonly PlacedEmitter[];
}

export interface WaterLifeFrame {
  /** Caller seconds; everything is a pure function of it. */
  readonly time: number;
  /** Kingdom hour [0, 24): which creatures keep which hours. */
  readonly hour: number;
  readonly environment: Environment;
  readonly camera: THREE.Camera;
  /**
   * Each lamp's strength 0..1 by emitter id, as the host resolved it through the shared people-light helper and
   * its hour curve. A lamp the host does not mention is dark. Nothing here decides whether anyone is near.
   */
  readonly lamps: ReadonlyMap<string, number>;
  /** The caller's finite floater actions; the newest `FLOATER_CAP` alive are drawn. */
  readonly floaters: readonly FloaterAction[];
}

/** A float's label anchor for the host's approved text treatment: the caller's own text, never rewritten. */
export interface FloaterLabel { readonly id: string; readonly label: string; readonly position: Vec3; readonly opacity: number }

export interface WaterLifeDiagnostics {
  readonly ready: boolean;
  readonly error: string | null;
  readonly ducks: { readonly pairs: number; readonly skipped: readonly string[] };
  readonly heron: boolean;
  readonly fishWaters: number;
  readonly flights: number;
  readonly dragonflies: number;
  readonly fireflies: number;
  readonly rings: { readonly cap: number; readonly drawn: number; readonly wanted: number };
  readonly floaters: { readonly cap: number; readonly drawn: number; readonly dropped: number; readonly tracks: number };
  readonly lamps: number;
  /** Meshes, point clouds and sprites this layer owns, and the triangles of its creature meshes. */
  readonly objects: number;
  readonly creatureTriangles: number;
}

interface Rig { readonly root: THREE.Group; readonly head?: THREE.Group; readonly wings: readonly [THREE.Group, THREE.Group] | null; readonly pose: Pose }

const smoothstep = THREE.MathUtils.smoothstep;
/** Fireflies come out at dusk and go before dawn. */
export const fireflyAmount = (hour: number) => (hour >= 12 ? smoothstep(hour, 19.2, 20.6) : 1 - smoothstep(hour, 4, 5.5));
/** Mist gathers from hour 21 and burns off after dawn. */
export const mistAmount = (hour: number) => (hour >= 12 ? smoothstep(hour, 21, 22.2) : 1 - smoothstep(hour, 5, 6.5));

/**
 * The water's life: wild ducks in pairs, a heron in the reeds, a fish breaking the surface, the kingfisher's
 * flash, noon dragonflies and dusk fireflies; the wheel's turn and spray, moored boats' sway, weir spray, flour
 * dust, rings, low night mist; the place's lamps showing the host's people-light strengths, and the caller's
 * floaters. Everything is planned once from the caller's habitat and seed and posed from the caller's time.
 *
 * Host order each frame: `update(frame)` before the water's reflection pass, so the reflection sees the same
 * creatures; pass `exclusions` to that pass (glows and mist reflect through the water's own light sources).
 * Caller-owned material, pool, wheels and boats survive `dispose()`; wheels and boats get their placed matrices back.
 */
export function createWaterLife(options: WaterLifeOptions) {
  const seed = seedOf(options.seed), habitat = options.habitat;
  const plan: LifePlan = planWaterLife(habitat, options.reeds, seed);
  const root = new THREE.Group(); root.name = 'water-life';
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(thing: T) => { owned.push(thing); return thing; };
  let objects = 0, creatureTriangles = 0, error: string | null = null, ready = false, disposed = false;

  // ── Creatures: one meshed geometry per part, shared by every bird of a kind. ───────────────────────────────────
  const kinds = new Map<string, Critter>();
  const critter = (kind: CritterKind, variant: 0 | 1 | 2 = 0) => {
    const key = `${kind}:${variant}`;
    let c = kinds.get(key);
    if (!c) kinds.set(key, c = createCritter(kind, variant));
    return c;
  };
  const geometries = new Map<VoxelAsset, Promise<THREE.BufferGeometry>>();
  const mesh = (asset: VoxelAsset) => {
    let pending = geometries.get(asset);
    if (!pending) {
      pending = options.critters.pool.submit({ kind: 'asset', asset, materials: options.critters.registry.materials, materialRevision: options.critters.registry.revision }).then(result => {
        if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${asset.id}`);
        return geometryFromChunks(result.chunks, 'avatar');
      });
      geometries.set(asset, pending);
    }
    return pending;
  };
  const builds: Promise<void>[] = [];
  /** A rig: a root at the body's pivot, a head and wings at their attachments, meshes hung from their pivots. */
  const rig = (c: Critter, name: string): Rig => {
    const body = c.parts[0]!, group = new THREE.Group(); group.name = name; group.rotation.order = 'YXZ'; group.visible = false;
    const joint = (part: Critter['parts'][number]) => {
      const node = part === body ? group : new THREE.Group();
      if (part !== body) { node.position.set((part.attach[0] - body.pivot[0]) * H, (part.attach[1] - body.pivot[1]) * H, (part.attach[2] - body.pivot[2]) * H); node.rotation.order = 'YXZ'; group.add(node); }
      builds.push(mesh(part.asset).then(geometry => {
        if (disposed) return;
        const m = new THREE.Mesh(geometry, options.critters.material);
        m.name = `${name}:${part.id}`; m.position.set(-part.pivot[0] * H, -part.pivot[1] * H, -part.pivot[2] * H);
        node.add(m); objects++; creatureTriangles += (geometry.index?.count ?? 0) / 3;
      }));
      return node;
    };
    let head: THREE.Group | undefined, left: THREE.Group | undefined, right: THREE.Group | undefined;
    for (const part of c.parts) {
      const node = joint(part);
      if (part.id === 'head') head = node; else if (part.id === 'wing-left') left = node; else if (part.id === 'wing-right') right = node;
    }
    root.add(group);
    return { root: group, ...(head ? { head } : {}), wings: left && right ? [left, right] : null, pose: restingPose() };
  };

  const ducks = plan.ducks.map(pair => {
    const variant = (pair.index % 3) as 0 | 1 | 2;
    const lead = rig(critter(pair.leader, variant), `${pair.id}:lead`), follow = rig(critter(pair.leader === 'hen' ? 'drake' : 'hen', variant), `${pair.id}:follow`);
    return { pair, birds: [lead, follow] as const };
  });
  const heron = plan.heron ? rig(critter('heron'), 'heron') : null;
  const fish = plan.fishWaters.length ? rig(critter('trout'), 'trout') : null;
  const kingfisher = plan.flights.length ? rig(critter('kingfisher'), 'kingfisher') : null;
  const dragonflies = plan.dragonflies.map((home, i) => ({ home, rig: rig(critter('dragonfly', (i % 3) as 0 | 1 | 2), home.id) }));

  // ── Floaters: a fixed pool of floats and glows. ────────────────────────────────────────────────────────────────
  const texture = own(glowTexture());
  const glow = (name: string) => {
    const material = own(new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const sprite = new THREE.Sprite(material); sprite.name = name; sprite.renderOrder = 7; sprite.visible = false; root.add(sprite); objects++;
    return sprite;
  };
  const floaterKind = critter('floater');
  const floats = Array.from({ length: FLOATER_CAP }, (_, i) => ({ rig: rig(critter('floater', (i % 3) as 0 | 1 | 2), `floater:${i}`), glow: glow(`floater:${i}:glow`) }));
  const tracks = new Map<string, FloaterTrack | null>();
  const labels: FloaterLabel[] = [];
  const lantern = floaterKind.light ?? floaterKind.parts[0]!.pivot;
  const lanternOffset = new THREE.Vector3((lantern[0] - floaterKind.parts[0]!.pivot[0]) * H, (lantern[1] - floaterKind.parts[0]!.pivot[1]) * H, (lantern[2] - floaterKind.parts[0]!.pivot[2]) * H);
  let floaterStats = { drawn: 0, dropped: 0 };

  // ── Lamps: a glow at each lamp's glass, as bright as the host says. ───────────────────────────────────────────
  const lamps = (options.lamps ?? []).map(emitter => ({ emitter, glow: glow(`lamp:${emitter.id}`), strength: 0, at: new THREE.Vector3(...emitter.position) }));
  const sources: WaterLightSource[] = [];

  // ── Motes, rings and mist. ────────────────────────────────────────────────────────────────────────────────────
  const clouds = [
    ...(plan.fireflies.length ? [{ kind: 'fireflies' as const, m: fireflies(plan.fireflies, seed) }] : []),
    ...(options.wheels ?? []).map((w, i) => ({ kind: 'spray' as const, m: wheelSpray({ ...w, omega: (Math.PI * 2 * WHEEL_RPM) / 60 }, seed, i) })),
    ...(options.weirs ?? []).map((w, i) => ({ kind: 'weir' as const, m: weirSpray(w, seed, i) })),
    ...(options.doors ?? []).map((d, i) => ({ kind: 'dust' as const, m: flourDust(d, seed, i) })),
    ...(fish ? [{ kind: 'splash' as const, m: splash(seed) }] : []),
  ];
  for (const { m } of clouds) { root.add(m.points); own(m.points.geometry); own(m.points.material as THREE.Material); objects++; }
  const ringLayer = rings(); root.add(ringLayer.mesh); own(ringLayer.mesh.geometry); own(ringLayer.mesh.material as THREE.Material); objects++;
  const mists = mist(habitat.bodies, habitat.reaches);
  for (const m of mists.meshes) { root.add(m); own(m.geometry); objects++; }
  if (mists.meshes[0]) own(mists.meshes[0].material as THREE.Material);

  // ── Caller-placed wheels and boats: remember their placed matrices, then move them about their mounts. ─────────
  const movers = [
    ...(options.wheels ?? []).map((w, i) => ({ object: w.object, base: w.object.matrix.clone(), auto: w.object.matrixAutoUpdate, kind: 'wheel' as const, i, w })),
    ...(options.boats ?? []).map((b, i) => ({ object: b.object, base: b.object.matrix.clone(), auto: b.object.matrixAutoUpdate, kind: 'boat' as const, i, b,
      centre: new THREE.Box3().setFromObject(b.object).getCenter(new THREE.Vector3()) })),
  ];
  for (const m of movers) { if (m.auto) m.object.updateMatrix(); m.base.copy(m.object.matrix); m.object.matrixAutoUpdate = false; }

  const readyPromise = Promise.all(builds).then(() => { ready = !disposed; }, (e: unknown) => { error = e instanceof Error ? e.message : String(e); throw e; });

  const pose = (r: Rig) => {
    const p = r.pose;
    r.root.visible = p.visible && ready;
    if (!r.root.visible) return;
    r.root.position.set(p.x, p.y, p.z); r.root.rotation.set(p.pitch, p.yaw, p.roll);
    if (r.head) r.head.rotation.set(p.headPitch, p.headYaw, 0);
    if (r.wings) { r.wings[0].rotation.set(0, 0, p.wing); r.wings[1].rotation.set(0, 0, -p.wing); }
  };
  const m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4(), m4c = new THREE.Matrix4(), axis = new THREE.Vector3(), towards = new THREE.Vector3(), eye = new THREE.Vector3(), back = new THREE.Vector3();
  const sway = new THREE.Euler(), colour = new THREE.Color(), white = new THREE.Color(1, 1, 1);
  const sheets = mists.meshes.map(m => ({ m, d: 0 }));
  const floatAt = { position: [0, 0, 0] as [number, number, number], light: 0 };
  let ringStats = { drawn: 0, wanted: 0 };

  return {
    root,
    /** Resolves once every creature is meshed; rejects (and diagnostics carry the error) if one cannot be. */
    ready: readyPromise,
    plan,
    /** Glows and mist: the host passes these to the water's reflection pass as exclusions. */
    exclusions: [...lamps.map(l => l.glow), ...floats.map(f => f.glow), ...mists.meshes] as readonly THREE.Object3D[],

    update(frame: WaterLifeFrame): void {
      if (disposed) return;
      const { time, hour, environment, camera } = frame;
      if (!Number.isFinite(time)) throw new RangeError('Water life time must be finite seconds');
      if (!(hour >= 0 && hour < 24)) throw new RangeError('Water life hour must lie in [0, 24)');
      camera.getWorldPosition(eye);

      for (const { pair, birds } of ducks) { duckPose(plan, pair, 0, time, birds[0].pose); duckPose(plan, pair, 1, time, birds[1].pose); pose(birds[0]); pose(birds[1]); }
      if (heron && plan.heron) { heronPose(plan, plan.heron, time, heron.pose); pose(heron); }
      const jump = fish ? fishInAir(plan, habitat, time) : null;
      if (fish) { fishPose(jump, time, fish.pose); pose(fish); }
      if (kingfisher) { kingfisherPose(plan, habitat, time, hour, kingfisher.pose); pose(kingfisher); }
      dragonflies.forEach(({ home, rig: r }, i) => { dragonflyPose(plan, habitat, home, i, time, hour, r.pose); pose(r); });

      // The wheel turns about its own axle; moored boats sway about their tethers, each out of step.
      for (const m of movers) {
        if (m.kind === 'wheel') {
          const { pivot } = m.w;
          axis.set(...m.w.axis).normalize();
          m4.makeTranslation(pivot[0], pivot[1], pivot[2]).multiply(m4b.makeRotationAxis(axis, wheelAngle(time))).multiply(m4c.makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
        } else {
          const s = boatSway(seed, m.i, time), [tx, ty, tz] = m.b.tether, c = m.centre;
          // Heave and swing about the tether, then pitch and roll about the hull's own middle.
          m4.makeTranslation(tx, ty + s.heave, tz).multiply(m4b.makeRotationY(s.yaw)).multiply(m4c.makeTranslation(c.x - tx, c.y - ty, c.z - tz))
            .multiply(m4b.makeRotationFromEuler(sway.set(s.pitch, 0, s.roll))).multiply(m4c.makeTranslation(-c.x, -c.y, -c.z));
        }
        m.object.matrix.multiplyMatrices(m4, m.base); m.object.matrixWorldNeedsUpdate = true;
      }

      // Floaters: the caller's live actions, newest first, each on its own integrated track.
      for (const action of frame.floaters) assertFloater(action);
      const { live, dropped } = liveFloaters(frame.floaters, time);
      const keep = new Set(live.map(floaterKey));
      for (const key of tracks.keys()) if (!keep.has(key)) tracks.delete(key);
      labels.length = 0; sources.length = 0;
      let drawn = 0;
      floats.forEach((f, i) => {
        const action = live[i];
        let track: FloaterTrack | null | undefined;
        if (action) { const key = floaterKey(action); track = tracks.get(key); if (track === undefined) tracks.set(key, track = floaterTrack(habitat, seed, action)); }
        const on = !!action && !!track && floaterAt(track, time - action.launched, floatAt);
        f.rig.pose.visible = on;
        if (on) {
          [f.rig.pose.x, f.rig.pose.y, f.rig.pose.z] = floatAt.position;
          f.rig.pose.yaw = (time - action!.launched) * 0.05 + i; f.rig.pose.pitch = 0.03 * Math.sin(time * 1.7 + i); f.rig.pose.roll = 0.03 * Math.sin(time * 1.3 + i);
          drawn++;
          const at = towards.copy(lanternOffset).applyEuler(f.rig.root.rotation.set(f.rig.pose.pitch, f.rig.pose.yaw, f.rig.pose.roll)).add(f.rig.root.position.set(...floatAt.position));
          const light = floatAt.light * (0.4 + 0.6 * environment.night);
          f.glow.visible = ready && light > 0.01;
          f.glow.position.copy(at).addScaledVector(back.copy(eye).sub(at).normalize(), 0.06);
          f.glow.scale.setScalar(0.18 + 0.25 * light); (f.glow.material as THREE.SpriteMaterial).opacity = Math.min(1, light);
          labels.push({ id: action!.id, label: action!.label, position: [at.x, at.y + 0.45, at.z], opacity: floatAt.light });
          sources.push({ position: [at.x, at.y, at.z], strength: 0.3 * light, kind: 'lamp', size: 0.2 });
        } else f.glow.visible = false;
        pose(f.rig);
      });
      floaterStats = { drawn, dropped };

      // Lamps: exactly the strength the host resolved; a lamp left out is dark.
      for (const lamp of lamps) {
        const strength = frame.lamps.get(lamp.emitter.id) ?? 0;
        if (!(strength >= 0 && strength <= 1)) throw new RangeError(`Lamp ${lamp.emitter.id} needs a strength from 0 to 1`);
        lamp.strength = strength;
        // Just outside the glass toward the eye, so the lantern's own frame never hides its light.
        lamp.glow.position.copy(lamp.at).addScaledVector(back.copy(eye).sub(lamp.at).normalize(), 0.3);
        lamp.glow.scale.setScalar(0.3 + 1.5 * strength); (lamp.glow.material as THREE.SpriteMaterial).opacity = Math.min(1, strength * 1.25);
        lamp.glow.visible = strength > 0.005;
        if (strength > 0) sources.push({ position: lamp.emitter.position, strength, kind: 'lamp' });
      }

      // Motes.
      const night = environment.night;
      for (const { kind, m } of clouds) {
        m.uniforms.uTime!.value = time;
        if (kind === 'fireflies') m.uniforms.uAmount!.value = fireflyAmount(hour);
        else if (kind === 'spray') { m.uniforms.uAmount!.value = 0.35 + 0.65 * (1 - night); m.uniforms.uRainbow!.value = noonPresence(hour) * (1 - night); }
        else if (kind === 'weir') m.uniforms.uAmount!.value = 0.35 + 0.65 * (1 - night);
        else if (kind === 'dust') m.uniforms.uAmount!.value = 1 - 0.85 * night;
        else {
          // The splash follows the latest landing, whether or not the fish is still in the air.
          const k = Math.round(time / FISH_SLOT);
          let landing: ReturnType<typeof fishJump> = null;
          for (const slot of [k - 1, k, k + 1]) { const j = fishJump(plan, habitat, slot); if (j && time >= j.start + FISH_AIRTIME && time < j.start + FISH_AIRTIME + SPLASH_LIFE) landing = j; }
          m.uniforms.uAmount!.value = landing ? 1 - 0.5 * night : 0;
          const centre = m.uniforms.uCentre!.value as THREE.Vector3;
          if (landing) { const [x, z] = fishLanding(landing); centre.set(x, landing.level, z); m.uniforms.uStart!.value = landing.start + FISH_AIRTIME; }
          else { centre.set(0, 0, 0); m.uniforms.uStart!.value = -1e6; }
        }
      }
      const { rings: list, wanted } = ringsAt(plan, habitat, frame.floaters, time);
      ringLayer.write(list, time, colour.set(environment.horizon).lerp(white, 0.4), RING_LIFE);
      ringStats = { drawn: list.length, wanted };
      mists.uniforms.uTime.value = time; mists.uniforms.uAmount.value = mistAmount(hour);
      mists.uniforms.uColour.value.set(environment.fog).lerp(colour.set(environment.horizon), 0.35);
      // Nearest sheet first, so where two meet the nearer one's depth keeps the farther from stacking under it.
      for (const sheet of sheets) sheet.d = sheet.m.geometry.boundingSphere!.center.distanceToSquared(eye);
      sheets.sort((a, b) => a.d - b.d).forEach(({ m }, i) => { m.renderOrder = 8 + i * 1e-3; });
    },

    /** Discrete sound hooks in (from, to] for the host's audio mix; a seek or backward step yields none. */
    sounds(from: number, to: number, hour: number, floaters: readonly FloaterAction[] = []): WaterLifeSound[] {
      return soundsBetween(plan, habitat, floaters, from, to, hour);
    },
    /** This frame's lamp and floater light, for the water's reflection inputs and the light field's emitters. */
    sources: (): readonly WaterLightSource[] => sources,
    floaterLabels: (): readonly FloaterLabel[] => labels,

    diagnostics(): WaterLifeDiagnostics {
      return {
        ready, error,
        ducks: { pairs: plan.ducks.length, skipped: plan.skipped }, heron: !!plan.heron, fishWaters: plan.fishWaters.length,
        flights: plan.flights.length, dragonflies: plan.dragonflies.length, fireflies: plan.fireflies.length,
        rings: { cap: RING_CAP, ...ringStats }, floaters: { cap: FLOATER_CAP, ...floaterStats, tracks: tracks.size },
        lamps: lamps.length, objects, creatureTriangles,
      };
    },

    /** Frees only what this layer made. The caller's material, pool, scene, wheels and boats stay theirs. */
    dispose(): void {
      if (disposed) return;
      disposed = true; ready = false;
      for (const m of movers) { m.object.matrix.copy(m.base); m.object.matrixAutoUpdate = m.auto; m.object.matrixWorldNeedsUpdate = true; }
      root.removeFromParent();
      root.clear();
      // Geometries still meshing are disposed as they arrive.
      for (const pending of geometries.values()) void pending.then(g => g.dispose(), () => undefined);
      for (const thing of owned) thing.dispose();
      tracks.clear(); labels.length = 0; sources.length = 0;
    },
  };
}

export type WaterLife = ReturnType<typeof createWaterLife>;
