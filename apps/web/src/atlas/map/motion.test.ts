// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Camera, MAX_SCALE, NO_INSETS, type Box, type Insets, type Viewport } from './camera';
import { centreForFocus, FLIGHT, focusOf, HERO_DRIFT_STEP_PX, heroDrift, insideFree, planAnchoredZoom, planFlight, screenShift, type CameraState } from './motion';

/** The bounds of a real survey preview (world units). */
const BOUNDS: Box = { minX: -1230, minY: -1445, maxX: 1360, maxY: 878 };
const LAPTOP: Viewport = { width: 1440, height: 900 };
const PHONE: Viewport = { width: 390, height: 844 };
const WORLD_WIDTH = BOUNDS.maxX - BOUNDS.minX;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

/** Samples a flight every `step` ms (a 60 Hz frame by default), including its end. */
function sample(flight: ReturnType<typeof planFlight>, step = 1000 / 60): CameraState[] {
  const out: CameraState[] = [];
  for (let ms = 0; ms < flight.duration; ms += step) out.push(flight.at(ms));
  out.push(flight.at(flight.duration));
  return out;
}

describe('planFlight', () => {
  it('lands exactly on its target and starts exactly at its origin', () => {
    const from = { x: -600, y: 200, scale: 0.5 };
    const to = { x: 900, y: -1100, scale: 22 };
    const flight = planFlight(from, to, { width: 1440 });
    const start = flight.at(0);
    expect(start.x).toBeCloseTo(from.x, 9);
    expect(start.y).toBeCloseTo(from.y, 9);
    expect(start.scale).toBeCloseTo(from.scale, 9);
    expect(flight.at(flight.duration)).toEqual(to);
    expect(flight.at(flight.duration + 5_000)).toEqual(to);
  });

  it('is bounded below three seconds for any pair of views on the map', () => {
    const random = seeded(7);
    for (let i = 0; i < 160; i++) {
      const from = { x: BOUNDS.minX + random() * WORLD_WIDTH, y: BOUNDS.minY + random() * 2300, scale: 0.3 * (MAX_SCALE / 0.3) ** random() };
      const to = { x: BOUNDS.minX + random() * WORLD_WIDTH, y: BOUNDS.minY + random() * 2300, scale: 0.3 * (MAX_SCALE / 0.3) ** random() };
      const flight = planFlight(from, to, { width: random() < 0.5 ? 1440 : 390, maxWorldWidth: WORLD_WIDTH * 1.1 });
      expect(flight.duration).toBeLessThan(3_000);
      expect(flight.duration).toBeGreaterThanOrEqual(FLIGHT.minMs);
      for (const state of sample(flight, 40)) {
        expect(Number.isFinite(state.x) && Number.isFinite(state.y) && Number.isFinite(state.scale)).toBe(true);
        expect(state.scale).toBeGreaterThan(0);
      }
    }
  });

  it('rises to see both ends of a long hop at deep zoom, then descends (the van Wijk arc)', () => {
    const from = { x: -900, y: -900, scale: 20 };
    const to = { x: 1000, y: 500, scale: 20 };
    const states = sample(planFlight(from, to, { width: 1440 }));
    const lowest = Math.min(...states.map((state) => state.scale));
    // At the top of the arc both kingdoms fit in the view's width.
    expect(1440 / lowest).toBeGreaterThan(Math.hypot(1900, 1400) * 0.5);
    // Scale falls, then rises: one valley, no wobble.
    const valley = states.findIndex((state) => state.scale === lowest);
    for (let i = 1; i <= valley; i++) expect(states[i]!.scale).toBeLessThanOrEqual(states[i - 1]!.scale + 1e-9);
    for (let i = valley + 1; i < states.length; i++) expect(states[i]!.scale).toBeGreaterThanOrEqual(states[i - 1]!.scale - 1e-9);
  });

  it('never rises past the whole map, however far the hop', () => {
    const maxWorldWidth = WORLD_WIDTH * 1.05;
    const from = { x: BOUNDS.minX, y: BOUNDS.minY, scale: MAX_SCALE };
    const to = { x: BOUNDS.maxX, y: BOUNDS.maxY, scale: MAX_SCALE };
    for (const width of [1440, 390]) {
      const states = sample(planFlight(from, to, { width, maxWorldWidth }));
      const widest = Math.max(...states.map((state) => width / state.scale));
      expect(widest).toBeLessThanOrEqual(maxWorldWidth * 1.001);
    }
  });

  it('moves monotonically toward the target along the straight line between centres', () => {
    const from = { x: 0, y: 0, scale: 2 };
    const to = { x: 300, y: 400, scale: 9 };
    const states = sample(planFlight(from, to, { width: 1440 }));
    let travelled = 0;
    for (const state of states) {
      const along = (state.x * 300 + state.y * 400) / 500;
      const across = (state.x * 400 - state.y * 300) / 500;
      expect(Math.abs(across)).toBeLessThan(1e-9);
      expect(along).toBeGreaterThanOrEqual(travelled - 1e-9);
      travelled = along;
    }
  });

  it('reduces equal centres to a pure zoom, and equal views to the shortest still move', () => {
    const zoom = planFlight({ x: 10, y: 20, scale: 1 }, { x: 10, y: 20, scale: 16 }, { width: 1440 });
    for (const state of sample(zoom)) {
      expect(state.x).toBeCloseTo(10, 9);
      expect(state.y).toBeCloseTo(20, 9);
    }
    const scales = sample(zoom).map((state) => state.scale);
    for (let i = 1; i < scales.length; i++) expect(scales[i]!).toBeGreaterThanOrEqual(scales[i - 1]! - 1e-12);
    const still = planFlight({ x: 10, y: 20, scale: 3 }, { x: 10, y: 20, scale: 3 }, { width: 1440 });
    expect(still.duration).toBe(FLIGHT.minMs);
    for (const state of sample(still)) expect(state).toEqual({ x: 10, y: 20, scale: 3 });
  });

  it('makes one short composed move without an arc under reduced motion', () => {
    const flight = planFlight({ x: -900, y: -900, scale: 20 }, { x: 1000, y: 500, scale: 20 }, { width: 1440, reducedMotion: true });
    expect(flight.duration).toBe(FLIGHT.reducedMs);
    for (const state of sample(flight)) expect(state.scale).toBeCloseTo(20, 9);
  });

  it('interrupted at any moment, a new flight starts from the current view with no jump', () => {
    const first = planFlight({ x: -500, y: 0, scale: 1 }, { x: 700, y: -300, scale: 25 }, { width: 1440 });
    for (const fraction of [0.1, 0.5, 0.9]) {
      const here = first.at(first.duration * fraction);
      const second = planFlight(here, { x: 0, y: 0, scale: 3 }, { width: 1440 });
      const start = second.at(0);
      expect(start.x).toBeCloseTo(here.x, 9);
      expect(start.y).toBeCloseTo(here.y, 9);
      expect(start.scale).toBeCloseTo(here.scale, 9);
    }
  });
});

