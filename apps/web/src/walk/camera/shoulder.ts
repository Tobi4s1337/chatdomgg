import * as THREE from 'three';
import { WALK_BODY, type CollisionWorld } from '@chatdom/shared/realm';
import { angleBetween, wrapAngle } from '../input/direction';
import { clearBoom, nearFootprint, RECOVER_RATE, type BoomPoint } from './occlusion';

/**
 * The walking camera: a shoulder view that leaves the street open ahead, and the same boom shortened
 * continuously by the wheel until the eye sits in the citizen's head. Presentation only: it reads the
 * rendered pose and never feeds back into the shared step.
 *
 * Composition is done in the lens. The aim pivot sits on the optical axis directly above the citizen,
 * high enough that the body lands in the lower third, and `filmOffset` slides the image so the citizen
 * stands on the left third line. Closer in, the pivot is held high enough that the head never rises past
 * `headY`, so a short boom (wheeled or pulled in by a wall) is an over-the-shoulder view, never a giant head
 * in the middle of the picture; at zero the pivot is the eye. Because the whole image shifts, the vanishing point of "forward" sits in
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
  /** Between these boom lengths the lens shift blends from first person (none) to the shoulder. */
  blendNear: .3,
  blendFar: 1.4,
  /** The head never sits higher on screen than this NDC height (−1 bottom, 1 top) except in first person. */
  headY: -.15,
  /** Wider than tall: thirds in landscape. Taller than wide: a little more centred and a wider lens. */
  landscape: { fov: 50, screenX: -.333, screenY: -.38 },
  portrait: { fov: 64, screenX: -.32, screenY: -.38 },
  /** Orbit radians per viewport height of drag. */
  orbitYaw: 2.6,
  orbitPitch: 1.7,
  /** Zoom parameter per wheel pixel; distance is maxDistance × z², so the last metre is finely controlled. */
  wheelZoom: .0007,
  /**
   * The wheel's closest third-person boom. First person is its own view (V, or the ledger), reached by an eased
   * swing of the boom rather than by wheeling into the skull.
   */
  minThirdDistance: .9,
  /** Seconds for the boom to swing between first and third person; reduced motion takes the short one. */
  viewSwing: .42,
  viewSwingReduced: .12,
  /** The field-of-view setting that draws today's accepted lens (50° vertical landscape); others scale from it. */
  defaultHorizontalFov: 74,
  /** Auto-follow waits this long after a manual orbit, then swings gently behind the walk. */
  followDelay: 1.5,
  followRate: .85,
  /** Exponential rates per second for presentation easing. */
  distanceRate: 14,
  heightRate: 12,
  /** The eased camera height never trails the body by more than this. */
  heightLag: .45,
  /** The local citizen fades between these eye-to-head distances, so first person never looks out through a skull. */
  selfFade: [.5, 1.25],
  /**
   * When a solid has pulled the boom in, the street matters more than the citizen: the fade starts further out,
   * so a camera backed against a wall looks past a faint figure rather than at the back of a giant head. It
   * blends in over the first metres the solid took away, so a wheeled-in view (the walker's own choice) keeps
   * the over-the-shoulder citizen and a wall arriving or leaving never pops the body.
   */
  pulledFade: [1.5, 2.4],
  /**
   * The citizen renderer fades with a screen-door pattern: a few per cent of a body this close reads as dirt
   * on the lens, so below this the citizen is simply not drawn.
   */
  fadeFloor: .05,
  pulledBlend: [.25, 1.5],
  /**
   * A fade follows a camera pulled in at once, but comes back at this rate per second: a boom springing out
   * of a corner travels most of a metre in its first frame, and the body should return, not flash on.
   */
  appearRate: 10,
} as const;

