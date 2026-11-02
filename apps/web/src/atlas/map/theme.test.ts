// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { geographyOf } from '../data/model';
import { makeWorld } from '../data/fixtures.test-support';
import { hexToRgb, landTint, OUTER_TINT, REALM_ACCENTS, realmTints, regionTint, type TintRealm } from './theme';

const chroma = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
};
const luma = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Hue in degrees, for telling a warm clay from vermilion. */
const hue = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

/** A continent like the real ones: the Crossroads at the heart, a ring of family realms, the Wilds outside. */
function ringContinent(region: number, families: number, firstIndex = 0): TintRealm[] {
  const realms: TintRealm[] = [{ index: firstIndex, region, kind: 'crossroads', family: -1, x: 0, y: 0, r: 100 }];
  for (let i = 0; i < families; i++) {
    const a = (i / families) * Math.PI * 2;
    realms.push({ index: firstIndex + 1 + i, region, kind: 'family', family: i, x: Math.cos(a) * 260, y: Math.sin(a) * 260, r: 130 });
  }
  realms.push({ index: firstIndex + families + 1, region, kind: 'wilds', family: -1, x: 520, y: 0, r: 120 });
  return realms;
}

const touching = (a: TintRealm, b: TintRealm) => a.region === b.region && Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 1.2;

describe('realmTints', () => {
  it('gives touching family realms of one land different washes', () => {
    for (const families of [3, 6, 9, 14]) {
      const realms = ringContinent(0, families);
      const tints = realmTints(realms, [{ index: 0, kind: 'continent' }]);
      for (const a of realms) {
        for (const b of realms) {
          if (a.index < b.index && a.kind === 'family' && b.kind === 'family' && touching(a, b)) expect(tints[a.index], `${families}: ${a.index}/${b.index}`).not.toBe(tints[b.index]);
        }
      }
    }
  });

  it('lets one family keep its accent across lands where nothing touching wears it', () => {
    const regions = [{ index: 0, kind: 'continent' }, { index: 1, kind: 'continent' }];
    const realms = [...ringContinent(0, 4), ...ringContinent(1, 4, 6)];
    const tints = realmTints(realms, regions);
    // Family 0 wears the accent it would wear alone in either land, mixed into that land's own pigment.
    const alone = (realm: TintRealm) => realmTints([{ ...realm, index: 0 }], regions)[0];
    expect(tints[1]).toBe(alone(realms[1]!));
    expect(tints[7]).toBe(alone(realms[7]!));
    expect(tints[1]).not.toBe(tints[7]);
    expect(new Set([0, 1, 2, 3].map((family) => realmTints([{ ...realms[1]!, index: 0, family }], regions)[0])).size).toBe(Math.min(4, REALM_ACCENTS.length));
  });

  it('draws the Crossroads paler and the Wilds deeper than the land, an isle in its language’s colour, the Outer Isles in graphite', () => {
    const geo = geographyOf(makeWorld());
    const tints = realmTints(geo.realms, geo.regions);
    const land = landTint(geo.regions[0]!);
    expect(luma(tints[0]!)).toBeGreaterThan(luma(land)); // the Crossroads
    expect(luma(tints[3]!)).toBeLessThan(luma(land)); // the Wilds
    expect(tints[4]).toBe(regionTint(1)); // the isle Deutsch
    expect(tints[5]).toBe(OUTER_TINT);
    expect(landTint(geo.regions[2]!)).toBe(OUTER_TINT);
    expect(new Set(tints.slice(0, 4)).size).toBe(4); // four realms of one continent, four washes
  });

  it('is the same on every call (two bakers must agree) and stays a restrained watercolour, never vermilion', () => {
    const regions = Array.from({ length: 12 }, (_, index) => ({ index, kind: index === 11 ? 'outer' : index > 6 ? 'isle' : 'continent' }));
    const realms: TintRealm[] = [];
    for (let region = 0; region < 7; region++) realms.push(...ringContinent(region, 14, realms.length));
    for (let region = 7; region < 12; region++) realms.push({ index: realms.length, region, kind: region === 11 ? 'outer' : 'isle', family: -1, x: 0, y: 0, r: 50 });
    const tints = realmTints(realms, regions);
    expect(realmTints(realms, regions)).toEqual(tints);
    for (const tint of tints) {
      expect(tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(chroma(tint), tint).toBeLessThan(0.36);
      // Vermilion sits near 6° at a chroma around 0.7; anything near its hue stays a pale clay.
      const h = hue(tint);
      if (h < 31 || h > 341) expect(chroma(tint), `${tint} reads as red`).toBeLessThan(0.25);
    }
  });
});