describe('planAnchoredZoom', () => {
  it('keeps the world point under the anchor fixed for the whole step', () => {
    const view = LAPTOP;
    const from = { x: 120, y: -40, scale: 3 };
    const anchor = { x: 1100, y: 210 };
    const world = { x: from.x + (anchor.x - view.width / 2) / from.scale, y: from.y + (anchor.y - view.height / 2) / from.scale };
    const flight = planAnchoredZoom(from, 5.4, anchor, view);
    for (let ms = 0; ms <= flight.duration; ms += 16) {
      const state = flight.at(ms);
      const sx = (world.x - state.x) * state.scale + view.width / 2;
      const sy = (world.y - state.y) * state.scale + view.height / 2;
      expect(sx).toBeCloseTo(anchor.x, 6);
      expect(sy).toBeCloseTo(anchor.y, 6);
    }
    expect(flight.at(flight.duration).scale).toBe(5.4);
  });
});

describe('focus and padding', () => {
  const sheet: Insets = { left: 0, right: 0, top: 120, bottom: 420 };

  it('puts the focus at the centre of the free area above a phone sheet', () => {
    const focus = { x: 300, y: -200, scale: 8 };
    const camera = centreForFocus(focus, PHONE, sheet);
    const sy = (focus.y - camera.y) * camera.scale + PHONE.height / 2;
    const sx = (focus.x - camera.x) * camera.scale + PHONE.width / 2;
    expect(sy).toBeCloseTo((120 + 844 - 420) / 2, 9);
    expect(sx).toBeCloseTo(195, 9);
    expect(insideFree(focus, camera, PHONE, sheet, 48)).toBe(true);
    expect(focusOf(camera, PHONE, sheet)).toEqual(focus);
  });

  it('a flight planned in focus space lands its target clear of the sheet even after a resize mid-flight', () => {
    const target = { x: 640, y: 120, scale: 12 };
    const flight = planFlight({ x: 0, y: 0, scale: 1 }, target, { width: PHONE.width });
    const resized: Viewport = { width: 844, height: 390 };
    const landing = centreForFocus(flight.at(flight.duration), resized, NO_INSETS);
    expect(insideFree(target, landing, resized, NO_INSETS, 48)).toBe(true);
    const onPhone = centreForFocus(flight.at(flight.duration), PHONE, sheet);
    expect(insideFree(target, onPhone, PHONE, sheet, 48)).toBe(true);
  });

  it('reports a mark under the sheet or the card as not free', () => {
    const camera = { x: 0, y: 0, scale: 4 };
    expect(insideFree({ x: 0, y: 60 }, camera, PHONE, sheet, 48)).toBe(false);
    const card: Insets = { left: 0, right: 380, top: 0, bottom: 0 };
    expect(insideFree({ x: 120, y: 0 }, camera, LAPTOP, card, 48)).toBe(false);
    expect(insideFree({ x: -120, y: 0 }, camera, LAPTOP, card, 48)).toBe(true);
  });

  it('a flown-to target ends inside the camera clamp of the real map', () => {
    const camera = new Camera(BOUNDS);
    camera.home(LAPTOP);
    const target = centreForFocus({ x: 1300, y: 860, scale: 20 }, LAPTOP, NO_INSETS);
    camera.x = target.x;
    camera.y = target.y;
    camera.scale = target.scale;
    camera.clamp(LAPTOP);
    const s = camera.worldToScreen(1300, 860, LAPTOP);
    expect(s.x).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(LAPTOP.width);
    expect(s.y).toBeGreaterThan(0);
    expect(s.y).toBeLessThan(LAPTOP.height);
  });
});

