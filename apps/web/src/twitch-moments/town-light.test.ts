import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getEnvironment } from '@chatdom/render';
import { skyLitEnvironment } from './town-light';

const hue = (hex: string) => { const c = new THREE.Color(hex), hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl); return { ...hsl, c }; };

describe('the town under a sky moment', () => {
  const dusk = getEnvironment(19.5);

  it('leaves the hour alone when the sky is quiet', () => {
    expect(skyLitEnvironment(dusk, null)).toBe(dusk);
    expect(skyLitEnvironment(dusk, { colour: [0, 0, 0], strength: 0, hush: 0, night: 0 })).toBe(dusk);
  });

  it('draws the dusk down under Skyfire, then lets the aurora green the moonlight on the roofs', () => {
    const dimmed = skyLitEnvironment(dusk, { colour: [0, 0, 0], strength: 0, night: 0.55 });
    expect(dimmed.ambientIntensity).toBeLessThan(dusk.ambientIntensity * 0.8);
    expect(dimmed.sunIntensity).toBeLessThan(dusk.sunIntensity);
    // Toward indigo, never toward grey or black.
    expect(hue(dimmed.ambient).h).toBeGreaterThan(0.6);
    expect(hue(dimmed.ambient).l).toBeGreaterThan(0.2);

    const green: [number, number, number] = [0.25, 1, 0.55];
    const lit = skyLitEnvironment(dusk, { colour: green, strength: 0.32, night: 0.55 });
    const moon = hue(lit.sun).c, before = hue(dusk.sun).c;
    expect(moon.g / (moon.r + moon.b)).toBeGreaterThan(before.g / (before.r + before.b));
    expect(lit.sunIntensity).toBeGreaterThan(dimmed.sunIntensity);
    // The parts of the grade the moment does not own are the hour's own.
    for (const key of ['zenith', 'horizon', 'fog', 'glow', 'cloud', 'cloudShade', 'cloudCover', 'fogDensity', 'exposure', 'night', 'sunDirection'] as const) expect(lit[key]).toEqual(dusk[key]);
  });

  it('holds its breath before a climax and never goes past its bounds, whatever it is handed', () => {
    const hushed = skyLitEnvironment(dusk, { colour: [1, 0.8, 0.5], strength: 0, hush: 0.4 });
    expect(hushed.ambientIntensity).toBeCloseTo(dusk.ambientIntensity * 0.8, 5);
    const wild = skyLitEnvironment(dusk, { colour: [Number.NaN, 9, -3], strength: 40, hush: 9, night: Number.POSITIVE_INFINITY });
    expect(Number.isFinite(wild.ambientIntensity) && wild.ambientIntensity > 0).toBe(true);
    expect(wild.sunIntensity).toBeLessThanOrEqual(dusk.sunIntensity + 0.6 * 0.75 + 1e-9);
    expect(wild.ambient).toMatch(/^#[0-9a-f]{6}$/);
    expect(skyLitEnvironment(dusk, { colour: [0.2, 1, 0.5], strength: 0.3, night: 0.4 })).toEqual(skyLitEnvironment(dusk, { colour: [0.2, 1, 0.5], strength: 0.3, night: 0.4 }));
  });
});
