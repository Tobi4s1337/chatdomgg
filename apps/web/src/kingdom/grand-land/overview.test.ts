import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { createGrandOverview } from './overview';
import { overviewFrame } from './overview-pose';

class CanvasEvents extends EventTarget {
  style = { touchAction: 'pan-y', cursor: 'auto' };
  ownerDocument = new EventTarget();
  clientWidth = 1440;
  clientHeight = 900;
  getRootNode() { return this.ownerDocument; }
}
const frame = overviewFrame(new Box3(new Vector3(-500, -20, -500), new Vector3(1200, 300, 1200)), new Box3(new Vector3(-100, 0, -120), new Vector3(270, 60, 300)), 16 / 10);

describe('overview lens ownership in the existing scene loop', () => {
  it('keeps orbit state across base-camera writes and yields without moving a walking/capture lens', () => {
    const canvas = new CanvasEvents(), owner = createGrandOverview(canvas as unknown as HTMLCanvasElement, frame);
    const camera = new PerspectiveCamera(), target = new Vector3();
    owner.setActive(true); owner.orbit(.8, .6, 700); owner.apply(camera, target);
    const view = owner.capture();
    camera.position.set(2, 3, 4); target.set(5, 6, 7); camera.fov = 70;
    owner.apply(camera, target);
    expect(camera.position.distanceTo(new Vector3(...view.eye))).toBeLessThan(1e-9);
    expect(target.toArray()).toEqual(view.target); expect(camera.fov).toBe(view.fov);
    owner.setActive(false);
    camera.position.set(2, 3, 4); target.set(5, 6, 7); camera.fov = 70;
    expect(owner.apply(camera, target)).toBe(false);
    expect(camera.position.toArray()).toEqual([2, 3, 4]); expect(target.toArray()).toEqual([5, 6, 7]); expect(camera.fov).toBe(70);
    expect(canvas.style.touchAction).toBe('pan-y');
    owner.setActive(true); owner.apply(camera, target);
    expect(camera.position.distanceTo(new Vector3(...view.eye))).toBeLessThan(1e-9);
    owner.dispose();
  });

  it('disposes input handlers and restores touch scrolling without mutating the final pose', () => {
    const canvas = new CanvasEvents(), owner = createGrandOverview(canvas as unknown as HTMLCanvasElement, frame);
    owner.setActive(true); expect(canvas.style.touchAction).toBe('none');
    const view = owner.capture(); owner.dispose(); owner.dispose();
    const wheel = new Event('wheel', { cancelable: true }); canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false); expect(canvas.style.touchAction).toBe('pan-y');
    owner.orbit(1, .7, 400); owner.reset(); owner.setActive(true);
    expect(owner.capture()).toEqual(view); expect(owner.inspect().active).toBe(false);
    expect(owner.apply(new PerspectiveCamera(), new Vector3())).toBe(false);
  });
});
