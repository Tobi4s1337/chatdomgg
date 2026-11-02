import { describe, expect, it } from 'vitest';
import { WINDOW_VIEW_ASPECT, WINDOW_VIEW_ZOOM, windowViewCrop } from './window-view';

const painting = { width: 640, height: 400 };

describe('the window view on the You tab', () => {
  it('centres a window in the middle of the painting', () => {
    const crop = windowViewCrop({ x: .5, y: .45 }, painting)!;
    expect(crop.centre).toEqual({ x: .5, y: .45 });
    expect(crop.ring.x).toBeCloseTo(.5);
    expect(crop.ring.y).toBeCloseTo(.5);
  });

  it('stops at the painting edge and moves the ring toward the window instead', () => {
    // A home at the painting's bottom-left corner.
    const crop = windowViewCrop({ x: .06, y: .9061 }, painting)!;
    const tall = WINDOW_VIEW_ZOOM * (400 / 640) / WINDOW_VIEW_ASPECT;
    expect(crop.centre.x).toBeCloseTo(1 / (2 * WINDOW_VIEW_ZOOM));
    expect(crop.centre.y).toBeCloseTo(1 - 1 / (2 * tall));
    // The arch's left and bottom edges sit on the painting's edges.
    expect(crop.centre.x * WINDOW_VIEW_ZOOM).toBeCloseTo(.5);
    expect((1 - crop.centre.y) * tall).toBeCloseTo(.5);
    // The ring still lands on the window, inside the arch.
    expect(crop.ring.x).toBeGreaterThan(0);
    expect(crop.ring.x).toBeLessThan(.5);
    expect(crop.ring.y).toBeGreaterThan(.5);
    expect(crop.ring.y).toBeLessThan(1);
    expect(crop.centre.x + (crop.ring.x - .5) / WINDOW_VIEW_ZOOM).toBeCloseTo(.06);
    expect(crop.centre.y + (crop.ring.y - .5) / tall).toBeCloseTo(.9061);
  });

  it('keeps the window centred when the painting has room around it', () => {
    // The painting's real mark for the newcomer at the edge of town.
    const crop = windowViewCrop({ x: .1328, y: .8242 }, painting)!;
    expect(crop.centre.x).toBeCloseTo(.1328);
    expect(crop.ring.x).toBeCloseTo(.5);
    expect(crop.ring.y).toBeGreaterThanOrEqual(.5);
  });

  it('refuses marks outside the painting and paintings without a size', () => {
    expect(windowViewCrop({ x: -.01, y: .5 }, painting)).toBeNull();
    expect(windowViewCrop({ x: .5, y: 1.2 }, painting)).toBeNull();
    expect(windowViewCrop({ x: Number.NaN, y: .5 }, painting)).toBeNull();
    expect(windowViewCrop({ x: .5, y: .5 }, { width: 0, height: 400 })).toBeNull();
  });
});
