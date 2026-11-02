import { Box3, MathUtils, Spherical, Vector3 } from 'three';
import type { Vec3 } from '@chatdom/shared';

export interface OverviewView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export interface OverviewLimits {
  readonly minPitch: number; readonly maxPitch: number;
  readonly minDistance: number; readonly maxDistance: number;
}
export interface OverviewFrame { readonly bounds: Box3; readonly initial: OverviewView; readonly limits: OverviewLimits }

/** All coordinates are already in installed-world space (the hosted bounds include its seat offset). */
export function overviewFrame(bounds: Box3, settlement: Box3, aspect: number): OverviewFrame {
  if (bounds.isEmpty() || settlement.isEmpty() || ![...bounds.min, ...bounds.max, ...settlement.min, ...settlement.max, aspect].every(Number.isFinite) || aspect <= 0) throw new Error('Overview needs finite installed bounds');
  const size = bounds.getSize(new Vector3()), inhabited = settlement.getSize(new Vector3());
  const span = Math.max(1, Math.hypot(inhabited.x, inhabited.z));
  const limits: OverviewLimits = { minPitch: .18, maxPitch: 1.3, minDistance: Math.max(24, span * .08), maxDistance: Math.max(100, size.length() * 1.5) };
  const target = bounds.clampPoint(settlement.getCenter(new Vector3()), new Vector3());
  // Fit the physical town in the limiting screen dimension and leave space for the actual wider land.
  const distance = MathUtils.clamp(Math.max(span * .85, Math.hypot(size.x, size.z) * .28) / Math.min(1, aspect), limits.minDistance, limits.maxDistance);
  const eye = target.clone().add(new Vector3().setFromSpherical(new Spherical(distance, Math.PI / 2 - .57, -.45)));
  return { bounds: bounds.clone(), limits, initial: { eye: eye.toArray() as Vec3, target: target.toArray() as Vec3, fov: 43 } };
}

/** Reject malformed public input atomically; clamp legitimate but out-of-range saved poses. */
export function boundedOverviewView(frame: OverviewFrame, view: OverviewView): OverviewView {
  if (view.eye.length !== 3 || view.target.length !== 3 || ![...view.eye, ...view.target, view.fov].every(Number.isFinite) || view.fov < 10 || view.fov > 100 || Math.hypot(...view.eye.map((v, i) => v - view.target[i]!)) < .01) throw new Error('Overview needs a finite distinct view');
  const offset = new Vector3(...view.eye).sub(new Vector3(...view.target));
  if (![...offset, Math.hypot(...offset)].every(Number.isFinite)) throw new Error('Overview needs a finite distinct view');
  const spherical = new Spherical().setFromVector3(offset), { limits } = frame;
  spherical.radius = MathUtils.clamp(spherical.radius, limits.minDistance, limits.maxDistance);
  spherical.phi = MathUtils.clamp(spherical.phi, Math.PI / 2 - limits.maxPitch, Math.PI / 2 - limits.minPitch);
  const target = frame.bounds.clampPoint(new Vector3(...view.target), new Vector3());
  const eye = new Vector3().setFromSpherical(spherical).add(target);
  return { eye: eye.toArray() as Vec3, target: target.toArray() as Vec3, fov: view.fov };
}

export function orbitOverviewView(frame: OverviewFrame, view: OverviewView, yaw: number | null, pitch: number | null, distance: number | null): OverviewView {
  if ([yaw, pitch, distance].some(value => value !== null && !Number.isFinite(value))) throw new Error('Overview orbit needs finite values or null');
  const offset = new Spherical().setFromVector3(new Vector3(...view.eye).sub(new Vector3(...view.target)));
  offset.theta = yaw === null ? offset.theta : MathUtils.euclideanModulo(yaw + Math.PI, Math.PI * 2) - Math.PI;
  offset.phi = pitch === null ? offset.phi : Math.PI / 2 - MathUtils.clamp(pitch, frame.limits.minPitch, frame.limits.maxPitch);
  offset.radius = distance === null ? offset.radius : MathUtils.clamp(distance, frame.limits.minDistance, frame.limits.maxDistance);
  return boundedOverviewView(frame, { eye: new Vector3().setFromSpherical(offset).add(new Vector3(...view.target)).toArray() as Vec3, target: view.target, fov: view.fov });
}