export type Vec3 = readonly [number, number, number];
export interface ShoulderView { readonly yaw: number; readonly pitch: number; readonly distance: number }
export interface ShoulderPose {
  /** The point above the feet the boom turns about; the eye stands the view's distance behind it. */
  readonly pivot: Vec3;
  readonly eye: Vec3;
  /** Unit look direction. Roll is always zero, so the horizon stays level. */
  readonly direction: Vec3;
  readonly fov: number;
  /** Fraction of the half-width the image is shifted; the aim column sits at NDC x = -shift. */
  readonly shift: number;
  /**
   * Opacity for the local citizen: it fades out as the eye nears the head and returns on zoom out. From
   * `apply`, a boom a solid has pulled in fades it from further away (`selfFade`).
   */
  readonly selfOpacity: number;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Framing for an aspect ratio, blended between portrait and landscape so a rotating phone never jumps. */
export function framingFor(aspect: number, fovScale = 1): { fov: number; screenX: number; screenY: number } {
  const t = smoothstep(.75, 1.2, Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const { portrait: p, landscape: l } = SHOULDER;
  const scale = Number.isFinite(fovScale) && fovScale > 0 ? fovScale : 1;
  return { fov: Math.min(120, lerp(p.fov, l.fov) * scale), screenX: lerp(p.screenX, l.screenX), screenY: lerp(p.screenY, l.screenY) };
}

/**
 * The field-of-view setting is horizontal degrees on a 16:10 landscape screen (what players compare between games);
 * the framings are vertical. The default, 74° horizontal, draws today's accepted lens exactly.
 */
export function fovScaleFor(horizontalDegrees: number): number {
  if (!Number.isFinite(horizontalDegrees)) return 1;
  const vertical = (degrees: number) => 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(degrees) / 2) / 1.6);
  return vertical(horizontalDegrees) / vertical(SHOULDER.defaultHorizontalFov);
}

/**
 * Opacity of the local citizen for an eye `eyeToHead` metres from the head, when a solid has cut the boom
 * `pulledIn` metres short of where the wheel left it (0: nothing in the way).
 */
export function selfFade(eyeToHead: number, pulledIn = 0): number {
  const k = smoothstep(SHOULDER.pulledBlend[0], SHOULDER.pulledBlend[1], Number.isFinite(pulledIn) ? pulledIn : 0);
  const near = SHOULDER.selfFade[0] + (SHOULDER.pulledFade[0] - SHOULDER.selfFade[0]) * k;
  const far = SHOULDER.selfFade[1] + (SHOULDER.pulledFade[1] - SHOULDER.selfFade[1]) * k;
  const opacity = smoothstep(near, far, eyeToHead);
  return opacity < SHOULDER.fadeFloor ? 0 : opacity;
}

/** Pure camera placement for feet at `feet`, the given view and aspect. */
export function shoulderPose(feet: Vec3, view: ShoulderView, aspect: number, fovScale = 1): ShoulderPose {
  const frame = framingFor(aspect, fovScale);
  const d = Math.max(0, view.distance);
  const tan = Math.tan(THREE.MathUtils.degToRad(frame.fov) / 2);
  const sinPitch = Math.sin(view.pitch), cosPitch = Math.cos(view.pitch);
  // A point h below the pivot lands at NDC y = −lift when lift·tan·(d − h·sinφ) = h·cosφ.
  const below = (lift: number) => lift * tan * d / Math.max(.2, cosPitch - lift * tan * sinPitch);
  // Body centre on the lower third, and the head no higher than headY: whichever needs the higher pivot.
  const pivotHeight = Math.max(SHOULDER.bodyCentre + below(-frame.screenY), SHOULDER.eyeHeight + below(-SHOULDER.headY));
  const direction: Vec3 = [Math.sin(view.yaw) * cosPitch, -sinPitch, Math.cos(view.yaw) * cosPitch];
  const pivot: Vec3 = [feet[0], feet[1] + pivotHeight, feet[2]];
  const eye: Vec3 = [pivot[0] - direction[0] * d, pivot[1] - direction[1] * d, pivot[2] - direction[2] * d];
  // Fade by how close the eye actually is to the head.
  const ex = eye[0] - feet[0], ey = eye[1] - feet[1] - SHOULDER.eyeHeight, ez = eye[2] - feet[2];
  const shift = -frame.screenX * smoothstep(SHOULDER.blendNear, SHOULDER.blendFar, d);
  return { pivot, eye, direction, fov: frame.fov, shift, selfOpacity: selfFade(Math.sqrt(ex * ex + ey * ey + ez * ez)) };
}

