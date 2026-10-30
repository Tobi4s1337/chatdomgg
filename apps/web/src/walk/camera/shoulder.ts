import * as THREE from 'three';
import { angleBetween, wrapAngle } from '../input/direction';

/**
 * The walking camera: a shoulder view that leaves the street open ahead, and the same boom shortened
 * continuously by the wheel until the eye sits in the citizen's head. Presentation only: it reads the
 * rendered pose and never feeds back into the shared step.
 *
 * Composition is done in the lens. The aim pivot sits on the optical axis directly above the citizen,
 * high enough that the body lands in the lower third, and `filmOffset` slides the image so the citizen
 * stands on the left third line. Because the whole image shifts, the vanishing point of "forward" sits in
 * the same column as the citizen: W walks them straight into the picture rather than across it.
 */
export const SHOULDER = {
  /** First-person eye above the feet. WALK_BODY is 1.75 m tall; eyes sit a little under the crown. */
  eyeHeight: 1.6,
  /** The body point that is composed onto the thirds. */
  bodyCentre: .9,
  /** Entry boom. The citizen fills about a quarter of the height: readable, with the kingdom large around them. */
  distance: 6.5,
  maxDistance: 11,
  /** A gentle downward look: the street to the horizon, without verticals leaning hard at the far edge. */
  pitch: .18,
  minPitch: -.5,
  maxPitch: 1.1,
  /** Between these boom lengths the framing blends from first person (no offset, eye pivot) to the shoulder. */
  blendNear: .3,
  blendFar: 2.6,
  /** Wider than tall: thirds in landscape. Taller than wide: a little more centred and a wider lens. */
  landscape: { fov: 50, screenX: -.333, screenY: -.38 },
  portrait: { fov: 64, screenX: -.32, screenY: -.38 },
  /** Orbit radians per viewport height of drag. */
  orbitYaw: 2.6,
  orbitPitch: 1.7,
  /** Zoom parameter per wheel pixel; distance is maxDistance × z², so the last metre is finely controlled. */
  wheelZoom: .0007,
  /** Auto-follow waits this long after a manual orbit, then swings gently behind the walk. */
  followDelay: 1.5,
  followRate: .85,
  /** Exponential rates per second for presentation easing. */
  distanceRate: 14,
  heightRate: 12,
  /** The eased camera height never trails the body by more than this. */
  heightLag: .45,
} as const;

