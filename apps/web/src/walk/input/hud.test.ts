import { describe, expect, it } from 'vitest';
import { THUMB, thumbSlots, type ThumbSlot } from './hud';
import { stickRegion, TOUCH } from './touch';

const SCREENS = [[390, 844], [360, 640], [430, 932], [844, 390], [667, 375], [768, 1024], [1024, 768]] as const;

/** Every point on the disc's rim and its centre, sampled finely enough for a 30 px button. */
function rim(slot: ThumbSlot): [number, number][] {
  const points: [number, number][] = [[slot.x, slot.y]];
  for (let n = 0; n < 64; n++) points.push([slot.x + Math.cos(n / 32 * Math.PI) * slot.radius, slot.y + Math.sin(n / 32 * Math.PI) * slot.radius]);
  return points;
}

describe('the phone thumb map', () => {
  for (const [width, height] of SCREENS) it(`keeps the stick, Jump and the interaction's action apart at ${width}×${height}`, () => {
    const { stick, jump, action } = thumbSlots(width, height);
    // A thumb walking never lands on a button: both lie wholly outside the stick region.
    for (const slot of [jump, action]) for (const [x, y] of rim(slot)) expect(stickRegion(x, y, width, height)).toBe('orbit');
    // The action is a real touch target and never touches Jump.
    expect(action.radius * 2).toBeGreaterThanOrEqual(44);
    expect(Math.hypot(action.x - jump.x, action.y - jump.y)).toBeGreaterThanOrEqual(action.radius + jump.radius + 20);
    // Everything is on screen, the action above Jump within the right thumb's reach.
    for (const slot of [jump, action]) {
      expect(slot.x + slot.radius).toBeLessThanOrEqual(width);
      expect(slot.y - slot.radius).toBeGreaterThan(height * .1);
      expect(slot.y + slot.radius).toBeLessThan(height);
    }
    expect(action.y).toBeLessThan(jump.y);
    expect(jump.y - action.y).toBeLessThan(height * .3);
    // The resting stick is whole on screen and inside its own region, level with Jump.
    expect(stick.x - stick.radius).toBeGreaterThanOrEqual(TOUCH.edge);
    expect(stickRegion(stick.x, stick.y, width, height)).toBe('stick');
    expect(stick.y).toBe(jump.y);
  });

  it('places Jump where its stylesheet draws it', () => {
    // .walk-jump: right 22 px, 64 px wide.
    expect(THUMB.jumpInset).toBe(22 + THUMB.jumpRadius);
    expect(thumbSlots(390, 844).jump).toEqual({ x: 390 - 54, y: 844 * .66, radius: 32 });
  });
});