/** The `filmOffset` (millimetres of film) that shifts the image by `shift` of its half-width. */
export function filmOffsetFor(camera: THREE.PerspectiveCamera, shift: number, aspect = camera.aspect): number {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
  return shift * aspect * tan * camera.filmGauge * Math.min(aspect, 1);
}

export interface ShoulderRig {
  /** The view being drawn, after easing and occlusion: `distance` is the boom actually drawn. */
  readonly view: ShoulderView;
  /** Where the wheel asked the boom to be; easing and occlusion never overwrite it. */
  readonly desiredDistance: number;
  /** The wheel's wish after presentation easing, before any solid shortens it. */
  readonly zoomDistance: number;
  /** How far the boom could reach this frame when a solid cut it short, otherwise null. */
  readonly clearance: number | null;
  /** Seconds since the last manual orbit. */
  readonly idle: number;
  /** Drag in CSS pixels against a viewport of `viewportHeight` CSS pixels. */
  orbit(dx: number, dy: number, viewportHeight: number): void;
  /** Wheel pixels; positive pulls back, negative leans in, down to the closest third-person boom. */
  zoom(pixels: number): void;
  /** The person's view: third person on the boom, or first person at the eyes. The boom swings between them. */
  readonly person: 'third' | 'first';
  setPerson(person: 'third' | 'first', options?: { readonly instant?: boolean; readonly reducedMotion?: boolean }): void;
  /** Scale of every framing's field of view (see fovScaleFor). */
  setFovScale(scale: number): void;
  /**
   * A place's camera limits (a low tavern room): the boom never reaches past `maxDistance` and the pitch eases into
   * `[minPitch, maxPitch]` (radians below the horizon). Null lifts them; the wheel's own wish returns, eased.
   */
  setLimits(limits: { readonly maxDistance: number; readonly minPitch: number; readonly maxPitch: number } | null): void;
  /** Advance presentation easing and auto-follow behind `travelHeading` while moving at `speed` m/s. */
  update(dt: number, travelHeading: number | null, speed: number, holding: boolean): void;
  /**
   * Place `camera` for the citizen's rendered feet. With a collision world the boom is swept first: a solid
   * pulls the camera in before this very frame is drawn, and only clear air lets it ease back out.
   * Optional `cameraY` supplies step-only easing without moving the feet used for the collision anchor.
   */
  apply(camera: THREE.PerspectiveCamera, feet: Vec3, aspect: number, world?: CollisionWorld | null, cameraY?: number): ShoulderPose;
  /** Entry framing behind `heading`, with all eased state dropped. */
  reset(heading: number): void;
  /** Keep the chosen view but drop easing, so the next frame lands exactly on the citizen (camera handed back). */
  settle(): void;
}