describe('hero drift', () => {
  const base: CameraState = { x: 120, y: -340, scale: 1.1 };
  const HERO: Viewport = { width: 1920, height: 1080 };

  it('stays within its bounds and starts at its base', () => {
    expect(heroDrift(base, 0)).toEqual(base);
    for (let s = 0; s < 4_000; s += 7) {
      const at = heroDrift(base, s);
      expect(Math.abs(at.x - base.x) * base.scale).toBeLessThanOrEqual(36 + 1e-9);
      expect(Math.abs(at.y - base.y) * base.scale).toBeLessThanOrEqual(22 + 1e-9);
      expect(Math.abs(at.scale / base.scale - 1)).toBeLessThanOrEqual(0.018 + 1e-12);
    }
  });

  it('measures a shift, a zoom and their sum in device pixels', () => {
    expect(screenShift(base, base, HERO, 2)).toBe(0);
    expect(screenShift(base, { ...base, x: base.x + 1 / base.scale }, HERO, 1)).toBeCloseTo(1, 9);
    expect(screenShift(base, { ...base, x: base.x + 1 / base.scale }, HERO, 2)).toBeCloseTo(2, 9);
    const corner = Math.hypot(1920, 1080) / 2;
    expect(screenShift(base, { ...base, scale: base.scale * 1.001 }, HERO, 1)).toBeCloseTo(corner * 0.001, 6);
  });

  it('asks for a few frames a second at 60 Hz, never a frame each, and never a visible step', () => {
    // The loop's own rule, frame by frame over ten minutes: draw only once the view moved a quarter device pixel.
    for (const [view, ratio] of [[HERO, 1], [HERO, 2], [PHONE, 3]] as const) {
      let drawn = heroDrift(base, 0);
      let draws = 0;
      let largest = 0;
      const frames = 60 * 600;
      for (let f = 1; f <= frames; f++) {
        const next = heroDrift(base, f / 60);
        const step = screenShift(drawn, next, view, ratio);
        if (step < HERO_DRIFT_STEP_PX) continue;
        largest = Math.max(largest, step);
        drawn = next;
        draws++;
      }
      expect(draws).toBeGreaterThan(0);
      expect(draws / 600).toBeLessThan(6);
      expect(largest).toBeLessThan(HERO_DRIFT_STEP_PX + 0.05);
    }
  });
});