export type Vec3 = readonly [number, number, number];
export interface ShoulderView { readonly yaw: number; readonly pitch: number; readonly distance: number }
export interface ShoulderPose {
  readonly eye: Vec3;
  /** Unit look direction. Roll is always zero, so the horizon stays level. */
  readonly direction: Vec3;
  readonly fov: number;
  /** Fraction of the half-width the image is shifted; the aim column sits at NDC x = -shift. */
  readonly shift: number;
  /** Opacity for the local citizen: it fades out as the eye enters the head and returns on zoom out. */
  readonly selfOpacity: number;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Framing for an aspect ratio, blended between portrait and landscape so a rotating phone never jumps. */
export function framingFor(aspect: number): { fov: number; screenX: number; screenY: number } {
  const t = smoothstep(.75, 1.2, Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const { portrait: p, landscape: l } = SHOULDER;
  return { fov: lerp(p.fov, l.fov), screenX: lerp(p.screenX, l.screenX), screenY: lerp(p.screenY, l.screenY) };
}

/** Pure camera placement for feet at `feet`, the given view and aspect. */
export function shoulderPose(feet: Vec3, view: ShoulderView, aspect: number): ShoulderPose {
  const frame = framingFor(aspect);
  const d = Math.max(0, view.distance);
  const blend = smoothstep(SHOULDER.blendNear, SHOULDER.blendFar, d);
  const tan = Math.tan(THREE.MathUtils.degToRad(frame.fov) / 2);
  const sinPitch = Math.sin(view.pitch), cosPitch = Math.cos(view.pitch);
  // Body centre at NDC y = -lift: lift·tan·(d − δ·sinφ) = −δ·cosφ for δ = bodyCentre − pivot.
  const lift = -frame.screenY * blend;
  const framed = SHOULDER.bodyCentre + lift * tan * d / Math.max(.2, cosPitch - lift * tan * sinPitch);
  const pivotHeight = SHOULDER.eyeHeight + (framed - SHOULDER.eyeHeight) * blend;
  const direction: Vec3 = [Math.sin(view.yaw) * cosPitch, -sinPitch, Math.cos(view.yaw) * cosPitch];
  const eye: Vec3 = [feet[0] - direction[0] * d, feet[1] + pivotHeight - direction[1] * d, feet[2] - direction[2] * d];
  return { eye, direction, fov: frame.fov, shift: -frame.screenX * blend, selfOpacity: smoothstep(.5, 1.25, d) };
}

/** The `filmOffset` (millimetres of film) that shifts the image by `shift` of its half-width. */
export function filmOffsetFor(camera: THREE.PerspectiveCamera, shift: number, aspect = camera.aspect): number {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
  return shift * aspect * tan * camera.filmGauge * Math.min(aspect, 1);
}

export interface ShoulderRig {
  /** The view being drawn, after easing. */
  readonly view: ShoulderView;
  /** Where the wheel asked the boom to be; easing and later occlusion never overwrite it. */
  readonly desiredDistance: number;
  /** Seconds since the last manual orbit. */
  readonly idle: number;
  /** Drag in CSS pixels against a viewport of `viewportHeight` CSS pixels. */
  orbit(dx: number, dy: number, viewportHeight: number): void;
  /** Wheel pixels; positive pulls back, negative leans in down to first person. */
  zoom(pixels: number): void;
  /** Advance presentation easing and auto-follow behind `travelHeading` while moving at `speed` m/s. */
  update(dt: number, travelHeading: number | null, speed: number, holding: boolean): void;
  /** Place `camera` for the citizen's rendered feet. */
  apply(camera: THREE.PerspectiveCamera, feet: Vec3, aspect: number): ShoulderPose;
  /** Entry framing behind `heading`, with all eased state dropped. */
  reset(heading: number): void;
  /** Keep the chosen view but drop easing, so the next frame lands exactly on the citizen (camera handed back). */
  settle(): void;
}

export function createShoulderRig(heading = 0): ShoulderRig {
  let yaw = wrapAngle(heading), pitch: number = SHOULDER.pitch, zoomT = Math.sqrt(SHOULDER.distance / SHOULDER.maxDistance);
  let distance: number = SHOULDER.distance, idle = Infinity, followY: number | null = null, lastStep = 0;
  const desired = () => SHOULDER.maxDistance * zoomT * zoomT;
  const look = new THREE.Vector3();
  return {
    get view() { return { yaw, pitch, distance }; },
    get desiredDistance() { return desired(); },
    get idle() { return idle; },
    orbit(dx, dy, viewportHeight) {
      const h = Math.max(1, viewportHeight);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
      // Dragging right turns the view right; dragging up looks up.
      yaw = wrapAngle(yaw - dx / h * SHOULDER.orbitYaw);
      pitch = Math.max(SHOULDER.minPitch, Math.min(SHOULDER.maxPitch, pitch + dy / h * SHOULDER.orbitPitch));
      idle = 0;
    },
    zoom(pixels) {
      if (!Number.isFinite(pixels) || !pixels) return;
      zoomT = Math.max(0, Math.min(1, zoomT + pixels * SHOULDER.wheelZoom));
    },
    update(dt, travelHeading, speed, holding) {
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
      lastStep = step;
      if (holding) idle = 0; else idle += step;
      const target = desired();
      distance += (target - distance) * (1 - Math.exp(-SHOULDER.distanceRate * step));
      if (Math.abs(target - distance) < 1e-4) distance = target;
      if (travelHeading === null || idle < SHOULDER.followDelay || !(speed > .5)) return;
      // Swing behind the walk, never through a reversal: walking back toward the camera keeps the view.
      const delta = angleBetween(yaw, travelHeading);
      if (Math.abs(delta) > 2) return;
      yaw = wrapAngle(yaw + delta * (1 - Math.exp(-SHOULDER.followRate * Math.min(1, speed / 4) * step)));
    },
    apply(camera, feet, aspect) {
      if (followY === null) followY = feet[1];
      else {
        followY = Math.max(feet[1] - SHOULDER.heightLag, Math.min(feet[1] + SHOULDER.heightLag, followY));
        followY += (feet[1] - followY) * (1 - Math.exp(-SHOULDER.heightRate * lastStep));
      }
      const pose = shoulderPose([feet[0], followY, feet[2]], { yaw, pitch, distance }, aspect);
      camera.position.set(...pose.eye);
      camera.up.set(0, 1, 0);
      camera.lookAt(look.set(pose.eye[0] + pose.direction[0], pose.eye[1] + pose.direction[1], pose.eye[2] + pose.direction[2]));
      const changedFov = Math.abs(camera.fov - pose.fov) > 1e-6 || Math.abs(camera.aspect - aspect) > 1e-6;
      camera.fov = pose.fov; camera.aspect = aspect;
      const film = filmOffsetFor(camera, pose.shift, aspect);
      if (changedFov || Math.abs(camera.filmOffset - film) > 1e-6) { camera.filmOffset = film; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld();
      return pose;
    },
    reset(value) {
      yaw = wrapAngle(value); pitch = SHOULDER.pitch; idle = Infinity; followY = null;
      zoomT = Math.sqrt(SHOULDER.distance / SHOULDER.maxDistance); distance = SHOULDER.distance;
    },
    settle() { followY = null; distance = desired(); idle = Infinity; },
  };
}