export function createShoulderRig(heading = 0): ShoulderRig {
  let yaw = wrapAngle(heading), pitch: number = SHOULDER.pitch, zoomT = Math.sqrt(SHOULDER.distance / SHOULDER.maxDistance);
  const minZoomT = Math.sqrt(SHOULDER.minThirdDistance / SHOULDER.maxDistance);
  // 0 is third person, 1 first; `swing` eases between them so V never pops the camera.
  let person: 'third' | 'first' = 'third', swing = 0, swingFrom = 0, swingAt = 1, swingSeconds: number = SHOULDER.viewSwing, fovScale = 1;
  const swingEase = () => { const t = Math.max(0, Math.min(1, swingAt)); return swingFrom + ((person === 'first' ? 1 : 0) - swingFrom) * t * t * (3 - 2 * t); };
  let distance: number = SHOULDER.distance, idle = Infinity, followY: number | null = null, lastStep = 0;
  // `drawn` is the boom on screen; `tracking` means it follows the zoom directly (no solid in the way last frame).
  let drawn: number = SHOULDER.distance, tracking = true, clearance: number | null = null;
  // The citizen's opacity as last drawn; null takes the next frame's value as it is (entry, handback).
  let shown: number | null = null;
  let limits: { readonly maxDistance: number; readonly minPitch: number; readonly maxPitch: number } | null = null;
  const desired = () => Math.min(limits?.maxDistance ?? Infinity, SHOULDER.maxDistance * zoomT * zoomT) * (1 - swing);
  const pitchRange = (): readonly [number, number] => limits
    ? [Math.max(SHOULDER.minPitch, limits.minPitch), Math.min(SHOULDER.maxPitch, limits.maxPitch)] : [SHOULDER.minPitch, SHOULDER.maxPitch];
  const look = new THREE.Vector3();
  return {
    get view() { return { yaw, pitch, distance: drawn }; },
    get desiredDistance() { return desired(); },
    get zoomDistance() { return distance; },
    get clearance() { return clearance; },
    get idle() { return idle; },
    orbit(dx, dy, viewportHeight) {
      const h = Math.max(1, viewportHeight);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
      // Dragging right turns the view right; dragging up looks up.
      yaw = wrapAngle(yaw - dx / h * SHOULDER.orbitYaw);
      const [low, high] = pitchRange();
      // Inside a place's range the hand moves freely; outside it (just walked in) it may only move back toward it.
      const next = pitch + dy / h * SHOULDER.orbitPitch;
      pitch = Math.max(Math.min(low, pitch), Math.min(Math.max(high, pitch), next));
      pitch = Math.max(SHOULDER.minPitch, Math.min(SHOULDER.maxPitch, pitch));
      idle = 0;
    },
    zoom(pixels) {
      if (!Number.isFinite(pixels) || !pixels || person === 'first') return;
      zoomT = Math.max(minZoomT, Math.min(1, zoomT + pixels * SHOULDER.wheelZoom));
    },
    get person() { return person; },
    setPerson(next, options) {
      if (next !== 'first' && next !== 'third') return;
      if (next === person && !options?.instant) return;
      swingFrom = swing; person = next; swingAt = 0;
      swingSeconds = options?.reducedMotion ? SHOULDER.viewSwingReduced : SHOULDER.viewSwing;
      if (options?.instant) { swingAt = 1; swing = person === 'first' ? 1 : 0; distance = desired(); drawn = distance; tracking = true; shown = null; }
    },
    setFovScale(scale) { if (Number.isFinite(scale) && scale > 0) fovScale = scale; },
    setLimits(next) {
      if (next && (!(next.maxDistance > 0) || !Number.isFinite(next.minPitch) || !Number.isFinite(next.maxPitch) || next.minPitch > next.maxPitch)) next = null;
      limits = next ? { maxDistance: next.maxDistance, minPitch: next.minPitch, maxPitch: next.maxPitch } : null;
    },
    update(dt, travelHeading, speed, holding) {
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
      lastStep = step;
      if (holding) idle = 0; else idle += step;
      if (swingAt < 1) {
        // The swing is the boom's own ease: the distance follows it directly so the two never fight.
        swingAt = Math.min(1, swingAt + step / swingSeconds);
        swing = swingEase();
        distance = desired();
      }
      const [low, high] = pitchRange();
      if (pitch < low || pitch > high) pitch += (Math.max(low, Math.min(high, pitch)) - pitch) * (1 - Math.exp(-SHOULDER.distanceRate * step));
      const target = desired();
      distance += (target - distance) * (1 - Math.exp(-SHOULDER.distanceRate * step));
      if (Math.abs(target - distance) < 1e-4) distance = target;
      if (tracking) drawn = distance;
      if (travelHeading === null || idle < SHOULDER.followDelay || !(speed > .5)) return;
      // Swing behind the walk, never through a reversal: walking back toward the camera keeps the view.
      const delta = angleBetween(yaw, travelHeading);
      if (Math.abs(delta) > 2) return;
      yaw = wrapAngle(yaw + delta * (1 - Math.exp(-SHOULDER.followRate * Math.min(1, speed / 4) * step)));
    },
    apply(camera, feet, aspect, world, cameraY) {
      // A caller with predicted grounded state supplies step-only easing; do not smooth jumps a second time.
      if (cameraY !== undefined && Number.isFinite(cameraY)) followY = cameraY;
      else if (followY === null) followY = feet[1];
      else {
        followY = Math.max(feet[1] - SHOULDER.heightLag, Math.min(feet[1] + SHOULDER.heightLag, followY));
        followY += (feet[1] - followY) * (1 - Math.exp(-SHOULDER.heightRate * lastStep));
      }
      let limit = distance;
      let headOffset = 0;
      clearance = null;
      if (world) {
        // camera.zoom narrows the drawn frustum; the footprint uses the narrowed angle.
        const zoom = camera.zoom || 1;
        const point = (d: number, y: number): BoomPoint => {
          const p = shoulderPose([feet[0], y + headOffset, feet[2]], { yaw, pitch, distance: d }, aspect, fovScale);
          const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(p.fov) / 2) / zoom));
          return { distance: d, eye: p.eye, footprint: nearFootprint(p.direction, fov, aspect, p.shift, camera.near) };
        };
        // Looking up can put the near plane above the crown even when the real head is clear. Lower the
        // camera within the supported body envelope so the zero-boom fallback is itself a safe view.
        const crown = point(0, feet[1]);
        headOffset = Math.min(0, feet[1] + WALK_BODY.height - crown.eye[1] - crown.footprint.max[1]);
        const lagged = followY;
        const clear = clearBoom(world, point(0, feet[1]), d => point(d, lagged), distance);
        if (clear.settle) followY = feet[1];
        if (clear.occluded) clearance = clear.distance;
        limit = clear.distance;
      }
      // In at once, before this frame is drawn; out again only through clear air, eased over ~.35 s.
      if (limit <= drawn || tracking) drawn = limit;
      else {
        drawn += (limit - drawn) * (1 - Math.exp(-RECOVER_RATE * lastStep));
        if (limit - drawn < 1e-3) drawn = limit;
      }
      tracking = drawn >= distance - 1e-9;
      const pose = shoulderPose([feet[0], followY + headOffset, feet[2]], { yaw, pitch, distance: drawn }, aspect, fovScale);
      camera.position.set(...pose.eye);
      camera.up.set(0, 1, 0);
      camera.lookAt(look.set(pose.eye[0] + pose.direction[0], pose.eye[1] + pose.direction[1], pose.eye[2] + pose.direction[2]));
      // Build and the Forge compose with a view offset. The near-plane footprint above assumes the plain
      // frustum, so a view offset left behind by any earlier owner would let the drawn frustum reach a wall.
      if (camera.view?.enabled) camera.clearViewOffset();
      const changedFov = Math.abs(camera.fov - pose.fov) > 1e-6 || Math.abs(camera.aspect - aspect) > 1e-6;
      camera.fov = pose.fov; camera.aspect = aspect;
      const film = filmOffsetFor(camera, pose.shift, aspect);
      if (changedFov || Math.abs(camera.filmOffset - film) > 1e-6) { camera.filmOffset = film; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld();
      const ex = pose.eye[0] - feet[0], ey = pose.eye[1] - feet[1] - SHOULDER.eyeHeight, ez = pose.eye[2] - feet[2];
      const target = selfFade(Math.sqrt(ex * ex + ey * ey + ez * ez), Math.max(0, distance - drawn));
      if (shown === null || target <= shown) shown = target;
      else {
        shown += (target - shown) * (1 - Math.exp(-SHOULDER.appearRate * lastStep));
        if (target - shown < 1e-3) shown = target;
      }
      return { ...pose, selfOpacity: shown };
    },
    reset(value) {
      yaw = wrapAngle(value); pitch = SHOULDER.pitch; idle = Infinity; followY = null;
      zoomT = Math.sqrt(SHOULDER.distance / SHOULDER.maxDistance); swingAt = 1; swing = person === 'first' ? 1 : 0; distance = desired();
      drawn = distance; tracking = true; clearance = null; shown = null;
    },
    // The next apply still sweeps the boom, so a camera handed back in a tight spot is pulled in on its first frame.
    settle() { followY = null; distance = desired(); drawn = distance; tracking = true; idle = Infinity; shown = null; },
  };
}
