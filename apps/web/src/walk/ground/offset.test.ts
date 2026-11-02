import { describe, expect, it } from 'vitest';
import { createGroundOffset, followsDrawnGround, GROUND_OFFSET, type GroundOffsetSample } from './offset';
import type { WalkerSupport } from './support';

/** A 0.3 rise slope and its physics ground: half-metre cells whose heights are rounded to half a metre. */
const drawnSlope = (z: number) => .3 * z;
const physicsSlope = (z: number) => Math.round(drawnSlope(z) / .5) * .5;

type Frame = Partial<GroundOffsetSample> & { readonly z: number };
function drive(frames: readonly Frame[], dt = 1 / 60) {
  const offset = createGroundOffset(), drawn: number[] = [];
  for (const frame of frames) {
    const y = frame.y ?? physicsSlope(frame.z);
    const sample: GroundOffsetSample = { y, drawnY: frame.drawnY === undefined ? drawnSlope(frame.z) : frame.drawnY,
      support: frame.support ?? 'terrain', grounded: frame.grounded, posed: frame.posed, dt: frame.dt ?? dt };
    drawn.push(y + offset.update(sample));
  }
  return { offset, drawn };
}

describe('the visual ground offset', () => {
  it('draws a body walking a slope exactly on the drawn surface, never on the half-metre physics steps', () => {
    const frames = Array.from({ length: 240 }, (_, n) => ({ z: n * 4 / 60 }));
    const { drawn } = drive(frames);
    frames.forEach((frame, n) => expect(drawn[n]).toBeCloseTo(drawnSlope(frame.z), 12));
    // The physics body pops by half a metre; the drawn body's largest frame-to-frame change is the slope's rise.
    let pop = 0, bodyPop = 0;
    for (let n = 1; n < frames.length; n++) {
      pop = Math.max(pop, Math.abs(drawn[n]! - drawn[n - 1]!));
      bodyPop = Math.max(bodyPop, Math.abs(physicsSlope(frames[n]!.z) - physicsSlope(frames[n - 1]!.z)));
    }
    expect(bodyPop).toBe(.5);
    expect(pop).toBeLessThanOrEqual(.3 * 4 / 60 + 1e-9);
  });

  it('starts on the drawn ground with no fade, and adds nothing on flat ground', () => {
    expect(drive([{ z: 1.2 }]).drawn[0]).toBeCloseTo(drawnSlope(1.2), 12);
    const flat = drive(Array.from({ length: 30 }, (_, n) => ({ z: n * .1, y: 2, drawnY: 2 })));
    expect(flat.offset.value).toBe(0);
    expect(flat.offset.following).toBe(true);
  });

  it.each<[string, Frame]>([
    ['a floor', { z: 3, support: 'solid' }],
    ['a stair', { z: 3, y: 1.25, support: 'solid' }],
    ['a jump', { z: 3, grounded: false }],
    ['a seat', { z: 3, posed: true }],
    ['ground that is not drawn here', { z: 3, drawnY: null }],
  ])('fades to the physical height on %s, without a pop, and back on terrain', (_name, away) => {
    const before = Array.from({ length: 30 }, () => ({ z: 2.9 }));
    const leave = Array.from({ length: 60 }, () => away);
    const back = Array.from({ length: 60 }, () => ({ z: 2.9 }));
    const { offset, drawn } = drive([...before, ...leave, ...back]);
    const gap = drawnSlope(2.9) - physicsSlope(2.9);
    expect(Math.abs(gap)).toBeGreaterThan(.1);
    const awayY = away.y ?? physicsSlope(away.z);
    // The first frame off terrain moves at most one easing step from the drawn ground.
    const step = 1 - Math.exp(-1 / 60 / GROUND_OFFSET.seconds);
    expect(Math.abs(drawn[30]! - awayY - gap)).toBeLessThanOrEqual(Math.abs(gap) * step + 1e-9);
    // Within half a second it is exactly the physical height: zero indoors, on stairs, in the air, seated.
    expect(drawn[89]).toBe(awayY);
    expect(drawn[149]).toBeCloseTo(drawnSlope(2.9), 9);
    expect(offset.following).toBe(true);
  });

  it('never moves the body more than the clamp, and trusts no sample beyond the trust bound', () => {
    expect(followsDrawnGround({ y: 0, drawnY: GROUND_OFFSET.trust, support: 'terrain' })).toBe(true);
    expect(followsDrawnGround({ y: 0, drawnY: GROUND_OFFSET.trust + 1e-6, support: 'terrain' })).toBe(false);
    expect(followsDrawnGround({ y: 0, drawnY: Number.POSITIVE_INFINITY, support: 'terrain' })).toBe(false);
    // A gap past the clamp is drawn as near the surface as allowed, and the gait is not told it is on the surface.
    const clamped = drive([{ z: 0, y: 0, drawnY: -.5 }, { z: 0, y: 0, drawnY: -.5 }]);
    expect(clamped.drawn).toEqual([-GROUND_OFFSET.clamp, -GROUND_OFFSET.clamp]);
    expect(clamped.offset.following).toBe(false);
    // A sample far from the feet (a cliff, another surface) fades the offset out.
    const { drawn } = drive([{ z: 0, y: 0, drawnY: .2 }, ...Array.from({ length: 60 }, () => ({ z: 0, y: 0, drawnY: 2 }))]);
    for (const y of drawn) expect(Math.abs(y)).toBeLessThanOrEqual(GROUND_OFFSET.clamp);
    expect(drawn.at(-1)).toBe(0);
  });

  it('starts fresh after a reset, and is frame-rate independent', () => {
    const offset = createGroundOffset();
    offset.update({ y: 0, drawnY: .2, support: 'terrain', dt: 1 / 60 });
    offset.reset();
    expect(offset.value).toBe(0);
    expect(offset.update({ y: 0, drawnY: .2, support: 'solid', dt: 1 / 60 })).toBe(0);
    const fade = (fps: number) => {
      const o = createGroundOffset();
      o.update({ y: 0, drawnY: .2, support: 'terrain', dt: 1 / fps });
      let value = 0;
      for (let n = 0; n < fps / 10; n++) value = o.update({ y: 0, drawnY: .2, support: 'solid' as WalkerSupport, dt: 1 / fps });
      return value;
    };
    expect(fade(30)).toBeCloseTo(fade(120), 9);
    expect(fade(60)).toBeCloseTo(.2 * Math.exp(-1), 9);
    const stalled = createGroundOffset();
    stalled.update({ y: 0, drawnY: .2, support: 'terrain', dt: 1 / 60 });
    expect(stalled.update({ y: 0, drawnY: .2, support: 'solid', dt: Number.NaN })).toBeCloseTo(.2, 12);
  });
});
