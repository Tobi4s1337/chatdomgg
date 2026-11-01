import { PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '@chatdom/shared';
import { boundedOverviewView, orbitOverviewView, type OverviewFrame, type OverviewView } from './overview-pose';

/** One virtual lens protects orbit state from the host's base director. The host owns every tick. */
export function createGrandOverview(canvas: HTMLCanvasElement, frame: OverviewFrame, initial?: OverviewView) {
  const saved = boundedOverviewView(frame, initial ?? frame.initial);
  const originalTouchAction = canvas.style.touchAction;
  const lens = new PerspectiveCamera(), controls = new OrbitControls(lens, canvas);
  controls.enablePan = false; controls.enableDamping = false; controls.enabled = false;
  canvas.style.touchAction = originalTouchAction;
  controls.minDistance = frame.limits.minDistance; controls.maxDistance = frame.limits.maxDistance;
  controls.minPolarAngle = Math.PI / 2 - frame.limits.maxPitch; controls.maxPolarAngle = Math.PI / 2 - frame.limits.minPitch;
  controls.zoomSpeed = .8; controls.rotateSpeed = .55;
  let active = false, disposed = false, revision = 0;
  const read = (): OverviewView => ({ eye: lens.position.toArray() as Vec3, target: controls.target.toArray() as Vec3, fov: lens.fov });
  function restore(view: OverviewView) {
    if (disposed) return;
    const bounded = boundedOverviewView(frame, view);
    lens.position.set(...bounded.eye); controls.target.set(...bounded.target); lens.fov = bounded.fov;
    controls.update(); revision++;
  }
  controls.addEventListener('change', () => { revision++; });
  restore(saved);
  return {
    get revision() { return revision; },
    orbit(yaw: number | null, pitch: number | null, distance: number | null) { if (!disposed) restore(orbitOverviewView(frame, read(), yaw, pitch, distance)); },
    reset() { restore(frame.initial); },
    restore,
    capture: read,
    setActive(value: boolean) {
      const next = value && !disposed;
      if (active === next) return;
      active = next; controls.enabled = active;
      canvas.style.touchAction = active ? 'none' : originalTouchAction;
    },
    apply(camera: PerspectiveCamera, target: Vector3) {
      if (!active || disposed) return false;
      controls.update(); camera.position.copy(lens.position); target.copy(controls.target); camera.lookAt(target);
      if (camera.fov !== lens.fov) { camera.fov = lens.fov; camera.updateProjectionMatrix(); }
      return true;
    },
    inspect() {
      const view = read(), spherical = new Spherical().setFromVector3(lens.position.clone().sub(controls.target));
      return { active, ...view, yaw: spherical.theta, pitch: Math.PI / 2 - spherical.phi, distance: spherical.radius, limits: { ...frame.limits } };
    },
    dispose() { if (disposed) return; disposed = true; active = false; controls.dispose(); canvas.style.touchAction = originalTouchAction; },
  };
}
